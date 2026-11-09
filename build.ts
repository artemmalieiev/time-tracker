import * as esbuild from 'esbuild';
import { rm } from 'node:fs/promises';

// Builds the extension into dist/extension (load this folder in chrome://extensions) and the
// tests into dist/tests. Static files are copied through esbuild's copy loader so the whole
// build stays in one tool.

await rm('dist', { force: true, recursive: true });

await esbuild.build({
  bundle: true,
  entryNames: '[dir]/[name]',
  entryPoints: [
    'src/background.ts',
    'src/popup.ts',
    'src/app.ts',
    'src/manifest.json',
    'src/popup.html',
    'src/app.html',
    'src/common.css',
    'src/popup.css',
    'src/app.css',
    'src/icons/16.png',
    'src/icons/32.png',
    'src/icons/48.png',
    'src/icons/128.png'
  ],
  format: 'esm',
  loader: { '.css': 'copy', '.html': 'copy', '.json': 'copy', '.png': 'copy' },
  logLevel: 'info',
  outbase: 'src',
  outdir: 'dist/extension',
  target: 'chrome116'
});

await esbuild.build({
  bundle: true,
  entryPoints: ['src/tests/index.ts'],
  format: 'esm',
  logLevel: 'info',
  outfile: 'dist/tests/index.js',
  platform: 'node',
  target: 'node22'
});
