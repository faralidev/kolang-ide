// renderer.js — kolang-ide renderer (ES module source).
//
// Bundled by esbuild into bundle.js (classic script loaded by index.html);
// this file is never loaded directly by the page. Mounts the CodeMirror 6
// editor with the kolang language module, wires toolbar buttons, tabs,
// language switching and keyboard shortcuts to the Tauri backend (invoke
// API), and renders program output.

import { invoke } from '@tauri-apps/api/core'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab, addCursorAbove, addCursorBelow, toggleComment, indentMore, indentLess, moveLineUp, moveLineDown } from '@codemirror/commands'
import { bracketMatching, codeFolding, foldGutter, foldKeymap, foldService, indentOnInput } from '@codemirror/language'
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches, selectNextOccurrence } from '@codemirror/search'
import { linter, lintGutter, lintKeymap, forceLinting } from '@codemirror/lint'
import { kolang } from '@kolang/grammar/codemirror/kolang-syntax.js'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { kolangCompletion, kolangHover, kolangTheme } from './kolang-extras.mjs'

document.addEventListener('DOMContentLoaded', async () => {
  const editorEl = document.getElementById('editor')
  const tabBarEl = document.getElementById('tab-bar')
  const sidebarEl = document.getElementById('sidebar')
  const sidebarHeaderEl = document.getElementById('sidebar-header')
  const sidebarChevron = document.getElementById('sidebar-chevron')
  const runBtn = document.getElementById('run-btn')
  const stopBtn = document.getElementById('stop-btn')
  const openBtn = document.getElementById('open-btn')
  const saveBtn = document.getElementById('save-btn')
  const outputEl = document.getElementById('output')
  const outputPanel = document.getElementById('output-panel')
  const outputHeader = document.getElementById('output-header')
  const outputToggleBtn = document.getElementById('output-toggle-btn')
  const outputToggleIcon = document.getElementById('output-toggle-icon')
  const outputResizer = document.getElementById('output-resizer')
  const statusEl = document.getElementById('status')
  const settingsBtn = document.getElementById('settings-btn')
  const settingsModal = document.getElementById('settings-modal')
  const kolangPathInput = document.getElementById('kolang-path-input')
  const browseBtn = document.getElementById('browse-btn')
  const linterPathInput = document.getElementById('linter-path-input')
  const browseLinterBtn = document.getElementById('browse-linter-btn')
  const fontSizeInput = document.getElementById('font-size-input')
  const tabSizeInput = document.getElementById('tab-size-input')
  const themeSelect = document.getElementById('theme-select')
  const wordWrapCheckbox = document.getElementById('word-wrap-checkbox')
  const lineNumbersCheckbox = document.getElementById('line-numbers-checkbox')
  const autoSaveCheckbox = document.getElementById('auto-save-checkbox')
  const autoFormatCheckbox = document.getElementById('auto-format-checkbox')
  const autoThemeCheckbox = document.getElementById('auto-theme-checkbox')
  const settingsResetBtn = document.getElementById('settings-reset')
  const explorerEl = document.getElementById('explorer')
  const openFolderBtn = document.getElementById('open-folder-btn')
  const shortcutsBtn = document.getElementById('shortcuts-btn')
  const shortcutsModal = document.getElementById('shortcuts-modal')
  const shortcutsCloseBtn = document.getElementById('shortcuts-close')
  const shortcutsEditJsonBtn = document.getElementById('shortcuts-edit-json')
  const directionToggleBtn = document.getElementById('direction-toggle')

  let isRunning = false
  let dialogBusy = false
  let explorerRoot = null
  const expandedDirs = new Map() // expanded directory path → true (cache)

  // Open files (tabs). Each tab keeps its own immutable EditorState so
  // content, selection and language survive tab switches.
  let openFiles = []
  let activeTab = -1

  // Editor settings (VS Code-style), mirrored from the backend settings.json.
  // font_size / tab_size / theme / word_wrap / line_numbers are applied to the
  // editor; auto_save saves the active file on change; auto_format is stored
  // for future use.
  let editorSettings = {
    kolang_path: '',
    linter_path: '',
    font_size: 14,
    tab_size: 4,
    theme: 'dark',
    auto_theme: true,
    word_wrap: true,
    line_numbers: true,
    auto_save: false,
    auto_format: false,
  }
  let autoSaveTimer = null
  let settingsPersistTimer = null

  // Keybindings (VS Code-style JSON). The default set mirrors the original
  // hardcoded app-level shortcuts; user overrides live in localStorage
  // 'kolang-keybindings' and are merged by `command` (user wins). The
  // effective set drives both editorKeymap() and the window-level handler.
  // The `when` field is stored for parity with VS Code but not enforced —
  // app bindings always apply in the editor keymap.
  const DEFAULT_KEYBINDINGS = [
    { key: 'Mod-s',              command: 'saveFile',             when: 'editorTextFocus' },
    { key: 'Mod-o',              command: 'openFile',             when: 'editorTextFocus' },
    { key: 'Mod-Enter',          command: 'runCode',              when: 'editorTextFocus' },
    { key: 'F5',                 command: 'runCode',              when: 'editorTextFocus' },
    { key: 'Mod-/',              command: 'toggleComment',        when: 'editorTextFocus' },
    { key: 'Mod-]',              command: 'indentMore',           when: 'editorTextFocus' },
    { key: 'Mod-[',              command: 'indentLess',           when: 'editorTextFocus' },
    { key: 'Alt-ArrowUp',        command: 'moveLineUp',           when: 'editorTextFocus' },
    { key: 'Alt-ArrowDown',      command: 'moveLineDown',         when: 'editorTextFocus' },
    { key: 'Mod-Alt-ArrowUp',    command: 'addCursorAbove',       when: 'editorTextFocus' },
    { key: 'Mod-Alt-ArrowDown',  command: 'addCursorBelow',       when: 'editorTextFocus' },
    { key: 'Mod-d',              command: 'selectNextOccurrence', when: 'editorTextFocus' },
  ]
  let userKeybindings = []
  let effectiveKeybindings = DEFAULT_KEYBINDINGS.map((b) => ({ ...b }))
  let applyKeybindingsTimer = null
  let isApplyingKeybindings = false

  // Default welcome program — valid Kolang, verb-final, Persian digits.
  const DEFAULT_DOC = `/ به ویرایشگر کلنگ خوش آمدید
«سلام دنیا!» بنویس

برای ای از ۱ تا ۵:
    ای بنویس
`

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  // Convert Latin digits to Persian digits for the line-number gutter.
  function toPersianDigits(s) {
    return String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])
  }

  function basename(p) {
    return String(p).split(/[\\/]/).pop()
  }

  function activeFile() {
    return openFiles[activeTab] || null
  }

  function activeFilePath() {
    const tab = activeFile()
    return tab ? tab.path : null
  }

  // Language by file extension; anything unknown defaults to Kolang.
  function languageFromPath(path) {
    const ext = String(path).split('.').pop().toLowerCase()
    if (ext === 'py') return 'python'
    if (ext === 'json') return 'json'
    if (ext === 'html' || ext === 'htm') return 'html'
    if (ext === 'css') return 'css'
    return 'kolang'
  }

  // Indentation-based code folding — Kolang uses StreamLanguage (no syntax
  // tree), so the built-in syntax fold service cannot find ranges. This
  // service folds any line whose following lines are more indented, up to
  // the first dedent. Tabs count as 4 spaces.
  function countIndent(text) {
    let n = 0
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (ch === ' ') n++
      else if (ch === '\t') n += 4
      else break
    }
    return n
  }

  const kolangFoldService = foldService.of((state, lineStart) => {
    const line = state.doc.lineAt(lineStart)
    if (!line.text.trim() || line.to >= state.doc.length) return null
    const indent = countIndent(line.text)
    const nextLine = state.doc.lineAt(line.to + 1)
    if (!nextLine.text.trim() || countIndent(nextLine.text) <= indent) return null
    let to = line.to
    for (let pos = line.to + 1; pos <= state.doc.length; ) {
      const l = state.doc.lineAt(pos)
      if (l.to <= to) break
      if (!l.text.trim() || countIndent(l.text) > indent) {
        to = l.to
        pos = l.to + 1
      } else break
    }
    return to > line.to ? { from: line.from, to } : null
  })

  // Convert the linter's 1-based (line, col) to a 0-based document offset,
  // clamping the line to the current doc length to guard stale positions.
  function linterPos(view, line, col) {
    const lines = view.state.doc.lines
    const ln = Math.min(Math.max(line, 1), lines)
    const docLine = view.state.doc.line(ln)
    const c = Math.max(col, 1)
    return docLine.from + (c - 1)
  }

  // Lint source via the kolang-linter binary. Debounced by CM6's `delay`
  // (400ms); the source function is async and resolves to [] on any error.
  //
  // RTL NOTE: each cm-lintRange is an inline <span>, and when one cuts through
  // a Persian word the browser's shaper restarts at the span boundary,
  // visually detaching the letters inside it from the rest of the word. This
  // is most visible on the word you're actively typing (the linter flags the
  // half-finished word). To avoid splitting the word under the cursor, we
  // suppress diagnostics that overlap the active (cursor) line — they'll
  // reappear once the cursor moves elsewhere.
  const kolangLinter = linter(async (view) => {
    const code = view.state.doc.toString()
    // The whole line the main cursor is on; diagnostics touching it are held
    // back so the lint span doesn't split the word being edited.
    const sel = view.state.selection.main
    const activeLine = view.state.doc.lineAt(sel.head)
    try {
      const diags = await invoke("linter_run", { code })
      if (!Array.isArray(diags)) return []
      return diags
        .filter((d) => d.line >= 1 && d.line <= view.state.doc.lines)
        .filter((d) => {
          const from = linterPos(view, d.line, d.col)
          const to = linterPos(view, d.endLine ?? d.line, d.endCol ?? d.col)
          const lo = Math.min(from, to)
          const hi = Math.max(from, to)
          // Drop diagnostics that touch the active line.
          return hi < activeLine.from || lo > activeLine.to
        })
        .map((d) => {
          let from = linterPos(view, d.line, d.col)
          let to = linterPos(view, d.endLine ?? d.line, d.endCol ?? d.col)
          // The linter's diag.At() helper produces single-character ranges
          // (endCol = col+1). A cm-lintRange span wrapping just one letter
          // splits a Persian word at the bidi boundary, detaching that letter
          // from the rest of the word. Extend any single-char diagnostic to
          // cover the full word/token at that position so the whole word sits
          // inside one span (no reshape split).
          if (to <= from + 1) {
            const doc = view.state.doc
            // Walk forward to the end of the current token (letters/digits/
            // underscores, including ZWNJ U+200C which joins Persian words).
            let end = from
            while (end < doc.length) {
              const ch = doc.sliceString(end, end + 1)
              if (!/[\p{L}\p{N}_\u200C]/u.test(ch)) break
              end++
            }
            // Walk backward to the start of the token so the span aligns to a
            // whole word, not mid-word (the linter col may point past the
            // first char for some rules).
            let start = from
            while (start > 0) {
              const ch = doc.sliceString(start - 1, start)
              if (!/[\p{L}\p{N}_\u200C]/u.test(ch)) break
              start--
            }
            if (end > start) { from = start; to = end }
          }
          return {
            from: Math.min(from, to),
            to: Math.max(from, to),
            severity: d.severity,
            message: d.rule ? `[${d.rule}] ${d.message}` : d.message,
            source: 'kolang',
          }
        })
    } catch (e) {
      return []
    }
  }, { delay: 400 })

  // Auto-pair the asymmetric Persian guillemets: « inserts «» with the
  // cursor between; » skips over an already-typed closing mark. Kolang-only.
  const guillemetHandler = (view, from, to, text) => {
    if (text === '«') {
      view.dispatch({
        changes: { from, to, insert: '«»' },
        selection: { anchor: from + 1 },
      })
      return true
    }
    if (text === '»') {
      const next = view.state.doc.sliceString(to, to + 1)
      if (next === '»') {
        view.dispatch({ selection: { anchor: to + 1 } })
        return true
      }
    }
    return false
  }

  // Language-specific CodeMirror extensions. kolang gets completion, hover
  // docs, indentation folding and the linter; the other languages bring
  // their own syntax support + completions.
  const LANG_EXTENSIONS = {
    kolang: () => [kolang(), kolangCompletion(), kolangHover(), kolangFoldService, kolangLinter],
    python: () => [python()],
    json: () => [json()],
    html: () => [html()],
    css: () => [css()],
  }

  // Per-language default text direction. kolang is RTL; code in other
  // languages (python/json/html/css) reads LTR. A tab may carry a manual
  // directionOverride ('ltr'|'rtl'|null) from the toolbar toggle; null means
  // "use the language default".
  function defaultDirectionFor(language) {
    return language === 'kolang' ? 'rtl' : 'ltr'
  }

  function effectiveDirection(tab) {
    if (!tab) return 'rtl'
    return tab.directionOverride || defaultDirectionFor(tab.language)
  }

  // Reflect the active tab's effective direction on the toolbar toggle.
  // ↩️ = RTL, ↪️ = LTR (the arrow indicates the reading direction).
  function updateDirectionToggle() {
    if (!directionToggleBtn) return
    const dir = effectiveDirection(activeFile())
    directionToggleBtn.textContent = dir === 'rtl' ? '↩\uFE0F' : '↪\uFE0F'
    directionToggleBtn.classList.toggle('ltr', dir === 'ltr')
    directionToggleBtn.title = dir === 'rtl'
      ? 'جهت متن: راست‌چین — برای چپ‌چین کردن کلیک کنید'
      : 'جهت متن: چپ‌چین — برای راست‌چین کردن کلیک کنید'
  }

  function buildState(doc, language, selection, directionOverride, isKeybindings) {
    const lang = Object.prototype.hasOwnProperty.call(LANG_EXTENSIONS, language) ? language : 'kolang'
    const dir = directionOverride || defaultDirectionFor(lang)
    const extensions = [
      ...(editorSettings.line_numbers !== false
        ? [lineNumbers({ formatNumber: (n) => toPersianDigits(String(n)) })]
        : []),
      foldGutter(),
      codeFolding(),
      lintGutter(),
      history(),
      bracketMatching(),
      closeBrackets(),
      ...(lang === 'kolang' ? [EditorView.inputHandler.of(guillemetHandler)] : []),
      ...LANG_EXTENSIONS[lang](),
      ...(lang !== 'kolang' ? [autocompletion()] : []),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSelectionMatches(),
      indentOnInput(),
      keymap.of(editorKeymap()),
      ...(editorSettings.word_wrap !== false ? [EditorView.lineWrapping] : []),
      EditorState.tabSize.of(editorSettings.tab_size > 0 ? editorSettings.tab_size : 4),
      ...(editorSettings.auto_save
        ? [EditorView.updateListener.of((update) => { if (update.docChanged) scheduleAutoSave() })]
        : []),
      // Live-apply keybindings while editing the keybindings tab (debounced,
      // silent — success/error messages are reserved for the Mod-s save).
      ...(isKeybindings ? [EditorView.updateListener.of((update) => {
        if (!update.docChanged || isApplyingKeybindings) return
        const tab = activeFile()
        if (tab && tab.isKeybindings) scheduleApplyKeybindings()
      })] : []),
      // Pick the editor theme (Mocha dark / Latte light) based on the current
      // body.light class. The flag is read at state-build time, so changing
      // the theme requires rebuilding states (rebuildAllTabStates).
      ...kolangTheme(document.body.classList.contains('light')),
      // Per-state direction override — added AFTER kolangTheme() so it wins
      // on equal specificity, and uses !important to GUARANTEE it beats
      // kolangTheme's `.cm-content { direction: rtl; textAlign: right }`
      // (set in kolang-extras.mjs, which we cannot edit). We previously tried
      // `&&` (double-&) to bump specificity, but this version of style-mod
      // only replaces the FIRST `&` in the selector, leaving a literal `&`
      // that makes the CSS rule invalid and silently dropped. !important is
      // the robust fix. contentAttributes sets the `dir` attr on .cm-content
      // for bidi + a11y; the theme flips the CSS `direction` AND `textAlign`
      // on both `.cm-content` and `.cm-line` so LTR text actually aligns left.
      ...(function () {
        const isRtl = dir === 'rtl'
        const align = isRtl ? 'right' : 'left'
        const t = {
          '.cm-scroller': { direction: dir + ' !important' },
          '.cm-content': { direction: dir + ' !important', textAlign: align + ' !important' },
          '.cm-line': { direction: dir + ' !important', textAlign: align + ' !important' },
        }
        if (!isRtl) {
          // Move sticky gutters to the left for LTR; kolangTheme pins them
          // right with a left border — flip both.
          t['.cm-gutters'] = { right: 'auto', left: '0 !important', borderLeft: 'none', borderRight: '1px solid #313244' }
        }
        return [EditorView.contentAttributes.of({ dir }), EditorView.theme(t)]
      })(),
    ]
    return EditorState.create({
      doc,
      ...(selection ? { selection } : {}),
      extensions,
    })
  }

  // Dispatch table mapping VS Code-style command names to their handlers.
  // App-level bindings in the keybindings JSON resolve through this table;
  // the built-in CM6 keymaps (defaultKeymap, historyKeymap, …) stay hardcoded.
  const commandHandlers = {
    saveFile: () => { saveFile(); return true },
    openFile: () => { openFile(); return true },
    runCode: () => { runCode(); return true },
    toggleComment,
    indentMore,
    indentLess,
    moveLineUp,
    moveLineDown,
    addCursorAbove,
    addCursorBelow,
    selectNextOccurrence,
  }

  function editorKeymap() {
    // App-level shortcuts come FIRST so they win over any conflicting
    // built-in binding (CM6 keymap is first-match-wins). preventDefault: true
    // makes CM6 call preventDefault on match so the window-level handler
    // (which bails on defaultPrevented) won't double-fire.
    const appBindings = effectiveKeybindings
      .filter((b) => commandHandlers[b.command])
      .map((b) => ({ key: b.key, run: commandHandlers[b.command], preventDefault: true }))
    return [
      ...appBindings,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      ...closeBracketsKeymap,
      ...foldKeymap,
      ...lintKeymap,
      indentWithTab,
    ]
  }

  // --- Keybindings JSON: load / merge / apply ---------------------------

  // Merge defaults with user overrides by `command` (user entry wins).
  // Merge defaults with user overrides. Unlike a per-command replace (which
  // would wipe ALL default keys for a command when the user adds one — e.g. a
  // user saving {"key":"F5","command":"runCode"} would delete the default
  // Mod-Enter), this keys by command+key so a user entry adds or overrides a
  // SPECIFIC key while preserving other default keys for the same command.
  function mergeKeybindings(defaults, user) {
    const map = new Map()
    const key2 = (b) => b.command + '|' + b.key
    for (const d of defaults) map.set(key2(d), { ...d })
    for (const u of user) map.set(key2(u), { ...u })
    return [...map.values()]
  }

  // Pretty-printed effective keybindings — the content of the keybindings tab.
  function getKeybindingsJson() {
    return JSON.stringify(effectiveKeybindings, null, 2)
  }

  // localStorage key suffix is versioned (v2) so stale saves from earlier
  // versions — which may have a partial runCode entry (F5 only, missing
  // Mod-Enter) — are ignored and defaults are restored.
  const KEYBINDINGS_STORAGE_KEY = 'kolang-keybindings-v2'

  // Load user overrides from localStorage; fall back to defaults on invalid
  // JSON (with an error in the output panel). Sets `effectiveKeybindings`.
  function loadKeybindings() {
    let user = []
    const stored = localStorage.getItem(KEYBINDINGS_STORAGE_KEY)
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        if (!Array.isArray(parsed)) throw new Error('not an array')
        user = parsed.filter((e) => e && typeof e.key === 'string' && typeof e.command === 'string')
      } catch (e) {
        appendOutput('خطا: JSON میان‌برها نامعتبر است — به پیش‌فرض برمی‌گردیم\n', 'err')
        user = []
      }
    }
    userKeybindings = user
    effectiveKeybindings = mergeKeybindings(DEFAULT_KEYBINDINGS, userKeybindings)
  }

  // Rebuild every open tab's EditorState so a new keymap (and direction)
  // takes effect. Content + selection are preserved; the active tab's scroll
  // Rebuild every open tab's EditorState so a new keymap, direction, or
  // theme takes effect. Content + selection are preserved; the active tab's
  // scroll is restored. Shared by applySettings(), applyKeybindingsFromJson(),
  // and the theme-swap functions. No-ops before the editor view exists or
  // when there are no open tabs (e.g. during startup before the first tab).
  // True once the EditorView has been created. rebuildAllTabStates() is called
  // from applyChromeSettings() during startup (before `view` exists) and from
  // the theme-apply path; without this flag the guard would do `typeof view`,
  // which throws a ReferenceError on the TDZ `const view` declared later in
  // init — halting DOMContentLoaded before button handlers attach.
  let viewReady = false

  function rebuildAllTabStates() {
    if (!viewReady || !openFiles.length) return
    saveActiveState()
    for (const tab of openFiles) {
      if (tab.state) {
        const sel = tab.state.selection
        const docText = tab.state.doc.toString()
        tab.state = buildState(docText, tab.language, sel, tab.directionOverride, tab.isKeybindings)
      }
    }
    const tab = activeFile()
    if (tab && tab.state) {
      view.setState(tab.state)
      view.scrollDOM.scrollTop = tab.scrollTop || 0
    }
  }

  // Apply a keybindings JSON string: validate, persist, rebuild effective
  // set, re-apply to all tabs. Returns true on success. `showMessage` controls
  // the success/error output (Mod-s shows it; the live debounced path is silent).
  function applyKeybindingsFromJson(jsonStr, { showMessage = false } = {}) {
    let parsed
    try {
      parsed = JSON.parse(jsonStr)
      if (!Array.isArray(parsed)) throw new Error('not an array')
    } catch (e) {
      if (showMessage) appendOutput('خطا: JSON میان‌برها نامعتبر است\n', 'err')
      return false
    }
    const cleaned = parsed.filter((e) => e && typeof e.key === 'string' && typeof e.command === 'string')
    localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(cleaned))
    userKeybindings = cleaned
    effectiveKeybindings = mergeKeybindings(DEFAULT_KEYBINDINGS, userKeybindings)
    isApplyingKeybindings = true
    rebuildAllTabStates()
    isApplyingKeybindings = false
    if (showMessage) appendOutput('میان‌برهای جدید اعمال شد\n', 'muted')
    return true
  }

  // Debounced live-apply while editing the keybindings tab.
  function scheduleApplyKeybindings() {
    clearTimeout(applyKeybindingsTimer)
    applyKeybindingsTimer = setTimeout(() => {
      const tab = activeFile()
      if (!tab || !tab.isKeybindings) return
      applyKeybindingsFromJson(view.state.doc.toString(), { showMessage: false })
    }, 800)
  }

  // Open the effective keybindings JSON as an in-memory editor tab (language
  // json → LTR). Reuses an existing keybindings tab if one is open. Marked
  // with isKeybindings so saveFile() applies the JSON instead of writing disk.
  function openKeybindingsTab() {
    const existing = openFiles.findIndex((t) => t.isKeybindings)
    if (existing >= 0) {
      switchTab(existing)
      hideShortcutsModal()
      return
    }
    const json = getKeybindingsJson()
    openFiles.push({
      path: null,
      name: 'میان‌برها',
      content: json,
      language: 'json',
      state: buildState(json, 'json', null, null, true),
      scrollTop: 0,
      directionOverride: null,
      isKeybindings: true,
    })
    hideShortcutsModal()
    switchTab(openFiles.length - 1)
  }

  // Auto-save: debounced save of the active file when it changes and it has a
  // path. Only active when the auto_save setting is enabled.
  function scheduleAutoSave() {
    if (!editorSettings.auto_save) return
    const tab = activeFile()
    if (!tab || !tab.path || dialogBusy || isRunning) return
    clearTimeout(autoSaveTimer)
    autoSaveTimer = setTimeout(() => {
      const t = activeFile()
      if (!t || !t.path || dialogBusy || isRunning) return
      invoke("fs_write_file", { filePath: t.path, content: view.state.doc.toString() }).catch(() => {})
    }, 800)
  }

  // Chrome-only settings (font size CSS var + theme class). When auto_theme
  // is on, the theme follows the OS prefers-color-scheme media query; when
  // off, the manual `theme` setting applies. Both paths rebuild editor states
  // so the editor surface (CM6 theme extension) swaps with the chrome.
  function applyChromeSettings() {
    document.documentElement.style.setProperty('--editor-font-size', String(editorSettings.font_size || 14) + 'px')
    if (editorSettings.auto_theme) {
      applyAutoThemeFromSystem()
    } else {
      applyManualTheme()
    }
  }

  // Returns the current OS color-scheme preference ('light' or 'dark'). Falls
  // back to 'dark' if matchMedia is unavailable (older webview).
  function systemColorScheme() {
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light'
      }
    } catch (e) { /* matchMedia unavailable — fall back to dark */ }
    return 'dark'
  }

  // Apply the current theme (auto-from-system or manual) to body.light AND
  // rebuild all editor states so the editor's theme extension swaps too.
  // Called on startup, on settings change, and from the matchMedia change
  // listener. The listener path guards on auto_theme (see setupAutoTheme) so
  // a manual theme isn't overridden when the OS preference changes while
  // auto is off. rebuildAllTabStates is what actually makes the editor
  // surface recolor — without it, only the chrome (sidebar/tabs/output)
  // would switch and the editor would stay dark.
  function applyAutoThemeFromSystem() {
    if (!editorSettings.auto_theme) return
    const isLight = systemColorScheme() === 'light'
    const changed = document.body.classList.contains('light') !== isLight
    document.body.classList.toggle('light', isLight)
    if (changed) rebuildAllTabStates()
  }

  // Manual theme apply (used when auto_theme is off) — toggles body.light
  // and rebuilds editor states if the theme actually changed.
  function applyManualTheme() {
    const isLight = editorSettings.theme === 'light'
    const changed = document.body.classList.contains('light') !== isLight
    document.body.classList.toggle('light', isLight)
    if (changed) rebuildAllTabStates()
  }

  // Set up the prefers-color-scheme listener. Only active when auto_theme is
  // on; re-evaluated whenever settings change (applySettings re-calls
  // applyChromeSettings, which re-applies the system theme). The listener is
  // idempotent — addEventListener with the same function is a no-op.
  let autoThemeMql = null
  function setupAutoTheme() {
    try {
      if (!window.matchMedia) return
      const mql = window.matchMedia('(prefers-color-scheme: light)')
      // addEventListener is preferred; older Safari uses addListener.
      if (mql.addEventListener) {
        mql.addEventListener('change', applyAutoThemeFromSystem)
      } else if (mql.addListener) {
        mql.addListener(applyAutoThemeFromSystem)
      }
      autoThemeMql = mql
    } catch (e) { /* unavailable — manual theme still works */ }
  }

  // Apply a full settings object: chrome settings plus the editor-affecting
  // ones (tabSize / lineNumbers / wordWrap) by rebuilding every open tab's
  // EditorState (content and selection are preserved).
  function applySettings(settings) {
    editorSettings = { ...editorSettings, ...settings }
    applyChromeSettings()
    rebuildAllTabStates()
    updateChrome()
  }

  // Load persisted settings before creating the editor so tab size, line
  // numbers, word wrap etc. apply immediately. (Defaults if unavailable.)
  try {
    const saved = await invoke("settings_get")
    editorSettings = { ...editorSettings, ...saved }
  } catch (err) {
    // Defaults apply when the backend is unavailable.
  }
  // Set up the prefers-color-scheme listener before applyChromeSettings so
  // the initial theme reflects the OS preference immediately.
  setupAutoTheme()
  applyChromeSettings()

  // Load user keybindings (merged with defaults) before creating the editor
  // so the first EditorState is built with the effective keymap.
  loadKeybindings()

  const view = new EditorView({
    parent: editorEl,
    state: buildState(DEFAULT_DOC, 'kolang', null, null, false),
  })
  viewReady = true

  // Exposed for debugging in DevTools.
  window.kolangView = view

  // -------------------------------------------------------------------------
  // Tabs
  // -------------------------------------------------------------------------

  function makeUntitledTab() {
    return {
      path: null,
      name: 'بدون عنوان',
      content: DEFAULT_DOC,
      language: 'kolang',
      state: null,
      scrollTop: 0,
      directionOverride: null,
      isKeybindings: false,
    }
  }

  function saveActiveState() {
    const tab = activeFile()
    if (!tab) return
    tab.state = view.state
    tab.content = view.state.doc.toString()
    tab.scrollTop = view.scrollDOM.scrollTop
  }

  // Open (or focus) a path in a tab, with pre-read content.
  function openPathInTab(path, content) {
    const existing = openFiles.findIndex((t) => t.path === path)
    if (existing >= 0) {
      switchTab(existing)
      return
    }
    const language = languageFromPath(path)
    openFiles.push({
      path,
      name: basename(path),
      content,
      language,
      state: buildState(content, language, null, null, false),
      scrollTop: 0,
      directionOverride: null,
      isKeybindings: false,
    })
    switchTab(openFiles.length - 1)
  }

  function switchTab(index) {
    if (index < 0 || index >= openFiles.length || index === activeTab) return
    saveActiveState()
    activeTab = index
    const tab = openFiles[index]
    const next = tab.state || buildState(tab.content || '', tab.language, null, tab.directionOverride, tab.isKeybindings)
    view.setState(next)
    view.scrollDOM.scrollTop = tab.scrollTop || 0
    if (tab.language === 'kolang') forceLinting(view)
    view.focus()
    renderTabBar()
    updateChrome()
  }

  function closeTab(index) {
    if (index < 0 || index >= openFiles.length) return
    // Closing the last tab starts over with a fresh untitled document.
    if (openFiles.length === 1) {
      openFiles = [makeUntitledTab()]
      activeTab = 0
      view.setState(openFiles[0].state || buildState(DEFAULT_DOC, 'kolang', null, null, false))
      view.scrollDOM.scrollTop = 0
      renderTabBar()
      updateChrome()
      return
    }
    const wasActive = index === activeTab
    openFiles.splice(index, 1)
    if (wasActive) {
      activeTab = Math.min(index, openFiles.length - 1)
      const tab = openFiles[activeTab]
      view.setState(tab.state || buildState(tab.content || '', tab.language, null, tab.directionOverride, tab.isKeybindings))
      view.scrollDOM.scrollTop = tab.scrollTop || 0
    } else if (index < activeTab) {
      activeTab--
    }
    renderTabBar()
    updateChrome()
  }

  function renderTabBar() {
    tabBarEl.textContent = ''
    openFiles.forEach((tab, i) => {
      const el = document.createElement('div')
      el.className = 'tab' + (i === activeTab ? ' active' : '')
      el.title = tab.path || tab.name
      const label = document.createElement('span')
      label.className = 'tab-label'
      label.textContent = tab.name
      const close = document.createElement('span')
      close.className = 'tab-close'
      close.textContent = '×'
      close.addEventListener('click', (e) => {
        e.stopPropagation()
        closeTab(i)
      })
      el.appendChild(label)
      el.appendChild(close)
      el.addEventListener('click', () => switchTab(i))
      tabBarEl.appendChild(el)
    })
  }

  function updateTitle() {
    const tab = activeFile()
    const name = tab && tab.path ? basename(tab.path) : 'بدون عنوان'
    document.title = `«${name} — کلنگ»`
  }

  function updateChrome() {
    const tab = activeFile()
    updateTitle()
    // Filename is already shown in the tab — don't duplicate it in the status
    // bar. The status bar only shows transient run state (set in setRunning).
    if (!isRunning) {
      statusEl.textContent = 'آماده'
    }
    highlightActiveFile()
    updateDirectionToggle()
  }

  // -------------------------------------------------------------------------
  // Output / run status
  // -------------------------------------------------------------------------

  // Collapsible + resizable output panel. State is persisted in localStorage
  // (kolang-output-collapsed, kolang-output-height) the same way the sidebar
  // visibility is. The panel is a flex column: a 28px header (always visible,
  // clickable to toggle) above the scrollable #output body, which collapses to
  // display:none. A drag handle (#output-resizer) above the panel resizes it.
  const OUTPUT_MIN_H = 60
  function outputMaxH() { return Math.floor(window.innerHeight * 0.7) }

  function applyOutputCollapsed(collapsed) {
    outputPanel.classList.toggle('collapsed', collapsed)
    if (outputToggleIcon) outputToggleIcon.textContent = collapsed ? '▸' : '▾'
    if (collapsed) {
      // Yield to the .collapsed CSS rule (flex: 0 0 28px).
      outputPanel.style.flexBasis = ''
    } else {
      const saved = parseInt(localStorage.getItem('kolang-output-height'), 10)
      outputPanel.style.flexBasis = (saved >= OUTPUT_MIN_H) ? (saved + 'px') : ''
    }
    localStorage.setItem('kolang-output-collapsed', collapsed ? '1' : '0')
  }

  function expandOutput() {
    if (outputPanel.classList.contains('collapsed')) applyOutputCollapsed(false)
  }
  function collapseOutput() { applyOutputCollapsed(true) }
  function toggleOutput() { applyOutputCollapsed(!outputPanel.classList.contains('collapsed')) }

  function appendOutput(text, className) {
    const span = document.createElement('span')
    span.className = className || 'out'
    span.textContent = text
    outputEl.appendChild(span)
    outputEl.scrollTop = outputEl.scrollHeight
  }

  function setRunning(running) {
    isRunning = running
    runBtn.disabled = running
    stopBtn.disabled = !running
    const tab = activeFile()
    statusEl.textContent = running ? 'در حال اجرا...' : (tab && tab.path ? basename(tab.path) : 'آماده')
  }

  // -------------------------------------------------------------------------
  // Run / stop / open / save
  // -------------------------------------------------------------------------

  async function runCode() {
    if (isRunning) return
    // Auto-expand the output panel so the user sees the program's result even
    // if they had collapsed it.
    expandOutput()
    setRunning(true)
    outputEl.textContent = ''
    appendOutput('در حال اجرا...\n', 'muted')

    const code = view.state.doc.toString()
    try {
      const result = await invoke("kolang_run", { code })
      if (result.stdout) appendOutput(result.stdout, 'out')
      if (result.stderr) appendOutput(result.stderr, 'err')
      appendOutput(`— پایان اجرا (کد: ${result.exitCode}، زمان: ${result.durationMs}ms)\n`, 'muted')
    } catch (err) {
      appendOutput('خطا در اجرا: ' + err.message + '\n', 'err')
    } finally {
      setRunning(false)
    }
  }

  function stopCode() {
    invoke("kolang_kill")
  }

  async function openFile() {
    if (dialogBusy) return
    dialogBusy = true
    try {
      const r = await invoke("file_open")
      if (!r) return
      if (r.error) {
        appendOutput('خطا در باز کردن فایل: ' + r.error + '\n', 'err')
        return
      }
      openPathInTab(r.path, r.content)
    } finally {
      dialogBusy = false
    }
  }

  async function saveFile() {
    // The keybindings tab is in-memory only: Mod-s applies the JSON instead
    // of writing to disk.
    const current = activeFile()
    if (current && current.isKeybindings) {
      applyKeybindingsFromJson(view.state.doc.toString(), { showMessage: true })
      return
    }
    if (dialogBusy) return
    dialogBusy = true
    try {
      const tab = activeFile()
      if (!tab) return
      const content = view.state.doc.toString()
      // If the file came from the explorer (or was previously saved), write
      // straight back to that path — no save dialog.
      if (tab.path) {
        const res = await invoke("fs_write_file", { filePath: tab.path, content })
        if (res.error) {
          appendOutput('خطا در ذخیره فایل: ' + res.error + '\n', 'err')
          return
        }
        statusEl.textContent = basename(tab.path)
        refreshExplorer()
        forceLinting(view)
        return
      }
      const p = await invoke("file_save", { content })
      if (!p) return
      if (p.error) {
        appendOutput('خطا در ذخیره فایل: ' + p.error + '\n', 'err')
        return
      }
      tab.path = p.path
      tab.name = basename(p.path)
      updateChrome()
      refreshExplorer()
      forceLinting(view)
    } finally {
      dialogBusy = false
    }
  }

  // -------------------------------------------------------------------------
  // File explorer
  // -------------------------------------------------------------------------

  function highlightActiveFile() {
    explorerEl.querySelectorAll('.tree-item.active').forEach((el) => el.classList.remove('active'))
    const path = activeFilePath()
    if (!path) return
    explorerEl.querySelectorAll('.tree-item').forEach((el) => {
      if (el.dataset.path === path) el.classList.add('active')
    })
  }

  async function openFileFromExplorer(path, item) {
    try {
      const r = await invoke("fs_read_file", { filePath: path })
      if (r.error) {
        appendOutput('خطا در باز کردن فایل: ' + r.error + '\n', 'err')
        return
      }
      openPathInTab(path, r.content)
      if (item) item.classList.add('active')
    } catch (err) {
      appendOutput('خطا در باز کردن فایل: ' + err.message + '\n', 'err')
    }
  }

  function buildFileItem(entry) {
    const row = document.createElement('div')
    row.className = 'tree-item'
    row.dataset.path = entry.path
    const icon = document.createElement('span')
    icon.className = 'tree-icon'
    icon.textContent = '📄'
    const name = document.createElement('span')
    name.textContent = entry.name
    row.appendChild(icon)
    row.appendChild(name)
    row.addEventListener('click', () => openFileFromExplorer(entry.path, row))
    return row
  }

  function buildDirRow(entry) {
    const wrapper = document.createElement('div')
    wrapper.className = 'tree-dir'
    wrapper.dataset.path = entry.path
    const row = document.createElement('div')
    row.className = 'tree-item dir'
    const icon = document.createElement('span')
    icon.className = 'tree-icon'
    icon.textContent = '📁'
    const name = document.createElement('span')
    name.textContent = entry.name
    row.appendChild(icon)
    row.appendChild(name)
    const children = document.createElement('div')
    children.className = 'tree-children'
    children.style.display = 'none'
    wrapper.appendChild(row)
    wrapper.appendChild(children)
    row.addEventListener('click', () => toggleDir(wrapper, row))
    return wrapper
  }

  async function toggleDir(wrapper, row) {
    const childrenEl = wrapper.querySelector('.tree-children')
    const icon = row.querySelector('.tree-icon')
    if (childrenEl.style.display !== 'none') {
      childrenEl.style.display = 'none'
      icon.textContent = '📁'
      return
    }
    if (!childrenEl.dataset.loaded) {
      try {
        const res = await invoke("fs_list_dir", { dirPath: wrapper.dataset.path })
        if (res.error) {
          appendOutput('خطا در خواندن پوشه: ' + res.error + '\n', 'err')
          return
        }
        for (const child of res.entries) {
          childrenEl.appendChild(child.isDir ? buildDirRow(child) : buildFileItem(child))
        }
        childrenEl.dataset.loaded = '1'
        expandedDirs.set(wrapper.dataset.path, true)
      } catch (err) {
        appendOutput('خطا در خواندن پوشه: ' + err.message + '\n', 'err')
        return
      }
    }
    childrenEl.style.display = ''
    icon.textContent = '📂'
  }

  async function renderExplorer(dirPath, container) {
    container.textContent = ''
    try {
      const res = await invoke("fs_list_dir", { dirPath: dirPath })
      if (res.error) {
        const msg = document.createElement('div')
        msg.className = 'muted'
        msg.textContent = 'خطا: ' + res.error
        container.appendChild(msg)
        return
      }
      for (const entry of res.entries) {
        container.appendChild(entry.isDir ? buildDirRow(entry) : buildFileItem(entry))
      }
      highlightActiveFile()
    } catch (err) {
      const msg = document.createElement('div')
      msg.className = 'muted'
      msg.textContent = 'خطا: ' + err.message
      container.appendChild(msg)
    }
  }

  // Re-render the root and re-expand previously expanded folders so newly
  // saved files show up in the tree.
  async function refreshExplorer() {
    if (!explorerRoot) return
    const expanded = [...expandedDirs.keys()]
    expandedDirs.clear()
    await renderExplorer(explorerRoot, explorerEl)
    for (const p of expanded) {
      const wrapper = explorerEl.querySelector('.tree-dir[data-path="' + CSS.escape(p) + '"]')
      if (wrapper) {
        wrapper.querySelector('.tree-children').dataset.loaded = ''
        await toggleDir(wrapper, wrapper.querySelector('.tree-item'))
      }
    }
    highlightActiveFile()
  }

  openFolderBtn.addEventListener('click', async () => {
    try {
      const p = await invoke("fs_open_folder")
      if (p) {
        explorerRoot = p
        expandedDirs.clear()
        await renderExplorer(p, explorerEl)
      }
    } catch (err) {
      appendOutput('خطا در باز کردن پوشه: ' + err.message + '\n', 'err')
    }
  })

  // -------------------------------------------------------------------------
  // Settings modal — live-apply (no Save/Cancel). Each control applies its
  // change immediately via applySettingChange(), which calls applySettings()
  // (rebuilds editor states + chrome) and debounces a settings_set to the
  // backend by 400ms so rapid edits don't spam. Reset restores all defaults.
  // -------------------------------------------------------------------------

  // Default settings — used by resetSettings() and as the source of truth for
  // what "default" means. Must stay in sync with the editorSettings literal.
  const DEFAULT_SETTINGS = {
    kolang_path: '',
    linter_path: '',
    font_size: 14,
    tab_size: 4,
    theme: 'dark',
    auto_theme: true,
    word_wrap: true,
    line_numbers: true,
    auto_save: false,
    auto_format: false,
  }

  // Read all control values into a settings object (clamped/sanitized).
  function collectSettingsFromControls() {
    return {
      kolang_path: kolangPathInput.value.trim(),
      linter_path: linterPathInput.value.trim(),
      font_size: Math.max(8, Math.min(32, parseInt(fontSizeInput.value, 10) || 14)),
      tab_size: Math.max(1, Math.min(16, parseInt(tabSizeInput.value, 10) || 4)),
      theme: themeSelect.value,
      auto_theme: autoThemeCheckbox.checked,
      word_wrap: wordWrapCheckbox.checked,
      line_numbers: lineNumbersCheckbox.checked,
      auto_save: autoSaveCheckbox.checked,
      auto_format: autoFormatCheckbox.checked,
    }
  }

  // Apply the current control values to the editor + chrome immediately, and
  // debounce persistence to the backend. Called by every control's listener.
  function applySettingChange() {
    const settings = collectSettingsFromControls()
    applySettings(settings)
    clearTimeout(settingsPersistTimer)
    settingsPersistTimer = setTimeout(() => {
      invoke("settings_set", { settings }).catch((err) => {
        appendOutput('خطا در ذخیره تنظیمات: ' + (err.message || err) + '\n', 'err')
      })
    }, 400)
  }

  // Reset all controls to defaults, apply, and persist. Shows a brief message.
  function resetSettings() {
    kolangPathInput.value = DEFAULT_SETTINGS.kolang_path
    linterPathInput.value = DEFAULT_SETTINGS.linter_path
    fontSizeInput.value = DEFAULT_SETTINGS.font_size
    tabSizeInput.value = DEFAULT_SETTINGS.tab_size
    themeSelect.value = DEFAULT_SETTINGS.theme
    autoThemeCheckbox.checked = DEFAULT_SETTINGS.auto_theme
    wordWrapCheckbox.checked = DEFAULT_SETTINGS.word_wrap
    lineNumbersCheckbox.checked = DEFAULT_SETTINGS.line_numbers
    autoSaveCheckbox.checked = DEFAULT_SETTINGS.auto_save
    autoFormatCheckbox.checked = DEFAULT_SETTINGS.auto_format
    updateThemeSelectDisabled()
    applySettings({ ...DEFAULT_SETTINGS })
    clearTimeout(settingsPersistTimer)
    settingsPersistTimer = setTimeout(() => {
      invoke("settings_set", { settings: { ...DEFAULT_SETTINGS } }).catch(() => {})
    }, 400)
    appendOutput('تنظیمات به پیش‌فرض بازگردانده شد\n', 'muted')
  }

  // When auto_theme is on, the manual theme-select is disabled (auto overrides
  // it). Re-enable when auto is off.
  function updateThemeSelectDisabled() {
    themeSelect.disabled = autoThemeCheckbox.checked
  }

  async function showSettingsModal() {
    try {
      const settings = await invoke("settings_get")
      kolangPathInput.value = settings.kolang_path || ''
      linterPathInput.value = settings.linter_path || ''
      fontSizeInput.value = settings.font_size || 14
      tabSizeInput.value = settings.tab_size || 4
      themeSelect.value = settings.theme === 'light' ? 'light' : 'dark'
      autoThemeCheckbox.checked = settings.auto_theme !== false
      wordWrapCheckbox.checked = settings.word_wrap !== false
      lineNumbersCheckbox.checked = settings.line_numbers !== false
      autoSaveCheckbox.checked = settings.auto_save === true
      autoFormatCheckbox.checked = settings.auto_format === true
    } catch (err) {
      appendOutput('خطا در خواندن تنظیمات: ' + err.message + '\n', 'err')
    }
    updateThemeSelectDisabled()
    settingsModal.classList.remove('hidden')
    kolangPathInput.focus()
    kolangPathInput.select()
  }

  function hideSettingsModal() {
    settingsModal.classList.add('hidden')
  }

  settingsBtn.addEventListener('click', showSettingsModal)
  settingsResetBtn.addEventListener('click', resetSettings)

  // Browse buttons pick a path then trigger live-apply so it takes effect
  // immediately (no Save needed).
  browseBtn.addEventListener('click', async () => {
    try {
      const p = await invoke("settings_pick_path")
      if (p) {
        kolangPathInput.value = p
        applySettingChange()
      }
    } catch (err) {
      appendOutput('خطا در انتخاب مسیر: ' + err.message + '\n', 'err')
    }
  })

  browseLinterBtn.addEventListener('click', async () => {
    try {
      const p = await invoke("settings_pick_linter_path")
      if (p) {
        linterPathInput.value = p
        applySettingChange()
      }
    } catch (err) {
      appendOutput('خطا در انتخاب مسیر لینتر: ' + err.message + '\n', 'err')
    }
  })

  // Live-apply listeners. Path inputs use `input` (fires on every keystroke);
  // number inputs use `input` (fires on type + spinner drag); checkboxes and
  // the theme select use `change`. auto_theme also re-toggles the
  // theme-select disabled state.
  kolangPathInput.addEventListener('input', applySettingChange)
  linterPathInput.addEventListener('input', applySettingChange)
  fontSizeInput.addEventListener('input', applySettingChange)
  tabSizeInput.addEventListener('input', applySettingChange)
  themeSelect.addEventListener('change', applySettingChange)
  autoThemeCheckbox.addEventListener('change', () => {
    updateThemeSelectDisabled()
    applySettingChange()
  })
  wordWrapCheckbox.addEventListener('change', applySettingChange)
  lineNumbersCheckbox.addEventListener('change', applySettingChange)
  autoSaveCheckbox.addEventListener('change', applySettingChange)
  autoFormatCheckbox.addEventListener('change', applySettingChange)

  // Clicking the backdrop closes the modal.
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) hideSettingsModal()
  })

  // -------------------------------------------------------------------------
  // Shortcuts modal
  // -------------------------------------------------------------------------

  // Persian labels for the configurable commands, shown in the shortcuts list.
  const COMMAND_LABELS = {
    saveFile: 'ذخیره فایل',
    openFile: 'باز کردن فایل',
    runCode: 'اجرای برنامه',
    toggleComment: 'نظر (کامنت) خط',
    indentMore: 'افزایش تورفتگی',
    indentLess: 'کاهش تورفتگی',
    moveLineUp: 'جابه‌جایی خط به بالا',
    moveLineDown: 'جابه‌جایی خط به پایین',
    addCursorAbove: 'افزودن مکان‌نمای بالاتر',
    addCursorBelow: 'افزودن مکان‌نمای پایین‌تر',
    selectNextOccurrence: 'انتخاب تکرار بعدی',
  }

  // Pretty-print a CM6 key string for display: "Mod-s" → "Ctrl/Cmd+S",
  // "Alt-ArrowUp" → "Alt+↑", "F5" → "F5".
  function formatKey(keyStr) {
    return String(keyStr)
      .replace(/^Mod-/, 'Ctrl/Cmd+')
      .replace(/-Mod-/, '+Ctrl/Cmd+')
      .replace(/ArrowUp/g, '↑')
      .replace(/ArrowDown/g, '↓')
      .replace(/-/g, '+')
      .replace(/\b([a-z])$/, (m) => m.toUpperCase())
  }

  // Render the shortcuts table from the effective keybindings (grouped by
  // command so multiple keys for the same action — e.g. runCode has both
  // Mod-Enter and F5 — appear on one row). Only the app-level configurable
  // shortcuts are shown; built-in CM6 keymaps (undo, search, fold, …) are
  // deliberately omitted to keep the list clean.
  function renderShortcutsTable() {
    const list = document.getElementById('shortcuts-list')
    if (!list) return
    const byCommand = new Map()
    for (const b of effectiveKeybindings) {
      if (!byCommand.has(b.command)) byCommand.set(b.command, [])
      byCommand.get(b.command).push(b.key)
    }
    let html = '<table class="shortcuts-table">'
    for (const [command, keys] of byCommand) {
      const label = COMMAND_LABELS[command] || command
      const keysHtml = keys.map((k) => `<kbd>${formatKey(k)}</kbd>`).join(' یا ')
      html += `<tr><td>${label}</td><td>${keysHtml}</td></tr>`
    }
    html += '</table>'
    list.innerHTML = html
  }

  function showShortcutsModal() {
    renderShortcutsTable()
    shortcutsModal.classList.remove('hidden')
  }

  function hideShortcutsModal() {
    shortcutsModal.classList.add('hidden')
  }

  shortcutsBtn.addEventListener('click', showShortcutsModal)
  shortcutsCloseBtn.addEventListener('click', hideShortcutsModal)
  if (shortcutsEditJsonBtn) shortcutsEditJsonBtn.addEventListener('click', openKeybindingsTab)

  // Clicking the backdrop closes the modal.
  shortcutsModal.addEventListener('click', (e) => {
    if (e.target === shortcutsModal) hideShortcutsModal()
  })

  // Escape closes either modal (without stealing the editor's Escape behavior
  // while both modals are closed).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    if (!settingsModal.classList.contains('hidden')) hideSettingsModal()
    if (!shortcutsModal.classList.contains('hidden')) hideShortcutsModal()
  })

  // -------------------------------------------------------------------------
  // Wiring: toolbar buttons, language selector, keyboard shortcuts
  // -------------------------------------------------------------------------

  runBtn.addEventListener('click', runCode)
  stopBtn.addEventListener('click', stopCode)
  openBtn.addEventListener('click', openFile)
  saveBtn.addEventListener('click', saveFile)

  // Sidebar toggle — the sidebar's own chevron (and the collapsed header
  // strip around it) toggle collapse. The toolbar button was removed; the
  // chevron IS the collapse control. The chevron stops propagation so its
  // click doesn't double-toggle through the header handler.
  if (sidebarChevron) {
    sidebarChevron.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleSidebar()
    })
  }
  if (sidebarHeaderEl) {
    sidebarHeaderEl.addEventListener('click', () => {
      // Only the collapsed strip (bare area) acts as a toggle; in expanded
      // mode the header hosts action buttons we don't want to trigger.
      if (sidebarEl.classList.contains('collapsed')) toggleSidebar()
    })
  }

  // Output panel collapse/expand — the whole header is clickable; the button
  // inside is just the icon + tooltip and its click bubbles to the header, so
  // we only wire the header (wiring both would double-toggle and cancel out).
  outputHeader.addEventListener('click', toggleOutput)

  // Draggable resize handle between editor and output. mousedown on the handle
  // → mousemove updates the panel's flex-basis (height) → mouseup releases.
  // Dragging UP grows the output panel (it sits below the editor). Dragging
  // when collapsed first expands the panel so there is something to resize.
  outputResizer.addEventListener('mousedown', (e) => {
    e.preventDefault()
    if (outputPanel.classList.contains('collapsed')) applyOutputCollapsed(false)
    const startY = e.clientY
    const startH = outputPanel.getBoundingClientRect().height
    const maxH = outputMaxH()
    const onMove = (ev) => {
      let h = startH - (ev.clientY - startY)
      h = Math.max(OUTPUT_MIN_H, Math.min(h, maxH))
      outputPanel.style.flexBasis = h + 'px'
      localStorage.setItem('kolang-output-height', String(h))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })

  // -------------------------------------------------------------------------
  // Sidebar collapse/expand — mirrors the output-panel pattern: a thin strip
  // (the header with just a chevron) stays visible when collapsed so the user
  // can click to re-expand. State persists in localStorage
  // 'kolang-sidebar-collapsed' (migrated from the old 'kolang-sidebar-hidden').
  // -------------------------------------------------------------------------

  function applySidebarCollapsed(collapsed) {
    sidebarEl.classList.toggle('collapsed', collapsed)
    if (sidebarChevron) sidebarChevron.textContent = collapsed ? '▸' : '▾'
    localStorage.setItem('kolang-sidebar-collapsed', collapsed ? '1' : '0')
  }

  function toggleSidebar() {
    applySidebarCollapsed(!sidebarEl.classList.contains('collapsed'))
  }

  // Manual LTR/RTL toggle for the active tab. Flips the per-tab direction
  // override (persisted in memory only, for this session) and rebuilds the
  // state preserving content + selection. The button label reflects the
  // effective direction.
  directionToggleBtn.addEventListener('click', () => {
    const tab = activeFile()
    if (!tab) return
    const next = effectiveDirection(tab) === 'rtl' ? 'ltr' : 'rtl'
    tab.directionOverride = next
    const sel = view.state.selection
    const docText = view.state.doc.toString()
    tab.state = buildState(docText, tab.language, sel, tab.directionOverride, tab.isKeybindings)
    tab.scrollTop = view.scrollDOM.scrollTop
    view.setState(tab.state)
    view.scrollDOM.scrollTop = tab.scrollTop || 0
    view.focus()
    updateDirectionToggle()
  })

  // Window-level keyboard shortcuts. When the editor is focused, the editor
  // keymap handles the app bindings and calls preventDefault, so these don't
  // fire again here (the handler bails on defaultPrevented). When focus is
  // elsewhere, we match against the effective keybindings JSON. Settings
  // (Mod-,) stays hardcoded — it isn't part of the configurable JSON set.
  const windowCommandHandlers = {
    runCode,
    saveFile,
    openFile,
  }

  // Match a KeyboardEvent against a CM6 key string ("Mod-s", "F5",
  // "Mod-Alt-ArrowUp", …). Mod = meta OR ctrl (platform-generic).
  function eventMatchesBinding(e, keyStr) {
    const parts = String(keyStr).split('-')
    const last = parts[parts.length - 1]
    const mods = parts.slice(0, -1)
    const needMod = mods.includes('Mod')
    const needAlt = mods.includes('Alt')
    const needShift = mods.includes('Shift')
    const hasMod = e.metaKey || e.ctrlKey
    if (needMod && !hasMod) return false
    if (!needMod && hasMod) return false
    if (needAlt !== e.altKey) return false
    if (needShift !== e.shiftKey) return false
    if (last.length === 1) return e.key.toLowerCase() === last.toLowerCase()
    return e.key === last
  }

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return
    const mod = e.metaKey || e.ctrlKey
    // Settings: Mod-, (hardcoded — not in the configurable JSON).
    if (mod && e.key === ',') {
      e.preventDefault()
      showSettingsModal()
      return
    }
    // App commands (runCode / saveFile / openFile) from the effective JSON.
    for (const b of effectiveKeybindings) {
      if (!windowCommandHandlers[b.command]) continue
      if (!eventMatchesBinding(e, b.key)) continue
      e.preventDefault()
      windowCommandHandlers[b.command]()
      return
    }
  })

  // Initial state: one untitled Kolang tab.
  openFiles = [makeUntitledTab()]
  activeTab = 0

  // Restore the sidebar collapse state saved from a previous session.
  // Migrate from the old 'kolang-sidebar-hidden' key: if the new key isn't
  // set but the old one is '1', treat as collapsed.
  {
    let collapsed = localStorage.getItem('kolang-sidebar-collapsed') === '1'
    if (localStorage.getItem('kolang-sidebar-collapsed') === null &&
        localStorage.getItem('kolang-sidebar-hidden') === '1') {
      collapsed = true
    }
    applySidebarCollapsed(collapsed)
  }

  // Restore the output panel's collapse state (and, when expanded, the saved
  // drag height). applyOutputCollapsed handles both branches.
  applyOutputCollapsed(localStorage.getItem('kolang-output-collapsed') === '1')

  renderTabBar()
  updateChrome()
})