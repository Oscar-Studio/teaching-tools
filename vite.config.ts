import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { seoInject } from './vite-plugin-seo-inject';

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    seoInject(),
    viteStaticCopy({
      targets: [
        { src: 'tools-config.json', dest: '.' },
        { src: 'plotly-2.27.0.min.js', dest: '.' },
        { src: 'legacy-tools/*', dest: '.' },
        { src: 'CNAME', dest: '.' },
      ],
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});