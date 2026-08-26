# Changelog

All notable changes to **Kolang IDE** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-08-26

### Added
- App logo / icon: a white pickaxe (کلنگ) on a modern green rounded-square
  background. Committed `build/logo.svg` (vector source), `build/icon.png`
  (1024² raster master), `build/icon.icns` (macOS), and `build/icon.ico`
  (Windows). Packaged builds now use the real icon instead of the default
  Electron one.
- Homebrew installation route: `brew install --cask faralidev/tap/kolang-ide`.
  A `Casks/kolang-ide.rb` was added to `faralidev/homebrew-tap`.
- `update-cask.yml` workflow that auto-opens a PR to `faralidev/homebrew-tap`
  on every release publish, keeping the cask in sync.
- `.gitattributes` for line-ending normalization and linguist stats.
- `docs/` directory (with `.gitkeep`) for screenshots.
- Persian-primary README (full Persian section first, English below) with a
  language switcher, brew install instructions, and a Screenshots section.
- CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md (GitHub Security Advisories
  as the private reporting channel), issue templates, PR template, MIT LICENSE.

### Changed
- The release workflow now bundles the `kolang` interpreter and `kolang-linter`
  (downloaded from `faralidev/kolang` and `faralidev/kolang-linter` Releases)
  into the packaged app, so end users no longer need to install the
  interpreter separately. macOS gets a universal binary stitched via `lipo`.
- README download section updated to reflect that releases bundle the
  interpreter, and to list the correct macOS asset filename
  (`kolang-ide-<version>-universal.dmg`).
- `extraResources` switched from the ambiguous `${os}` token to per-platform
  `mac.extraResources` / `win.extraResources` blocks keyed to `native/darwin`
  and `native/win32`.
- Removed invalid `arch` keys from the `mac` / `win` electron-builder config
  blocks (rejected by the 26.x schema; `--universal` / `--x64` are passed on
  the CLI instead).
- macOS release builds skip code signing when `MAC_CSC_LINK` is unset
  (`-c.mac.identity=null -c.mac.hardenedRuntime=false`), so unsigned builds
  succeed instead of failing with "not a file".

### Fixed
- Language name misspelling `کولنگ` → `کلنگ` in the README and in the native
  open/save dialog titles (`main.js`).

## [0.1.0] — initial

- CodeMirror 6 editor with RTL and Persian language support
- Run (▶) / Stop (■) buttons executing the `kolang` interpreter
- Output and error panel
- Open / save `.kolang` files via system dialogs
- Linting via `kolang-linter`
- Catppuccin Mocha dark theme
- macOS (universal) and Windows (x64) packaging via electron-builder
- GitHub Actions release workflow
