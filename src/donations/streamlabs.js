import WebSocket from 'ws';
import { DonationService } from './base.js';

/**
 * Streamlabs: Socket API en tiempo real.
 * Streamlabs usa Socket.IO v2 (Engine.IO 3); aquí se habla ese protocolo directamente sobre WebSocket,
 * para no depender de una versión antigua de socket.io-client.
 *   0{...}  apertura (trae pingInterval)   40  conectado
 *   2 / 3   ping / pong                    42["event", {...}]  evento
 * Token: Streamlabs → Ajustes → API Settings → API Tokens → "Your Socket API Token".
 */
export class StreamlabsService extends DonationService {
  constructor(opts) {
    super({ ...opts, id: 'streamlabs', label: 'Streamlabs' });
    this.url = process.env.STREAMLABS_SOCKET_URL || 'wss://sockets.streamlabs.com';
    this.ws = null;
    this.pingTimer = null;
  }

  start() {
    this.state = 'connecting';
    const url = `${this.url}/socket.io/?token=${encodeURIComponent(this.settings.token)}&EIO=3&transport=websocket`;
    const ws = new WebSocket(url);
    this.ws = ws;
    let opened = false;

    ws.on('message', (raw) => {
      const msg = raw.toString();
      if (msg.startsWith('0')) {
        opened = true;
        let interval = 25000;
        try { interval = JSON.parse(msg.slice(1)).pingInterval ?? interval; } catch { /* usar el valor por defecto */ }
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('2'), interval);
      } else if (msg === '40') {
        this.setConnected();
      } else if (msg.startsWith('44')) {
        this.fail('Streamlabs rechazó el token. Revisa tu "Socket API Token".');
        ws.close();
      } else if (msg.startsWith('42')) {
        try {
          const [name, data] = JSON.parse(msg.slice(2));
          if (name === 'event') this.#handle(data);
        } catch { /* mensaje que no es JSON */ }
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      if (res.statusCode === 401 || res.statusCode === 403) this.fail('Streamlabs rechazó el token. Revisa tu "Socket API Token".');
    });
    ws.on('error', () => { /* el cierre se encarga */ });
    ws.on('close', () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.state === 'error' || !this.settings.enabled) return;
      this.scheduleRetry(opened ? 'Se cerró la conexión' : 'No se pudo conectar');
    });
  }

  stop() {
    super.stop();
    clearInterval(this.pingTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  #handle(data) {
    // Streamlabs también reenvía eventos de Twitch/YouTube (con "for"); aquí solo nos interesan sus donaciones
    if (data?.type !== 'donation' || data.for) return;
    for (const d of [].concat(data.message ?? [])) {
      this.emit({
        id: d._id ?? d.id ?? d.donation_id,
        user: d.from ?? d.name,
        amount: d.amount,
        currency: d.currency,
        message: d.message,
        isTest: Boolean(d.isTest)
      });
    }
  }
}
