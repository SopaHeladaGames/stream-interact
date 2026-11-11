import path from 'node:path';
import { config } from './config.js';
import { log } from './core/logger.js';
import { EventBus } from './core/eventBus.js';
import { RulesEngine } from './core/rulesEngine.js';
import { RulesStore } from './core/rulesStore.js';
import { MinecraftRcon, minecraftAction, announceAction, titleAction } from './actions/minecraft.js';
import { chatAction } from './actions/chat.js';
import { createTwitchAuth } from './auth/twitchAuth.js';
import { startTwitch } from './adapters/twitch.js';
import { createServer, registerApiRoutes, servePanel } from './server.js';

const rulesPath = path.resolve('config', 'rules.json');
const app = createServer();

const bus = new EventBus({ gapMs: 500 });
const mc = new MinecraftRcon(config.minecraft);

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

// Eventos simulados (panel → Probar, o npm run simular)
const simulate = ({ type = 'reward', name = '', user = 'Tester', amount = 0, input = '' }) =>
  bus.emit({
    platform: 'simulado', type, name, amount: Number(amount) || 0, input,
    user: { id: `sim-${user}`, name: user, displayName: user, isMod: true, isBroadcaster: false }
  });

let twitch = null;
registerApiRoutes(app, { bus, engine, store, simulate, mc, getTwitch: () => twitch, config });

// El login de Twitch registra /auth/*; el panel va al final para no tapar esas rutas
const authPromise = createTwitchAuth(app, config.twitch, config.port);
servePanel(app);

const server = app.listen(config.port, '127.0.0.1', () =>
  log.info(`🌐 Panel en http://localhost:${config.port}`));

await mc.tryConnect();

const { authProvider, userId } = await authPromise;
twitch = await startTwitch({ authProvider, userId, bus });
chatSenders.twitch = twitch.sendChat;

log.info('✅ Todo listo. Usa !pausa / !reanudar en el chat (tú o tus mods) si algo se sale de control.');

process.on('SIGINT', () => {
  log.info('Cerrando...');
  twitch?.stop();
  server.close();
  process.exit(0);
});
