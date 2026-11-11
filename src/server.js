import express from 'express';

/**
 * Servidor local: login de Twitch + endpoints de control.
 * Solo escucha en localhost, no queda expuesto a internet.
 */
export function createServer() {
  const app = express();
  app.use(express.json());
  return app;
}

export function registerControlRoutes(app, { bus, simulate, getTwitch }) {
  app.get('/', (_req, res) => {
    res.type('html').send(`
      <h2>stream-interact</h2>
      <p>Estado: <code>${JSON.stringify(bus.status())}</code></p>
      <p><a href="/pausa">⏸️ Pausar</a> · <a href="/reanudar">▶️ Reanudar</a></p>
      <p>Simular: <code>POST /simular</code> con JSON {"type":"reward","name":"...","user":"...","amount":0,"input":""}</p>`);
  });
  app.get('/pausa', (_req, res) => { bus.pause(); res.redirect('/'); });
  app.get('/reanudar', (_req, res) => { bus.resume(); res.redirect('/'); });
  app.get('/estado', (_req, res) => res.json(bus.status()));

  // Simula un evento sin estar en directo (útil para probar reglas)
  app.post('/simular', (req, res) => {
    simulate(req.body ?? {});
    res.json({ ok: true });
  });

  // Crea una recompensa de Twitch propiedad de esta app
  app.post('/twitch/recompensas', async (req, res) => {
    const twitch = getTwitch();
    if (!twitch) return res.status(400).json({ error: 'Twitch no está conectado' });
    try {
      const { title, cost, prompt, userInputRequired = false, globalCooldown } = req.body ?? {};
      const reward = await twitch.createReward({
        title, cost, prompt, userInputRequired,
        globalCooldown: globalCooldown ?? null
      });
      res.json({ id: reward.id, title: reward.title, cost: reward.cost });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
}
