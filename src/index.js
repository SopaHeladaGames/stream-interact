import path from 'node:path';
import { config } from './config.js';
import { log } from './core/logger.js';
import { EventBus } from './core/eventBus.js';
import { RulesEngine } from './core/rulesEngine.js';
import { MinecraftRcon, minecraftAction, announceAction, titleAction } from './actions/minecraft.js';
import { chatAction } from './actions/chat.js';
import { createTwitchAuth } from './auth/twitchAuth.js';
import { startTwitch } from './adapters/twitch.js';
import { createServer, registerControlRoutes } from './server.js';

const app = createServer();
const server = app.listen(config.port, '127.0.0.1', () =>
  log.info(`🌐 Panel local en http://localhost:${config.port}`));

const bus = new EventBus({ gapMs: 500 });
const mc = new MinecraftRcon(config.minecraft);
await mc.tryConnect();

const chatSenders = {};
new RulesEngine({
  rulesPath: path.resolve('config', 'rules.json'),
  bus,
  context: { player: config.minecraft.player },
  actions: {
    minecraft: minecraftAction(mc),
    announce: announceAction(mc),
    title: titleAction(mc),
    chat: chatAction(chatSenders, config.chatReplies),
    wait: async (action) => new Promise((r) => setTimeout(r, action.ms ?? 1000))
  }
});

// Eventos simulados (POST /simular o npm run simular)
const simulate = ({ type = 'reward', name = '', user = 'Tester', amount = 0, input = '' }) =>
  bus.emit({
    platform: 'simulado', type, name, amount, input,
    user: { id: `sim-${user}`, name: user, displayName: user, isMod: true, isBroadcaster: false }
  });

// Las rutas de control se registran antes del login para que la página funcione desde el inicio
let twitch = null;
registerControlRoutes(app, { bus, simulate, getTwitch: () => twitch });

const { authProvider, userId } = await createTwitchAuth(app, config.twitch, config.port);
twitch = await startTwitch({ authProvider, userId, bus });
chatSenders.twitch = twitch.sendChat;

log.info('✅ Todo listo. Usa !pausa / !reanudar en el chat (tú o tus mods) si algo se sale de control.');

process.on('SIGINT', () => {
  log.info('Cerrando...');
  twitch?.stop();
  server.close();
  process.exit(0);
});
