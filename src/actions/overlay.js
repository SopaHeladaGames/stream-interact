import { fill } from '../core/rulesEngine.js';
import { overlayFeed } from '../core/overlayFeed.js';
import { log } from '../core/logger.js';
import { formatMoney } from '../core/money.js';

/**
 * Acción "overlay": muestra una alerta con texto propio en el overlay de OBS.
 * { "type": "overlay", "title": "{user}", "subtitle": "te mandó un zombie", "color": "#9b6bff", "image": "zombie.gif", "sound": "grito.mp3" }
 * Si una regla tiene esta acción, no se muestra la alerta automática para esa regla.
 */
export function overlayAction() {
  return async (action, vars) => {
    const title = fill(action.title ?? '', vars).trim();
    const subtitle = fill(action.subtitle ?? '', vars).trim();
    if (!title && !subtitle) return;
    overlayFeed.alert({
      kind: 'custom', title, subtitle, platform: vars.platform, color: action.color || null,
      image: action.image || null, sound: action.sound || null
    });
    log.action(`🖼️ overlay: ${[title, subtitle].filter(Boolean).join(' — ')}`);
  };
}

/** Texto de la alerta automática según de dónde vino el evento. */
export function autoAlert(event, label) {
  const user = event.user?.displayName ?? 'Alguien';
  const input = (event.input ?? '').trim();
  switch (event.type) {
    case 'reward':
      return { kind: 'reward', title: user, subtitle: `canjeó ${label}`, detail: input };
    case 'cheer':
      return { kind: 'cheer', title: user, subtitle: `mandó ${event.amount} bits`, detail: input };
    case 'donation':
      return { kind: 'donation', title: user, subtitle: `${event.name === 'subscription' ? 'se suscribió con' : 'donó'} ${formatMoney(event.amount, event.currency)}`, detail: input };
    case 'command':
      return { kind: 'command', title: user, subtitle: `usó ${label}`, detail: input };
    case 'sub': {
      const tier = event.tier && event.tier !== '1' ? ` (Tier ${event.tier})` : '';
      return { kind: 'sub', title: user, subtitle: event.resub ? `se resuscribió · ${event.months ?? event.amount} meses${tier}` : `se suscribió${tier}`, detail: input };
    }
    case 'gift':
      return { kind: 'sub', title: user, subtitle: `regaló ${event.amount} ${event.amount === 1 ? 'sub' : 'subs'}` };
    case 'raid':
      return { kind: 'raid', title: user, subtitle: `llegó con una raid de ${event.amount} ${event.amount === 1 ? 'viewer' : 'viewers'}` };
    case 'follow':
      return { kind: 'follow', title: user, subtitle: 'ahora te sigue' };
    case 'poll':
      return { kind: 'poll', title: 'El chat decidió', subtitle: label };
    case 'chaos':
      return { kind: 'chaos', title: 'Modo caos', subtitle: label };
    default:
      return { kind: 'custom', title: user, subtitle: label, detail: input };
  }
}
