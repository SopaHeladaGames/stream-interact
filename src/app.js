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
import { startPlayit } from './playit.js';
import { InstallationStore } from './installations.js';
import { BackupManager } from './backups.js';
import { PaperUpdater } from './paperUpdater.js';
import { GameruleManager } from './gamerules.js';
import { HistoryStore } from './core/history.js';
import { RedemptionQueue } from './core/redemptions.js';
import { PlayerTargets } from './core/targets.js';
import { parseList } from './minecraftPlayers.js';
import { GameStore } from './game/gameStore.js';
import { PollManager } from './game/polls.js';
import { ChaosMode } from './game/chaos.js';
import { DonationManager } from './donations/index.js';
import { chatFeed } from './core/chatFeed.js';
import { formatMoney } from './core/money.js';
import { createServer, registerApiRoutes, registerServerRoutes, registerGameRoutes, registerOverlayRoutes, registerDonationRoutes, registerStatsRoutes, registerRedemptionRoutes, servePanel } from './server.js';

/**
 * Arranca todo el backend: reglas, RCON, servidor HTTP + panel y Twitch.
 * Lo usan tanto `npm start` (src/index.js) como la app de escritorio (electron/main.js).
 *
 * Devuelve en cuanto el servidor HTTP escucha; Twitch se conecta en segundo plano
 * (la primera vez espera a que inicies sesión).
 */
export async function startApp(options = {}) {
  // Se importa aquí para que un .env incompleto se reporte como error de arranque (y Electron pueda mostrarlo)
  const { config } = await import('./config.js');

  const rulesPath = path.resolve('config', 'rules.json');
  const app = createServer();
  const bus = new EventBus({ gapMs: 500 });
  const mc = new MinecraftRcon(config.minecraft);
  const mcServer = new MinecraftServer({
    ...config.mcServer,
    rcon: { port: config.minecraft.port, password: config.minecraft.password },
    onRconReady: () => mc.tryConnect()
  });
  // Instalaciones (Vanilla, con mods…): la activa es la que arranca ▶ Iniciar
  const installations = new InstallationStore(path.resolve('config', 'instalaciones.json'), {
    seedDir: config.mcServer.dir,
    defaults: { java: config.mcServer.java, memoryMin: config.mcServer.memoryMin, memoryMax: config.mcServer.memoryMax, extraArgs: config.mcServer.extraArgs ?? '' }
  });
  if (installations.active) mcServer.setInstallation(installations.effective(installations.active));
  // Respaldos del mundo de la instalación activa
  const backups = new BackupManager({
    file: path.resolve('config', 'respaldos.json'), mcServer, mc,
    getInstallation: () => installations.active
  });

  const chatSenders = {};
  // Reglas del mundo (/gamerule): panel y acción "gamerule" de las reglas (con duración opcional)
  const gamerules = new GameruleManager({
    mc, file: path.resolve('config', 'gamerules-temporales.json'),
    getInstallationId: () => installations.active?.id ?? null
  });

  const actions = {
    gamerule: (action, vars) => gamerules.applyAction(action, vars),
    // Encender el modo caos por un tiempo (chaos se crea más abajo; se usa cuando ya existe)
    caos: async (action, vars) => { chaos.startFor(action.seconds, vars.user); },
    minecraft: minecraftAction(mc),
    announce: announceAction(mc),
    title: titleAction(mc),
    chat: chatAction(chatSenders, config.chatReplies),
    overlay: overlayAction(),
    wait: async (action) => new Promise((r) => setTimeout(r, action.ms ?? 1000))
  };
  // A quién le llega cada regla: tú, quien elija el chat, alguien al azar o todos
  const targets = new PlayerTargets({
    file: path.resolve('config', 'jugadores.json'),
    me: config.minecraft.player,
    online: async () => {
      if (!mc.connected) await mc.tryConnect({ quiet: true });
      if (!mc.connected) throw new Error('Sin RCON');
      return parseList(await mc.send('minecraft:list')).players;
    }
  });
  const engine = new RulesEngine({ rulesPath, bus, context: { player: config.minecraft.player }, actions, targets });
  const store = new RulesStore(rulesPath, Object.keys(actions));
  // Historial de lo que hizo el chat (estadísticas): data/historial/AAAA-MM.jsonl
  const history = new HistoryStore(path.resolve('data', 'historial'));
  engine.onRecord((rec) => history.record(rec));
  engine.countThisStream = (ruleId) => history.countThisStream(ruleId);
  // Canjes de recompensas para la pestaña "Canjes" del chat
  const redemptions = new RedemptionQueue(path.resolve('data', 'canjes.json'));

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
      bus.emit(event);
    }
  });
  const webhookServer = await donations.startWebhookServer();

  // Donaciones y bits (dinero o apoyo real) siempre se ven en el overlay al llegar, tengan o no una regla.
  // Si su regla trae una acción "Alerta en overlay" propia, esa la reemplaza (para no mostrar dos).
  // Las simulaciones de la página Probar siguen el camino normal (alerta solo si hay regla).
  const ALWAYS_ALERT = new Set(['donation', 'cheer']);
  const alwaysAlerts = (event) => ALWAYS_ALERT.has(event.type) && event.platform !== 'simulado';
  bus.onEvent((event) => {
    if (!alwaysAlerts(event) || !gameStore.overlay.autoAlerts) return;
    const rule = engine.findRule(event);
    if ((rule?.actions ?? []).some((a) => a.type === 'overlay')) return;
    overlayFeed.alert({ ...autoAlert(event, event.type === 'cheer' ? 'bits' : 'donación'), platform: event.platform });
  });

  // Alerta automática en el overlay cada vez que se ejecuta una regla
  // (salvo que la regla tenga su propia acción "overlay")
  engine.onRuleRun((rule, event, label, target) => {
    if (!gameStore.overlay.autoAlerts) return;
    if ((rule.actions ?? []).some((a) => a.type === 'overlay')) return;
    if (alwaysAlerts(event)) return; // ya se mostró al llegar
    // "A quién le tocó" cuando la regla (o el modo caos) eligió a alguien
    const extra = target && gameStore.overlay.showTarget ? { target } : {};
    overlayFeed.alert({ ...autoAlert(event, label), ...extra, platform: event.platform });
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
  registerStatsRoutes(app, { history });
  // Overlay: contadores (reglas del mundo temporales y modo caos) y top del directo
  app.get('/api/overlay/estado', (_req, res) => {
    const timers = [];
    const c = chaos.status();
    if (c.running) timers.push({ id: 'caos', kind: 'chaos', icon: '🌀', label: 'Modo caos', since: c.autoStartAt, endsAt: c.autoStopAt });
    for (const t of gamerules.temporaries()) {
      if (t.otherInstallation) continue;
      const v = typeof t.value === 'boolean' ? (t.value ? 'activado' : 'desactivado') : t.value;
      timers.push({ id: t.id, kind: 'gamerule', icon: '⏱', label: t.label, value: v, since: t.since ? new Date(t.since).toISOString() : null, endsAt: new Date(t.until).toISOString() });
    }
    // Top del directo: bits y donaciones (convertidas a bits para ordenarlas)
    const rates = engine.settings.bitsPerCurrency ?? {};
    const s = history.stats({ range: 'session' });
    const top = s.topViewers
      .map((v) => {
        const moneyBits = Object.entries(v.money).reduce((n, [cur, amt]) => n + amt * (Number(rates[cur]) || 0), 0);
        return { user: v.user, bits: v.bits, money: v.money, score: v.bits + moneyBits };
      })
      .filter((v) => v.bits > 0 || Object.keys(v.money).length)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    res.json({ timers, top });
  });
  registerRedemptionRoutes(app, { redemptions, getTwitch: () => twitch });
  // Versión y actualizaciones (las maneja la app de escritorio; sin ella solo se informa la versión)
  app.get('/api/app/version', (_req, res) => res.json(options.updates?.status() ?? { current: process.env.npm_package_version ?? null, packaged: false, state: 'dev' }));
  app.post('/api/app/buscar-actualizacion', async (_req, res) => res.json(options.updates ? await options.updates.check() : { state: 'dev' }));
  app.post('/api/app/actualizar', (_req, res) => {
    try { res.json(options.updates?.install() ?? { ok: false }); } catch (err) { res.status(err.status ?? 500).json({ error: err.message }); }
  });
  const paper = new PaperUpdater({ installations, mcServer });
  registerServerRoutes(app, { mcServer, mc, installations, backups, paper, targets, gamerules, pickFolder: options.pickFolder, openPath: options.openPath });

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

  startPlayit(config.playit).catch((err) => log.error(`Playit: ${err.message}`));

  if (config.mcServer.autoStart && mcServer.configured && !mc.connected) {
    try { mcServer.start(); } catch (err) { log.error(err.message); }
  }

  const twitchReady = authPromise
    .then(({ authProvider, userId }) => startTwitch({ authProvider, userId, bus, redemptions }))
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
    await backups.whenIdle(); // que el respaldo al detener termine antes de salir
    backups.dispose();
    gamerules.dispose();
    mc.close();
    const closed = new Promise((r) => server.close(() => r()));
    server.closeAllConnections?.(); // el feed en vivo mantiene conexiones abiertas
    await closed;
  })());

  return { config, bus, mc, mcServer, polls, chaos, donations, twitchReady, stop, url: `http://localhost:${config.port}` };
}
