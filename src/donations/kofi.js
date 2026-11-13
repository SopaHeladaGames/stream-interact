import crypto from 'node:crypto';
import { DonationService } from './base.js';
import { log } from '../core/logger.js';

/**
 * Ko-fi: no tiene conexión en tiempo real; manda un webhook (POST) a una URL pública con HTTPS.
 * Ese POST llega como formulario con un campo "data" (JSON) que incluye verification_token.
 * Token: Ko-fi → More → API → Webhooks → Advanced → Verification Token.
 *
 * El webhook se recibe en un puerto aparte (WEBHOOK_PORT, 3001 por defecto) que SOLO acepta esto,
 * para que el túnel no exponga el panel de la app.
 */
export class KofiService extends DonationService {
  constructor(opts) {
    super({ ...opts, id: 'kofi', label: 'Ko-fi' });
    this.lastWebhookAt = null;
  }

  start() {
    this.state = 'listening'; // esperando avisos de Ko-fi (no hay conexión que mantener)
    this.lastError = null;
  }

  status() {
    return { ...super.status(), lastWebhookAt: this.lastWebhookAt };
  }

  /** Procesa el cuerpo del webhook. Devuelve el código HTTP para responderle a Ko-fi. */
  handleWebhook(body) {
    if (!this.settings.enabled || !this.settings.token) return 404;
    let data;
    try { data = JSON.parse(body?.data ?? ''); } catch { return 400; }
    if (!data || !safeEqual(String(data.verification_token ?? ''), this.settings.token)) {
      log.warn('Ko-fi: llegó un aviso con un token de verificación incorrecto (se ignoró)');
      return 401;
    }
    this.lastWebhookAt = new Date().toISOString();

    // Donaciones y membresías; las órdenes de tienda y comisiones no disparan reglas
    const kinds = { Donation: 'donation', Subscription: 'subscription' };
    const kind = kinds[data.type];
    if (!kind) {
      log.info(`Ko-fi: aviso de tipo "${data.type}" recibido (no se usa para reglas)`);
      return 200;
    }
    const isPublic = data.is_public !== false;
    this.emit({
      id: data.message_id ?? data.kofi_transaction_id,
      user: isPublic ? data.from_name : 'Anónimo',
      amount: data.amount,
      currency: data.currency,
      message: isPublic ? data.message : '',
      kind
    });
    return 200;
  }
}

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
