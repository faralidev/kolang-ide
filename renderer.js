// renderer.js — kolang-ide renderer (ES module source).
//
// Bundled by esbuild into bundle.js (classic script loaded by index.html);
// this file is never loaded directly by the page. Mounts the CodeMirror 6
// editor with the kolang language module, wires toolbar buttons + menu events
// to window.kolangIDE, and renders program output.

import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab, addCursorAbove, addCursorBelow } from '@codemirror/commands'
import { bracketMatching, codeFolding, foldGutter, foldKeymap, foldService, indentOnInput } from '@codemirror/language'
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { searchKeymap, highlightSelectionMatches, selectNextOccurrence } from '@codemirror/search'
import { linter, lintGutter, lintKeymap, forceLinting } from '@codemirror/lint'
import { kolang, kolangCompletion, kolangTheme } from './kolang-language.js'

document.addEventListener('DOMContentLoaded', () => {
  const editorEl = document.getElementById('editor')
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

  let currentFilePath = null
  let isRunning = false
  let dialogBusy = false
  let explorerRoot = null
  const expandedDirs = new Map() // expanded directory path → true (cache)

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
      const diags = await window.kolangIDE.runLinter(code)
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

  const view = new EditorView({
    parent: editorEl,
    state: EditorState.create({
      doc: DEFAULT_DOC,
      extensions: [
        lineNumbers({ formatNumber: (n) => toPersianDigits(String(n)) }),
        foldGutter(),
        codeFolding(),
        kolangFoldService,
        kolangLinter,
        lintGutter(),
        history(),
        bracketMatching(),
        closeBrackets(),
        // Auto-pair the asymmetric Persian guillemets: « inserts «» with the
        // cursor between; » skips over an already-typed closing mark.
        EditorView.inputHandler.of((view, from, to, text) => {
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
        }),
        kolangCompletion(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSelectionMatches(),
        indentOnInput(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap,
          ...closeBracketsKeymap,
          ...foldKeymap,
          ...lintKeymap,
          // Multicursor: Mod-Alt+Up/Down adds a cursor above/below;
          // Mod-d selects the next occurrence (Mod-Shift-l in searchKeymap
          // selects all occurrences; Mod-Click adds a cursor, CM6 default).
          { key: 'Mod-Alt-ArrowUp', run: addCursorAbove },
          { key: 'Mod-Alt-ArrowDown', run: addCursorBelow },
          { key: 'Mod-d', run: selectNextOccurrence },
          indentWithTab,
        ]),
        kolang(),
        ...kolangTheme(),
        EditorView.lineWrapping,
      ],
    }),
  })

  // Exposed for debugging in DevTools.
  window.kolangView = view

  function basename(p) {
    return String(p).split(/[\\/]/).pop()
  }

  function updateTitle() {
    const name = currentFilePath ? basename(currentFilePath) : 'بدون عنوان'
    document.title = `«${name} — کلنگ»`
  }

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
    statusEl.textContent = running ? 'در حال اجرا...' : (currentFilePath ? basename(currentFilePath) : 'آماده')
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
      const result = await window.kolangIDE.run(code)
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
    window.kolangIDE.kill()
  }

  async function openFile() {
    if (dialogBusy) return
    dialogBusy = true
    try {
      const r = await window.kolangIDE.openFile()
      if (!r) return
      if (r.error) {
        appendOutput('خطا در باز کردن فایل: ' + r.error + '\n', 'err')
        return
      }
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: r.content } })
      currentFilePath = r.path
      updateTitle()
      statusEl.textContent = basename(r.path)
      highlightActiveFile()
      forceLinting(view)
    } finally {
      dialogBusy = false
    }
  }

  async function saveFile() {
    if (dialogBusy) return
    dialogBusy = true
    try {
      const content = view.state.doc.toString()
      // If the file came from the explorer (or was previously saved), write
      // straight back to that path — no save dialog.
      if (currentFilePath) {
        const res = await window.kolangIDE.writeFile({ filePath: currentFilePath, content })
        if (res && res.error) {
          appendOutput('خطا در ذخیره فایل: ' + res.error + '\n', 'err')
          return
        }
        statusEl.textContent = basename(currentFilePath)
        refreshExplorer()
        forceLinting(view)
        return
      }
      const p = await window.kolangIDE.saveFile(content)
      if (!p) return
      if (p.error) {
        appendOutput('خطا در ذخیره فایل: ' + p.error + '\n', 'err')
        return
      }
      currentFilePath = p.path
      updateTitle()
      statusEl.textContent = basename(p.path)
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
    if (!currentFilePath) return
    explorerEl.querySelectorAll('.tree-item').forEach((el) => {
      if (el.dataset.path === currentFilePath) el.classList.add('active')
    })
  }

  async function openFileFromExplorer(path, item) {
    try {
      const r = await window.kolangIDE.readFile(path)
      if (r && r.error) {
        appendOutput('خطا در باز کردن فایل: ' + r.error + '\n', 'err')
        return
      }
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: r } })
      currentFilePath = path
      updateTitle()
      statusEl.textContent = basename(path)
      highlightActiveFile()
      if (item) item.classList.add('active')
      forceLinting(view)
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
        const res = await window.kolangIDE.listDir(wrapper.dataset.path)
        if (res && res.error) {
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
      const res = await window.kolangIDE.listDir(dirPath)
      if (res && res.error) {
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
      const p = await window.kolangIDE.openFolder()
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
      const settings = await window.kolangIDE.getSettings()
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
      const p = await window.kolangIDE.pickKolangPath()
      if (p) kolangPathInput.value = p
    } catch (err) {
      appendOutput('خطا در انتخاب مسیر: ' + err.message + '\n', 'err')
    }
  })

  browseLinterBtn.addEventListener('click', async () => {
    try {
      const p = await window.kolangIDE.pickLinterPath()
      if (p) linterPathInput.value = p
    } catch (err) {
      appendOutput('خطا در انتخاب مسیر لینتر: ' + err.message + '\n', 'err')
    }
  })

  settingsSaveBtn.addEventListener('click', async () => {
    try {
      await window.kolangIDE.setSettings({
        kolangPath: kolangPathInput.value.trim(),
        linterPath: linterPathInput.value.trim(),
      })
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
  // Wiring: toolbar buttons, menu events, keyboard shortcuts
  // -------------------------------------------------------------------------

  runBtn.addEventListener('click', runCode)
  stopBtn.addEventListener('click', stopCode)
  openBtn.addEventListener('click', openFile)
  saveBtn.addEventListener('click', saveFile)

  window.kolangIDE.onMenuRun(() => runCode())
  window.kolangIDE.onMenuStop(() => stopCode())
  window.kolangIDE.onMenuOpen(() => openFile())
  window.kolangIDE.onMenuSave(() => saveFile())
  window.kolangIDE.onMenuSettings(() => showSettingsModal())

  // Window-level keyboard shortcuts. Cmd/Ctrl+Enter → run; Cmd/Ctrl+S → save;
  // Cmd/Ctrl+O → open; Cmd/Ctrl+, → settings. (Menu accelerators also fire
  // these — dialogBusy / isRunning guards prevent double execution.)
  window.addEventListener('keydown', (e) => {
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

  updateTitle()
})