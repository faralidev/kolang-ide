// kolang-ide — preload script. Exposes a minimal, safe API to the renderer
// via contextBridge. The renderer never touches Node or Electron directly.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kolangIDE', {
  // Run `code` through the kolang binary (written to a temp file in main).
  // Returns a Promise of { stdout, stderr, exitCode, durationMs }.
  run: (code) => ipcRenderer.invoke('kolang:run', { code }),

  // Kill the currently running program, if any.
  kill: () => ipcRenderer.invoke('kolang:kill'),

  // Lint `code` through the kolang-linter binary (stdin → JSON diagnostics).
  // Returns a Promise of an array of { line, col, endLine, endCol, severity,
  // message, rule } (or [] on any linter failure).
  runLinter: (code) => ipcRenderer.invoke('linter:run', { code }),

  // Native open dialog → { path, content } | null.
  openFile: () => ipcRenderer.invoke('file:open'),

  // Native save dialog → { path } | null.
  saveFile: (content) => ipcRenderer.invoke('file:save', { content }),

  // File/folder explorer — direct path-based operations.
  // listDir → { entries: [{ name, path, isDir }] } | { error }
  listDir: (dirPath) => ipcRenderer.invoke('fs:listDir', dirPath),
  // openFolder → chosen directory path | null
  openFolder: () => ipcRenderer.invoke('fs:openFolder'),
  // readFile → file content string | { error }
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  // writeFile → { ok: true } | { error }
  writeFile: ({ filePath, content }) =>
    ipcRenderer.invoke('fs:writeFile', { filePath, content }),

  // Settings — persisted interpreter path etc.
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  pickKolangPath: () => ipcRenderer.invoke('settings:pickPath'),
  pickLinterPath: () => ipcRenderer.invoke('settings:pickLinterPath'),

  // Menu-driven events from the main process.
  onMenuRun: (cb) => ipcRenderer.on('menu:run', cb),
  onMenuStop: (cb) => ipcRenderer.on('menu:stop', cb),
  onMenuOpen: (cb) => ipcRenderer.on('menu:open', cb),
  onMenuSave: (cb) => ipcRenderer.on('menu:save', cb),
  onMenuSettings: (cb) => ipcRenderer.on('menu:settings', cb),
});