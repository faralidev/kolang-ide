# native/ — bundled interpreter binaries

Place the compiled **kolang interpreter** and **kolang-linter** binaries here.
electron-builder copies the correct platform folder into the packaged app's
`Resources/bin/` (see `extraResources` in package.json), and `main.js` looks
them up there at runtime (`process.resourcesPath/bin/…`).

## macOS — `native/darwin/`

- `native/darwin/kolang` — the interpreter (see below for the universal build)
- `native/darwin/kolang-linter` — the linter

The macOS build is **universal** (arm64 + x64), so each binary should be a
universal binary too. Build them with:

```
GOOS=darwin GOARCH=arm64 go build -o /tmp/kolang-arm64 .
GOOS=darwin GOARCH=amd64 go build -o /tmp/kolang-amd64 .
lipo -create -output native/darwin/kolang /tmp/kolang-arm64 /tmp/kolang-amd64
chmod +x native/darwin/kolang

GOOS=darwin GOARCH=arm64 go build -o /tmp/kolang-linter-arm64 .
GOOS=darwin GOARCH=amd64 go build -o /tmp/kolang-linter-amd64 .
lipo -create -output native/darwin/kolang-linter /tmp/kolang-linter-arm64 /tmp/kolang-linter-amd64
chmod +x native/darwin/kolang-linter
```

If you only ship an arm64 binary for now, the universal app will still run
on arm64 Macs (Apple Silicon); Intel Macs would fail to launch the
interpreter/linter. `lipo -info native/darwin/kolang` shows the architectures.

## Windows — `native/win32/`

- `native/win32/kolang.exe` — the interpreter
- `native/win32/kolang-linter.exe` — the linter

Cross-compile from any platform with:

```
GOOS=windows GOARCH=amd64 go build -o native/win32/kolang.exe .
GOOS=windows GOARCH=amd64 go build -o native/win32/kolang-linter.exe .
```

## Dev mode

In development (`npm run dev`), the app ignores `native/` and looks for
`kolang` / `kolang-linter` on your `PATH` (the interpreter is a separate
project you build/install yourself). You can override these with the
`KOLANG_BIN` / `KOLANG_LINTER` environment variables, or set an absolute path
in the in-app Settings modal.