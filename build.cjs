// build.js — esbuild bundler for the kolang-ide renderer.
// Bundles renderer.js (+ @kolang/grammar + CodeMirror 6) into dist/bundle.js,
// a classic IIFE script loaded by index.html.
'use strict';

const esbuild = require('esbuild');
const path = require('path');
const isDev = process.argv.includes('--dev');

// @kolang/grammar is a file: symlink to a sibling repo; esbuild follows the
// symlink and tries to resolve its bare imports (@codemirror/language,
// @lezer/highlight) from the sibling's (nonexistent) node_modules. These
// aliases force resolution from THIS project's node_modules.
const nm = (p) => path.resolve(__dirname, 'node_modules', p);

esbuild
  .build({
    entryPoints: ['renderer.js'],
    bundle: true,
    outfile: 'dist/bundle.js',
    platform: 'browser',
    format: 'iife',
    target: ['chrome110'],
    sourcemap: true,
    minify: !isDev,
    // Treat .js files as ESM (package.json has no "type":"module" so they
    // default to CJS, which breaks `import`/`export` syntax).
    loader: { '.js': 'js' },
    alias: {
      '@codemirror/language': nm('@codemirror/language/dist/index.js'),
      '@lezer/highlight': nm('@lezer/highlight/dist/index.js'),
    },
  })
  .then(() => console.log('dist/bundle.js built'))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });