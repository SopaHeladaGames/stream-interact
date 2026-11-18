import { Rcon } from 'rcon-client';
import { fill } from '../core/rulesEngine.js';
import { log } from '../core/logger.js';

/**
 * Conexión RCON al servidor de Minecraft. Se reconecta sola si el servidor se cae
 * o si arrancas la app antes que el servidor.
 */
const UNKNOWN_COMMAND = /Unknown or incomplete command|Unknown command|Comando desconocido/i;

export class MinecraftRcon {
  constructor({ host, port, password }) {
    this.options = { host, port, password, timeout: 3000 };
    this.rcon = null;
    this.connecting = null;
  }

  async #connection() {
    if (this.rcon?.authenticated) return this.rcon;
    if (!this.connecting) {
      this.connecting = Rcon.connect(this.options)
        .then((rcon) => {
          log.info(`⛏️  Conectado a Minecraft por RCON (${this.options.host}:${this.options.port})`);
          rcon.on('end', () => { log.warn('Se cerró la conexión RCON'); this.rcon = null; });
          rcon.on('error', () => { this.rcon = null; });
          this.rcon = rcon;
          this.namespaced = null; // puede ser otro servidor (Paper, NeoForge…): volver a averiguarlo
          return rcon;
        })
        .finally(() => { this.connecting = null; });
    }
    return this.connecting;
  }

  get connected() {
    return Boolean(this.rcon?.authenticated);
  }

  async send(command) {
    const rcon = await this.#connection();
    // Traduce la sintaxis si la instalación activa es una versión vieja de Minecraft (ver mcCompat.js)
    return rcon.send(this.adapt ? this.adapt(command) : command);
  }

  /**
   * Comando de vanilla (list, whitelist, kick…). En Paper se manda como "minecraft:list" para que
   * ningún plugin cambie el formato de la respuesta; NeoForge, Fabric y vanilla no aceptan ese
   * prefijo, así que si lo rechaza se manda sin él y se recuerda para esta conexión.
   */
  async vanilla(command) {
    if (this.namespaced !== false) {
      const response = await this.send(`minecraft:${command}`);
      if (!UNKNOWN_COMMAND.test(response)) { this.namespaced = true; return response; }
      if (this.namespaced === true) return response; // ya sabíamos que acepta el prefijo: el error es del comando
      this.namespaced = false;
    }
    return this.send(command);
  }

  async tryConnect({ quiet = false } = {}) {
    try {
      await this.#connection();
    } catch (err) {
      if (!quiet) log.warn(`No se pudo conectar a Minecraft todavía (${err.message}). Se reintentará al llegar el primer evento.`);
    }
    return this.connected;
  }

  close() {
    this.rcon?.end().catch(() => {});
    this.rcon = null;
  }
}

/**
 * Funciones al azar dentro de un comando (se calculan en cada repetición):
 *   {azar:-4:4}            → un número entero entre -4 y 4 (para esparcir mobs: ~{azar:-4:4})
 *   {elegir:bread|apple}   → una de las opciones
 */
export function randomize(text) {
  return text
    .replace(/\{azar:(-?\d+):(-?\d+)\}/g, (_m, a, b) => {
      const lo = Math.min(Number(a), Number(b)); const hi = Math.max(Number(a), Number(b));
      return String(lo + Math.floor(Math.random() * (hi - lo + 1)));
    })
    .replace(/\{elegir:([^{}]+)\}/g, (_m, list) => {
      const opts = list.split('|').map((o) => o.trim()).filter(Boolean);
      return opts[Math.floor(Math.random() * opts.length)] ?? '';
    });
}

/**
 * Acción "minecraft": ejecuta una lista de comandos (sin la "/" inicial).
 * repeat: cuántas veces repetir la lista (hordas de mobs), máximo 100.
 */
export function minecraftAction(mc) {
  return async (action, vars) => {
    const times = Math.min(100, Math.max(1, Math.round(Number(action.repeat) || 1)));
    for (let i = 0; i < times; i++) {
      for (const template of action.commands ?? []) {
        const command = randomize(fill(template, vars)).trim().replace(/^\//, '');
        if (!command) continue;
        const response = await mc.send(command);
        // Con repeticiones solo se registra la primera, para no llenar el registro
        if (i === 0) log.action(`/${command}${response ? `  →  ${response}` : ''}${times > 1 ? `  (×${times})` : ''}`);
      }
    }
  };
}

const PLATFORM_TAG = {
  twitch: { text: '[Twitch] ', color: 'dark_purple' },
  kick: { text: '[Kick] ', color: 'green' },
  youtube: { text: '[YouTube] ', color: 'red' },
  simulado: { text: '[Prueba] ', color: 'gray' },
  votacion: { text: '[Votación] ', color: 'gold' },
  streamlabs: { text: '[Donación] ', color: 'green' },
  streamelements: { text: '[Donación] ', color: 'green' },
  kofi: { text: '[Ko-fi] ', color: 'aqua' },
  caos: { text: '[Caos] ', color: 'dark_red' }
};

/** Quita emojis: la fuente de Minecraft no los tiene y salen como cuadritos. */
export function stripEmojis(text) {
  return text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Acción "announce": mensaje con color en el chat de Minecraft para todos.
 * { "type": "announce", "text": "{user} te mandó un zombie", "color": "gold" }
 */
export function announceAction(mc) {
  return async (action, vars) => {
    const text = stripEmojis(fill(action.text ?? '', vars));
    const tag = PLATFORM_TAG[vars.platform] ?? { text: '[Chat] ', color: 'aqua' };
    const component = [tag, { text, color: action.color ?? 'yellow' }];
    await mc.send(`tellraw @a ${JSON.stringify(component)}`);
    log.action(`💬 ${tag.text}${text}`);
  };
}

/**
 * Acción "title": texto grande en la pantalla del jugador.
 * { "type": "title", "title": "¡Cuidado!", "subtitle": "{user} te mandó algo", "color": "red" }
 */
export function titleAction(mc) {
  return async (action, vars) => {
    const color = action.color ?? 'white';
    const target = vars.titleTarget ?? vars.player; // a quien le tocó la regla (o a ti)
    if (action.subtitle) {
      const sub = { text: stripEmojis(fill(action.subtitle, vars)), color: action.subtitleColor ?? 'white' };
      await mc.send(`title ${target} subtitle ${JSON.stringify(sub)}`);
    }
    const main = { text: stripEmojis(fill(action.title ?? '', vars)), color, bold: true };
    await mc.send(`title ${target} title ${JSON.stringify(main)}`);
    log.action(`🪧 título: ${main.text}`);
  };
}
