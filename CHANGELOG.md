# Changelog

All notable changes to **Kolang IDE** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Open-source project scaffolding: `LICENSE` (MIT), `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue/PR templates.
- Bilingual (English/Persian) README with screenshots section, download links,
  and badges.

### Changed
- Removed `"private": true` from `package.json`; added `license`, `author`,
  `repository`, `bugs`, `homepage`, and `keywords` for open-source publishing.
- Dev-mode interpreter path now defaults to `kolang` on `PATH` instead of a
  hardcoded absolute path, so other developers can run the app out of the box.
  Override with the `KOLANG_BIN` / `KOLANG_LINTER` env vars or via Settings.

## [0.1.0] — initial

- CodeMirror 6 editor with RTL and Persian language support
- Run (▶) / Stop (■) buttons executing the `kolang` interpreter
- Output and error panel
- Open / save `.kolang` files via system dialogs
- Linting via `kolang-linter`
- Catppuccin Mocha dark theme
- macOS (universal) and Windows (x64) packaging via electron-builder
- GitHub Actions release workflow
