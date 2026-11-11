import { log } from './logger.js';

/**
 * Cola de trabajos: ejecuta las acciones una por una, en orden de llegada,
 * con una pausa mínima entre ellas para que el juego no se sature.
 *
 * Un "evento" normalizado tiene esta forma (igual para cualquier plataforma):
 * {
 *   platform: 'twitch' | 'kick' | 'youtube' | 'simulado',
 *   type: 'reward' | 'command' | 'cheer' | 'donation',
 *   name: string,          // título de la recompensa o nombre del comando (ej. "!lluvia")
 *   user: { id, name, displayName, isMod, isBroadcaster },
 *   amount: number,        // bits / monto (0 si no aplica)
 *   input: string,         // texto del usuario (input de la recompensa o args del comando)
 *   complete?: () => Promise, // marcar canje como completado (si la plataforma lo soporta)
 *   refund?: () => Promise    // reembolsar canje (si la plataforma lo soporta)
 * }
 */
export class EventBus {
  constructor({ gapMs = 500, maxQueue = 50 } = {}) {
    this.gapMs = gapMs;
    this.maxQueue = maxQueue;
    this.queue = [];
    this.running = false;
    this.paused = false;
    this.handlers = new Set();
  }

  /** Registra quién procesa los eventos (el motor de reglas). */
  onEvent(handler) {
    this.handlers.add(handler);
  }

  /** Las plataformas llaman a esto cuando llega algo del chat. */
  emit(event) {
    log.event(`${event.platform}/${event.type} "${event.name}" de ${event.user.displayName}` +
      (event.amount ? ` (${event.amount})` : '') + (event.input ? ` → "${event.input}"` : ''));
    for (const handler of this.handlers) {
      Promise.resolve(handler(event)).catch((err) => log.error('Error procesando evento:', err));
    }
  }

  /** Encola un trabajo (una función async). Devuelve false si se rechazó. */
  enqueue(label, job) {
    if (this.paused) {
      log.warn(`En pausa: se ignora "${label}"`);
      return false;
    }
    if (this.queue.length >= this.maxQueue) {
      log.warn(`Cola llena (${this.maxQueue}): se ignora "${label}"`);
      return false;
    }
    this.queue.push({ label, job });
    this.#drain();
    return true;
  }

  pause() {
    this.paused = true;
    const dropped = this.queue.length;
    this.queue = [];
    log.warn(`⏸️  Interacciones en PAUSA (se descartaron ${dropped} pendientes)`);
  }

  resume() {
    this.paused = false;
    log.info('▶️  Interacciones REANUDADAS');
  }

  status() {
    return { paused: this.paused, pending: this.queue.length, running: this.running };
  }

  async #drain() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const { label, job } = this.queue.shift();
      try {
        await job();
      } catch (err) {
        log.error(`Falló "${label}":`, err.message);
      }
      await new Promise((r) => setTimeout(r, this.gapMs));
    }
    this.running = false;
  }
}
