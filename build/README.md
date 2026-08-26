# build/ — packaging assets

## App icon (optional)

Place a **1024×1024 `icon.png`** in this directory. electron-builder
auto-generates `icon.icns` (macOS) and `icon.ico` (Windows) from it during
packaging.

- The `mac.icon` config points to `build/icon.icns`; the `win.icon` config
  points to `build/icon.ico`. If the files are missing, electron-builder
  warns and falls back to the default Electron icon — the build still works.
- To generate the platform icons manually:
  ```
  npx electron-icon-builder --input=build/icon.png --output=build
  ```

`icon.png` / `icon.icns` / `icon.ico` are git-ignored (user-specific art).

## Entitlements (macOS)

- `entitlements.mac.plist` — hardened-runtime entitlements applied to the
  main app binary (JIT, unsigned executable memory, disabled library
  validation so the bundled `kolang` helper can run).
- `entitlements.mac.inherit.plist` — identical entitlements inherited by
  child processes (the kolang interpreter subprocess).