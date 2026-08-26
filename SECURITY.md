# Security Policy

## Supported versions

Kolang IDE is a hobby/open project and currently receives security updates only
for the latest release.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| < latest| :x:                |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, email **faralidev@example.com** (TODO: replace with a real contact
address) with:

- a description of the issue and its potential impact,
- steps to reproduce (a minimal example is ideal),
- the Kolang IDE version, OS, and Electron version you tested on, and
- any suggested fix if you have one.

We will acknowledge receipt within **7 days** and aim to issue a fix or
mitigation for confirmed vulnerabilities within **30 days**, depending on
severity. Please avoid public disclosure until a fix is released, so users can
patch before details are out.

## Scope

This policy covers the **Kolang IDE** Electron application in this repository
(`main.js`, `preload.js`, `renderer.js`, `kolang-language.js`, `build.js`,
`index.html`). It does **not** cover the separate `kolang` interpreter or
`kolang-linter` binaries — those have their own repositories.

### What's in scope

- Sandbox / IPC escape via the preload bridge
- Path traversal or arbitrary code execution through file open/save dialogs
- Unsafe handling of the spawned `kolang` / `kolang-linter` subprocesses
  (argument or stdin injection)
- Issues in the release/packaging pipeline (e.g. unsigned artifacts being
  published as signed)

### What's generally out of scope

- Bugs in the `kolang` interpreter itself (report to the interpreter repo)
- Vulnerabilities in Electron or CodeMirror that are fixed by upgrading —
  please check the latest version first
- Self-XSS or attacks requiring the user to deliberately point the editor at a
  malicious `kolang` binary

## Hardening notes

- The renderer talks to the main process **only** through the explicitly
  exposed `preload.js` bridge (`contextBridge`), not via a blanket `nodeIntegration`.
- The `kolang`/`kolang-linter` subprocesses are spawned with the user's source
  piped over stdin — no shell is used (`shell: false`), so source filenames and
  arguments are not interpreted by a shell.
- macOS packaged builds use the **hardened runtime** with minimal entitlements
  (see `build/entitlements.mac.plist`). Unsigned builds will trigger Gatekeeper
  warnings by design.
