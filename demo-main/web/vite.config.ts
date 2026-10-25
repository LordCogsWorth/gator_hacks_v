import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { gemmaMiddleware } from './gemma-proxy.mjs';

// Kyle's live dashboard (public/kyle/, copied unchanged from Kyle/server/public) runs inside the
// session screen. It calls its server with root paths (/app.js, /events, /session…), so:
//  - /app.js is served from public/kyle/app.js
//  - the server endpoints are proxied to Kyle's motion server, where the Apple Watch posts its data.
const KYLE_SERVER = process.env.KYLE_SERVER || 'http://localhost:8080';
const KYLE_API = ['/events', '/latest', '^/session(/.*)?$', '/ingest', '/watch/', '/alert', '/simulate', '/health', '^/plan$'];

function kyleDashboard(): Plugin {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (req.url === '/app.js' || req.url?.startsWith('/app.js?')) req.url = '/kyle/app.js';
    next();
  };
  return {
    name: 'kyle-dashboard',
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    // Same for `vite preview`, which is how Render serves the built app.
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

// POST /api/gemma for the care team's AI rehab plan (gemma-proxy.mjs). Reads GOOGLE_API_KEY / GEMMA_* from
// web/.env.local or the environment, server side only (no VITE_ prefix, so it never reaches the browser).
function gemmaApi(env: Record<string, string | undefined>): Plugin {
  return {
    name: 'gemma-api',
    configureServer(server) {
      server.middlewares.use(gemmaMiddleware(env));
    },
    configurePreviewServer(server) {
      server.middlewares.use(gemmaMiddleware(env));
    },
  };
}

const kyleProxy = Object.fromEntries(
  KYLE_API.map((p) => [p, { target: KYLE_SERVER, changeOrigin: true, secure: true }]),
);

export default defineConfig(({ mode }) => ({
  plugins: [react(), kyleDashboard(), gemmaApi(loadEnv(mode, process.cwd(), ''))],
  server: {
    port: 5173,
    proxy: kyleProxy,
  },
  // Render: `npx vite preview --host 0.0.0.0 --port $PORT` serves the build with the same proxy.
  preview: {
    proxy: kyleProxy,
    allowedHosts: ['.onrender.com', 'localhost'],
  },
  build: {
    rollupOptions: {
      output: {
        // Heavy libraries in their own chunks: three (replay page only), charts, supabase.
        // React + router get their own `react` chunk first: Rollup moves a manual chunk's unassigned
        // dependencies into it, so without this React would land in `charts` and every page would
        // preload the 150 kB (gzip) charts chunk.
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//.test(id)) return 'react';
          if (/\/node_modules\/(three|@react-three\/fiber|@react-three\/drei)\//.test(id)) return 'three';
          if (/\/node_modules\/recharts\//.test(id)) return 'charts';
          if (/\/node_modules\/@supabase\//.test(id)) return 'supabase';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
}));
