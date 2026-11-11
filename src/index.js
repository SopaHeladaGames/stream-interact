// Arranque desde la terminal: npm start
import { startApp } from './app.js';

try {
  const app = await startApp();

  let closing = false;
  const shutdown = async () => {
    if (closing) return process.exit(1); // segundo Ctrl+C: salir ya
    closing = true;
    await app.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
