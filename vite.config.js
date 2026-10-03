import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'client',
  publicDir: false,
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
    rollupOptions: { input: resolve(import.meta.dirname, 'client/index.html') },
  },
});
