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
      name: 'wrap-content-script-iife',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const chunk = bundle['content-script.js'];
        if (chunk && chunk.type === 'chunk') {
          // Wrap content-script in IIFE so `const` declarations are scoped
          // to a function and don't throw on re-injection.
          chunk.code = `(function(){\n${chunk.code}\n})();`;
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
  server: {
    port: 5173,
    hmr: {
      port: 5173,
    },
  },
});
