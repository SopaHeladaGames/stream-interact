import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { log } from '../core/logger.js';
import { StreamlabsService } from './streamlabs.js';
import { StreamElementsService } from './streamelements.js';
import { KofiService } from './kofi.js';

const FILE = path.resolve('data', 'donaciones.json'); // data/ no se sube a Git: aquí van los tokens

/**
 * Gestor de donaciones: guarda credenciales, conecta cada servicio que esté activado
 * y entrega las donaciones (formato común) a la app.
 */
export class DonationManager {
  constructor({ onDonation, webhookPort }) {
    this.webhookPort = webhookPort;
    const opts = { onDonation };
    this.services = {
      streamlabs: new StreamlabsService(opts),
      streamelements: new StreamElementsService(opts),
      kofi: new KofiService(opts)
    };
    this.settings = this.#read();
    for (const [id, svc] of Object.entries(this.services)) svc.configure(this.settings[id]);
  }

  /** Estado y configuración (sin exponer los tokens completos). */
  status() {
    return {
      webhookPort: this.webhookPort,
      services: Object.fromEntries(Object.entries(this.services).map(([id, svc]) => [id, {
        ...svc.status(),
        enabled: this.settings[id].enabled,
        hasToken: Boolean(this.settings[id].token),
        tokenHint: this.settings[id].token ? `…${this.settings[id].token.slice(-4)}` : ''
      }]))
    };
  }

  /** Cambia la configuración de un servicio. token: undefined = no cambiar, '' = borrar. */
  update(id, { enabled, token }) {
    const svc = this.services[id];
    if (!svc) throw Object.assign(new Error('Servicio desconocido'), { status: 404 });
    const current = this.settings[id];
    const next = {
      enabled: enabled ?? current.enabled,
      token: token === undefined ? current.token : String(token).trim()
    };
    if (next.enabled && !next.token) throw Object.assign(new Error('Escribe el token antes de activarlo'), { status: 400 });
    this.settings[id] = next;
    this.#write();
    svc.configure(next);
    log.info(`💰 ${svc.label} ${next.enabled ? 'activado' : 'desactivado'}`);
    return this.status().services[id];
  }

  /** Donación de prueba, por el mismo camino que una real. */
  test(id, { user = 'Tester', amount = 50, currency = 'MXN', message = '¡Donación de prueba!' } = {}) {
    const svc = this.services[id];
    if (!svc) throw Object.assign(new Error('Servicio desconocido'), { status: 404 });
    svc.emit({ id: `prueba-${Date.now()}`, user, amount, currency, message, isTest: true });
  }

  /** Servidor aparte, solo para webhooks (lo único que debe exponerse con el túnel). */
  startWebhookServer() {
    const app = express();
    app.disable('x-powered-by');
    app.get('/', (_req, res) => res.type('text').send('stream-interact: webhooks OK'));
    app.post('/webhooks/kofi', express.urlencoded({ extended: false, limit: '100kb' }), (req, res) => {
      const code = this.services.kofi.handleWebhook(req.body);
      res.sendStatus(code);
    });
    app.use((_req, res) => res.sendStatus(404)); // nada más: el panel nunca queda expuesto por aquí

    return new Promise((resolve) => {
      const server = app.listen(this.webhookPort, '127.0.0.1', () => resolve(server));
      server.on('error', (err) => {
        log.warn(`No se pudo abrir el puerto de webhooks ${this.webhookPort} (${err.code}). Ko-fi no recibirá avisos.`);
        resolve(null);
      });
    });
  }

  stop() {
    for (const svc of Object.values(this.services)) svc.stop();
  }

  #read() {
    const empty = { enabled: false, token: '' };
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* aún no hay configuración */ }
    return Object.fromEntries(Object.keys(this.services).map((id) => [id, { ...empty, ...(saved[id] ?? {}) }]));
  }

  #write() {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(this.settings, null, 2));
  }
}
