import path from 'node:path';
import { log } from './core/logger.js';
import { EventBus } from './core/eventBus.js';
import { RulesEngine } from './core/rulesEngine.js';
import { RulesStore } from './core/rulesStore.js';
import { MinecraftRcon, minecraftAction, announceAction, titleAction } from './actions/minecraft.js';
import { chatAction } from './actions/chat.js';
import { overlayAction, autoAlert } from './actions/overlay.js';
import { overlayFeed } from './core/overlayFeed.js';
import { createTwitchAuth } from './auth/twitchAuth.js';
import { startTwitch } from './adapters/twitch.js';
import { MinecraftServer } from './minecraftServer.js';
import { GameStore } from './game/gameStore.js';
import { PollManager } from './game/polls.js';
import { ChaosMode } from './game/chaos.js';
import { DonationManager } from './donations/index.js';
import { chatFeed } from './core/chatFeed.js';
import { formatMoney } from './core/money.js';
import { createServer, registerApiRoutes, registerServerRoutes, registerGameRoutes, registerOverlayRoutes, registerDonationRoutes, servePanel } from './server.js';

/**
 * Arranca todo el backend: reglas, RCON, servidor HTTP + panel y Twitch.
 * Lo usan tanto `npm start` (src/index.js) como la app de escritorio (electron/main.js).
 *
 * Devuelve en cuanto el servidor HTTP escucha; Twitch se conecta en segundo plano
 * (la primera vez espera a que inicies sesión).
 */
export async function startApp() {
  // Se importa aquí para que un .env incompleto se reporte como error de arranque (y Electron pueda mostrarlo)
  const { config } = await import('./config.js');

  const rulesPath = path.resolve('config', 'rules.json');
  const app = createServer();
  const bus = new EventBus({ gapMs: 500 });
  const mc = new MinecraftRcon(config.minecraft);
  const mcServer = new MinecraftServer({ ...config.mcServer, onRconReady: () => mc.tryConnect() });

  const chatSenders = {};
  const actions = {
    minecraft: minecraftAction(mc),
    announce: announceAction(mc),
    title: titleAction(mc),
    chat: chatAction(chatSenders, config.chatReplies),
    overlay: overlayAction(),
    wait: async (action) => new Promise((r) => setTimeout(r, action.ms ?? 1000))
  };
  const engine = new RulesEngine({ rulesPath, bus, context: { player: config.minecraft.player }, actions });
  const store = new RulesStore(rulesPath, Object.keys(actions));

  // Votaciones y modo caos: avisan en el chat de Twitch y dentro de Minecraft
  const notify = {
    chat: (text) => { chatSenders.twitch?.(text); },
    minecraft: async (text, platform, color = 'gold') => {
      if (mc.connected) await actions.announce({ text, color }, { platform }).catch(() => {});
    },
    title: async (title, subtitle, color = 'gold') => {
      if (mc.connected) await actions.title({ title, subtitle, color }, { player: config.minecraft.player }).catch(() => {});
    }
  };
  const gameStore = new GameStore(path.resolve('config', 'juego.json'));
  const polls = new PollManager({ bus, engine, store: gameStore, notify });
  const chaos = new ChaosMode({ bus, engine, store: gameStore, notify, canRun: () => mc.connected });

  // Donaciones (Streamlabs, StreamElements, Ko-fi): entran como un evento más, igual que los bits
  const webhookPort = Number(process.env.WEBHOOK_PORT ?? config.port + 1);
  const donations = new DonationManager({
    webhookPort,
    onDonation: (event) => {
      chatFeed.event({
        platform: event.platform, eventType: 'donation', amount: event.amount, currency: event.currency,
        money: formatMoney(event.amount, event.currency), input: event.input, user: event.user, isTest: event.isTest
      });
      // Una donación siempre se ve en el overlay, tenga o no una regla.
      // Si su regla trae una acción "Alerta en overlay" propia, esa la reemplaza (para no mostrar dos).
      const rule = engine.findRule(event);
      const customAlert = (rule?.actions ?? []).some((a) => a.type === 'overlay');
      if (gameStore.overlay.autoAlerts && !customAlert) {
        overlayFeed.alert({ ...autoAlert(event, 'donación'), platform: event.platform });
      }
      bus.emit(event);
    }
  });
  const webhookServer = await donations.startWebhookServer();

  // Alerta automática en el overlay cada vez que se ejecuta una regla
  // (salvo que la regla tenga su propia acción "overlay")
  engine.onRuleRun((rule, event, label) => {
    if (!gameStore.overlay.autoAlerts) return;
    if ((rule.actions ?? []).some((a) => a.type === 'overlay')) return;
    if (event.type === 'donation' && event.platform !== 'simulado') return; // ya se mostró al llegar
    overlayFeed.alert({ ...autoAlert(event, label), platform: event.platform });
  });

  const simulate = ({ type = 'reward', name = '', user = 'Tester', amount = 0, input = '', currency = '' }) =>
    bus.emit({
      platform: 'simulado', type, name, amount: Number(amount) || 0, input, currency,
      user: { id: `sim-${user}`, name: user, displayName: user, isMod: true, isBroadcaster: false }
    });

  let twitch = null;
  registerApiRoutes(app, {
    bus, engine, store, simulate, mc, mcServer, getTwitch: () => twitch, config,
    getGame: () => ({
      poll: polls.summary(),
      chaos: chaos.summary(),
      donations: Object.fromEntries(Object.entries(donations.status().services).map(([id, d]) => [id, d.state]))
    })
  });
  registerGameRoutes(app, { polls, chaos, gameStore });
  registerOverlayRoutes(app, { gameStore });
  registerDonationRoutes(app, { donations });
  registerServerRoutes(app, { mcServer, mc });

  // Las rutas /auth/* se registran antes del panel para que este no las tape
  const authPromise = createTwitchAuth(app, config.twitch, config.port);
  servePanel(app);

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(config.port, '127.0.0.1', () => resolve(s));
    s.once('error', (err) => reject(err.code === 'EADDRINUSE'
      ? new Error(`El puerto ${config.port} ya está en uso. ¿Tienes la app abierta en otra ventana o terminal?`)
      : err));
  });
  log.info(`🌐 Panel en http://localhost:${config.port}`);

  // Reintentar RCON en silencio cada 10 s y detectar servidores arrancados fuera de la app
  await mc.tryConnect();
  mcServer.markExternal(mc.connected);
  const watch = setInterval(async () => {
    if (!mc.connected) await mc.tryConnect({ quiet: true });
    mcServer.markExternal(mc.connected);
  }, 10000);

  if (config.mcServer.autoStart && mcServer.configured && !mc.connected) {
    try { mcServer.start(); } catch (err) { log.error(err.message); }
  }

  const twitchReady = authPromise
    .then(({ authProvider, userId }) => startTwitch({ authProvider, userId, bus }))
    .then((t) => {
      twitch = t;
      chatSenders.twitch = t.sendChat;

      // Pausar también las recompensas de la app en Twitch cuando se pausa todo
      bus.onPauseChange((paused) => {
        if (engine.settings.pauseRewards === false) return;
        return t.setRewardsPaused(paused);
      });
      // Si la app se cerró en pausa, reanudar las recompensas que había pausado
      if (!bus.paused) t.setRewardsPaused(false).catch(() => {});
      log.info('✅ Todo listo. Usa !pausa / !reanudar en el chat (tú o tus mods) si algo se sale de control.');
      return t;
    })
    .catch((err) => { log.error('No se pudo conectar a Twitch:', err.message); });

  let stopping = null;
  /** Apaga todo en orden: Twitch, servidor de Minecraft (guardando el mundo) y HTTP. */
  const stop = () => (stopping ??= (async () => {
    log.info('Cerrando...');
    clearInterval(watch);
    chaos.stop({ silent: true });
    donations.stop();
    webhookServer?.close();
    polls.dispose();
    twitch?.stop();
    if (mcServer.proc) await mcServer.stop();
    mc.close();
    const closed = new Promise((r) => server.close(() => r()));
    server.closeAllConnections?.(); // el feed en vivo mantiene conexiones abiertas
    await closed;
  })());

  return { config, bus, mc, mcServer, polls, chaos, donations, twitchReady, stop, url: `http://localhost:${config.port}` };
}
