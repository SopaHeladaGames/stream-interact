import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { log } from '../core/logger.js';
import { chatFeed } from '../core/chatFeed.js';

/**
 * Adaptador de Twitch: escucha EventSub por WebSocket (no necesita URL pública)
 * y convierte cada evento al formato común del EventBus.
 */
export async function startTwitch({ authProvider, userId, bus }) {
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
    bus.emit({
      platform: 'twitch',
      type: 'reward',
      name: e.rewardTitle,
      user: { id: e.userId, name: e.userName, displayName: e.userDisplayName, isMod: false, isBroadcaster: e.userId === userId },
      amount: e.rewardCost,
      input: e.input ?? '',
      complete: canManage ? () => e.updateStatus('FULFILLED') : undefined,
      refund: canManage ? () => e.updateStatus('CANCELED') : undefined
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

  // 4) Moderación hecha en Twitch (o desde la app): reflejarla en el panel
  listener.onChannelChatMessageDelete(userId, userId, (e) => chatFeed.deleted(e.messageId));
  listener.onChannelChatClearUserMessages(userId, userId, (e) => chatFeed.clearedUser(e.userId));
  listener.onChannelChatClear(userId, userId, () => chatFeed.cleared());

  listener.start();
  log.info('🟣 Escuchando chat, recompensas, comandos y bits de Twitch');

  const moderate = async (fn) => {
    try { return await fn(); } catch (err) { throw moderationError(err); }
  };

  return {
    displayName: me.displayName,
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
    timeout: (targetId, seconds, reason) => moderate(() => apiClient.moderation.banUser(userId, { user: targetId, duration: seconds, reason: reason || 'Timeout desde stream-interact' })),
    ban: (targetId, reason) => moderate(() => apiClient.moderation.banUser(userId, { user: targetId, reason: reason || 'Ban desde stream-interact' })),
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
