import { log } from '../core/logger.js';

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Modo caos: cada cierto tiempo (aleatorio entre un mínimo y un máximo)
 * ejecuta una regla al azar de la lista elegida en el panel.
 * Siempre arranca apagado al abrir la app.
 */
export class ChaosMode {
  constructor({ bus, engine, store, notify, canRun }) {
    this.bus = bus;
    this.engine = engine;
    this.store = store;
    this.notify = notify;
    this.canRun = canRun; // () => true si el juego está listo para recibir acciones
    this.running = false;
    this.nextAt = null;
    this.timer = null;
    this.last = null;      // { ruleId, label, at }
    this.lastSkip = null;  // por qué no se ejecutó el último turno

    // !caos (streamer y mods): enciende o apaga
    bus.onEvent((event) => {
      if (event.type !== 'command' || event.name !== '!caos') return;
      if (!(event.user.isMod || event.user.isBroadcaster)) return;
      try {
        if (this.running) this.stop(); else this.start();
      } catch (err) {
        this.notify.chat(`🌀 ${err.message}`);
      }
    });
  }

  /** Reglas de la lista que existen y están activas. */
  pool() {
    return this.store.chaos.ruleIds.filter((id) => this.engine.hasRule(id));
  }

  start() {
    if (this.running) return this.status();
    if (this.pool().length === 0) throw httpError(400, 'Elige al menos una regla activa para el modo caos');
    this.running = true;
    this.lastSkip = null;
    this.#schedule();
    this.notify.chat('🌀 ¡Modo caos ACTIVADO! Cualquier cosa puede pasar…');
    this.notify.title('MODO CAOS', 'Cualquier cosa puede pasar…', 'dark_red');
    log.info('🌀 Modo caos activado');
    return this.status();
  }

  stop({ silent = false } = {}) {
    clearTimeout(this.timer);
    const wasRunning = this.running;
    this.running = false;
    this.nextAt = null;
    if (wasRunning && !silent) {
      this.notify.chat('🌀 Modo caos desactivado.');
      log.info('🌀 Modo caos desactivado');
    }
    return this.status();
  }

  /** Vuelve a programar el siguiente evento (por ejemplo, al cambiar los intervalos). */
  reschedule() {
    if (this.running) this.#schedule();
  }

  /** Lanza un evento ya, esté o no encendido el modo caos. */
  now() {
    const result = this.#tick();
    if (!result.ok) throw httpError(409, result.reason);
    return this.status();
  }

  status() {
    return {
      running: this.running,
      nextAt: this.nextAt ? new Date(this.nextAt).toISOString() : null,
      remainingMs: this.nextAt ? Math.max(0, this.nextAt - Date.now()) : null,
      last: this.last,
      lastSkip: this.lastSkip,
      config: this.store.chaos,
      activeRules: this.pool().length
    };
  }

  summary() {
    return { running: this.running, nextAt: this.nextAt ? new Date(this.nextAt).toISOString() : null };
  }

  #schedule() {
    clearTimeout(this.timer);
    const { minSeconds, maxSeconds } = this.store.chaos;
    const delay = (minSeconds + Math.random() * (maxSeconds - minSeconds)) * 1000;
    this.nextAt = Date.now() + delay;
    this.timer = setTimeout(() => {
      this.#tick();
      if (this.running) this.#schedule();
    }, delay);
  }

  #tick() {
    const skip = (reason) => { this.lastSkip = { reason, at: new Date().toISOString() }; return { ok: false, reason }; };
    if (this.bus.paused) return skip('Las interacciones están en pausa');
    if (!this.canRun()) return skip('Minecraft no está conectado');
    const pool = this.pool();
    if (pool.length === 0) return skip('No hay reglas activas en la lista del modo caos');

    // Evitar repetir la misma regla dos veces seguidas cuando hay más de una
    const candidates = pool.length > 1 ? pool.filter((id) => id !== this.last?.ruleId) : pool;
    const ruleId = candidates[Math.floor(Math.random() * candidates.length)];

    // A quién le toca: al azar entre los conectados, todos, o lo que diga cada regla
    const mode = this.store.chaos.target ?? 'random';
    const last = { ruleId, label: this.engine.ruleLabel(ruleId), at: new Date().toISOString(), target: null };
    const accepted = this.engine.runRule(ruleId, {
      platform: 'caos',
      chatPlatform: 'twitch',
      type: 'chaos',
      name: 'Modo caos',
      user: { id: 'caos', name: 'caos', displayName: 'El modo caos', isMod: false, isBroadcaster: false },
      amount: 0,
      input: '',
      onTarget: (t) => { last.target = t.display; }
    }, { target: mode === 'rule' ? undefined : mode });
    if (!accepted) return skip('La cola de acciones está llena');

    this.last = last;
    this.lastSkip = null;
    return { ok: true };
  }
}
