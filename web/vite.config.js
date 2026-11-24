import { resolve } from 'node:path';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { unstable_startWorker as startWorker } from 'wrangler';
import { startLocalAccess } from '../dev/local-access.mjs';

const localApi = {
  name: 'wavlark-local-api',
  enforce: 'pre',
  async configureServer(server) {
    const registry = resolve('../.wrangler/registry', String(process.pid));
    process.env.WRANGLER_REGISTRY_PATH = registry;
    process.env.WRANGLER_LOG ??= 'warn';
    let bindings;
    if (server.config.mode === 'admin') {
      if (![undefined, false, 'localhost', '127.0.0.1', '::1'].includes(server.config.server.host)) {
        throw new Error('Admin mode requires a loopback host.');
      }
      const access = globalThis.wavlarkDevAccess ??= await startLocalAccess();
      bindings = {
        ACCESS_ISSUER: { type: 'plain_text', value: access.issuer },
        ACCESS_AUD: { type: 'plain_text', value: access.audience }
      };
      server.middlewares.use((req, res, next) => {
        if (!/^\/(?:api\/)?manage(?:[/?]|$)/.test(req.url)) return next();
        access.sign().then((token) => {
          req.headers['cf-access-jwt-assertion'] = token;
          next();
        }, next);
      });
    }
    // Vite loads a new config before closing the old server on restart.
    const api = globalThis.wavlarkDevApi ??= await startWorker({
      config: '../worker/wrangler.jsonc',
      bindings,
      build: { custom: { workingDirectory: '../worker' } },
      dev: {
        server: { hostname: '127.0.0.1', port: 0 },
        registry,
        persist: '../.wrangler/state'
      }
    });
    // Preserve the browser's origin when R2 verifies the signed URL.
    server.config.server.proxy = {
      '/cdn-cgi/local/r2/s3/': { target: (await api.url).origin, xfwd: true }
    };
  },
  async closeServer({ reason }) {
    if (reason === 'restart') return;
    await globalThis.wavlarkDevApi?.dispose();
    delete globalThis.wavlarkDevApi;
    await globalThis.wavlarkDevAccess?.server[Symbol.asyncDispose]();
    delete globalThis.wavlarkDevAccess;
  }
};

export default defineConfig({
  plugins: [localApi, tailwindcss(), sveltekit({ adapter: adapter() })]
});
