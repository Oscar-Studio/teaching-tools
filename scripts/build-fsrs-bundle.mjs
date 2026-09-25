// scripts/build-fsrs-bundle.mjs
// 用 esbuild 把 scripts/fsrs-bundle-entry.js（含 ts-fsrs）打包成
// legacy-tools/摘词本/_shared/fsrs-bundle.js（IIFE 格式，可在浏览器直接加载）。
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, 'fsrs-bundle-entry.js');
const outfile = path.join(__dirname, '..', 'legacy-tools', '摘词本', '_shared', 'fsrs-bundle.js');

await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    outfile,
    target: ['es2020'],
    minify: false,         // 保留可读性，方便调试
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'info',
});

console.log('\n✅ fsrs-bundle.js 已生成:', outfile);
