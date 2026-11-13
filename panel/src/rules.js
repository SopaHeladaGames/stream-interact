// Utilidades compartidas para describir y crear reglas.

export const TRIGGERS = {
  reward: { label: 'Recompensa', hint: 'Canje de puntos del canal' },
  command: { label: 'Comando', hint: 'Mensaje del chat que empieza con !' },
  cheer: { label: 'Bits', hint: 'Cheers con un mínimo de bits' },
  donation: { label: 'Donación', hint: 'Streamlabs, StreamElements o Ko-fi, por monto' }
};

export const ACTIONS = {
  minecraft: { label: 'Comandos de Minecraft', defaults: { commands: [''] } },
  announce: { label: 'Mensaje en Minecraft', defaults: { text: '', color: 'yellow' } },
  title: { label: 'Título en pantalla', defaults: { title: '', subtitle: '', color: 'red' } },
  chat: { label: 'Responder en el chat', defaults: { message: '' } },
  overlay: { label: 'Alerta en overlay', defaults: { title: '{user}', subtitle: '', color: '', image: '', sound: '' } },
  wait: { label: 'Esperar', defaults: { ms: 1000 } }
};

export const MC_COLORS = {
  white: '#ffffff', yellow: '#ffff55', gold: '#ffaa00', red: '#ff5555', dark_red: '#aa0000',
  green: '#55ff55', dark_green: '#00aa00', aqua: '#55ffff', dark_aqua: '#00aaaa', blue: '#5555ff',
  dark_blue: '#0000aa', light_purple: '#ff55ff', dark_purple: '#aa00aa', gray: '#aaaaaa', dark_gray: '#555555', black: '#000000'
};

export const VARIABLES = ['{user}', '{player}', '{input}', '{amount}', '{currency}', '{money}', '{platform}'];

export function describeTrigger(t = {}) {
  if (t.type === 'cheer') {
    if (t.minAmount && t.maxAmount) return `${t.minAmount}–${t.maxAmount} bits`;
    return t.minAmount ? `${t.minAmount}+ bits` : 'Cualquier cheer';
  }
  if (t.type === 'donation') {
    const cur = t.currency ? ` ${t.currency}` : '';
    if (t.minAmount && t.maxAmount) return `$${t.minAmount}–${t.maxAmount}${cur}`;
    return t.minAmount ? `$${t.minAmount}+${cur}` : `Cualquier donación${cur}`;
  }
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
  return { type: t.type, name: t.name, user, amount: 0, input: '' };
}

export function slugify(text) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'regla';
}
