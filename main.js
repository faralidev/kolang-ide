// kolang-ide — Electron main process.
'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { performance } = require('perf_hooks');

// Path to the Kolang interpreter binary. Configurable via the Settings
// modal (settings:get/settings:set IPC); persisted in <userData>/settings.json.
// The default resolves per-environment: env override → bundled binary in a
// packaged app → `kolang` on PATH (must be installed separately in dev).
function resolveDefaultKolangBin() {
  // 1. User override via env var (highest priority for default)
  if (process.env.KOLANG_BIN) return process.env.KOLANG_BIN;
  // 2. Bundled binary in packaged app (placed there from native/${os} via
  //    electron-builder extraResources → Resources/bin/)
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'bin',
      process.platform === 'win32' ? 'kolang.exe' : 'kolang'
    );
  }
  // 3. Dev: assume `kolang` is on PATH (the interpreter is a separate project
  //    installed by the developer). The Settings modal lets users override
  //    this to any absolute path.
  return 'kolang';
}

let kolangBin = resolveDefaultKolangBin();

// Path to the Kolang linter binary (reads source on stdin, emits JSON
// diagnostics on stdout). Configurable via the Settings modal; resolved
// per-environment like the interpreter: env override → bundled → on PATH.
function resolveLinterBin() {
  if (process.env.KOLANG_LINTER) return process.env.KOLANG_LINTER;
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'bin',
      process.platform === 'win32' ? 'kolang-linter.exe' : 'kolang-linter'
    );
  }
  return 'kolang-linter';
}
let linterBin = resolveLinterBin();

function settingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFilePath(), 'utf8'));
    return {
      kolangPath:
        typeof parsed.kolangPath === 'string' && parsed.kolangPath.trim()
          ? parsed.kolangPath.trim()
          : resolveDefaultKolangBin(),
      linterPath:
        typeof parsed.linterPath === 'string' && parsed.linterPath.trim()
          ? parsed.linterPath.trim()
          : resolveLinterBin(),
    };
  } catch {
    // No settings file yet (or unreadable/corrupt) — use the defaults.
    return {
      kolangPath: resolveDefaultKolangBin(),
      linterPath: resolveLinterBin(),
    };
  }
}

function saveSettings(settings) {
  const file = settingsFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
}

// Execution timeout for a single program run (milliseconds).
const RUN_TIMEOUT_MS = 10_000;

// Currently running Kolang child process (for the Stop button / kolang:kill IPC).
let runningChild = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    title: 'کلنگ — ویرایشگر',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');
  return win;
}

function getFocusedWindow() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
}

// ---------------------------------------------------------------------------
// IPC: kolang:run — write code to a temp file, run `kolang <tempfile>`, return
// stdout/stderr/exit code/duration. The interpreter does not reliably support
// stdin, so code is always run from a real file on disk.
// ---------------------------------------------------------------------------
ipcMain.handle('kolang:run', async (event, { code }) => {
  const tempFile = path.join(os.tmpdir(), 'kolang-ide-' + Date.now() + '.kolang');
  const startedAt = performance.now();
  let stdout = '';
  let stderr = '';
  let exitCode = null;
  let timedOut = false;

  try {
    fs.writeFileSync(tempFile, code, 'utf8');
  } catch (err) {
    return {
      stdout: '',
      stderr: 'Failed to write temp file: ' + err.message,
      exitCode: -1,
      durationMs: 0,
    };
  }

  // Resolve the interpreter path. If it is missing or not executable, return
  // a clear (Persian) error pointing the user to the settings dialog.
  if (!kolangBin || !fs.existsSync(kolangBin)) {
    return {
      stdout: '',
      stderr:
        `«مسیر مفسر کلنگ پیدا نشد: ${kolangBin || '(تنظیم نشده)'} — لطفاً در تنظیمات مسیر را تنظیم کنید یا مفسر را در native/ قرار دهید»`,
      exitCode: -1,
      durationMs: 0,
    };
  }

  let binExecutable = false;
  try {
    fs.accessSync(kolangBin, fs.constants.X_OK);
    binExecutable = true;
  } catch {
    // Not executable — fall through to the error below.
  }
  if (!binExecutable) {
    return {
      stdout: '',
      stderr:
        `«مفسر کلنگ قابل اجرا نیست: ${kolangBin} — از تنظیمات مسیر را تنظیم کنید»`,
      exitCode: -1,
      durationMs: 0,
    };
  }

  try {
    const child = spawn(kolangBin, [tempFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    runningChild = child;

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, RUN_TIMEOUT_MS);

    try {
      for await (const chunk of child.stdout) stdout += chunk;
      for await (const chunk of child.stderr) stderr += chunk;
      exitCode = await new Promise((resolve) => child.once('close', resolve));
    } finally {
      clearTimeout(killTimer);
      if (runningChild === child) runningChild = null;
    }
  } catch (err) {
    return {
      stdout: '',
      stderr: 'Failed to start kolang: ' + err.message,
      exitCode: -1,
      durationMs: 0,
    };
  } finally {
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // Temp file already gone or could not be removed — nothing to do.
    }
  }

  const durationMs = performance.now() - startedAt;

  if (timedOut) {
    stderr = (stderr ? stderr + '\n' : '') +
      `[kolang-ide] اجرا بیش از ${RUN_TIMEOUT_MS / 1000} ثانیه طول کشید و متوقف شد.`;
  }

  return { stdout, stderr, exitCode, durationMs };
});

// ---------------------------------------------------------------------------
// IPC: kolang:kill — stop the currently running program, if any.
// ---------------------------------------------------------------------------
ipcMain.handle('kolang:kill', () => {
  if (runningChild) {
    runningChild.kill('SIGKILL');
    runningChild = null;
    return { killed: true };
  }
  return { killed: false };
});

// ---------------------------------------------------------------------------
// IPC: linter:run — feed the current source to the kolang linter binary via
// stdin and return its JSON diagnostics. Any linter failure degrades
// gracefully to [] so editing is never blocked.
// ---------------------------------------------------------------------------
ipcMain.handle('linter:run', async (event, { code }) => {
  return new Promise((resolve) => {
    const child = spawn(linterBin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c) => (stderr += c.toString('utf8')));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5000);
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout);
        resolve(Array.isArray(parsed?.diagnostics) ? parsed.diagnostics : []);
      } catch (e) {
        // Linter error — degrade gracefully to no diagnostics, log to stderr.
        console.error('Linter error:', stderr || e.message);
        resolve([]);
      }
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      console.error('Linter spawn error:', e.message);
      resolve([]); // don't block editing
    });
    child.stdin.write(code);
    child.stdin.end();
  });
});

// ---------------------------------------------------------------------------
// IPC: file:open / file:save — native open/save dialogs for .kolang files.
// ---------------------------------------------------------------------------
ipcMain.handle('file:open', async () => {
  const result = await dialog.showOpenDialog(getFocusedWindow(), {
    title: 'باز کردن فایل کلنگ',
    properties: ['openFile'],
    filters: [{ name: 'Kolang', extensions: ['kolang'] }],
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return { path: filePath, content };
  } catch (err) {
    return { path: filePath, content: null, error: err.message };
  }
});

ipcMain.handle('file:save', async (event, { content }) => {
  const result = await dialog.showSaveDialog(getFocusedWindow(), {
    title: 'ذخیره فایل کلنگ',
    defaultPath: 'untitled.kolang',
    filters: [{ name: 'Kolang', extensions: ['kolang'] }],
  });

  if (result.canceled || !result.filePath) return null;

  try {
    fs.writeFileSync(result.filePath, content, 'utf8');
    return { path: result.filePath };
  } catch (err) {
    return { path: result.filePath, error: err.message };
  }
});

// ---------------------------------------------------------------------------
// IPC: fs:* — file/folder explorer support. listDir returns the immediate
// children of a directory (dirs first, then files, alphabetically), skipping
// hidden files and node_modules. readFile/writeFile operate on explicit paths
// (used for explorer-driven open + direct save to the current file).
// ---------------------------------------------------------------------------
ipcMain.handle('fs:listDir', (event, dirPath) => {
  try {
    const entries = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => ({
        name: e.name,
        path: path.join(dirPath, e.name),
        isDir: e.isDirectory(),
      }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, 'fa');
      });
    return { entries };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:openFolder', async () => {
  const result = await dialog.showOpenDialog(getFocusedWindow(), {
    title: 'باز کردن پوشه',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('fs:readFile', (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:writeFile', (event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ---------------------------------------------------------------------------
// IPC: settings — get/set persisted settings, and a native file picker for
// selecting the Kolang interpreter binary.
// ---------------------------------------------------------------------------
ipcMain.handle('settings:get', () => loadSettings());

ipcMain.handle('settings:set', (event, settings) => {
  const next = {
    kolangPath:
      settings && typeof settings.kolangPath === 'string' && settings.kolangPath.trim()
        ? settings.kolangPath.trim()
        : resolveDefaultKolangBin(),
    linterPath:
      settings && typeof settings.linterPath === 'string' && settings.linterPath.trim()
        ? settings.linterPath.trim()
        : resolveLinterBin(),
  };
  saveSettings(next);
  kolangBin = next.kolangPath;
  linterBin = next.linterPath;
  return true;
});

ipcMain.handle('settings:pickPath', async () => {
  const result = await dialog.showOpenDialog(getFocusedWindow(), {
    title: 'انتخاب مفسر کلنگ',
    properties: ['openFile'],
    filters: [{ name: 'All', extensions: ['*'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('settings:pickLinterPath', async () => {
  const result = await dialog.showOpenDialog(getFocusedWindow(), {
    title: 'انتخاب لینتر کلنگ',
    properties: ['openFile'],
    filters: [{ name: 'All', extensions: ['*'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ---------------------------------------------------------------------------
// Application menu.
// ---------------------------------------------------------------------------
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'پرونده',
      submenu: [
        {
          label: 'باز کردن…',
          accelerator: 'CmdOrCtrl+O',
          click: () => getFocusedWindow().webContents.send('menu:open'),
        },
        {
          label: 'ذخیره…',
          accelerator: 'CmdOrCtrl+S',
          click: () => getFocusedWindow().webContents.send('menu:save'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'ویرایش',
      submenu: [
        { role: 'undo', label: 'بازگشت' },
        { role: 'redo', label: 'از نو' },
        { type: 'separator' },
        { role: 'cut', label: 'برش' },
        { role: 'copy', label: 'کپی' },
        { role: 'paste', label: 'چسباندن' },
        { role: 'selectAll', label: 'انتخاب همه' },
        { type: 'separator' },
        { role: 'find', label: 'جستجو' },
      ],
    },
    {
      label: 'اجرا',
      submenu: [
        {
          label: 'اجرا',
          accelerator: 'CmdOrCtrl+Enter',
          click: () => getFocusedWindow().webContents.send('menu:run'),
        },
        {
          label: 'توقف',
          accelerator: 'CmdOrCtrl+.',
          click: () => getFocusedWindow().webContents.send('menu:stop'),
        },
      ],
    },
    {
      label: 'تنظیمات',
      submenu: [
        {
          label: 'تنظیمات…',
          accelerator: 'CmdOrCtrl+,',
          click: () => getFocusedWindow().webContents.send('menu:settings'),
        },
      ],
    },
    {
      label: 'نمایش',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// App lifecycle.
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  kolangBin = loadSettings().kolangPath || resolveDefaultKolangBin();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});