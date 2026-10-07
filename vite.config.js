import { defineConfig } from 'vite';
import { join, resolve } from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gzip, brotliCompress, constants as zlib } from 'node:zlib';

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

// The client's code and pages are also written compressed, next to each file (name.gz and name.br): the server sends
// those to a browser that takes them (server/index.js), so nothing is compressed as it starts. What a page loaded again
// for a deploy waits for is mostly the bundle: 3 MB, 1 MB gzipped, 0.8 MB with brotli. Sound and images are compressed
// already; a file under 1 KB, or one that would not get smaller, is left as it is.
const COMPRESS = /\.(js|css|html|json|svg)$/;
const precompress = () => {
  let outDir = '';
  const gz = promisify(gzip);
  const br = promisify(brotliCompress);
  return {
    name: 'precompress',
    apply: 'build',
    configResolved: (c) => (outDir = c.build.outDir),
    async closeBundle() {
      const jobs = [];
      for (const e of await readdir(outDir, { recursive: true, withFileTypes: true })) {
        if (!e.isFile() || !COMPRESS.test(e.name)) continue;
        const file = join(e.parentPath, e.name);
        jobs.push(
          readFile(file).then((body) =>
            body.length < 1024
              ? null
              : Promise.all([
                  gz(body, { level: 9 }).then((out) => out.length < body.length && writeFile(`${file}.gz`, out)),
                  br(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: body.length } }).then((out) => out.length < body.length && writeFile(`${file}.br`, out)),
                ])
          )
        );
      }
      await Promise.all(jobs);
    },
  };
};

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  plugins: [statsPage, precompress()],
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
