// Utilidades compartidas para describir y crear reglas.

export const TRIGGERS = {
  reward: { label: 'Recompensa', hint: 'Canje de puntos del canal' },
  command: { label: 'Comando', hint: 'Mensaje del chat que empieza con !' },
  cheer: { label: 'Bits', hint: 'Cheers con un mínimo de bits' },
  donation: { label: 'Donación', hint: 'Streamlabs, StreamElements o Ko-fi, por monto' },
  sub: { label: 'Suscripción', hint: 'Sub nueva o resub de Twitch (por tier y meses)' },
  gift: { label: 'Subs regaladas', hint: 'Se ejecuta una vez por cada sub regalada' },
  raid: { label: 'Raid', hint: 'Otro canal llega con su comunidad (por viewers)' },
  follow: { label: 'Follow', hint: 'Alguien nuevo sigue el canal' }
};

export const TIERS = { '': 'Cualquiera', 1: 'Tier 1 / Prime', 2: 'Tier 2', 3: 'Tier 3' };

export const ACTIONS = {
  minecraft: { label: 'Comandos de Minecraft', defaults: { commands: [''], repeat: 1 } },
  announce: { label: 'Mensaje en Minecraft', defaults: { text: '', color: 'yellow' } },
  title: { label: 'Título en pantalla', defaults: { title: '', subtitle: '', color: 'red' } },
  chat: { label: 'Responder en el chat', defaults: { message: '' } },
  overlay: { label: 'Alerta en overlay', defaults: { title: '{user}', subtitle: '', color: '', image: '', sound: '' } },
  caos: { label: 'Activar modo caos', defaults: { seconds: 600 } },
  gamerule: { label: 'Regla del mundo', defaults: { rule: 'natural_health_regeneration', value: false, seconds: 300, endMessage: '' } },
  wait: { label: 'Esperar', defaults: { ms: 1000 } }
};

export const TARGETS = {
  me: { label: 'Tú', hint: 'Siempre a ti ({player})' },
  chat: { label: 'Lo elige el chat', hint: 'Al jugador que escriba el espectador' },
  'chat-random': { label: 'El chat o al azar', hint: 'Al jugador que escriba el espectador; si no escribe ninguno, a alguien al azar' },
  random: { label: 'Al azar', hint: 'A alguien conectado al azar (te incluye)' },
  all: { label: 'Todos', hint: 'A todos los conectados' }
};

export const MC_COLORS = {
  white: '#ffffff', yellow: '#ffff55', gold: '#ffaa00', red: '#ff5555', dark_red: '#aa0000',
  green: '#55ff55', dark_green: '#00aa00', aqua: '#55ffff', dark_aqua: '#00aaaa', blue: '#5555ff',
  dark_blue: '#0000aa', light_purple: '#ff55ff', dark_purple: '#aa00aa', gray: '#aaaaaa', dark_gray: '#555555', black: '#000000'
};

export const VARIABLES = ['{user}', '{target}', '{player}', '{input}', '{amount}', '{currency}', '{money}', '{platform}', '{months}', '{gifts}', '{viewers}', '{tier}'];

export function describeTrigger(t = {}) {
  if (t.type === 'cheer') {
    const plus = t.includeDonations ? ' (+ donaciones)' : '';
    if (t.minAmount && t.maxAmount) return `${t.minAmount}–${t.maxAmount} bits${plus}`;
    return t.minAmount ? `${t.minAmount}+ bits${plus}` : `Cualquier cheer${plus}`;
  }
  if (t.type === 'donation') {
    const cur = t.currency ? ` ${t.currency}` : '';
    if (t.minAmount && t.maxAmount) return `$${t.minAmount}–${t.maxAmount}${cur}`;
    return t.minAmount ? `$${t.minAmount}+${cur}` : `Cualquier donación${cur}`;
  }
  if (t.type === 'sub') {
    const kind = t.resub === 'new' ? 'Sub nueva' : t.resub === 'resub' ? 'Resub' : 'Sub o resub';
    const tier = t.tier ? ` · Tier ${t.tier}` : '';
    const months = t.minAmount && t.maxAmount ? ` · ${t.minAmount}–${t.maxAmount} meses` : t.minAmount ? ` · ${t.minAmount}+ meses` : '';
    return `${kind}${tier}${months}`;
  }
  if (t.type === 'gift') {
    const tier = t.tier ? ` · Tier ${t.tier}` : '';
    if (t.minAmount && t.maxAmount) return `Regalos de ${t.minAmount}–${t.maxAmount} subs${tier}`;
    return t.minAmount ? `Regalos de ${t.minAmount}+ subs${tier}` : `Cualquier sub regalada${tier}`;
  }
  if (t.type === 'raid') {
    if (t.minAmount && t.maxAmount) return `Raid de ${t.minAmount}–${t.maxAmount} viewers`;
    return t.minAmount ? `Raid de ${t.minAmount}+ viewers` : 'Cualquier raid';
  }
  if (t.type === 'follow') return 'Follow nuevo';
  return t.name || '(sin nombre)';
}

export function newRule(existingIds) {
  let n = 1;
  while (existingIds.includes(`regla-${n}`)) n++;
  return {
    id: `regla-${n}`,
    trigger: { type: 'command', name: '!nuevo' },
    cooldownMs: 30000,
    actions: [{ type: 'announce', text: '{user} usó un comando', color: 'yellow' }]
  };
}

/** Evento simulado que dispararía esta regla (para el botón Probar). */
export function simulatedEventFor(rule, user = 'Tester') {
  const t = rule.trigger ?? {};
  if (t.type === 'cheer') return { type: 'cheer', name: 'bits', user, amount: t.minAmount || 100 };
  if (t.type === 'donation') return { type: 'donation', name: 'donation', user, amount: t.minAmount || 50, currency: t.currency || 'MXN' };
  if (t.type === 'sub') return { type: 'sub', name: 'sub', user, amount: t.resub === 'new' ? 1 : (t.minAmount || (t.resub === 'resub' ? 6 : 1)), tier: t.tier || '1', resub: t.resub === 'resub' };
  if (t.type === 'gift') return { type: 'gift', name: 'gift', user, amount: t.minAmount || 1, tier: t.tier || '1' };
  if (t.type === 'raid') return { type: 'raid', name: 'raid', user, amount: t.minAmount || 10 };
  if (t.type === 'follow') return { type: 'follow', name: 'follow', user, amount: 0 };
  return { type: t.type, name: t.name, user, amount: 0, input: '' };
}

export function slugify(text) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'regla';
}
