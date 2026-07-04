import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [
    preact(),
    crx({ manifest }),
    {
      name: 'wrap-standalone-iife',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const contentChunk = bundle['content-script.js'];
        if (contentChunk && contentChunk.type === 'chunk') {
          // Wrap content-script in IIFE so `const` declarations are scoped
          // to a function and don't throw on re-injection.
          contentChunk.code = `(function(){\n${contentChunk.code}\n})();`;
        }
        const apiChunk = bundle['content-extractor-api.js'];
        if (apiChunk && apiChunk.type === 'chunk') {
          // The standalone API must install itself on window immediately.
          apiChunk.code = `(function(){\n${apiChunk.code}\n})();`;
        }
      },
    },
  ],
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      input: {
        'content-script': resolve(__dirname, 'src/content/index.ts'),
        'content-extractor-api': resolve(__dirname, 'src/api/index.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'content-script') {
            return 'content-script.js';
          }
          if (chunkInfo.name === 'content-extractor-api') {
            return 'content-extractor-api.js';
          }
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
  server: {
    port: 5173,
    hmr: {
      port: 5173,
    },
  },
});
