import { log } from '../core/logger.js';

const BACKOFF = [2000, 5000, 10000, 30000, 60000];

/**
 * Base de los conectores de donaciones: estado, reconexión y evitar duplicados.
 *
 * Estados: disabled | connecting | connected | listening | error
 */
export class DonationService {
  constructor({ id, label, onDonation }) {
    this.id = id;
    this.label = label;
    this.onDonation = onDonation;
    this.state = 'disabled';
    this.lastError = null;
    this.lastEventAt = null;
    this.count = 0;
    this.attempt = 0;
    this.retryTimer = null;
    this.seen = new Set();
    this.settings = { enabled: false, token: '' };
  }

  /** Aplica la configuración guardada: conecta, reconecta o desconecta según haga falta. */
  configure(settings) {
    const changed = settings.token !== this.settings.token || settings.enabled !== this.settings.enabled;
    this.settings = { ...settings };
    if (!changed && this.state !== 'error') return;
    this.stop();
    if (settings.enabled && settings.token) {
      this.attempt = 0;
      this.start();
    } else {
      this.state = 'disabled';
      this.lastError = settings.enabled && !settings.token ? 'Falta el token' : null;
    }
  }

  start() { /* lo implementa cada servicio */ }

  stop() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  status() {
    return {
      id: this.id,
      label: this.label,
      state: this.state,
      error: this.lastError,
      lastEventAt: this.lastEventAt,
      count: this.count
    };
  }

  setConnected() {
    if (this.state !== 'connected') log.info(`💰 ${this.label} conectado`);
    this.state = 'connected';
    this.lastError = null;
    this.attempt = 0;
  }

  /** Error que no se arregla reintentando (por ejemplo, token inválido). */
  fail(message) {
    this.stop();
    this.state = 'error';
    this.lastError = message;
    log.error(`${this.label}: ${message}`);
  }

  /** Se perdió la conexión: reintentar con espera creciente. */
  scheduleRetry(reason) {
    if (!this.settings.enabled || this.state === 'error') return;
    clearTimeout(this.retryTimer);
    const wait = BACKOFF[Math.min(this.attempt, BACKOFF.length - 1)];
    this.attempt++;
    this.state = 'connecting';
    this.lastError = reason ? `${reason} · reintentando en ${Math.round(wait / 1000)}s` : null;
    if (this.attempt === 1 || this.attempt % 5 === 0) log.warn(`${this.label}: ${reason ?? 'conexión perdida'}; reintentando en ${Math.round(wait / 1000)}s`);
    this.retryTimer = setTimeout(() => this.start(), wait);
  }

  /** Normaliza y entrega una donación (ignora duplicados). */
  emit({ id, user, amount, currency, message, isTest = false, kind = 'donation' }) {
    if (id) {
      if (this.seen.has(id)) return;
      this.seen.add(id);
      if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value);
    }
    const value = Math.round(Number(amount) * 100) / 100;
    if (!(value > 0)) return;
    this.count++;
    this.lastEventAt = new Date().toISOString();
    this.onDonation({
      platform: this.id,
      type: 'donation',
      name: kind,
      user: { id: `${this.id}:${user || 'anonimo'}`, name: user || 'Anónimo', displayName: user || 'Anónimo', isMod: false, isBroadcaster: false },
      amount: value,
      currency: String(currency || '').toUpperCase(),
      input: message ?? '',
      isTest,
      chatPlatform: isTest ? undefined : 'twitch' // las respuestas (acción "chat") van a Twitch; las pruebas no salen al chat real
    });
  }
}
