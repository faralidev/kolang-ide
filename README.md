<div align="center">

# کلنگ — ویرایشگر · Kolang IDE

A simple desktop editor for the **[Kolang](https://github.com/faralidev/kolang)**
Persian programming language — built with Electron and CodeMirror 6.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows-blue)](#download)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](./CONTRIBUTING.md)
[![Electron](https://img.shields.io/badge/Electron-33-47848F)](https://www.electronjs.org/)
[![CodeMirror](https://img.shields.io/badge/CodeMirror-6-D22215)](https://codemirror.net/)

</div>

---

Kolang IDE is a lightweight code editor for **Kolang**, a programming language
with Persian (Farsi) keywords and right-to-left source code. It gives you a
CodeMirror 6 editor with Kolang syntax highlighting, a Run button that pipes
your code to the `kolang` interpreter, an output/error panel, and file
open/save — all in a calm Catppuccin Mocha dark theme.

> **Note:** Kolang IDE is the *editor*. To actually run Kolang programs you also
> need the **`kolang` interpreter**, which is a separate project — see
> [Install the interpreter](#install-the-interpreter).

## ✨ Features

- **CodeMirror 6 editor** with Kolang syntax highlighting, folding, and indentation
- **Right-to-left** editing for Persian source
- **Run ▶ / Stop ■** — executes the current file with the `kolang` interpreter
- **Output & error panel** showing stdout, stderr, and exit status
- **Live linting** via `kolang-linter` (reads source on stdin, emits JSON diagnostics)
- **Open / save `.kolang` files** through native system dialogs
- **Settings modal** to point the editor at your `kolang` / `kolang-linter` binaries
- **Catppuccin Mocha** dark theme
- Cross-platform: **macOS** (universal arm64+x64) and **Windows** (x64)

## 📷 Screenshots

<!-- TODO: Replace these placeholders with real screenshots.

     1. Save a screenshot to docs/screenshot-editor.png
     2. Save a run-output screenshot to docs/screenshot-run.png
     3. Delete this comment and the placeholder blocks below.
-->

| Editor | Run output |
| :---: | :---: |
| _editor screenshot coming soon_ | _run-output screenshot coming soon_ |

## ⬇️ Download

Pre-built binaries are published on the **[Releases](https://github.com/faralidev/kolang-ide/releases)**
page:

| Platform | Download |
| --- | --- |
| macOS (Apple Silicon + Intel) | `Kolang-IDE-<version>.dmg` |
| Windows (x64) | `Kolang-IDE-Setup-<version>.exe` |

> The macOS `.dmg` is currently **unsigned**. On first launch, right-click the
> app → **Open** → **Open anyway** to bypass Gatekeeper. (Signing/notarization
> requires a paid Apple Developer account — see
> [Code signing](#code-signing-optional).)

### Install the interpreter

Kolang IDE does **not** bundle the interpreter. To run Kolang programs:

1. Build or download the **`kolang`** interpreter from
   [faralidev/kolang](https://github.com/faralidev/kolang).
2. Put it somewhere on your `PATH` (e.g. `/usr/local/bin` on macOS,
   somewhere on `%PATH%` on Windows), **or**
3. Launch Kolang IDE → **Settings** → set the path to the `kolang` binary, **or**
4. Set the `KOLANG_BIN` environment variable before launching the app.

For live linting, do the same for **`kolang-linter`** (`KOLANG_LINTER` env var).

## 🚀 Quick start (from source)

Requirements: **Node.js ≥ 18** (Node 20+ recommended) and npm.

```bash
git clone https://github.com/faralidev/kolang-ide.git
cd kolang-ide
npm install
npm run dev     # builds the CodeMirror bundle and launches Electron with DevTools
```

To just build the bundle without launching: `npm run build`.
To launch without rebuilding: `npm start`.

If `kolang` isn't on your `PATH`, point the editor at it:

```bash
KOLANG_BIN=/path/to/kolang KOLANG_LINTER=/path/to/kolang-linter npm run dev
```

## 🧩 How the interpreter path is resolved

The editor finds the `kolang` binary in this order (highest priority first):

1. **Settings modal** — an absolute path you set in-app (persisted in
   `<userData>/settings.json`)
2. **`KOLANG_BIN` / `KOLANG_LINTER`** environment variables
3. **Bundled binary** in a packaged app (`Resources/bin/kolang`, placed there
   by electron-builder from `native/${os}/`)
4. **`kolang` on `PATH`** — the dev-mode fallback

## 📦 Packaging

This project uses **[electron-builder](https://www.electron.build/)** to
produce installable macOS (universal arm64+x64) and Windows (x64) apps.

### 1. Place the interpreter binaries in `native/`

If you want the packaged app to *include* the interpreter (one-click install
for end users), drop the compiled binaries into `native/`:

- `native/darwin/kolang` and `native/darwin/kolang-linter` for macOS
  (ideally universal binaries — see [`native/README.md`](./native/README.md))
- `native/win32/kolang.exe` and `native/win32/kolang-linter.exe` for Windows

electron-builder copies the right platform folder into `Resources/bin/` at
packaging time. These binaries are **gitignored** — each packager supplies
their own.

> If you skip this step, the packaged app still builds and runs, but users will
> need to install the `kolang` interpreter themselves (see
> [Install the interpreter](#install-the-interpreter)).

### 2. (Optional) App icon

Put a 1024×1024 `icon.png` in `build/`; electron-builder generates
`icon.icns` (macOS) and `icon.ico` (Windows) from it. Without an icon the
build still succeeds with the default Electron icon. See
[`build/README.md`](./build/README.md).

### 3. Build

```bash
npm run dist:mac    # → dist/*.dmg and dist/*.zip (universal)
npm run dist:win    # → dist/*-Setup.exe (NSIS, x64) — run on Windows or in CI
npm run dist        # both (macOS must run on macOS; Windows must run on Windows)
```

### Code signing (optional)

For signed/notarized macOS builds, set these environment variables before
`npm run dist:mac`:

- `CSC_LINK`, `CSC_KEY_PASSWORD` — your Developer ID Application certificate
- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID` —
  for notarization

Without them, builds are **unsigned** and macOS users must right-click → Open
the first time. macOS notarization requires a paid Apple Developer Program
membership (~$99/year). Windows signing uses `WIN_CSC_LINK` /
`WIN_CSC_KEY_PASSWORD`.

### Releases via GitHub Actions

Pushing a tag `v*.*.*` triggers [`.github/workflows/release.yml`](./.github/workflows/release.yml),
which builds macOS-universal on `macos-latest` and Windows-x64 on
`windows-latest`, then publishes a **GitHub Release** with both artifacts.

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md)
and our [Code of Conduct](./CODE_OF_CONDUCT.md) before opening an issue or PR.

- 🐛 Found a bug? [Open a bug report](https://github.com/faralidev/kolang-ide/issues/new?template=bug_report.md)
- 💡 Have an idea? [Suggest a feature](https://github.com/faralidev/kolang-ide/issues/new?template=feature_request.md)
- 💬 Just want to chat? [Start a discussion](https://github.com/faralidev/kolang-ide/discussions)

## 🗂 Project layout

```
main.js              Electron main process — IPC, runs the kolang binary
preload.js           Secure bridge between renderer and main
index.html           UI (Catppuccin Mocha dark theme)
renderer.js          Renderer logic
kolang-language.js   CodeMirror 6 language package (syntax, fold, indent)
bundle.js            Bundled CodeMirror 6 (generated by `npm run build` — gitignored)
build.js             esbuild script that produces bundle.js
native/              Platform-specific kolang binaries (gitignored) for packaging
build/               Packaging assets (icon, entitlements)
.github/workflows/   CI / release workflow
```

## 🔒 Security

Found a security issue? Please **don't** open a public issue — see
[SECURITY.md](./SECURITY.md) for how to report it privately.

## 📜 License

MIT © FaraliDev and contributors. See [LICENSE](./LICENSE).

---

## فارسی (Persian)

کلنگ — ویرایشگر، یک محیط توسعه ساده برای زبان برنامه‌نویسی فارسی
**[کولنگ](https://github.com/faralidev/kolang)** است که به‌صورت یک اپلیکیشن
دسکتاپ Electron ساخته شده است.

### اجرا از روی سورس

```bash
git clone https://github.com/faralidev/kolang-ide.git
cd kolang-ide
npm install
npm run dev
```

### امکانات

- ویرایشگر کد مبتنی بر CodeMirror 6 با پشتیبانی راست‌به‌چپ و زبان فارسی
- دکمه اجرا (▶) کد را در یک فایل موقت می‌نویسد و با باینری `kolang` اجرا می‌کند
- خروجی و خطاها در پنل پایین نمایش داده می‌شود؛ امکان توقف اجرا (■) نیز وجود دارد
- باز و ذخیره فایل‌های `.kolang` از طریق دیالوگ‌های سیستمی
- لایو-لینت با `kolang-linter`

### وابستگی به باینری کولنگ

این برنامه مفسر را در بر نمی‌گیرد؛ بلکه به باینری `kolang` (که به صورت جداگانه
ساخته می‌شود) وابسته است. مسیر باینری به این ترتیب پیدا می‌شود:

1. تنظیمات ذخیره‌شده در پنجره تنظیمات (بالاترین اولویت)
2. متغیر محیطی `KOLANG_BIN` / `KOLANG_LINTER`
3. باینری بسته‌بندی‌شده در `Resources/bin/` (در نسخه نصب‌شده)
4. `kolang` روی `PATH` (در حالت توسعه)

برای نصب مفسر، به پروژه
[faralidev/kolang](https://github.com/faralidev/kolang) مراجعه کنید.

### بسته‌بندی

این پروژه با **electron-builder** به اپلیکیشن‌های قابل نصب macOS (یونیورسال
arm64+x64) و Windows (x64) بسته‌بندی می‌شود. باینری مفسر را پیش از بسته‌بندی
در `native/darwin/` و `native/win32/` قرار دهید (این فایل‌ها gitignore شده‌اند).
سپس:

```
npm run dist:mac     # نسخه macOS یونیورسال
npm run dist:win     # نسخه Windows x64
```

با push کردن تگ `v*.*.*`، ورک‌فلو GitHub Actions اجرا می‌شود و نسخه macOS و
Windows را ساخته و به‌صورت GitHub Release منتشر می‌کند.

**نکته فنی:** این پروژه عمداً روی Electron 33 نگه داشته شده است (نسخه پایدار
فعلی بالاتر است، اما ارتقای نسخه‌ی اصلی ریسک دارد). ارتقای آینده باید در یک
PR مجزا با تست کامل انجام شود.

### مجوز

MIT — FaraliDev و مشارکت‌کنندگان. متن کامل در [LICENSE](./LICENSE).
