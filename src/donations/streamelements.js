import crypto from 'node:crypto';
import WebSocket from 'ws';
import { DonationService } from './base.js';

/**
 * StreamElements: Astro, su gateway de WebSockets (pub/sub).
 * Se suscribe al tema "channel.tips" con el JWT del canal.
 * JWT: StreamElements → avatar (arriba a la derecha) → tu canal → copiar el JWT Token.
 */
export class StreamElementsService extends DonationService {
  constructor(opts) {
    super({ ...opts, id: 'streamelements', label: 'StreamElements' });
    this.url = process.env.STREAMELEMENTS_ASTRO_URL || 'wss://astro.streamelements.com';
    this.ws = null;
    this.reconnectToken = null;
  }

  start() {
    this.state = 'connecting';
    const url = this.reconnectToken ? `${this.url}/?reconnect_token=${encodeURIComponent(this.reconnectToken)}` : this.url;
    const resuming = Boolean(this.reconnectToken);
    this.reconnectToken = null;
    const ws = new WebSocket(url);
    this.ws = ws;
    const nonce = crypto.randomUUID();
    let welcomed = false;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'welcome') {
        welcomed = true;
        if (resuming) { this.setConnected(); return; } // la reconexión restaura las suscripciones
        ws.send(JSON.stringify({
          type: 'subscribe',
          nonce,
          data: { topic: 'channel.tips', token: this.settings.token, token_type: 'jwt' }
        }));
      } else if (msg.type === 'response' && msg.nonce === nonce) {
        if (msg.error) {
          const why = msg.error === 'err_unauthorized'
            ? 'StreamElements rechazó el token. Revisa tu JWT Token.'
            : `StreamElements respondió: ${msg.data?.message ?? msg.error}`;
          this.fail(why);
          ws.close();
        } else {
          this.setConnected();
        }
      } else if (msg.type === 'reconnect') {
        this.reconnectToken = msg.data?.reconnect_token ?? null; // el servidor se reinicia: reconectar con este token
      } else if (msg.type === 'message' && msg.topic === 'channel.tips') {
        this.#handle(msg.data);
      }
    });

    ws.on('error', () => { /* el cierre se encarga */ });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.state === 'error' || !this.settings.enabled) return;
      if (this.reconnectToken) { this.start(); return; }
      this.scheduleRetry(welcomed ? 'Se cerró la conexión' : 'No se pudo conectar');
    });
  }

  stop() {
    super.stop();
    this.reconnectToken = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  #handle(data) {
    const d = data?.donation;
    if (!d) return;
    // Solo propinas cobradas y no bloqueadas por la moderación de propinas
    if (data.status && data.status !== 'success') return;
    if (data.approved && !['allowed', 'approved'].includes(data.approved)) return;
    this.emit({
      id: data._id ?? data.transactionId,
      user: d.user?.username,
      amount: d.amount,
      currency: d.currency,
      message: d.message
    });
  }
}
