import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { log } from './core/logger.js';
import { chatFeed } from './core/chatFeed.js';
import { overlayFeed } from './core/overlayFeed.js';

/**
 * Servidor local: login de Twitch, API del panel y el panel ya compilado.
 * Solo escucha en localhost, no queda expuesto a internet.
 */
export function createServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  return app;
}

/** Envuelve handlers async para que los errores respondan JSON en vez de tumbar el servidor. */
const route = (fn) => async (req, res) => {
  try {
    const result = await fn(req, res);
    if (!res.headersSent) res.json(result ?? { ok: true });
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
};

export function registerApiRoutes(app, { bus, engine, store, simulate, mc, mcServer, getTwitch, config, getGame }) {
  // --- Estado general ---
  app.get('/api/estado', route(() => {
    const twitch = getTwitch();
    return {
      ...bus.status(),
      twitch: twitch ? { connected: true, user: twitch.displayName } : { connected: false, loginUrl: '/auth/login' },
      minecraft: { connected: mc.connected, host: `${config.minecraft.host}:${config.minecraft.port}`, player: config.minecraft.player },
      server: mcServer?.status() ?? null,
      rules: engine.rules.length,
      ...(getGame?.() ?? {})
    };
  }));

  app.post('/api/pausa', route(() => { bus.pause(); return bus.status(); }));
  app.post('/api/reanudar', route(() => { bus.resume(); return bus.status(); }));

  // --- Feed en vivo (Server-Sent Events) ---
  app.get('/api/feed', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (entry) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
    log.history().slice(-100).forEach(send);
    const unsubscribe = log.subscribe(send);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { unsubscribe(); clearInterval(ping); });
  });

  // --- Reglas ---
  app.get('/api/reglas', route(() => {
    const data = store.read();
    return { settings: data.settings ?? {}, rules: data.rules ?? [], actionTypes: store.actionTypes };
  }));

  app.put('/api/reglas', route((req) => {
    const saved = store.write(req.body ?? {});
    engine.load(); // aplicar al instante, sin esperar a que se detecte el cambio del archivo
    log.info(`💾 Reglas guardadas desde el panel (${saved.rules.length})`);
    return { settings: saved.settings, rules: saved.rules };
  }));

  // --- Pruebas ---
  app.post('/api/simular', route((req) => {
    simulate(req.body ?? {});
  }));

  app.post('/api/minecraft/conectar', route(async () => {
    await mc.tryConnect();
    return { connected: mc.connected };
  }));

  app.post('/api/minecraft/comando', route(async (req) => {
    const command = String(req.body?.command ?? '').trim().replace(/^\//, '');
    if (!command) throw Object.assign(new Error('Escribe un comando'), { status: 400 });
    const response = await mc.send(command);
    log.action(`/${command}${response ? `  →  ${response}` : ''} (desde el panel)`);
    return { response };
  }));

  // --- Recompensas de Twitch ---
  app.get('/api/twitch/recompensas', route(async () => {
    const twitch = getTwitch();
    if (!twitch) throw Object.assign(new Error('Twitch no está conectado'), { status: 409 });
    return twitch.listRewards();
  }));

  app.post('/api/twitch/recompensas', route(async (req) => {
    const twitch = getTwitch();
    if (!twitch) throw Object.assign(new Error('Twitch no está conectado'), { status: 409 });
    const { title, cost, prompt, userInputRequired = false, globalCooldown, backgroundColor } = req.body ?? {};
    if (!title || !(cost > 0)) throw Object.assign(new Error('Pon un título y un costo mayor a 0'), { status: 400 });
    const reward = await twitch.createReward({
      title, cost: Number(cost), prompt, userInputRequired,
      globalCooldown: globalCooldown ? Number(globalCooldown) : null,
      ...(backgroundColor ? { backgroundColor } : {})
    });
    log.info(`🎁 Recompensa creada en Twitch: "${reward.title}" (${reward.cost} puntos)`);
    return { id: reward.id, title: reward.title, cost: reward.cost };
  }));

  app.patch('/api/twitch/recompensas/:id', route(async (req) => {
    const twitch = getTwitch();
    if (!twitch) throw Object.assign(new Error('Twitch no está conectado'), { status: 409 });
    const body = req.body ?? {};
    if (body.cost != null && !(Number(body.cost) > 0)) throw Object.assign(new Error('El costo debe ser mayor a 0'), { status: 400 });
    const patch = { ...body };
    if (patch.cost != null) patch.cost = Number(patch.cost);
    if ('globalCooldown' in patch) patch.globalCooldown = patch.globalCooldown ? Number(patch.globalCooldown) : null;
    const reward = await twitch.updateReward(req.params.id, patch);
    const what = 'isEnabled' in body ? (body.isEnabled ? 'activada' : 'desactivada')
      : 'isPaused' in body ? (body.isPaused ? 'pausada' : 'reanudada') : 'actualizada';
    log.info(`🎁 Recompensa "${reward.title}" ${what}`);
    return reward;
  }));

  app.delete('/api/twitch/recompensas/:id', route(async (req) => {
    const twitch = getTwitch();
    if (!twitch) throw Object.assign(new Error('Twitch no está conectado'), { status: 409 });
    await twitch.deleteReward(req.params.id);
    log.info('🗑️ Recompensa eliminada de Twitch');
  }));

  // --- Chat de Twitch ---
  const requireTwitch = () => {
    const twitch = getTwitch();
    if (!twitch) throw Object.assign(new Error('Twitch no está conectado'), { status: 409 });
    return twitch;
  };

  app.get('/api/chat/feed', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (entry) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
    chatFeed.history().forEach(send);
    const unsubscribe = chatFeed.subscribe(send);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { unsubscribe(); clearInterval(ping); });
  });

  app.post('/api/chat/enviar', route(async (req) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) throw Object.assign(new Error('Escribe un mensaje'), { status: 400 });
    if (text.length > 500) throw Object.assign(new Error('Twitch permite máximo 500 caracteres'), { status: 400 });
    await requireTwitch().sendFromPanel(text, req.body?.replyTo || undefined);
  }));

  app.delete('/api/chat/mensajes/:id', route(async (req) => {
    await requireTwitch().deleteMessage(req.params.id);
  }));

  app.post('/api/chat/timeout', route(async (req) => {
    const { userId, seconds = 600, reason, userName } = req.body ?? {};
    if (!userId) throw Object.assign(new Error('Falta el usuario'), { status: 400 });
    const secs = Math.min(1209600, Math.max(1, Number(seconds)));
    await requireTwitch().timeout(userId, secs, reason);
    log.info(`⏱️ Timeout de ${secs}s a ${userName ?? userId} desde el panel`);
  }));

  app.post('/api/chat/ban', route(async (req) => {
    const { userId, reason, userName } = req.body ?? {};
    if (!userId) throw Object.assign(new Error('Falta el usuario'), { status: 400 });
    await requireTwitch().ban(userId, reason);
    log.info(`⛔ Ban a ${userName ?? userId} desde el panel`);
  }));

  app.post('/api/chat/unban', route(async (req) => {
    const { userId, userName } = req.body ?? {};
    if (!userId) throw Object.assign(new Error('Falta el usuario'), { status: 400 });
    await requireTwitch().unban(userId);
    log.info(`✅ Se quitó el ban/timeout a ${userName ?? userId} desde el panel`);
  }));

  // --- Compatibilidad con los enlaces anteriores ---
  app.get('/pausa', (_req, res) => { bus.pause(); res.redirect('/'); });
  app.get('/reanudar', (_req, res) => { bus.resume(); res.redirect('/'); });
  app.post('/simular', (req, res) => { simulate(req.body ?? {}); res.json({ ok: true }); });
}

/** Votaciones del chat y modo caos. */
export function registerGameRoutes(app, { polls, chaos, gameStore }) {
  // Configuración guardada
  app.get('/api/juego', route(() => ({ polls: gameStore.polls, chaos: gameStore.chaos })));
  app.put('/api/juego/votaciones', route((req) => ({ polls: gameStore.savePolls(req.body?.polls) })));
  app.put('/api/juego/caos', route((req) => {
    const saved = gameStore.saveChaos(req.body ?? {});
    chaos.reschedule();
    return { chaos: saved };
  }));

  // Votación en curso
  app.get('/api/votacion', route(() => polls.status()));
  app.post('/api/votacion/iniciar', route((req) => polls.start(req.body ?? {})));
  app.post('/api/votacion/terminar', route(() => { polls.finish('manual'); return polls.status(); }));
  app.post('/api/votacion/cancelar', route(() => { polls.finish('cancelled'); return polls.status(); }));
  // Voto simulado, para probar sin espectadores
  app.post('/api/votacion/votar', route((req) => {
    const user = String(req.body?.user ?? 'Tester');
    if (!polls.vote({ id: `simulado:${user}`, name: user }, Number(req.body?.option))) {
      throw Object.assign(new Error('No hay votación en curso o esa opción no existe'), { status: 400 });
    }
    return polls.status();
  }));

  // Modo caos
  app.get('/api/caos', route(() => chaos.status()));
  app.post('/api/caos/iniciar', route(() => chaos.start()));
  app.post('/api/caos/detener', route(() => chaos.stop()));
  app.post('/api/caos/ahora', route(() => chaos.now()));
}

/** Overlay para OBS: página, alertas en vivo y ajustes. */
export function registerOverlayRoutes(app, { gameStore }) {
  app.get('/api/overlay/feed', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const unsubscribe = overlayFeed.subscribe((entry) => res.write(`data: ${JSON.stringify(entry)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { unsubscribe(); clearInterval(ping); });
  });

  app.get('/api/overlay/config', route(() => ({ ...gameStore.overlay, listeners: overlayFeed.listeners })));
  app.put('/api/overlay/config', route((req) => {
    const body = req.body ?? {};
    const saved = gameStore.saveOverlay({
      ...gameStore.overlay, ...body,
      colors: { ...gameStore.overlay.colors, ...(body.colors ?? {}) },
      media: { ...gameStore.overlay.media, ...(body.media ?? {}) }
    });
    overlayFeed.alert({ event: 'config' }); // el overlay (y OBS) aplican el cambio al momento
    return saved;
  }));

  // --- Imágenes y sonidos propios (carpeta media/) ---
  const mediaDir = path.resolve('media');
  const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
  const SOUND = /\.(mp3|ogg|wav)$/i;
  const listMedia = () => {
    try {
      return fs.readdirSync(mediaDir)
        .filter((f) => IMAGE.test(f) || SOUND.test(f))
        .map((name) => ({ name, type: IMAGE.test(name) ? 'image' : 'sound', size: fs.statSync(path.join(mediaDir, name)).size }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch { return []; }
  };

  app.get('/api/overlay/archivos', route(() => listMedia()));

  app.post('/api/overlay/archivos', express.raw({ type: () => true, limit: '20mb' }), route((req) => {
    const original = String(req.query.nombre ?? '');
    if (!IMAGE.test(original) && !SOUND.test(original)) {
      throw Object.assign(new Error('Formato no permitido. Usa PNG, JPG, GIF o WEBP para imágenes y MP3, OGG o WAV para sonidos.'), { status: 400 });
    }
    if (!req.body?.length) throw Object.assign(new Error('El archivo está vacío'), { status: 400 });
    const ext = path.extname(original).toLowerCase();
    const base = path.basename(original, path.extname(original))
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'archivo';
    fs.mkdirSync(mediaDir, { recursive: true });
    let name = `${base}${ext}`;
    for (let i = 2; fs.existsSync(path.join(mediaDir, name)); i++) name = `${base}-${i}${ext}`;
    fs.writeFileSync(path.join(mediaDir, name), req.body);
    log.info(`📁 Archivo agregado para el overlay: ${name}`);
    return { name, type: IMAGE.test(name) ? 'image' : 'sound', size: req.body.length };
  }));

  app.delete('/api/overlay/archivos/:name', route((req) => {
    const name = path.basename(req.params.name);
    const full = path.join(mediaDir, name);
    if (!fs.existsSync(full)) throw Object.assign(new Error('Ese archivo ya no existe'), { status: 404 });
    fs.unlinkSync(full);
    // Quitarlo de los tipos de alerta que lo usaban
    const media = Object.fromEntries(Object.entries(gameStore.overlay.media).map(([k, m]) => [k, {
      image: m.image === name ? '' : m.image, sound: m.sound === name ? '' : m.sound
    }]));
    gameStore.saveOverlay({ ...gameStore.overlay, media });
    overlayFeed.alert({ event: 'config' });
    log.info(`🗑️ Archivo del overlay eliminado: ${name}`);
  }));

  app.use('/overlay/media', express.static(mediaDir, { maxAge: 0 }));

  // Alerta de prueba desde el panel
  app.post('/api/overlay/prueba', route((req) => {
    const kind = ['reward', 'cheer', 'command', 'poll', 'chaos'].includes(req.body?.kind) ? req.body.kind : 'reward';
    const samples = {
      reward: { title: 'Pepe_123', subtitle: 'canjeó Invocar zombie', detail: '' },
      cheer: { title: 'Rico', subtitle: 'mandó 500 bits', detail: '¡Toma tus refuerzos!' },
      command: { title: 'Ana', subtitle: 'usó !lluvia', detail: '' },
      poll: { title: 'El chat decidió', subtitle: 'Creeper sorpresa' },
      chaos: { title: 'Modo caos', subtitle: '!salto' }
    };
    overlayFeed.alert({ kind, platform: 'twitch', ...samples[kind] });
    return { listeners: overlayFeed.listeners };
  }));

  // La página del overlay (archivos estáticos en /overlay)
  const dir = path.resolve('overlay');
  app.get('/overlay', (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  app.use('/overlay', express.static(dir));
}

/** Control del servidor de Minecraft desde el panel. */
export function registerServerRoutes(app, { mcServer, mc }) {
  app.get('/api/servidor', route(() => ({ ...mcServer.status(), rcon: mc.connected })));

  app.post('/api/servidor/iniciar', route(() => { mcServer.start(); return mcServer.status(); }));
  app.post('/api/servidor/detener', route(async () => { await mcServer.stop(); return mcServer.status(); }));
  app.post('/api/servidor/reiniciar', route(async () => { await mcServer.restart(); return mcServer.status(); }));

  // Si la app arrancó el servidor, el comando va por su consola; si no, por RCON
  app.post('/api/servidor/comando', route(async (req) => {
    const command = String(req.body?.command ?? '');
    if (mcServer.proc) { mcServer.send(command); return { via: 'consola' }; }
    const clean = command.trim().replace(/^\//, '');
    if (!clean) throw Object.assign(new Error('Escribe un comando'), { status: 400 });
    const response = await mc.send(clean);
    return { via: 'rcon', response };
  }));

  app.get('/api/servidor/consola', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (entry) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
    mcServer.history().slice(-300).forEach(send);
    const unsubscribe = mcServer.subscribe(send);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { unsubscribe(); clearInterval(ping); });
  });
}

/** Sirve el panel compilado (panel/dist). Se registra al final, después de /api y /auth. */
export function servePanel(app) {
  const dist = path.resolve('panel', 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    app.get('/', (_req, res) => res.type('html').send(
      '<h2>stream-interact</h2><p>El panel no está compilado. Ejecuta <code>npm run panel:build</code> ' +
      'o, para desarrollo, <code>npm run panel:dev</code> y abre <a href="http://localhost:5173">localhost:5173</a>.</p>'));
    return;
  }
  app.use(express.static(dist));
  app.get(/^\/(?!api\/|auth\/|overlay).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
