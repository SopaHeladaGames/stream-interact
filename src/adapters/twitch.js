import { ApiClient } from '@twurple/api';
import { EventSubWsListener } from '@twurple/eventsub-ws';
import { log } from '../core/logger.js';

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

  const listener = new EventSubWsListener({ apiClient });

  // 1) Canje de recompensas de puntos de canal
  listener.onChannelRedemptionAdd(userId, (e) => {
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

  // 2) Mensajes de chat que empiezan con "!" → comandos
  listener.onChannelChatMessage(userId, userId, (e) => {
    const text = e.messageText.trim();
    if (!text.startsWith('!')) return;
    const [name, ...args] = text.split(/\s+/);
    const badges = e.badges ?? {};
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

  listener.start();
  log.info('🟣 Escuchando recompensas, comandos y bits de Twitch');

  return {
    sendChat: (text) => apiClient.chat.sendChatMessage(userId, text).catch((err) =>
      log.warn('No se pudo enviar mensaje al chat:', err.message)),
    /** Crea una recompensa propiedad de esta app (así se puede completar/reembolsar). */
    createReward: async (data) => {
      const reward = await apiClient.channelPoints.createCustomReward(userId, data);
      manageable.add(reward.id);
      return reward;
    },
    stop: () => listener.stop()
  };
}
