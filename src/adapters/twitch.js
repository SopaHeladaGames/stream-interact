import fs from 'node:fs';
import path from 'node:path';
import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { log } from '../core/logger.js';
import { chatFeed } from '../core/chatFeed.js';

/**
 * Adaptador de Twitch: escucha EventSub por WebSocket (no necesita URL pública)
 * y convierte cada evento al formato común del EventBus.
 */
export async function startTwitch({ authProvider, userId, bus, redemptions = null }) {
  const apiClient = new ApiClient({ authProvider });
  const me = await apiClient.users.getUserById(userId);
  log.info(`🟣 Conectado a Twitch como ${me.displayName}`);

  // IDs de las recompensas que creó ESTA app (solo esas se pueden completar/reembolsar por API)
  const manageable = new Set();
  try {
    const rewards = await apiClient.channelPoints.getCustomRewards(userId, true);
    rewards.forEach((r) => manageable.add(r.id));
  } catch (err) {
    log.warn('No se pudieron leer las recompensas (¿tu cuenta es afiliado/partner?):', err.message);
  }

  const assertManageable = (rewardId) => {
    if (!manageable.has(rewardId)) {
      throw Object.assign(new Error('Twitch solo permite modificar recompensas creadas por esta app. Esta se creó en el panel de Twitch.'), { status: 403 });
    }
  };

  const listener = new EventSubWsListener({ apiClient });

  // 1) Canje de recompensas de puntos de canal
  listener.onChannelRedemptionAdd(userId, (e) => {
    chatFeed.event({
      platform: 'twitch', eventType: 'reward', title: e.rewardTitle, amount: e.rewardCost, input: e.input ?? '',
      user: { id: e.userId, name: e.userName, displayName: e.userDisplayName }
    });
    const canManage = manageable.has(e.rewardId) && e.status === 'unfulfilled';
    // Pestaña "Canjes" del chat: queda pendiente hasta que una regla (o tú) lo complete o lo devuelva
    redemptions?.add({
      id: e.id, rewardId: e.rewardId, title: e.rewardTitle, cost: e.rewardCost, input: e.input ?? '',
      user: e.userDisplayName, managed: canManage, status: e.status === 'unfulfilled' ? 'pendiente' : 'hecho'
    });
    bus.emit({
      platform: 'twitch',
      type: 'reward',
      name: e.rewardTitle,
      user: { id: e.userId, name: e.userName, displayName: e.userDisplayName, isMod: false, isBroadcaster: e.userId === userId },
      amount: e.rewardCost,
      input: e.input ?? '',
      // Recompensas creadas en Twitch: no se pueden completar por la API, pero si una regla las ejecutó se marcan como hechas aquí
      complete: canManage
        ? () => e.updateStatus('FULFILLED').then((r) => { redemptions?.set(e.id, 'hecho', { by: 'regla' }); return r; })
        : async () => { redemptions?.set(e.id, 'hecho', { by: 'regla' }); },
      refund: canManage ? () => e.updateStatus('CANCELED').then((r) => { redemptions?.set(e.id, 'devuelto', { by: 'regla' }); return r; }) : undefined
    });
  });

  // 2) Mensajes de chat: todos van al panel; los que empiezan con "!" además son comandos
  listener.onChannelChatMessage(userId, userId, (e) => {
    const text = e.messageText.trim();
    const badges = e.badges ?? {};
    chatFeed.message({
      platform: 'twitch',
      id: e.messageId,
      user: {
        id: e.chatterId,
        name: e.chatterName,
        displayName: e.chatterDisplayName,
        color: e.color || null,
        badges: Object.keys(badges)
      },
      parts: normalizeParts(e.messageParts, text),
      text,
      reply: e.parentMessageId ? { id: e.parentMessageId, user: e.parentMessageUserDisplayName, text: e.parentMessageText } : null,
      highlighted: e.messageType === 'channel_points_highlighted',
      mentionsMe: e.messageParts.some((p) => p.type === 'mention' && p.mention?.user_id === userId),
      isCommand: text.startsWith('!')
    });

    if (!text.startsWith('!')) return;
    const [name, ...args] = text.split(/\s+/);
    bus.emit({
      platform: 'twitch',
      type: 'command',
      name: name.toLowerCase(),
      user: {
        id: e.chatterId,
        name: e.chatterName,
        displayName: e.chatterDisplayName,
        isMod: 'moderator' in badges,
        isBroadcaster: 'broadcaster' in badges || e.chatterId === userId
      },
      amount: 0,
      input: args.join(' ')
    });
  });

  // 3) Bits (cheers)
  listener.onChannelCheer(userId, (e) => {
    chatFeed.event({
      platform: 'twitch', eventType: 'cheer', amount: e.bits, input: e.message ?? '',
      user: { id: e.userId, name: e.userName, displayName: e.isAnonymous ? 'Anónimo' : e.userDisplayName }
    });
    bus.emit({
      platform: 'twitch',
      type: 'cheer',
      name: 'bits',
      user: {
        id: e.userId ?? 'anonimo',
        name: e.userName ?? 'anonimo',
        displayName: e.isAnonymous ? 'Anónimo' : e.userDisplayName,
        isMod: false,
        isBroadcaster: false
      },
      amount: e.bits,
      input: e.message ?? ''
    });
  });

  // 4) Suscripciones, subs regaladas, raids y follows
  const TIER = { 1000: '1', 2000: '2', 3000: '3' };
  const viewer = (id, name, displayName) => ({ id: id ?? 'anonimo', name: name ?? 'anonimo', displayName: displayName ?? 'Anónimo', isMod: false, isBroadcaster: false });
  const safely = (label, fn) => { try { fn(); } catch (err) { log.warn(`No se pudo escuchar ${label} de Twitch: ${err.message}`); } };

  // Suscripción nueva (las que son regalo se cuentan en "subs regaladas", para no contarlas dos veces)
  safely('suscripciones', () => listener.onChannelSubscription(userId, (e) => {
    if (e.isGift) return;
    const tier = TIER[e.tier] ?? '1';
    const user = viewer(e.userId, e.userName, e.userDisplayName);
    chatFeed.event({ platform: 'twitch', eventType: 'sub', user, amount: 1, tier, input: '' });
    bus.emit({ platform: 'twitch', type: 'sub', name: 'sub', user, amount: 1, tier, months: 1, input: '' });
  }));

  // Resub (cuando el espectador comparte su mensaje de resuscripción en el chat)
  safely('resubs', () => listener.onChannelSubscriptionMessage(userId, (e) => {
    const tier = TIER[e.tier] ?? '1';
    const months = e.cumulativeMonths ?? 1;
    const user = viewer(e.userId, e.userName, e.userDisplayName);
    chatFeed.event({ platform: 'twitch', eventType: 'sub', user, amount: months, tier, resub: true, input: e.messageText ?? '' });
    bus.emit({ platform: 'twitch', type: 'sub', name: 'sub', user, amount: months, tier, months, resub: true, input: e.messageText ?? '' });
  }));

  // Subs regaladas: la regla se ejecuta una vez por cada sub del regalo
  safely('subs regaladas', () => listener.onChannelSubscriptionGift(userId, (e) => {
    const tier = TIER[e.tier] ?? '1';
    const total = Math.max(1, e.amount ?? 1);
    const user = e.isAnonymous ? viewer('anonimo', 'anonimo', 'Anónimo') : viewer(e.gifterId, e.gifterName, e.gifterDisplayName);
    chatFeed.event({ platform: 'twitch', eventType: 'gift', user, amount: total, tier, input: '' });
    for (let i = 0; i < Math.min(total, 100); i++) {
      bus.emit({ platform: 'twitch', type: 'gift', name: 'gift', user, amount: total, tier, giftIndex: i, input: '' });
    }
  }));

  // Raids hacia tu canal
  safely('raids', () => listener.onChannelRaidTo(userId, (e) => {
    const user = viewer(e.raidingBroadcasterId, e.raidingBroadcasterName, e.raidingBroadcasterDisplayName);
    chatFeed.event({ platform: 'twitch', eventType: 'raid', user, amount: e.viewers, input: '' });
    bus.emit({ platform: 'twitch', type: 'raid', name: 'raid', user, amount: e.viewers, input: '' });
  }));

  // Follows: cada persona cuenta una sola vez mientras la app está abierta (dejar de seguir y volver no repite)
  const followed = new Set();
  safely('follows', () => listener.onChannelFollow(userId, userId, (e) => {
    if (followed.has(e.userId)) return;
    followed.add(e.userId);
    const user = viewer(e.userId, e.userName, e.userDisplayName);
    chatFeed.event({ platform: 'twitch', eventType: 'follow', user, amount: 0, input: '' });
    bus.emit({ platform: 'twitch', type: 'follow', name: 'follow', user, amount: 0, input: '' });
  }));

  // 5) Moderación hecha en Twitch (o desde la app): reflejarla en el panel
  listener.onChannelChatMessageDelete(userId, userId, (e) => chatFeed.deleted(e.messageId));
  listener.onChannelChatClearUserMessages(userId, userId, (e) => chatFeed.clearedUser(e.userId));
  listener.onChannelChatClear(userId, userId, () => chatFeed.cleared());

  listener.start();
  log.info('🟣 Escuchando chat, recompensas, comandos y bits de Twitch');

  const moderate = async (fn) => {
    try { return await fn(); } catch (err) { throw moderationError(err); }
  };

  // Al conectar: traer los canjes de las recompensas de la app que siguen pendientes en Twitch
  if (redemptions) {
    (async () => {
      for (const rewardId of manageable) {
        try {
          const page = await apiClient.channelPoints.getRedemptionsForBroadcaster(userId, rewardId, 'UNFULFILLED', { newestFirst: true, limit: 50 });
          for (const r of page.data) {
            redemptions.add({
              id: r.id, rewardId: r.rewardId, title: r.rewardTitle, cost: r.rewardCost, input: r.userInput ?? '',
              user: r.userDisplayName, managed: true, at: r.redemptionDate.toISOString()
            });
          }
        } catch { /* recompensa borrada o sin permiso: se ignora */ }
      }
    })();
  }

  return {
    displayName: me.displayName,
    /** Completa o devuelve un canje pendiente desde el panel (solo recompensas de la app). */
    resolveRedemption: async (id, action) => {
      const item = redemptions?.get(id);
      if (!item) throw Object.assign(new Error('Ese canje ya no está en la lista'), { status: 404 });
      if (action === 'visto') return redemptions.set(id, 'hecho', { by: 'panel' });
      if (!item.managed) {
        throw Object.assign(new Error('Esta recompensa se creó en el panel de Twitch: solo se puede devolver desde Twitch. Puedes marcarla como hecha aquí.'), { status: 403 });
      }
      try {
        await apiClient.channelPoints.updateRedemptionStatusByIds(userId, item.rewardId, [id], action === 'devolver' ? 'CANCELED' : 'FULFILLED');
      } catch (err) {
        // Si ya se resolvió en Twitch, solo se actualiza la lista
        if (!/not found|already|404|400/i.test(err.message)) throw friendlyError(err);
      }
      return redemptions.set(id, action === 'devolver' ? 'devuelto' : 'hecho', { by: 'panel' });
    },
    sendChat: (text) => apiClient.chat.sendChatMessage(userId, text).catch((err) =>
      log.warn('No se pudo enviar mensaje al chat:', err.message)),
    /** Escribir en el chat desde el panel (con respuesta opcional a otro mensaje). */
    sendFromPanel: (text, replyTo) => moderate(async () => {
      const res = await apiClient.chat.sendChatMessage(userId, text, replyTo ? { replyParentMessageId: replyTo } : undefined);
      if (!res.isSent) {
        throw Object.assign(new Error(`Twitch no envió el mensaje${res.dropReasonMessage ? `: ${res.dropReasonMessage}` : ''}`), { status: 400 });
      }
    }),
    deleteMessage: (messageId) => moderate(() => apiClient.moderation.deleteChatMessages(userId, messageId)),
    timeout: (targetId, seconds, reason) => moderate(() => apiClient.moderation.banUser(userId, { user: targetId, duration: seconds, reason: reason || 'Timeout desde Sopa-ChatBot' })),
    ban: (targetId, reason) => moderate(() => apiClient.moderation.banUser(userId, { user: targetId, reason: reason || 'Ban desde Sopa-ChatBot' })),
    unban: (targetId) => moderate(() => apiClient.moderation.unbanUser(userId, targetId)),
    /** Crea una recompensa propiedad de esta app (así se puede completar/reembolsar). */
    createReward: async (data) => {
      try {
        const reward = await apiClient.channelPoints.createCustomReward(userId, data);
        manageable.add(reward.id);
        return reward;
      } catch (err) { throw friendlyError(err); }
    },
    /** Todas las recompensas del canal, marcando cuáles puede administrar la app. */
    listRewards: async () => {
      const rewards = await apiClient.channelPoints.getCustomRewards(userId, false);
      return rewards.map((r) => ({
        id: r.id,
        title: r.title,
        cost: r.cost,
        prompt: r.prompt,
        enabled: r.isEnabled,
        paused: r.isPaused,
        userInputRequired: r.userInputRequired,
        globalCooldown: r.globalCooldown,
        backgroundColor: r.backgroundColor,
        managedByApp: manageable.has(r.id)
      }));
    },
    /** Cambia una recompensa de la app (activar, pausar, editar). */
    updateReward: async (rewardId, patch) => {
      assertManageable(rewardId);
      const allowed = ['title', 'cost', 'prompt', 'isEnabled', 'isPaused', 'userInputRequired', 'globalCooldown', 'backgroundColor'];
      const data = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
      try {
        const r = await apiClient.channelPoints.updateCustomReward(userId, rewardId, data);
        return { id: r.id, title: r.title, cost: r.cost, enabled: r.isEnabled, paused: r.isPaused };
      } catch (err) { throw friendlyError(err); }
    },
    /** Elimina una recompensa de la app. */
    deleteReward: async (rewardId) => {
      assertManageable(rewardId);
      try {
        await apiClient.channelPoints.deleteCustomReward(userId, rewardId);
        manageable.delete(rewardId);
      } catch (err) { throw friendlyError(err); }
    },
    /**
     * Pausa (o reanuda) en Twitch las recompensas de la app que estaban disponibles.
     * Solo reanuda las que pausó ella misma; las que ya estaban pausadas a mano se quedan así.
     */
    setRewardsPaused: async (paused) => {
      if (paused) {
        const rewards = await apiClient.channelPoints.getCustomRewards(userId, true);
        const targets = rewards.filter((r) => r.isEnabled && !r.isPaused);
        const done = [];
        for (const r of targets) {
          try { await apiClient.channelPoints.updateCustomReward(userId, r.id, { isPaused: true }); done.push(r.id); } catch { /* seguir con las demás */ }
        }
        savePausedByApp([...new Set([...loadPausedByApp(), ...done])]);
        if (done.length) log.info(`⏸️  ${done.length} recompensa${done.length === 1 ? '' : 's'} pausada${done.length === 1 ? '' : 's'} en Twitch`);
        return done.length;
      }
      const ids = loadPausedByApp();
      const pending = [];
      let count = 0;
      for (const id of ids) {
        try { await apiClient.channelPoints.updateCustomReward(userId, id, { isPaused: false }); count++; } catch (err) {
          if ((err.statusCode ?? 0) !== 404) pending.push(id); // si ya no existe, se olvida
        }
      }
      savePausedByApp(pending);
      if (count) log.info(`▶️  ${count} recompensa${count === 1 ? '' : 's'} reanudada${count === 1 ? '' : 's'} en Twitch`);
      return count;
    },
    stop: () => listener.stop()
  };
}

/** Traduce los errores más comunes de la API de Twitch a algo entendible. */
function friendlyError(err) {
  const body = String(err.body ?? err.message ?? '');
  const status = err.statusCode ?? 500;
  let message = err.message;
  if (/DUPLICATE_REWARD|duplicate/i.test(body)) message = 'Ya existe una recompensa con ese título en tu canal. Los títulos deben ser únicos.';
  else if (status === 403) message = 'Twitch rechazó el cambio: solo se pueden modificar recompensas creadas por esta app.';
  else if (status === 404) message = 'Esa recompensa ya no existe en Twitch.';
  else if (status === 400) {
    try { message = `Twitch rechazó los datos: ${JSON.parse(body).message}`; } catch { /* usar el mensaje original */ }
  }
  return Object.assign(new Error(message), { status: status >= 400 && status < 500 ? status : 502 });
}

/** Convierte las partes del mensaje de Twitch (texto, emotes, menciones, cheermotes) a un formato simple. */
function normalizeParts(parts, fallbackText) {
  if (!Array.isArray(parts) || parts.length === 0) return [{ type: 'text', text: fallbackText }];
  return parts.map((p) => {
    if (p.type === 'emote' && p.emote?.id) return { type: 'emote', text: p.text, id: p.emote.id, animated: p.emote.format?.includes('animated') };
    if (p.type === 'mention') return { type: 'mention', text: p.text };
    if (p.type === 'cheermote') return { type: 'cheermote', text: p.text, bits: p.cheermote?.bits ?? 0 };
    return { type: 'text', text: p.text };
  });
}

/** Errores de chat y moderación en español. */
function moderationError(err) {
  if (err.status) return err; // ya es nuestro
  const status = err.statusCode ?? 500;
  let message = err.message;
  let detail = '';
  try { detail = JSON.parse(err.body).message ?? ''; } catch { /* sin detalle */ }
  if (status === 401 || (status === 403 && /scope|token/i.test(detail))) {
    message = 'Faltan permisos de Twitch. Cierra la app, vuelve a abrirla e inicia sesión de nuevo para aceptar los permisos de moderación.';
  } else if (/may not be banned|cannot be banned|broadcaster/i.test(detail)) {
    message = 'No se puede aplicar a esa persona (no puedes banearte a ti ni al streamer).';
  } else if (/already banned/i.test(detail)) {
    message = 'Ese usuario ya está baneado.';
  } else if (/not banned/i.test(detail)) {
    message = 'Ese usuario no tiene ban ni timeout activo.';
  } else if (status === 404) {
    message = 'Ese mensaje ya no existe (pudo borrarse o ser muy antiguo).';
  } else if (detail) {
    message = `Twitch: ${detail}`;
  }
  return Object.assign(new Error(message), { status: status >= 400 && status < 500 ? status : 502 });
}

// Recompensas que pausó la app (para reanudarlas aunque se cierre a media pausa)
const PAUSED_FILE = path.resolve('data', 'recompensas-pausadas.json');

function loadPausedByApp() {
  try { return JSON.parse(fs.readFileSync(PAUSED_FILE, 'utf8')); } catch { return []; }
}

function savePausedByApp(ids) {
  try {
    fs.mkdirSync(path.dirname(PAUSED_FILE), { recursive: true });
    fs.writeFileSync(PAUSED_FILE, JSON.stringify(ids));
  } catch { /* no es crítico */ }
}
