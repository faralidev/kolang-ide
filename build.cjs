// build.js — esbuild bundler for the kolang-ide renderer.
// Bundles renderer.js (+ @kolang/grammar + CodeMirror 6) into dist/bundle.js,
// a classic IIFE script loaded by index.html.
'use strict';

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const isDev = process.argv.includes('--dev');

// @kolang/grammar is a file: symlink to a sibling repo; esbuild follows the
// symlink and tries to resolve its bare imports (@codemirror/language,
// @lezer/highlight) from the sibling's (nonexistent) node_modules. These
// aliases force resolution from THIS project's node_modules. The lang-*
// aliases keep the language packages resolving consistently, and 'kolang-docs'
// pulls the canonical docs JSON (from the kolang-data repo) into the bundle.
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
      '@codemirror/view': nm('@codemirror/view/dist/index.js'),
      '@codemirror/lang-python': nm('@codemirror/lang-python/dist/index.js'),
      '@codemirror/lang-json': nm('@codemirror/lang-json/dist/index.js'),
      '@codemirror/lang-html': nm('@codemirror/lang-html/dist/index.js'),
      '@codemirror/lang-css': nm('@codemirror/lang-css/dist/index.js'),
      'kolang-docs': path.resolve(__dirname, '../kolang-data/kolang-docs.json'),
    },
  })
  .then(() => {
    console.log('dist/bundle.js built');
    // Copy index.html into dist/ so the dev server can serve it.
    // Rewrite the bundle.js path: index.html references ./dist/bundle.js
    // (correct for production where frontendDist=../dist serves the parent),
    // but in dev the server serves FROM dist/ so it must be ./bundle.js.
    let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    html = html.replace('./dist/bundle.js', './bundle.js');
    fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), html);
    // In dev mode, start a static server on :8080 serving dist/ so Tauri's
    // devUrl can load the frontend. In build mode, just exit.
    if (isDev) {
      const http = require('http');
      const fs = require('fs');
      const server = http.createServer((req, res) => {
        let urlPath = req.url === '/' ? '/index.html' : req.url;
        const filePath = path.join(__dirname, 'dist', urlPath);
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(404);
            res.end('not found');
            return;
          }
          const ext = path.extname(filePath);
          const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
          res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
          res.end(data);
        });
      });
      server.listen(8080, () => console.log('dev server on http://localhost:8080'));
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });