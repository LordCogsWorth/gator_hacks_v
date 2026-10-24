import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
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
});
