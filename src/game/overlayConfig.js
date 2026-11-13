/**
 * Ajustes del overlay de OBS: comportamiento, posición, animación, estilo y archivos propios.
 * Todo se valida aquí para que el overlay nunca reciba valores rotos.
 */
const KINDS = ['reward', 'cheer', 'donation', 'command', 'poll', 'chaos'];
const POSITIONS = ['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'];
const ANIM_IN = ['pop', 'slide-down', 'slide-up', 'slide-left', 'slide-right', 'fade', 'zoom', 'drop', 'flip'];
const ANIM_OUT = ['rise', 'fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'zoom', 'shrink'];
const FONTS = ['segoe', 'inter', 'fredoka', 'bebas', 'pixel', 'vt323', 'mono'];
const BG_STYLES = ['gradient', 'solid', 'none'];

export const OVERLAY_DEFAULTS = {
  // Comportamiento
  autoAlerts: true,
  durationSec: 6,
  sound: true,
  volume: 0.5,
  // Posición y tamaño
  position: 'top-center',
  marginX: 60,
  marginY: 60,
  scale: 1,
  pollPosition: 'bottom-left',
  pollScale: 1,
  // Animación
  animIn: 'pop',
  animOut: 'rise',
  animSpeed: 1,
  shine: true,
  iconMotion: true,
  timerBar: true,
  // Estilo
  font: 'segoe',
  textScale: 1,
  textColor: '#ffffff',
  titleAccent: true,
  bgStyle: 'gradient',
  bgColor: '#14121e',
  bgColor2: '#201834',
  bgOpacity: 0.94,
  borderWidth: 3,
  radius: 26,
  glow: true,
  colors: { reward: '#9b6bff', cheer: '#ffb347', donation: '#3ddc84', command: '#4cc3ff', poll: '#ffb347', chaos: '#ff4d5e' },
  // Imágenes y sonidos (nombres de archivo de la carpeta media/)
  imageSize: 'icon',
  media: Object.fromEntries(KINDS.map((k) => [k, { image: '', sound: '' }]))
};

const num = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const color = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(String(v ?? '')) ? String(v).toLowerCase() : fallback);
const file = (v) => (typeof v === 'string' && /^[\w.-]{1,120}$/.test(v) ? v : '');

/** Combina con los valores por defecto y limpia todo. */
export function normalizeOverlay(input = {}) {
  const d = OVERLAY_DEFAULTS;
  const o = { ...d, ...input };
  const durationSec = Number(o.durationSec);
  if (!(durationSec >= 2 && durationSec <= 30)) {
    throw Object.assign(new Error('La duración de las alertas debe estar entre 2 y 30 segundos'), { status: 400 });
  }
  return {
    autoAlerts: o.autoAlerts !== false,
    durationSec: Math.round(durationSec * 2) / 2,
    sound: o.sound !== false,
    volume: num(o.volume, 0, 1, d.volume),

    position: oneOf(o.position, POSITIONS, d.position),
    marginX: Math.round(num(o.marginX, 0, 600, d.marginX)),
    marginY: Math.round(num(o.marginY, 0, 400, d.marginY)),
    scale: num(o.scale, 0.4, 2, d.scale),
    pollPosition: oneOf(o.pollPosition, POSITIONS, d.pollPosition),
    pollScale: num(o.pollScale, 0.4, 2, d.pollScale),

    animIn: oneOf(o.animIn, ANIM_IN, d.animIn),
    animOut: oneOf(o.animOut, ANIM_OUT, d.animOut),
    animSpeed: num(o.animSpeed, 0.3, 3, d.animSpeed),
    shine: o.shine !== false,
    iconMotion: o.iconMotion !== false,
    timerBar: o.timerBar !== false,

    font: oneOf(o.font, FONTS, d.font),
    textScale: num(o.textScale, 0.5, 1.8, d.textScale),
    textColor: color(o.textColor, d.textColor),
    titleAccent: o.titleAccent !== false,
    bgStyle: oneOf(o.bgStyle, BG_STYLES, d.bgStyle),
    bgColor: color(o.bgColor, d.bgColor),
    bgColor2: color(o.bgColor2, d.bgColor2),
    bgOpacity: num(o.bgOpacity, 0, 1, d.bgOpacity),
    borderWidth: Math.round(num(o.borderWidth, 0, 12, d.borderWidth)),
    radius: Math.round(num(o.radius, 0, 60, d.radius)),
    glow: o.glow !== false,
    colors: Object.fromEntries(KINDS.map((k) => [k, color(o.colors?.[k], d.colors[k])])),

    imageSize: oneOf(o.imageSize, ['icon', 'large'], d.imageSize),
    media: Object.fromEntries(KINDS.map((k) => [k, { image: file(o.media?.[k]?.image), sound: file(o.media?.[k]?.sound) }]))
  };
}
