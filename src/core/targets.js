import fs from 'node:fs';
import path from 'node:path';
import { log } from './logger.js';

/**
 * A quién le llega una regla cuando juegas con más gente.
 *
 * Modos (campo "target" de la regla; si no está, es "me"):
 *   me     → siempre tú ({player} del .env)
 *   chat   → el jugador que escriba el espectador (texto de la recompensa o "!comando Nombre")
 *   random → uno al azar entre los conectados (te incluye)
 *   chat-random → como chat si escriben un nombre; si no escriben ninguno, al azar
 *   all    → todos los conectados
 *
 * Los jugadores protegidos nunca reciben nada del chat (tú no te puedes proteger).
 * Los apodos traducen cómo te escribe el chat ("many") a la cuenta de Minecraft.
 * Se guardan en config/jugadores.json.
 */
export const TARGET_MODES = ['me', 'chat', 'chat-random', 'random', 'all'];
const NAME = /^[A-Za-z0-9_]{3,16}$/;
const ALIAS = /^[\p{L}\p{N}_]{2,25}$/u;
const httpError = (status, message) => Object.assign(new Error(message), { status });
const norm = (s) => String(s ?? '').toLowerCase();

export class PlayerTargets {
  constructor({ file, me, online }) {
    this.file = file;
    this.me = me;            // tu cuenta de Minecraft (MC_PLAYER)
    this.online = online;    // async () => ['Nombre', ...] conectados ahora
    this.data = { aliases: {}, protected: [] };
    try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* primera vez */ }
  }

  #save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  get() {
    return { me: this.me, aliases: this.data.aliases, protected: this.data.protected };
  }

  /** Guarda apodos y protegidos desde el panel. */
  update({ aliases, protected: prot } = {}) {
    if (aliases !== undefined) {
      const clean = {};
      for (const [alias, account] of Object.entries(aliases ?? {})) {
        const a = norm(alias).trim().replace(/^@/, '');
        const acc = String(account ?? '').trim();
        if (!a && !acc) continue;
        if (!ALIAS.test(a)) throw httpError(400, `Apodo inválido: "${alias}" (letras, números o _, de 2 a 25)`);
        if (!NAME.test(acc)) throw httpError(400, `Cuenta inválida para "${alias}": "${account}" (nombre de Minecraft de 3 a 16 caracteres)`);
        clean[a] = acc;
      }
      this.data.aliases = clean;
    }
    if (prot !== undefined) {
      const list = [...new Set((prot ?? []).map((n) => String(n).trim()).filter(Boolean))];
      for (const n of list) if (!NAME.test(n)) throw httpError(400, `Nombre inválido: "${n}"`);
      this.data.protected = list.filter((n) => norm(n) !== norm(this.me));
    }
    this.#save();
    return this.get();
  }

  isProtected(name) {
    return norm(name) !== norm(this.me) && this.data.protected.some((p) => norm(p) === norm(name));
  }

  async #onlineSafe() {
    try { return await this.online(); } catch { return null; }
  }

  #self() {
    return { mode: 'me', name: this.me, selector: this.me, display: this.me };
  }

  /**
   * Decide el objetivo. Con strict (recompensas y comandos), un nombre que no sirve devuelve
   * { error } para avisar y devolver los puntos; sin strict (bits, donaciones, votaciones) cae en ti.
   */
  async resolve(mode = 'me', input = '', { strict = false } = {}) {
    if (!mode || mode === 'me' || !TARGET_MODES.includes(mode)) return this.#self();

    const online = await this.#onlineSafe();

    if (mode === 'all') {
      const excluded = (online ?? []).filter((n) => this.isProtected(n));
      const allProtected = this.data.protected.filter((n) => norm(n) !== norm(this.me));
      // Excluir a todos los protegidos (estén o no conectados ahora, por si entran mientras corre la cola)
      const names = [...new Set([...excluded, ...allProtected])].filter((n) => NAME.test(n));
      const selector = names.length ? `@a[${names.map((n) => `name=!${n}`).join(',')}]` : '@a';
      return { mode, name: null, selector, display: 'todos' };
    }

    const pickRandom = () => {
      const pool = (online ?? []).filter((n) => !this.isProtected(n));
      if (pool.length === 0) return this.#self();
      const name = pool[Math.floor(Math.random() * pool.length)];
      return { mode, name, selector: name, display: name };
    };
    if (mode === 'random') return pickRandom();

    // mode === 'chat' o 'chat-random'
    // Sin nombre válido: en "chat" te toca a ti; en "chat-random", a alguien al azar
    const fallback = mode === 'chat-random' ? pickRandom : () => this.#self();
    const words = String(input ?? '').split(/[\s,]+/).map((w) => w.replace(/^@/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean);
    if (words.length === 0) return fallback(); // sin texto

    if (online === null) {
      return strict ? { error: 'No puedo ver quién está conectado en Minecraft ahora mismo.' } : fallback();
    }
    for (const w of words) {
      const wanted = this.data.aliases[norm(w)] ?? w;
      const found = online.find((n) => norm(n) === norm(wanted));
      if (!found) continue;
      if (this.isProtected(found)) {
        if (strict) return { error: `${found} no recibe cosas del chat.` };
        continue;
      }
      return { mode, name: found, selector: found, display: found };
    }
    const asked = words.join(' ').slice(0, 30);
    log.warn(`Objetivo "${asked}" no está conectado`);
    const available = online.filter((n) => !this.isProtected(n)).join(', ') || 'nadie';
    return strict ? { error: `No encontré a "${asked}" en el servidor. Conectados: ${available}.` } : fallback();
  }
}
