import { fill } from '../core/rulesEngine.js';
import { log } from '../core/logger.js';

/**
 * Acción "chat": responde en el chat de la plataforma de donde vino el evento.
 * `senders` es un mapa plataforma -> función(texto).
 */
export function chatAction(senders, enabled) {
  return async (action, vars, event) => {
    if (!enabled) return;
    // Votaciones y modo caos no vienen de un chat: indican dónde responder con chatPlatform
    const send = senders[event.chatPlatform ?? event.platform];
    const text = fill(action.message ?? '', vars);
    if (!send) {
      log.info(`💬 (sin chat para ${event.chatPlatform ?? event.platform}) ${text}`);
      return;
    }
    await send(text);
  };
}
