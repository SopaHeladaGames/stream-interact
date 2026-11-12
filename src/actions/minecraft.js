import { Rcon } from 'rcon-client';
import { fill } from '../core/rulesEngine.js';
import { log } from '../core/logger.js';

/**
 * Conexión RCON al servidor de Minecraft. Se reconecta sola si el servidor se cae
 * o si arrancas la app antes que el servidor.
 */
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
    return rcon.send(command);
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

/** Acción "minecraft": ejecuta una lista de comandos (sin la "/" inicial). */
export function minecraftAction(mc) {
  return async (action, vars) => {
    for (const template of action.commands ?? []) {
      const command = fill(template, vars).trim().replace(/^\//, '');
      if (!command) continue;
      const response = await mc.send(command);
      log.action(`/${command}${response ? `  →  ${response}` : ''}`);
    }
  };
}

const PLATFORM_TAG = {
  twitch: { text: '[Twitch] ', color: 'dark_purple' },
  kick: { text: '[Kick] ', color: 'green' },
  youtube: { text: '[YouTube] ', color: 'red' },
  simulado: { text: '[Prueba] ', color: 'gray' },
  votacion: { text: '[Votación] ', color: 'gold' },
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
    const target = vars.player;
    if (action.subtitle) {
      const sub = { text: stripEmojis(fill(action.subtitle, vars)), color: action.subtitleColor ?? 'white' };
      await mc.send(`title ${target} subtitle ${JSON.stringify(sub)}`);
    }
    const main = { text: stripEmojis(fill(action.title ?? '', vars)), color, bold: true };
    await mc.send(`title ${target} title ${JSON.stringify(main)}`);
    log.action(`🪧 título: ${main.text}`);
  };
}
