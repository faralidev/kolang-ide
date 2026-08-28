// kolang-extras.js — IDE-specific CodeMirror 6 glue for Kolang.
//
// استخراج‌شده از kolang-language.js قدیمی. گرامر زبان (kolang())، تم و
// برجسته‌سازی (تیره/روشن) و تکمیل خودکار + hover همگی اکنون از @kolang/grammar
// می‌آیند (منبع حقیقت مشترک). این فایل فقط مستندات (kolang-docs، باندل‌شده
// توسط build.cjs) را به ماژول‌های مشترک تزریق می‌کند و سه wrapper نازک نگه
// می‌دارد تا renderer.js تغییر نکند.

import kolangDocs from 'kolang-docs'
import { themeExtensions } from '@kolang/grammar/codemirror/kolang-theme.js'
import { kolangCompletion as grammarCompletion, kolangHover as grammarHover } from '@kolang/grammar/codemirror/kolang-editor.js'

// Docs for hover/autocomplete. Bundled at build time from kolang-data
// (see build.cjs alias 'kolang-docs'); also exposed globally for debugging.
globalThis.KOLANG_DOCS = kolangDocs

function kolangTheme(light) {
  return themeExtensions(light)
}

function kolangCompletion() {
  return grammarCompletion(kolangDocs)
}

function kolangHover() {
  return grammarHover(kolangDocs)
}

export { kolangTheme, kolangCompletion, kolangHover }
