/**
 * Historial del chat para el panel: mensajes, canjes, bits y eventos de moderación.
 * Las plataformas empujan aquí lo que pasa en el chat y el panel lo recibe en vivo (/api/chat/feed).
 *
 * Tipos de entrada:
 *   message    → { id, platform, user, parts, text, reply, highlighted, isCommand }
 *   event      → { platform, eventType: 'reward'|'cheer', user, title, amount, input }
 *   delete     → { messageId }            un mensaje fue borrado
 *   clearUser  → { userId }               se borraron los mensajes de un usuario (timeout/ban)
 *   clear      → {}                       se limpió todo el chat
 */
const MAX = 300;
const history = [];
const subscribers = new Set();
let seq = 1;

function emit(kind, data) {
  const entry = { seq: seq++, kind, at: new Date().toISOString(), ...data };

  // Aplicar borrados al historial, para que quien abra el panel después vea el estado correcto
  if (kind === 'delete') history.forEach((m) => { if (m.kind === 'message' && m.id === data.messageId) m.deleted = true; });
  if (kind === 'clearUser') history.forEach((m) => { if (m.kind === 'message' && m.user?.id === data.userId) m.deleted = true; });
  if (kind === 'clear') history.forEach((m) => { if (m.kind === 'message') m.deleted = true; });

  if (kind === 'message' || kind === 'event') {
    history.push(entry);
    if (history.length > MAX) history.shift();
  }
  for (const fn of subscribers) {
    try { fn(entry); } catch { /* ignorar suscriptores caídos */ }
  }
}

export const chatFeed = {
  message: (data) => emit('message', data),
  event: (data) => emit('event', data),
  deleted: (messageId) => emit('delete', { messageId }),
  clearedUser: (userId) => emit('clearUser', { userId }),
  cleared: () => emit('clear', {}),
  history: () => history.map((m) => ({ ...m })),
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }
};
