import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'tools-config.json', dest: '.' },
        { src: 'plotly-2.27.0.min.js', dest: '.' },
        { src: 'legacy-tools/*', dest: '.' },
      ],
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});