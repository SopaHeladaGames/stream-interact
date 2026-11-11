/**
 * Logger: imprime en la terminal y además guarda un historial en memoria
 * que el panel muestra en vivo (vía /api/feed).
 */
const MAX_HISTORY = 300;
const history = [];
const subscribers = new Set();
let nextId = 1;

const time = () => new Date().toLocaleTimeString('es-MX', { hour12: false });

const ICONS = { warn: '⚠️', error: '❌', event: '📥', action: '🎮' };

function toText(args) {
  return args.map((a) => (a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
}

function record(level, args) {
  const entry = { id: nextId++, at: new Date().toISOString(), level, text: toText(args) };
  history.push(entry);
  if (history.length > MAX_HISTORY) history.shift();
  for (const fn of subscribers) {
    try { fn(entry); } catch { /* un suscriptor caído no debe romper el log */ }
  }
}

function make(level, consoleFn) {
  return (...args) => {
    const icon = ICONS[level];
    consoleFn(`[${time()}]${icon ? ` ${icon}` : ''}`, ...args);
    record(level, args);
  };
}

export const log = {
  info: make('info', console.log),
  warn: make('warn', console.warn),
  error: make('error', console.error),
  event: make('event', console.log),
  action: make('action', console.log),
  /** Últimas entradas del historial. */
  history: () => [...history],
  /** Recibe cada entrada nueva. Devuelve una función para dejar de escuchar. */
  subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }
};
