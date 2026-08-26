<div align="center">

# کلنگ — ویرایشگر · Kolang IDE

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Windows-blue)](#دانلود)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](./CONTRIBUTING.md)
[![Electron](https://img.shields.io/badge/Electron-33-47848F)](https://www.electronjs.org/)
[![CodeMirror](https://img.shields.io/badge/CodeMirror-6-D22215)](https://codemirror.net/)

**فارسی** · [**English**](#english)

</div>

---

## فارسی

یک محیط توسعهٔ ساده برای زبان برنامه‌نویسی فارسی **[کلنگ](https://github.com/faralidev/kolang)**
که به‌صورت یک اپلیکیشن دسکتاپ Electron ساخته شده است.

ویرایشگر کلنگ یک ادیتور سبک برای نوشتن و اجرای برنامه‌های کلنگ است: یک
ویرایشگر CodeMirror 6 با برجسته‌سازی نحو کلنگ، دکمهٔ اجرا که کد شما را به
مفسر `kolang` می‌فرستد، پنل خروجی/خطا، و باز/ذخیرهٔ فایل — همه در یک تم تیرهٔ
آرام Catppuccin Mocha.

> **نکته:** ویرایشگر کلنگ فقط *ویرایشگر* است. برای اجرای برنامه‌های کلنگ به
> **مفسر `kolang`** نیز نیاز دارید که پروژه‌ای جداگانه است — ببینید
> [نصب مفسر](#نصب-مفسر).

### ✨ امکانات

- **ویرایشگر CodeMirror 6** با برجسته‌سازی نحو، تاشدن کد و تورفتگی هوشمند برای کلنگ
- **ویرایش راست‌به‌چپ** برای سورس فارسی
- **اجرای ▶ / توقف ■** — فایل جاری را با مفسر `kolang` اجرا می‌کند
- **پنل خروجی و خطا** که stdout، stderr و وضعیت خروج را نمایش می‌دهد
- **لینت زنده** با `kolang-linter` (سورس را از stdin می‌گیرد و دیاگنوستیک JSON می‌دهد)
- **باز/ذخیرهٔ فایل‌های `.kolang`** از طریق دیالوگ‌های سیستمی
- **پنجرهٔ تنظیمات** برای تعیین مسیر باینری `kolang` / `kolang-linter` دلخواه
- **تم تیرهٔ Catppuccin Mocha**
- کراس‌پلتفرم: **macOS** (یونیورسال arm64+x64) و **Windows** (x64)

### 📷 تصاویر

<!-- TODO: این placeholderها را با تصاویر واقعی جایگزین کنید.

     ۱. یک اسکرین‌شات از ادیتور در docs/screenshot-editor.png ذخیره کنید
     ۲. یک اسکرین‌شات از خروجی اجرا در docs/screenshot-run.png ذخیره کنید
     ۳. این کامنت و بلوک‌های placeholder زیر را پاک کنید.
-->

| ویرایشگر | خروجی اجرا |
| :---: | :---: |
| _به‌زودی اسکرین‌شات ادیتور_ | _به‌زودی اسکرین‌شات خروجی_ |

### ⬇️ دانلود

نسخه‌های ازپیش‌ساخته‌شده در صفحهٔ **[Releases](https://github.com/faralidev/kolang-ide/releases)**
منتشر می‌شوند:

| پلتفرم | فایل |
| --- | --- |
| macOS (Apple Silicon + Intel) | `kolang-ide-<version>-universal.dmg` |
| Windows (x64) | `kolang-ide-Setup-<version>.exe` |

مفسر `kolang` و `kolang-linter` از نسخهٔ v0.1.0 به بعد **داخل خود اپلیکیشن
بسته‌بندی شده‌اند** — برای کاربر نهایی نیازی به نصب جداگانه نیست.

#### نصب از طریق Homebrew (macOS)

```bash
brew install --cask faralidev/tap/kolang-ide
```

یا ابتدا tap را اضافه کنید و بعد نصب کنید:

```bash
brew tap faralidev/tap
brew install --cask kolang-ide
```

> فایل `.dmg` مک در حال حاضر **امضا نشده** است. در اولین اجرا، روی اپ کلیک
> راست کنید → **Open** → **Open anyway** تا Gatekeeper اجازه دهد. (امضا/نوتاری
> نیازمند حساب پولی برنامه‌نویسان اپل است — ببینید [امضای کد](#امضای-کد-اختیاری).)

#### نصب مفسر

اگر نسخهٔ بسته‌بندی‌شده (`.dmg` / `.exe` یا brew) را نصب می‌کنید، مفسر از قبل
موجود است و این بخش را نخوانید. اما اگر از روی سورس اجرا می‌کنید، برای اجرای
برنامه‌های کلنگ:

1. مفسر **`kolang`** را از [faralidev/kolang](https://github.com/faralidev/kolang)
   بگیرید یا بسازید.
2. آن را روی `PATH` خود بگذارید (مثلاً `/usr/local/bin` در macOS، یا جایی روی
   `%PATH%` در Windows)، **یا**
3. ویرایشگر کلنگ را باز کنید → **تنظیمات** → مسیر باینری `kolang` را تعیین کنید، **یا**
4. متغیر محیطی `KOLANG_BIN` را پیش از اجرای اپ تنظیم کنید.

برای لینت زنده، همان کار را برای **`kolang-linter`** انجام دهید (متغیر `KOLANG_LINTER`).

### 🚀 اجرا از روی سورس

پیش‌نیازها: **Node.js ≥ 18** (Node 20+ توصیه می‌شود) و npm.

```bash
git clone https://github.com/faralidev/kolang-ide.git
cd kolang-ide
npm install
npm run dev     # باندل CodeMirror را می‌سازد و Electron را با DevTools اجرا می‌کند
```

برای فقط ساختن باندل بدون اجرا: `npm run build`.
برای اجرا بدون ساخت مجدد: `npm start`.

اگر `kolang` روی `PATH` نیست، مسیر آن را به ادیتور بدهید:

```bash
KOLANG_BIN=/path/to/kolang KOLANG_LINTER=/path/to/kolang-linter npm run dev
```

### 🧩 نحوهٔ پیدا کردن مسیر مفسر

ادیتور باینری `kolang` را به این ترتیب پیدا می‌کند (اولویت از بالا به پایین):

1. **پنجرهٔ تنظیمات** — یک مسیر مطلق که در اپ تعیین می‌کنید (در `<userData>/settings.json` ذخیره می‌شود)
2. **متغیرهای محیطی** `KOLANG_BIN` / `KOLANG_LINTER`
3. **باینری بسته‌بندی‌شده** در اپ نصب‌شده (`Resources/bin/kolang`، که توسط electron-builder از `native/darwin/` یا `native/win32/` کپی شده)
4. **`kolang` روی `PATH`** — fallback حالت توسعه

### 📦 بسته‌بندی

این پروژه با **[electron-builder](https://www.electron.build/)** به اپلیکیشن‌های قابل نصب
macOS (یونیورسال arm64+x64) و Windows (x64) بسته‌بندی می‌شود.

#### ۱. قرار دادن باینری مفسر در `native/`

اگر می‌خواهید اپ بسته‌بندی‌شده *شامل مفسر* باشد (نصب یک‌کلیکی برای کاربر نهایی)،
باینری‌های کامپایل‌شده را در `native/` بگذارید:

- `native/darwin/kolang` و `native/darwin/kolang-linter` برای macOS
  (ترجیحاً باینری یونیورسال — ببینید [`native/README.md`](./native/README.md))
- `native/win32/kolang.exe` و `native/win32/kolang-linter.exe` برای Windows

electron-builder پوشهٔ پلتفرم درست را در زمان بسته‌بندی در `Resources/bin/` کپی
می‌کند. این باینری‌ها **gitignore شده‌اند** — هر بسته‌بندی‌کننده خودش آنها را فراهم می‌کند.

> اگر این مرحله را رها کنید، اپ هنوز ساخته و اجرا می‌شود، اما کاربران باید
> مفسر `kolang` را خودشان نصب کنند (ببینید [نصب مفسر](#نصب-مفسر)).

#### ۲. (اختیاری) آیکن اپ

یک `icon.png` با ابعاد ۱۰۲۴×۱۰۲۴ در `build/` بگذارید؛ electron-builder از روی آن
`icon.icns` (macOS) و `icon.ico` (Windows) می‌سازد. بدون آیکن هم بسته‌بندی با آیکن
پیش‌فرض Electron موفق می‌شود. ببینید [`build/README.md`](./build/README.md).

#### ۳. ساخت

```bash
npm run dist:mac    # → dist/*.dmg و dist/*.zip (یونیورسال)
npm run dist:win    # → dist/*-Setup.exe (NSIS, x64) — روی ویندوز یا CI
npm run dist        # هر دو (macOS باید روی macOS اجرا شود؛ Windows باید روی Windows)
```

#### امضای کد (اختیاری)

برای نسخه‌های امضا/نوتاری شدهٔ macOS، این متغیرهای محیطی را پیش از
`npm run dist:mac` تنظیم کنید:

- `CSC_LINK`, `CSC_KEY_PASSWORD` — گواهی Developer ID Application شما
- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID` — برای نوتاری

بدون این موارد، نسخه‌ها **امضا نشده** می‌شوند و کاربران macOS باید بار اول
کلیک راست → Open کنند. نوتاری macOS نیازمند عضویت پولی برنامه‌نویسان اپل
(~۹۹ دلار در سال) است. امضای ویندوز از `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` استفاده می‌کند.

#### انتشار از طریق GitHub Actions

push کردن تگ `v*.*.*` ورک‌فلو [.github/workflows/release.yml](./.github/workflows/release.yml)
را اجرا می‌کند که نسخهٔ macOS-یونیورسال را روی `macos-latest` و Windows-x64 را روی
`windows-latest` می‌سازد و هر دو را به‌صورت یک **GitHub Release** منتشر می‌کند. این
ورک‌فلو همچنین مفسر و لینتر را از Releases پروژه‌های faralidev/kolang و
faralidev/kolang-linter دانلود و داخل اپ بسته‌بندی می‌کند.

```bash
git tag v0.1.0
git push origin v0.1.0
```

به‌علاوه، با انتشار هر release، ورک‌فلو [.github/workflows/update-cask.yml](./.github/workflows/update-cask.yml)
به‌صورت خودکار یک PR به `faralidev/homebrew-tap` می‌فرستد تا Cask مربوط به brew
با نسخهٔ جدید هماهنگ شود.

### 🤝 مشارکت

مشارکت خوش‌آمد است! لطفاً پیش از باز کردن issue یا PR، [CONTRIBUTING.md](./CONTRIBUTING.md)
و [آیین‌نامهٔ رفتار](./CODE_OF_CONDUCT.md) را بخوانید.

- 🐛 باگ پیدا کردید؟ [گزارش باگ باز کنید](https://github.com/faralidev/kolang-ide/issues/new?template=bug_report.md)
- 💡 ایده‌ای دارید؟ [یک قابلیت پیشنهاد دهید](https://github.com/faralidev/kolang-ide/issues/new?template=feature_request.md)
- 💬 فقط می‌خواهید حرف بزنید؟ [یک بحث شروع کنید](https://github.com/faralidev/kolang-ide/discussions)

### 🗂 چیدمان پروژه

```
main.js              فرایند اصلی Electron — IPC، اجرای باینری kolang
preload.js           پل امن بین رندرر و فرایند اصلی
index.html           رابط کاربری (تم تیرهٔ Catppuccin Mocha)
renderer.js          منطق رندرر
kolang-language.js   بستهٔ زبان CodeMirror 6 برای کلنگ (نحو، تاشدن، تورفتگی)
bundle.js            باندل CodeMirror 6 (تولیدشده با `npm run build` — gitignore شده)
build.js             اسکریپت esbuild که bundle.js را می‌سازد
native/              باینری‌های پلتفرم‌خاص kolang (gitignore شده) برای بسته‌بندی
build/               دارایی‌های بسته‌بندی (آیکن، entitlements)
.github/workflows/   ورک‌فلوهای CI / انتشار
```

### 🔒 امنیت

مشکل امنیتی پیدا کردید؟ لطفاً **issue عمومی باز نکنید** — برای گزارش خصوصی
به [SECURITY.md](./SECURITY.md) مراجعه کنید.

### 📜 مجوز

MIT — FaraliDev و مشارکت‌کنندگان. متن کامل در [LICENSE](./LICENSE).

---

## English

A simple desktop editor for the **[Kolang](https://github.com/faralidev/kolang)**
Persian programming language — built with Electron and CodeMirror 6.

Kolang IDE is a lightweight code editor for writing and running Kolang programs:
a CodeMirror 6 editor with Kolang syntax highlighting, a Run button that pipes
your code to the `kolang` interpreter, an output/error panel, and file open/save
— all in a calm Catppuccin Mocha dark theme.

> **Note:** Kolang IDE is the *editor*. To actually run Kolang programs you also
> need the **`kolang` interpreter**, which is a separate project — see
> [Install the interpreter](#install-the-interpreter).

### ✨ Features

- **CodeMirror 6 editor** with Kolang syntax highlighting, folding, and indentation
- **Right-to-left** editing for Persian source
- **Run ▶ / Stop ■** — executes the current file with the `kolang` interpreter
- **Output & error panel** showing stdout, stderr, and exit status
- **Live linting** via `kolang-linter` (reads source on stdin, emits JSON diagnostics)
- **Open / save `.kolang` files** through native system dialogs
- **Settings modal** to point the editor at your `kolang` / `kolang-linter` binaries
- **Catppuccin Mocha** dark theme
- Cross-platform: **macOS** (universal arm64+x64) and **Windows** (x64)

### 📷 Screenshots

<!-- TODO: Replace these placeholders with real screenshots.

     1. Save a screenshot to docs/screenshot-editor.png
     2. Save a run-output screenshot to docs/screenshot-run.png
     3. Delete this comment and the placeholder blocks below.
-->

| Editor | Run output |
| :---: | :---: |
| _editor screenshot coming soon_ | _run-output screenshot coming soon_ |

### ⬇️ Download

Pre-built binaries are published on the **[Releases](https://github.com/faralidev/kolang-ide/releases)**
page:

| Platform | File |
| --- | --- |
| macOS (Apple Silicon + Intel) | `kolang-ide-<version>-universal.dmg` |
| Windows (x64) | `kolang-ide-Setup-<version>.exe` |

From v0.1.0 onwards, the `kolang` interpreter and `kolang-linter` are **bundled
inside the app** — end users need no extra setup.

#### Install via Homebrew (macOS)

```bash
brew install --cask faralidev/tap/kolang-ide
```

Or tap first, then install:

```bash
brew tap faralidev/tap
brew install --cask kolang-ide
```

> The macOS `.dmg` is currently **unsigned**. On first launch, right-click the
> app → **Open** → **Open anyway** to bypass Gatekeeper. (Signing/notarization
> requires a paid Apple Developer account — see [Code signing](#code-signing-optional).)

#### Install the interpreter

If you installed the packaged app (`.dmg` / `.exe` or brew), the interpreter is
already included — skip this section. If you're running from source, to run
Kolang programs:

1. Build or download the **`kolang`** interpreter from
   [faralidev/kolang](https://github.com/faralidev/kolang).
2. Put it somewhere on your `PATH` (e.g. `/usr/local/bin` on macOS,
   somewhere on `%PATH%` on Windows), **or**
3. Launch Kolang IDE → **Settings** → set the path to the `kolang` binary, **or**
4. Set the `KOLANG_BIN` environment variable before launching the app.

For live linting, do the same for **`kolang-linter`** (`KOLANG_LINTER` env var).

### 🚀 Quick start (from source)

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

### 🧩 How the interpreter path is resolved

The editor finds the `kolang` binary in this order (highest priority first):

1. **Settings modal** — an absolute path you set in-app (persisted in
   `<userData>/settings.json`)
2. **`KOLANG_BIN` / `KOLANG_LINTER`** environment variables
3. **Bundled binary** in a packaged app (`Resources/bin/kolang`, placed there
   by electron-builder from `native/darwin/` or `native/win32/`)
4. **`kolang` on `PATH`** — the dev-mode fallback

### 📦 Packaging

This project uses **[electron-builder](https://www.electron.build/)** to
produce installable macOS (universal arm64+x64) and Windows (x64) apps.

#### 1. Place the interpreter binaries in `native/`

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

#### 2. (Optional) App icon

Put a 1024×1024 `icon.png` in `build/`; electron-builder generates
`icon.icns` (macOS) and `icon.ico` (Windows) from it. Without an icon the
build still succeeds with the default Electron icon. See
[`build/README.md`](./build/README.md).

#### 3. Build

```bash
npm run dist:mac    # → dist/*.dmg and dist/*.zip (universal)
npm run dist:win    # → dist/*-Setup.exe (NSIS, x64) — run on Windows or in CI
npm run dist        # both (macOS must run on macOS; Windows must run on Windows)
```

#### Code signing (optional)

For signed/notarized macOS builds, set these environment variables before
`npm run dist:mac`:

- `CSC_LINK`, `CSC_KEY_PASSWORD` — your Developer ID Application certificate
- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID` —
  for notarization

Without them, builds are **unsigned** and macOS users must right-click → Open
the first time. macOS notarization requires a paid Apple Developer Program
membership (~$99/year). Windows signing uses `WIN_CSC_LINK` /
`WIN_CSC_KEY_PASSWORD`.

#### Releases via GitHub Actions

Pushing a tag `v*.*.*` triggers [`.github/workflows/release.yml`](./.github/workflows/release.yml),
which builds macOS-universal on `macos-latest` and Windows-x64 on
`windows-latest`, then publishes a **GitHub Release** with both artifacts. The
workflow also downloads the interpreter and linter from the faralidev/kolang
and faralidev/kolang-linter Releases and bundles them inside the app.

```bash
git tag v0.1.0
git push origin v0.1.0
```

Additionally, on every release publish, the
[`.github/workflows/update-cask.yml`](./.github/workflows/update-cask.yml)
workflow automatically opens a PR against `faralidev/homebrew-tap` to keep the
Homebrew Cask in sync with the new version.

### 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md)
and our [Code of Conduct](./CODE_OF_CONDUCT.md) before opening an issue or PR.

- 🐛 Found a bug? [Open a bug report](https://github.com/faralidev/kolang-ide/issues/new?template=bug_report.md)
- 💡 Have an idea? [Suggest a feature](https://github.com/faralidev/kolang-ide/issues/new?template=feature_request.md)
- 💬 Just want to chat? [Start a discussion](https://github.com/faralidev/kolang-ide/discussions)

### 🗂 Project layout

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

### 🔒 Security

Found a security issue? Please **don't** open a public issue — see
[SECURITY.md](./SECURITY.md) for how to report it privately.

### 📜 License

MIT © FaraliDev and contributors. See [LICENSE](./LICENSE).
