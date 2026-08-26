// build.js — esbuild bundler for the kolang-ide renderer.
// Bundles renderer.js (+ kolang-language.js + CodeMirror 6) into bundle.js,
// a classic IIFE script loaded by index.html.
'use strict';

const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: ['renderer.js'],
    bundle: true,
    outfile: 'bundle.js',
    platform: 'browser',
    format: 'iife',
    target: ['chrome110'],
    sourcemap: true,
  })
  .then(() => console.log('bundle.js built'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });