import fs from 'node:fs';
import path from 'node:path';
import { log } from './core/logger.js';
import { fill } from './core/rulesEngine.js';
import { stripEmojis } from './actions/minecraft.js';

/**
 * Reglas del mundo (/gamerule) desde el panel.
 *
 * Desde Minecraft 1.21.11 los nombres cambiaron a snake_case (keepInventory → keep_inventory,
 * doDaylightCycle → advance_time…). Aquí está cada regla con su nombre nuevo y el viejo,
 * y se usa el que entienda el servidor (las instalaciones con mods pueden ser versiones viejas).
 *
 * En Paper cada mundo (normal, Nether, End) tiene sus propias reglas, así que al cambiar
 * una se aplica en los tres.
 */
const httpError = (status, message) => Object.assign(new Error(message), { status });

export const GAMERULES = [
  // Chat
  { id: 'log_admin_commands', legacy: 'logAdminCommands', group: 'chat', type: 'bool', label: 'Avisar en el chat los comandos de administradores', hint: 'Apágalo para quitar los mensajes grises “[Rcon: …]” que salen cuando la app manda algo.' },
  { id: 'send_command_feedback', legacy: 'sendCommandFeedback', group: 'chat', type: 'bool', label: 'Mostrar el resultado de tus comandos', hint: 'Mensajes como “The difficulty has been set to…” cuando escribes un comando.' },
  { id: 'command_block_output', legacy: 'commandBlockOutput', group: 'chat', type: 'bool', label: 'Mensajes de bloques de comandos' },
  { id: 'show_death_messages', legacy: 'showDeathMessages', group: 'chat', type: 'bool', label: 'Mensajes de muerte' },
  { id: 'show_advancement_messages', legacy: 'announceAdvancements', group: 'chat', type: 'bool', label: 'Anunciar logros' },
  // Jugadores
  { id: 'keep_inventory', legacy: 'keepInventory', group: 'players', type: 'bool', label: 'Conservar el inventario al morir' },
  { id: 'immediate_respawn', legacy: 'doImmediateRespawn', group: 'players', type: 'bool', label: 'Reaparecer sin pantalla de muerte' },
  { id: 'natural_health_regeneration', legacy: 'naturalRegeneration', group: 'players', type: 'bool', label: 'Regenerar vida con la comida' },
  { id: 'fall_damage', legacy: 'fallDamage', group: 'players', type: 'bool', label: 'Daño por caída' },
  { id: 'pvp', legacy: null, group: 'players', type: 'bool', label: 'Daño entre jugadores (PvP)' },
  { id: 'players_sleeping_percentage', legacy: 'playersSleepingPercentage', group: 'players', type: 'int', min: 0, max: 100, label: 'Porcentaje de jugadores que deben dormir' },
  // Mundo
  { id: 'advance_time', legacy: 'doDaylightCycle', group: 'world', type: 'bool', label: 'Ciclo de día y noche' },
  { id: 'advance_weather', legacy: 'doWeatherCycle', group: 'world', type: 'bool', label: 'El clima cambia solo' },
  { id: 'spawn_mobs', legacy: 'doMobSpawning', group: 'world', type: 'bool', label: 'Aparecen mobs' },
  { id: 'spawn_phantoms', legacy: 'doInsomnia', group: 'world', type: 'bool', label: 'Phantoms si no duermes' },
  { id: 'mob_griefing', legacy: 'mobGriefing', group: 'world', type: 'bool', label: 'Los mobs rompen bloques (creepers, endermen)' },
  { id: 'spawn_patrols', legacy: 'doPatrolSpawning', group: 'world', type: 'bool', label: 'Patrullas de saqueadores' }
];

const DIMENSIONS = ['minecraft:the_nether', 'minecraft:the_end'];

function parseValue(text) {
  const m = /(?:currently set to|está establecida en|is set to)[:\s]*([\w.-]+)\s*$/i.exec(String(text ?? '').trim());
  return m ? m[1] : null;
}

export class GameruleManager {
  /**
   * file: dónde se guardan los cambios temporales pendientes de regresar (sobreviven a reiniciar la app)
   * getInstallationId: para regresar la regla solo en el mundo donde se cambió
   */
  constructor({ mc, file = null, getInstallationId = () => null }) {
    this.mc = mc;
    this.naming = null; // 'modern' | 'legacy' (se detecta una vez por conexión)
    this.file = file;
    this.getInstallationId = getInstallationId;
    this.temps = {};    // id → { value, original, until, installation, user, endMessage }
    if (file) { try { this.temps = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* nada pendiente */ } }
    this.timer = setInterval(() => this.#checkExpired(), 2000);
    this.timer.unref?.();
  }

  dispose() { clearInterval(this.timer); }

  #saveTemps() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.temps, null, 2));
  }

  /** Cambios temporales activos, para el panel. */
  temporaries() {
    return Object.entries(this.temps).map(([id, t]) => ({
      id, label: GAMERULES.find((r) => r.id === id)?.label ?? id, ...t,
      remainingMs: Math.max(0, t.until - Date.now()),
      otherInstallation: Boolean(t.installation && t.installation !== this.getInstallationId())
    }));
  }

  /**
   * Acción "gamerule" de las reglas: cambia una regla del mundo y, si tiene duración,
   * la regresa sola a como estaba. Si se vuelve a activar con el mismo valor antes de terminar,
   * el tiempo se suma (500 bits + 500 bits = el doble de tiempo).
   */
  async applyAction(action, vars = {}) {
    const rule = GAMERULES.find((r) => r.id === action.rule);
    if (!rule) throw new Error(`Regla del mundo desconocida: ${action.rule}`);
    const seconds = Math.max(0, Number(action.seconds) || 0);
    const now = Date.now();
    const current = this.temps[rule.id];
    const original = current ? current.original : await this.#currentValue(rule);

    const { value } = await this.set(rule.id, action.value);

    if (seconds === 0) {
      // Cambio permanente: ya no hay nada que regresar
      if (current) { delete this.temps[rule.id]; this.#saveTemps(); }
      return;
    }
    if (original === null) { log.warn(`No pude leer el valor actual de ${rule.id}; no se regresará solo`); return; }
    const sameValue = current && current.value === value;
    this.temps[rule.id] = {
      value, original,
      until: (sameValue ? Math.max(current.until, now) : now) + seconds * 1000,
      installation: this.getInstallationId(),
      user: vars.user ?? '',
      endMessage: action.endMessage || current?.endMessage || ''
    };
    this.#saveTemps();
    const left = Math.round((this.temps[rule.id].until - now) / 1000);
    log.info(`⏱ ${rule.label}: ${fmt(value)} por ${left} s (luego vuelve a ${fmt(original)})`);
  }

  /** Termina ya un cambio temporal (botón del panel). */
  async endNow(id) {
    if (!this.temps[id]) throw httpError(404, 'Ese cambio ya terminó');
    this.temps[id].until = 0;
    await this.#checkExpired();
    if (this.temps[id]) throw httpError(409, 'No se pudo regresar ahora (¿servidor apagado?). Se regresará al encender.');
    return this.temporaries();
  }

  async #currentValue(rule) {
    const naming = await this.#detect();
    const name = this.#name(rule, naming);
    const raw = name ? await this.#query(name) : null;
    return raw === null ? null : rule.type === 'bool' ? raw === 'true' : Number(raw);
  }

  async #checkExpired() {
    if (this.checking) return;
    const due = Object.entries(this.temps).filter(([, t]) => t.until <= Date.now());
    if (due.length === 0 || !this.mc.connected) return;
    this.checking = true;
    try {
      for (const [id, t] of due) {
        // Solo en el mundo donde se cambió (si cambiaste de instalación, espera a que vuelva a estar activa)
        if (t.installation && t.installation !== this.getInstallationId()) continue;
        try {
          await this.set(id, t.original);
          delete this.temps[id];
          this.#saveTemps();
          const rule = GAMERULES.find((r) => r.id === id);
          const text = t.endMessage ? fill(t.endMessage, { user: t.user }) : `${rule?.label ?? id}: volvió a la normalidad`;
          await this.mc.send(`tellraw @a ${JSON.stringify([{ text: '[Chat] ', color: 'aqua' }, { text: stripEmojis(text), color: 'green' }])}`).catch(() => {});
          log.info(`⏱ ${rule?.label ?? id} regresó a ${fmt(t.original)}`);
        } catch (err) {
          log.warn(`No se pudo regresar ${id} todavía: ${err.message}`);
        }
      }
    } finally { this.checking = false; }
  }

  #requireRcon() {
    if (!this.mc.connected) throw httpError(409, 'Enciende el servidor para cambiar las reglas del mundo.');
  }

  async #query(name) {
    try { return parseValue(await this.mc.send(`gamerule ${name}`)); } catch { return null; }
  }

  async #detect() {
    if (this.naming) return this.naming;
    if (await this.#query('keep_inventory') !== null) this.naming = 'modern';
    else if (await this.#query('keepInventory') !== null) this.naming = 'legacy';
    else throw httpError(502, 'El servidor no respondió a /gamerule. ¿Es un servidor de Minecraft Java?');
    return this.naming;
  }

  #name(rule, naming) {
    return naming === 'modern' ? rule.id : rule.legacy;
  }

  async list() {
    if (!this.mc.connected) { this.naming = null; return { connected: false, rules: [] }; }
    const naming = await this.#detect();
    const rules = [];
    for (const rule of GAMERULES) {
      const name = this.#name(rule, naming);
      const raw = name ? await this.#query(name) : null;
      if (raw === null) continue; // esta versión no tiene esa regla
      rules.push({ ...rule, name, value: rule.type === 'bool' ? raw === 'true' : Number(raw) });
    }
    return { connected: true, naming, rules };
  }

  async set(id, value) {
    this.#requireRcon();
    const rule = GAMERULES.find((r) => r.id === id);
    if (!rule) throw httpError(400, 'Regla desconocida');
    const naming = await this.#detect();
    const name = this.#name(rule, naming);
    if (!name) throw httpError(400, 'Esta versión de Minecraft no tiene esa regla');

    let v;
    if (rule.type === 'bool') v = value === true || value === 'true' ? 'true' : 'false';
    else {
      const n = Math.round(Number(value));
      if (!Number.isFinite(n) || n < rule.min || n > rule.max) throw httpError(400, `Debe ser un número de ${rule.min} a ${rule.max}`);
      v = String(n);
    }

    const response = await this.mc.send(`gamerule ${name} ${v}`);
    if (/unknown|incorrect|error|invalid/i.test(response ?? '')) throw httpError(400, `El servidor lo rechazó: ${response}`);
    // Paper guarda reglas por mundo: aplicarla también al Nether y al End (si existen)
    for (const dim of DIMENSIONS) await this.mc.send(`execute in ${dim} run gamerule ${name} ${v}`).catch(() => {});
    log.action(`/gamerule ${name} ${v}`);
    return { id, value: rule.type === 'bool' ? v === 'true' : Number(v) };
  }

  /** Para validar reglas guardadas desde el panel. */
  static isKnown(id) { return GAMERULES.some((r) => r.id === id); }

  /** Al reconectar (otro servidor u otra instalación) hay que volver a detectar los nombres. */
  reset() { this.naming = null; }
}

function fmt(v) {
  return typeof v === 'boolean' ? (v ? 'activado' : 'desactivado') : String(v);
}
