import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { log } from './core/logger.js';

/**
 * Instalaciones del servidor de Minecraft: cada una es una carpeta con su propio mundo,
 * lista blanca, server.properties y mods o plugins. Solo una está activa a la vez y es
 * la que arranca el botón ▶ Iniciar. Se guardan en config/instalaciones.json.
 */
const httpError = (status, message) => Object.assign(new Error(message), { status });
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const list = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
const MEMORY = /^\d{1,3}[MG]$/i;

export const TYPES = {
  paper: 'Paper', purpur: 'Purpur', vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt',
  neoforge: 'NeoForge', forge: 'Forge', jar: 'Servidor .jar', unknown: 'Sin servidor'
};

/** Busca el archivo de argumentos de NeoForge/Forge moderno (el que usa su run.bat). */
function argsFile(dir, group) {
  const base = path.join(dir, 'libraries', ...group);
  const versions = list(base).filter((v) => isDir(path.join(base, v))).sort().reverse();
  for (const v of versions) {
    const file = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
    const rel = path.join('libraries', ...group, v, file);
    if (exists(path.join(dir, rel))) return { rel, version: v };
  }
  return null;
}

const countJars = (dir) => list(dir).filter((f) => f.toLowerCase().endsWith('.jar')).length;

/** Contraseña de RCON que quedó en server.properties (para avisar si no coincide con la del .env). */
export function readRconPassword(dir) {
  try {
    const m = /^rcon\.password=(.*?)\r?$/m.exec(fs.readFileSync(path.join(dir, 'server.properties'), 'utf8'));
    return m ? m[1].replace(/\\(.)/g, '$1') : null;
  } catch { return null; }
}

/** Mira qué tipo de servidor hay en la carpeta y cómo se arranca. */
export function detectInstallation(dir) {
  const info = { exists: isDir(dir), type: 'unknown', label: TYPES.unknown, version: null, launch: null, mods: 0, plugins: 0, eula: false, world: false, propertiesFound: false };
  if (!info.exists) return info;

  info.mods = countJars(path.join(dir, 'mods'));
  info.plugins = countJars(path.join(dir, 'plugins'));
  info.eula = /eula\s*=\s*true/i.test((() => { try { return fs.readFileSync(path.join(dir, 'eula.txt'), 'utf8'); } catch { return ''; } })());
  info.propertiesFound = exists(path.join(dir, 'server.properties'));
  info.world = isDir(path.join(dir, 'world'));

  const set = (type, launch, version = null) => Object.assign(info, { type, label: TYPES[type], launch, version });

  // NeoForge y Forge modernos (1.17+) no tienen un .jar para "-jar": usan un archivo de argumentos
  const neo = argsFile(dir, ['net', 'neoforged', 'neoforge']);
  if (neo) return set('neoforge', { kind: 'args', args: neo.rel }, neo.version);
  const forge = argsFile(dir, ['net', 'minecraftforge', 'forge']);
  if (forge) return set('forge', { kind: 'args', args: forge.rel }, forge.version);

  const jars = list(dir).filter((f) => f.toLowerCase().endsWith('.jar'));
  const find = (re) => jars.find((f) => re.test(f));
  const versionFrom = (name) => /(\d+\.\d+(?:\.\d+)?)/.exec(name)?.[1] ?? null;
  let jar;
  if ((jar = find(/^fabric-server-launch(er)?\.jar$/i) ?? find(/fabric/i))) return set('fabric', { kind: 'jar', jar }, versionFrom(jar));
  if ((jar = find(/quilt/i))) return set('quilt', { kind: 'jar', jar }, versionFrom(jar));
  if ((jar = find(/purpur/i))) return set('purpur', { kind: 'jar', jar }, versionFrom(jar));
  if ((jar = find(/^paper\.jar$/i) ?? find(/paper/i))) return set('paper', { kind: 'jar', jar }, versionFrom(jar));
  if ((jar = find(/forge/i))) return set('forge', { kind: 'jar', jar }, versionFrom(jar)); // Forge viejo (1.16 o antes)
  if ((jar = find(/^server\.jar$/i) ?? find(/^minecraft_server/i))) return set('vanilla', { kind: 'jar', jar }, versionFrom(jar));
  if (jars.length) return set('jar', { kind: 'jar', jar: jars[0] }, versionFrom(jars[0]));
  return info;
}

/** Instalaciones de Java en las rutas habituales de Windows (cada versión de Minecraft pide una). */
export function detectJavas() {
  if (process.platform !== 'win32') return [];
  const env = process.env;
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean).flatMap((pf) =>
    ['Java', 'Eclipse Adoptium', 'Amazon Corretto', 'Microsoft', 'Zulu', 'BellSoft', 'Semeru', 'Temurin'].map((v) => path.join(pf, v)));
  const found = [];
  for (const root of roots) {
    for (const name of list(root)) {
      const home = path.join(root, name);
      const exe = path.join(home, 'bin', 'java.exe');
      if (!exists(exe)) continue;
      let version = null;
      try { version = /JAVA_VERSION="([^"]+)"/.exec(fs.readFileSync(path.join(home, 'release'), 'utf8'))?.[1] ?? null; } catch { /* sin archivo release */ }
      found.push({ path: exe, version, vendor: path.basename(root), name });
    }
  }
  return found.sort((a, b) => (parseInt(b.version) || 0) - (parseInt(a.version) || 0));
}

/** Versión de un java.exe concreto (para mostrarla en el panel). */
export function javaVersion(java) {
  return new Promise((resolve) => {
    execFile(java, ['-version'], { windowsHide: true, timeout: 8000 }, (err, stdout, stderr) => {
      resolve(err ? null : /version "([^"]+)"/.exec(`${stderr}${stdout}`)?.[1] ?? null);
    });
  });
}

/**
 * Antes de arrancar: deja RCON y el puerto como los espera la app, para que cualquier
 * instalación se pueda controlar igual (y la dirección de Playit siga sirviendo).
 */
export function prepareInstallation(dir, { rconPort, rconPassword, serverPort = 25565 }) {
  // Nunca escribir valores vacíos o "undefined" (dejarían RCON sin funcionar)
  if (!rconPassword || !Number.isInteger(Number(rconPort))) throw new Error('Falta la contraseña o el puerto de RCON para preparar server.properties');
  const file = path.join(dir, 'server.properties');
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* primera vez: el servidor completa el resto al arrancar */ }
  const wanted = {
    'enable-rcon': 'true', 'rcon.port': String(rconPort), 'rcon.password': rconPassword, 'server-port': String(serverPort),
    // Que los comandos de la app y de la consola del panel no llenen el chat de los ops con "[Rcon: …]"
    'broadcast-rcon-to-ops': 'false', 'broadcast-console-to-ops': 'false'
  };
  const lines = text ? text.split(/\r?\n/) : ['#Minecraft server properties'];
  const changed = [];
  for (const [key, value] of Object.entries(wanted)) {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i === -1) { lines.splice(lines[lines.length - 1] === '' ? lines.length - 1 : lines.length, 0, `${key}=${value}`); changed.push(key); }
    else if (lines[i] !== `${key}=${value}`) { lines[i] = `${key}=${value}`; changed.push(key); }
  }
  if (changed.length) {
    fs.writeFileSync(file, lines.join('\n').replace(/\n*$/, '\n'));
    log.info(`server.properties ajustado: ${changed.map((k) => (k === 'rcon.password' ? 'contraseña de RCON' : k)).join(', ')}`);
  }
  return changed;
}

export class InstallationStore {
  constructor(file, { seedDir, defaults }) {
    this.file = file;
    this.defaults = defaults; // { java, memoryMin, memoryMax, extraArgs } del .env
    this.data = { active: null, items: [] };
    try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* primera vez */ }
    // La carpeta de MC_SERVER_DIR se vuelve la primera instalación
    if (this.data.items.length === 0 && seedDir) {
      const info = detectInstallation(seedDir);
      this.data.items.push(this.#normalize({ id: 'principal', name: info.type === 'unknown' ? 'Principal' : info.label, dir: seedDir }));
      this.data.active = 'principal';
      this.#save();
    }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  #normalize(raw, prev = {}) {
    const item = { ...prev };
    if (raw.name !== undefined) {
      item.name = String(raw.name).trim().slice(0, 40);
      if (!item.name) throw httpError(400, 'Ponle un nombre a la instalación');
    }
    if (raw.dir !== undefined) {
      item.dir = path.resolve(String(raw.dir).trim().replace(/^"|"$/g, ''));
      if (!isDir(item.dir)) throw httpError(400, `No existe la carpeta ${item.dir}`);
      const dup = this.data.items.find((i) => i.id !== prev.id && i.dir.toLowerCase() === item.dir.toLowerCase());
      if (dup) throw httpError(409, `Esa carpeta ya está registrada como "${dup.name}"`);
    }
    if (raw.java !== undefined) item.java = String(raw.java ?? '').trim().replace(/^"|"$/g, '') || null;
    for (const key of ['memoryMin', 'memoryMax']) {
      if (raw[key] === undefined) continue;
      const v = String(raw[key] ?? '').trim().toUpperCase();
      if (v && !MEMORY.test(v)) throw httpError(400, 'La memoria se escribe como 2G, 4G o 3072M');
      item[key] = v || null;
    }
    if (raw.extraArgs !== undefined) item.extraArgs = String(raw.extraArgs ?? '').trim();
    if (raw.id) item.id = raw.id;
    return item;
  }

  /** Configuración efectiva: lo de la instalación y, si falta algo, lo del .env. */
  effective(item) {
    return {
      ...item,
      java: item.java || this.defaults.java,
      memoryMin: item.memoryMin || this.defaults.memoryMin,
      memoryMax: item.memoryMax || this.defaults.memoryMax,
      extraArgs: item.extraArgs ?? this.defaults.extraArgs ?? ''
    };
  }

  get(id) {
    const item = this.data.items.find((i) => i.id === id);
    if (!item) throw httpError(404, 'Esa instalación no existe');
    return item;
  }

  get active() {
    return this.data.items.find((i) => i.id === this.data.active) ?? null;
  }

  list() {
    return {
      active: this.data.active,
      defaults: this.defaults,
      items: this.data.items.map((i) => ({ ...i, info: detectInstallation(i.dir) }))
    };
  }

  add(raw) {
    if (!raw?.dir) throw httpError(400, 'Elige la carpeta de la instalación');
    let id = String(raw.name ?? 'instalacion').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'instalacion';
    const base = id;
    for (let n = 2; this.data.items.some((i) => i.id === id); n++) id = `${base}-${n}`;
    const item = this.#normalize({ ...raw, id });
    if (raw.acceptEula) acceptEula(item.dir);
    this.data.items.push(item);
    if (!this.data.active) this.data.active = item.id;
    this.#save();
    return item;
  }

  update(id, raw) {
    const prev = this.get(id);
    const item = this.#normalize(raw, prev);
    if (raw.acceptEula) acceptEula(item.dir);
    this.data.items = this.data.items.map((i) => (i.id === id ? item : i));
    this.#save();
    return item;
  }

  /** Quita la instalación del panel (no borra ningún archivo). */
  remove(id) {
    this.get(id);
    if (this.data.active === id) throw httpError(409, 'No puedes quitar la instalación activa. Activa otra primero.');
    this.data.items = this.data.items.filter((i) => i.id !== id);
    this.#save();
  }

  setActive(id) {
    this.get(id);
    this.data.active = id;
    this.#save();
  }
}

export function acceptEula(dir) {
  fs.writeFileSync(path.join(dir, 'eula.txt'),
    '# Aceptado desde stream-interact: https://aka.ms/MinecraftEULA\neula=true\n');
}
