import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log } from './core/logger.js';

/**
 * Jugadores, lista blanca y datos para conectarse desde la red local.
 * Todo pasa por RCON, así que funciona igual si el servidor lo arrancó la app o start.bat.
 * Los comandos van por mc.vanilla(): en Paper con el prefijo "minecraft:" (formato de vanilla aunque
 * haya plugins) y en NeoForge/Fabric sin él, porque ahí no existe.
 */
const NAME = /^[A-Za-z0-9_]{3,16}$/; // nombres válidos de Minecraft Java (evita meter otros comandos)
const httpError = (status, message) => Object.assign(new Error(message), { status });

export function validName(name) {
  const n = String(name ?? '').trim();
  if (!NAME.test(n)) throw httpError(400, 'Nombre inválido: deben ser de 3 a 16 caracteres (letras, números o _)');
  return n;
}

/** Lee server.properties (puerto, lista blanca, online-mode, máximo de jugadores). */
export function readServerProperties(dir) {
  const props = {};
  if (!dir) return props;
  try {
    for (const line of fs.readFileSync(path.join(dir, 'server.properties'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([^#=\s][^=]*)=(.*)$/.exec(line);
      if (m) props[m[1].trim()] = m[2].trim();
    }
  } catch { /* sin archivo */ }
  return props;
}

/** IPs IPv4 de esta PC; marca las que son de red local (192.168.x.x, 10.x.x.x, 172.16–31.x.x). */
export function localAddresses() {
  const list = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [x, y] = a.address.split('.').map(Number);
      const lan = x === 10 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31);
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Tailscale|ZeroTier|Radmin/i.test(iface);
      list.push({ address: a.address, iface, lan, virtual });
    }
  }
  // Primero las de red local "reales"; las virtuales (WSL, VPN…) al final
  return list.sort((a, b) => (b.lan - a.lan) || (a.virtual - b.virtual));
}

/** "There are 2 of a max of 20 players online: A, B" → { count, max, players } */
export function parseList(text) {
  const t = String(text ?? '');
  const m = /(\d+)\s+(?:of a max of|out of maximum)\s+(\d+)/i.exec(t);
  const names = t.includes(':') ? t.slice(t.lastIndexOf(':') + 1).split(',').map((s) => s.trim()).filter((s) => NAME.test(s)) : [];
  return { count: m ? Number(m[1]) : names.length, max: m ? Number(m[2]) : null, players: names };
}

/** "There are 2 whitelisted player(s): A, B" / "There are no whitelisted players" → [nombres] */
export function parseWhitelist(text) {
  const t = String(text ?? '');
  if (!t.includes(':')) return [];
  return t.slice(t.indexOf(':') + 1).split(',').map((s) => s.trim()).filter((s) => NAME.test(s)).sort((a, b) => a.localeCompare(b));
}

export class PlayerManager {
  constructor({ mc, getDir, settingsFile = path.resolve('config', 'servidor.json') }) {
    this.mc = mc;
    this.getDir = getDir;
    this.settingsFile = settingsFile;
  }

  #settings() {
    try { return JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')); } catch { return {}; }
  }

  /** Dirección pública (por ejemplo la de Playit.gg) para tenerla a mano en el panel. Vacía = quitarla. */
  setPublicAddress(value) {
    const address = String(value ?? '').trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
    if (address && !/^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/.test(address)) {
      throw httpError(400, 'Dirección inválida. Escríbela como te la da Playit, por ejemplo algo.tun.ply.gg');
    }
    const settings = { ...this.#settings(), publicAddress: address };
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true });
    fs.writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2));
    return this.network();
  }

  #requireRcon() {
    if (!this.mc.connected) throw httpError(409, 'El servidor de Minecraft no está conectado (RCON). Enciéndelo para usar esta sección.');
  }

  network() {
    const props = readServerProperties(this.getDir());
    return {
      addresses: localAddresses(),
      publicAddress: this.#settings().publicAddress || '',
      port: Number(props['server-port'] || 25565),
      whitelistInFile: props['white-list'] === 'true' || props['enforce-whitelist'] === 'true',
      onlineMode: props['online-mode'] !== 'false',
      maxPlayers: props['max-players'] ? Number(props['max-players']) : null,
      propertiesFound: Object.keys(props).length > 0
    };
  }

  async players() {
    if (!this.mc.connected) return { connected: false, count: 0, max: null, players: [] };
    return { connected: true, ...parseList(await this.mc.vanilla('list')) };
  }

  async whitelist() {
    if (!this.mc.connected) return { connected: false, players: [], enabled: this.network().whitelistInFile };
    const players = parseWhitelist(await this.mc.vanilla('whitelist list'));
    return { connected: true, players, enabled: this.network().whitelistInFile };
  }

  async whitelistAction(action, name) {
    this.#requireRcon();
    let command;
    if (action === 'add' || action === 'remove') command = `whitelist ${action} ${validName(name)}`;
    else if (action === 'on' || action === 'off') command = `whitelist ${action}`;
    else throw httpError(400, 'Acción desconocida');
    const response = await this.mc.vanilla(command);
    log.action(`/${command}  →  ${response}`);
    // Para "on/off", el servidor guarda el cambio en server.properties; esperar un momento para leerlo bien
    if (action === 'on' || action === 'off') await new Promise((r) => setTimeout(r, 300));
    const result = { response: translate(response), ...(await this.whitelist()) };
    // Si server.properties tarda en actualizarse, confiar en la orden que se acaba de dar
    if (action === 'on' || action === 'off') result.enabled = action === 'on';
    return result;
  }

  async kick(name, reason) {
    this.#requireRcon();
    const clean = String(reason ?? '').replace(/[^\p{L}\p{N} .,!?¡¿_-]/gu, '').slice(0, 80);
    const command = `kick ${validName(name)}${clean ? ` ${clean}` : ''}`;
    const response = await this.mc.vanilla(command);
    log.action(`/${command}  →  ${response}`);
    return { response: translate(response) };
  }
}

/** Respuestas comunes del servidor, en español. */
function translate(text) {
  const t = String(text ?? '').trim();
  const rules = [
    [/^Added (\w+) to the whitelist/i, (m) => `${m[1]} se agregó a la lista blanca.`],
    [/^Removed (\w+) from the whitelist/i, (m) => `${m[1]} se quitó de la lista blanca.`],
    [/already whitelisted/i, () => 'Ese jugador ya estaba en la lista blanca.'],
    [/not whitelisted/i, () => 'Ese jugador no estaba en la lista blanca.'],
    [/That player does not exist|Unknown player|No player was found/i, () => 'No existe una cuenta de Minecraft con ese nombre (o no está conectado).'],
    [/Whitelist is now turned on/i, () => 'Lista blanca activada.'],
    [/Whitelist is now turned off/i, () => 'Lista blanca desactivada: cualquiera con la dirección puede entrar.'],
    [/Whitelist is already turned on/i, () => 'La lista blanca ya estaba activada.'],
    [/Whitelist is already turned off/i, () => 'La lista blanca ya estaba desactivada.'],
    [/^Kicked (\w+)/i, (m) => `${m[1]} fue expulsado del servidor.`]
  ];
  for (const [re, fn] of rules) {
    const m = re.exec(t);
    if (m) return fn(m);
  }
  return t || 'Listo.';
}
