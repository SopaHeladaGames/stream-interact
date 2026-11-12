/**
 * Alertas para el overlay de OBS (/overlay). La app empuja aquí cada alerta
 * y la página del overlay las recibe en vivo por /api/overlay/feed.
 *
 * Alerta: { title, subtitle, detail, platform, color, kind }
 */
const subscribers = new Set();
let seq = 1;

export const overlayFeed = {
  alert(data) {
    const entry = { seq: seq++, at: new Date().toISOString(), ...data };
    for (const fn of subscribers) {
      try { fn(entry); } catch { /* ignorar suscriptores caídos */ }
    }
    return entry;
  },
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },
  get listeners() {
    return subscribers.size;
  }
};
