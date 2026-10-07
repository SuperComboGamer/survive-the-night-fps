import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// /stats is the stats page (client/stats.html) and /admin the control room (client/admin.html), as the game server serves them
const statsPage = {
  name: 'stats-page',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (/^\/stats\/?(\?|$)/.test(req.url)) req.url = req.url.replace(/^\/stats\/?/, '/stats.html');
      if (/^\/admin\/?(\?|$)/.test(req.url)) req.url = req.url.replace(/^\/admin\/?/, '/admin.html');
      next();
    });
  },
};

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  plugins: [statsPage],
  server: {
    port: 5173,
    host: true,
    fs: { allow: ['..'] },
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/social': { target: 'ws://localhost:3000', ws: true },
      '/status': { target: 'http://localhost:3000' },
      '/api': { target: 'http://localhost:3000' },
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { index: resolve(import.meta.dirname, 'client/index.html'), stats: resolve(import.meta.dirname, 'client/stats.html'), admin: resolve(import.meta.dirname, 'client/admin.html') } },
  },
});
