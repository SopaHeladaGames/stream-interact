import path from 'node:path';
import { log } from './core/logger.js';
import { EventBus } from './core/eventBus.js';
import { RulesEngine } from './core/rulesEngine.js';
import { RulesStore } from './core/rulesStore.js';
import { MinecraftRcon, minecraftAction, announceAction, titleAction } from './actions/minecraft.js';
import { chatAction } from './actions/chat.js';
import { createTwitchAuth } from './auth/twitchAuth.js';
import { startTwitch } from './adapters/twitch.js';
import { MinecraftServer } from './minecraftServer.js';
import { GameStore } from './game/gameStore.js';
import { PollManager } from './game/polls.js';
import { ChaosMode } from './game/chaos.js';
import { createServer, registerApiRoutes, registerServerRoutes, registerGameRoutes, servePanel } from './server.js';

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

  const simulate = ({ type = 'reward', name = '', user = 'Tester', amount = 0, input = '' }) =>
    bus.emit({
      platform: 'simulado', type, name, amount: Number(amount) || 0, input,
      user: { id: `sim-${user}`, name: user, displayName: user, isMod: true, isBroadcaster: false }
    });

  let twitch = null;
  registerApiRoutes(app, {
    bus, engine, store, simulate, mc, mcServer, getTwitch: () => twitch, config,
    getGame: () => ({ poll: polls.summary(), chaos: chaos.summary() })
  });
  registerGameRoutes(app, { polls, chaos, gameStore });
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
    polls.dispose();
    twitch?.stop();
    if (mcServer.proc) await mcServer.stop();
    mc.close();
    const closed = new Promise((r) => server.close(() => r()));
    server.closeAllConnections?.(); // el feed en vivo mantiene conexiones abiertas
    await closed;
  })());

  return { config, bus, mc, mcServer, polls, chaos, twitchReady, stop, url: `http://localhost:${config.port}` };
}
