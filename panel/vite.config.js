import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo (npm run panel:dev) el panel corre en :5173 y manda /api y /auth al backend en :3000.
// base './' para que el build también funcione dentro de Electron más adelante.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000'
    }
  }
});
