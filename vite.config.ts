import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    preact(),
    crx({ manifest }),
  ],
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      input: {
        'content-script': resolve(__dirname, 'src/content/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'content-script') {
            return 'content-script.js';
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@shared': '/src/shared',
      '@lib': '/src/lib',
    },
  },
  server: {
    port: 5173,
    hmr: {
      port: 5173,
    },
  },
});
