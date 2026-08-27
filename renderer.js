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

document.addEventListener('DOMContentLoaded', () => {
  const editorEl = document.getElementById('editor')
  const tabBarEl = document.getElementById('tab-bar')
  const langSelect = document.getElementById('language-select')
  const runBtn = document.getElementById('run-btn')
  const stopBtn = document.getElementById('stop-btn')
  const openBtn = document.getElementById('open-btn')
  const saveBtn = document.getElementById('save-btn')
  const outputEl = document.getElementById('output')
  const statusEl = document.getElementById('status')
  const settingsBtn = document.getElementById('settings-btn')
  const settingsModal = document.getElementById('settings-modal')
  const kolangPathInput = document.getElementById('kolang-path-input')
  const browseBtn = document.getElementById('browse-btn')
  const linterPathInput = document.getElementById('linter-path-input')
  const browseLinterBtn = document.getElementById('browse-linter-btn')
  const settingsSaveBtn = document.getElementById('settings-save')
  const settingsCancelBtn = document.getElementById('settings-cancel')
  const explorerEl = document.getElementById('explorer')
  const openFolderBtn = document.getElementById('open-folder-btn')
  const shortcutsBtn = document.getElementById('shortcuts-btn')
  const shortcutsModal = document.getElementById('shortcuts-modal')
  const shortcutsCloseBtn = document.getElementById('shortcuts-close')

  let isRunning = false
  let dialogBusy = false
  let explorerRoot = null
  const expandedDirs = new Map() // expanded directory path → true (cache)

  // Open files (tabs). Each tab keeps its own immutable EditorState so
  // content, selection and language survive tab switches.
  let openFiles = []
  let activeTab = -1

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
  const kolangLinter = linter(async (view) => {
    const code = view.state.doc.toString()
    try {
      const diags = await invoke("linter_run", { code })
      if (!Array.isArray(diags)) return []
      return diags
        .filter((d) => d.line >= 1 && d.line <= view.state.doc.lines)
        .map((d) => {
          const from = linterPos(view, d.line, d.col)
          const to = linterPos(view, d.endLine ?? d.line, d.endCol ?? d.col)
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

  function buildState(doc, language, selection) {
    const lang = Object.prototype.hasOwnProperty.call(LANG_EXTENSIONS, language) ? language : 'kolang'
    return EditorState.create({
      doc,
      ...(selection ? { selection } : {}),
      extensions: [
        lineNumbers({ formatNumber: (n) => toPersianDigits(String(n)) }),
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
        EditorView.lineWrapping,
        ...kolangTheme(),
      ],
    })
  }

  function editorKeymap() {
    return [
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      ...closeBracketsKeymap,
      ...foldKeymap,
      ...lintKeymap,
      // App-level shortcuts. Also wired at window level for when the editor
      // isn't focused; when handled here CM6 calls preventDefault so the
      // window handler (which bails on defaultPrevented) won't double-fire.
      { key: 'Mod-s', run: () => { saveFile(); return true } },
      { key: 'Mod-o', run: () => { openFile(); return true } },
      { key: 'Mod-Enter', run: () => { runCode(); return true } },
      { key: 'F5', run: () => { runCode(); return true } },
      // VS Code-style editing shortcuts.
      { key: 'Mod-/', run: toggleComment },
      { key: 'Mod-]', run: indentMore },
      { key: 'Mod-[', run: indentLess },
      { key: 'Alt-ArrowUp', run: moveLineUp },
      { key: 'Alt-ArrowDown', run: moveLineDown },
      // Multicursor: Mod-Alt+Up/Down adds a cursor above/below;
      // Mod-d selects the next occurrence (Mod-Shift-l in searchKeymap
      // selects all occurrences; Mod-Click adds a cursor, CM6 default).
      { key: 'Mod-Alt-ArrowUp', run: addCursorAbove },
      { key: 'Mod-Alt-ArrowDown', run: addCursorBelow },
      { key: 'Mod-d', run: selectNextOccurrence },
      indentWithTab,
    ]
  }

  const view = new EditorView({
    parent: editorEl,
    state: buildState(DEFAULT_DOC, 'kolang'),
  })

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
      state: buildState(content, language),
      scrollTop: 0,
    })
    switchTab(openFiles.length - 1)
  }

  function switchTab(index) {
    if (index < 0 || index >= openFiles.length || index === activeTab) return
    saveActiveState()
    activeTab = index
    const tab = openFiles[index]
    const next = tab.state || buildState(tab.content || '', tab.language)
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
      view.setState(openFiles[0].state || buildState(DEFAULT_DOC, 'kolang'))
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
      view.setState(tab.state || buildState(tab.content || '', tab.language))
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
    langSelect.value = tab ? tab.language : 'kolang'
    updateTitle()
    if (!isRunning) {
      statusEl.textContent = tab && tab.path ? basename(tab.path) : 'آماده'
    }
    highlightActiveFile()
  }

  // -------------------------------------------------------------------------
  // Output / run status
  // -------------------------------------------------------------------------

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
  // Settings modal
  // -------------------------------------------------------------------------

  async function showSettingsModal() {
    try {
      const settings = await invoke("settings_get")
      kolangPathInput.value = settings.kolangPath || ''
      linterPathInput.value = settings.linterPath || ''
    } catch (err) {
      appendOutput('خطا در خواندن تنظیمات: ' + err.message + '\n', 'err')
    }
    settingsModal.classList.remove('hidden')
    kolangPathInput.focus()
    kolangPathInput.select()
  }

  function hideSettingsModal() {
    settingsModal.classList.add('hidden')
  }

  settingsBtn.addEventListener('click', showSettingsModal)

  browseBtn.addEventListener('click', async () => {
    try {
      const p = await invoke("settings_pick_path")
      if (p) kolangPathInput.value = p
    } catch (err) {
      appendOutput('خطا در انتخاب مسیر: ' + err.message + '\n', 'err')
    }
  })

  browseLinterBtn.addEventListener('click', async () => {
    try {
      const p = await invoke("settings_pick_linter_path")
      if (p) linterPathInput.value = p
    } catch (err) {
      appendOutput('خطا در انتخاب مسیر لینتر: ' + err.message + '\n', 'err')
    }
  })

  settingsSaveBtn.addEventListener('click', async () => {
    try {
      await invoke("settings_set", { settings: {
        kolangPath: kolangPathInput.value.trim(),
        linterPath: linterPathInput.value.trim(),
      } })
      hideSettingsModal()
      appendOutput('تنظیمات ذخیره شد\n', 'muted')
    } catch (err) {
      appendOutput('خطا در ذخیره تنظیمات: ' + err.message + '\n', 'err')
    }
  })

  settingsCancelBtn.addEventListener('click', hideSettingsModal)

  // Clicking the backdrop closes the modal.
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) hideSettingsModal()
  })

  // -------------------------------------------------------------------------
  // Shortcuts modal
  // -------------------------------------------------------------------------

  function showShortcutsModal() {
    shortcutsModal.classList.remove('hidden')
  }

  function hideShortcutsModal() {
    shortcutsModal.classList.add('hidden')
  }

  shortcutsBtn.addEventListener('click', showShortcutsModal)
  shortcutsCloseBtn.addEventListener('click', hideShortcutsModal)

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

  // Manual language switch for the active tab — rebuilds its state with the
  // chosen language extensions (selection is preserved).
  langSelect.addEventListener('change', () => {
    const tab = activeFile()
    if (!tab) return
    const language = langSelect.value
    if (language === tab.language) return
    const doc = view.state.doc.toString()
    const selection = view.state.selection
    tab.content = doc
    tab.language = language
    tab.state = buildState(doc, language, selection)
    tab.scrollTop = view.scrollDOM.scrollTop
    view.setState(tab.state)
    if (language === 'kolang') forceLinting(view)
    view.focus()
    updateChrome()
  })

  // Window-level keyboard shortcuts. When the editor is focused, the editor
  // keymap handles Mod-s / Mod-o / Mod-Enter / F5 and calls preventDefault,
  // so these don't fire again here. When focus is elsewhere, we handle them.
  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return
    if (e.key === 'F5') {
      e.preventDefault()
      runCode()
      return
    }
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    if (e.key === 'Enter') {
      e.preventDefault()
      runCode()
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault()
      saveFile()
    } else if (e.key === 'o' || e.key === 'O') {
      e.preventDefault()
      openFile()
    } else if (e.key === ',') {
      e.preventDefault()
      showSettingsModal()
    }
  })

  // Initial state: one untitled Kolang tab.
  openFiles = [makeUntitledTab()]
  activeTab = 0
  renderTabBar()
  updateChrome()
})