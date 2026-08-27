// kolang-extras.js — IDE-specific CodeMirror 6 theme + completion for Kolang.
//
// استخراج‌شده از kolang-language.js قدیمی. گرامر زبان (kolang()) اکنون در
// @kolang/grammar است؛ این فایل فقط تم Catppuccin Mocha و تکمیل خودکار
// (کلیدواژه‌ها، توابع builtin، قطعه‌کدها) را ارائه می‌دهد — موارد ویرایشگر-خصوصی.

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { autocompletion, snippetCompletion } from '@codemirror/autocomplete'
import { EditorView, hoverTooltip } from '@codemirror/view'
import kolangDocs from 'kolang-docs'

// Docs for hover/autocomplete. Bundled at build time from kolang-data
// (see build.cjs alias 'kolang-docs'); also exposed globally for debugging.
globalThis.KOLANG_DOCS = kolangDocs

const COMPLETION_RE = /[\u0621-\u064A\u0670-\u06FFA-Za-z0-9_\u200C]*/
const VALID_FOR_RE = /^[\u0621-\u064A\u0670-\u06FFA-Za-z0-9_\u200C]*$/
const HOVER_CHAR = /[\u0621-\u064A\u0670-\u06FFA-Za-z0-9_\u200C]/

// ---------------------------------------------------------------------------
// Documentation lookup — normalized from kolang-docs.json.
//
// The JSON uses arrays of [name, description] pairs per section:
// { keywords: [...], builtins: [...], verbs: [...], types: [...],
//   modules: [...], exceptions: [...], literals: [...] }
// ---------------------------------------------------------------------------

const DOC_KIND_LABELS = {
  keyword: 'کلیدواژه',
  builtin: 'تابع آماده',
  verb: 'فعل',
  type: 'نوع',
  module: 'ماژول',
  exception: 'خطا',
  literal: 'مقدار ثابت',
}

function buildDocMap(docs) {
  const map = new Map()
  const sections = [
    ['keywords', 'keyword'],
    ['builtins', 'builtin'],
    ['verbs', 'verb'],
    ['types', 'type'],
    ['modules', 'module'],
    ['exceptions', 'exception'],
    ['literals', 'literal'],
  ]
  for (const [key, kind] of sections) {
    const entries = docs && docs[key]
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (Array.isArray(entry) && entry.length >= 2) {
        map.set(entry[0], { kind, desc: entry[1] })
      }
    }
  }
  return map
}

const DOC_MAP = buildDocMap(kolangDocs)

/// شرح مستندات برای یک نام (برای تکمیل خودکار). اگر در docs نبود،
/// شرح کوتاه پیش‌فرض به کار می‌رود.
function docDetail(name, fallback) {
  const entry = DOC_MAP.get(name)
  return entry ? entry.desc : fallback
}

const kolangEditorTheme = EditorView.theme({
  '&': {
    height: '100%', // editor fills its container so .cm-scroller can scroll
    backgroundColor: '#1e1e2e',
    color: '#cdd6f4',
    direction: 'ltr', // keep layout/scrollbar sane
  },
  '.cm-scroller': {
    overflow: 'auto',
    scrollbarWidth: 'thin', // Firefox
    scrollbarColor: '#45475a #181825', // Firefox
  },
  '.cm-scroller::-webkit-scrollbar': { width: '10px', height: '10px' },
  '.cm-scroller::-webkit-scrollbar-track': { background: '#181825' },
  '.cm-scroller::-webkit-scrollbar-thumb': { background: '#45475a', borderRadius: '5px' },
  '.cm-scroller::-webkit-scrollbar-thumb:hover': { background: '#585b70' },
  '.cm-content': {
    caretColor: '#f5e0dc',
    direction: 'rtl',
    unicodeBidi: 'isolate',
    textAlign: 'right',
    fontFamily: "'Vazirmatn', 'Iranian Sans', 'Sahel', monospace",
  },
  '.cm-line': {
    direction: 'rtl',
    unicodeBidi: 'isolate',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#f5e0dc' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: '#585b7080',
  },
  '.cm-gutters': {
    backgroundColor: '#181825',
    color: '#7f849c',
    border: 'none',
    // Gutter sits on the RIGHT for RTL: it is a flex child of .cm-scroller
    // (which is display:flex, row), so `order` moves it after the content.
    order: 2,
    // The gutter is position:sticky (set by CM6). Override the default
    // sticky `insetInlineStart: 0` so it pins to the right edge instead.
    right: 0,
    left: 'auto',
    // Separator between code (left) and line numbers (right).
    borderLeft: '1px solid #313244',
  },
  // Autocomplete tooltip: dark surface + RTL text for the Persian popup.
  '& .cm-tooltip': {
    backgroundColor: '#313244',
    border: '1px solid #45475a',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    fontFamily: "'Vazirmatn', 'Iranian Sans', monospace",
    fontSize: '13px',
  },
  '& .cm-tooltip-autocomplete': {
    direction: 'rtl',
    textAlign: 'right',
    '& > ul > li': {
      padding: '4px 10px',
      display: 'flex',
      alignItems: 'baseline',
      gap: '10px', // space between label and detail
    },
    '& > ul > li[aria-selected]': {
      backgroundColor: '#45475a',
      color: '#cdd6f4',
    },
    // Label (the completion name)
    '& .cm-completionLabel': {
      color: '#cdd6f4',
      fontWeight: '500',
      fontFamily: "'Vazirmatn', monospace",
    },
    // Detail (the Persian description) — muted, separated, truncated so long
    // doc descriptions don't blow up the popup width.
    '& .cm-completionDetail': {
      color: '#7f849c',
      fontSize: '12px',
      fontStyle: 'italic',
      paddingRight: '6px',
      borderRight: '1px solid #45475a', // visual separator
      marginRight: '2px',
      maxWidth: '24em',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    // Completion icon
    '& .cm-completionIcon': {
      color: '#cba6f7',
      marginRight: '4px',
    },
    // Type info if present
    '& .cm-completionType': {
      color: '#94e2d5',
      fontSize: '11px',
    },
  },
  // Lint gutter markers (dark theme) — override the default light-mode SVGs
  '.cm-lint-marker-error': {
    content: "url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><circle cx=\"20\" cy=\"20\" r=\"15\" fill=\"%23ff5c5c\" stroke=\"%23ff1f1f\" stroke-width=\"6\"/></svg>')",
  },
  '.cm-lint-marker-warning': {
    content: "url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path fill=\"%23ffd066\" stroke=\"%23ffb300\" stroke-width=\"6\" stroke-linejoin=\"round\" d=\"M20 6L37 35L3 35Z\"/></svg>')",
  },
  '.cm-lint-marker-info': {
    content: "url('data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\"><path fill=\"%2366b8ff\" stroke=\"%233d9bff\" stroke-width=\"6\" stroke-linejoin=\"round\" d=\"M5 5L35 5L35 35L5 35Z\"/></svg>')",
  },
  // In-content underlines (dark)
  '.cm-lintRange-error': { borderBottom: '2px dotted #ff5c5c' },
  '.cm-lintRange-warning': { borderBottom: '2px dotted #ffb300' },
  '.cm-lintRange-info': { borderBottom: '2px dotted #66b8ff' },
  '.cm-lintRange-active': { backgroundColor: '#ffb30033' },
  // Diagnostic tooltip
  '.cm-tooltip-lint': {
    backgroundColor: '#1e1f22',
    color: '#d7dae0',
    border: '1px solid #3c3f45',
    borderRadius: '6px',
    direction: 'rtl',
    textAlign: 'right',
    fontFamily: "'Vazirmatn', monospace",
    fontSize: '12px',
  },
  '.cm-diagnosticText': { fontSize: '12px', lineHeight: '1.4' },
  '.cm-diagnosticSource': { color: '#888c93', fontStyle: 'italic' },
  '.cm-diagnostic-error': { color: '#ff5c5c' },
  '.cm-diagnostic-warning': { color: '#ffb300' },
  '.cm-diagnostic-info': { color: '#66b8ff' },
  // Hover documentation tooltip
  '.cm-kolang-hover': {
    direction: 'rtl',
    textAlign: 'right',
    maxWidth: '32em',
    padding: '6px 12px',
    fontSize: '12px',
    lineHeight: '1.7',
    fontFamily: "'Vazirmatn', monospace",
  },
  '.cm-kolang-hover-kind': {
    color: '#cba6f7',
    fontWeight: 'bold',
    fontSize: '11px',
    marginBottom: '2px',
  },
  '.cm-kolang-hover-desc': {
    color: '#cdd6f4',
    whiteSpace: 'pre-wrap',
  },
  '.cm-activeLine': { backgroundColor: '#31324440' },
  '.cm-activeLineGutter': { backgroundColor: '#313244', color: '#cdd6f4' },
  '.cm-foldGutter .cm-gutterElement': { color: '#7f849c', cursor: 'pointer' },
  '.cm-foldGutter .cm-gutterElement:hover': { color: '#cdd6f4' },
  '.cm-matchingBracket': { backgroundColor: '#585b7040', outline: '1px solid #89b4fa80' },
}, { dark: true })

const kolangHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: '#7f849c', fontStyle: 'italic' },
  { tag: tags.string, color: '#a6e3a1' },
  { tag: tags.number, color: '#fab387' },
  { tag: tags.bool, color: '#fab387', fontWeight: 'bold' },
  { tag: tags.null, color: '#fab387' },
  { tag: tags.controlKeyword, color: '#cba6f7', fontWeight: 'bold' },
  { tag: tags.definitionKeyword, color: '#f9e2af', fontWeight: 'bold' },
  { tag: tags.keyword, color: '#89dceb', fontStyle: 'italic' },
  { tag: tags.operatorKeyword, color: '#f38ba8' },
  { tag: tags.operator, color: '#89b4fa' },
  // Builtin functions — dedicated tag path (standard(function(variableName))),
  // no competition with the user-call rule below.
  { tag: tags.standard(tags.function(tags.variableName)), color: '#a6e3a1' },
  { tag: tags.function(tags.variableName), color: '#89b4fa' }, // user function calls
  { tag: tags.typeName, color: '#94e2d5', fontStyle: 'italic' },
  { tag: tags.className, color: '#f38ba8', textDecoration: 'underline' },
  { tag: tags.namespace, color: '#74c7ec', fontStyle: 'italic' },
  { tag: tags.self, color: '#f38ba8', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#cdd6f4' },
  { tag: tags.punctuation, color: '#9399b2' },
  { tag: tags.meta, color: '#f5c2e7' },
])

function kolangTheme() {
  return [kolangEditorTheme, syntaxHighlighting(kolangHighlightStyle, { fallback: true })]
}

// ---------------------------------------------------------------------------
// Completion — keywords, builtins, modules, exceptions, literals + snippets
// ---------------------------------------------------------------------------

const KEYWORD_COMPLETIONS = [
  ['اگر', 'دستور شرطی'], ['وگرنه', 'در غیر صورت'], ['تاوقتی', 'حلقه while'], ['برای', 'حلقه for'],
  ['از', 'شروع بازه'], ['تا', 'پایان بازه'], ['گام', 'گام حلقه'], ['در', 'پیمایش'],
  ['بپا', 'شروع بلوک try'], ['درنهایت', 'بلوک finally'], ['اتمام', 'خروج از حلقه'], ['بروبعدی', 'رفتن به تکرار بعد'],
  ['باشد', 'مساوی بودن'], ['نباشد', 'مساوی نبودن'],
  ['همچنین', 'و منطقی'], ['یا', 'یا منطقی'],
  ['تعریف', 'تعریف تابع'], ['گونه', 'تعریف کلاس'], ['رابط', 'تعریف interface'], ['وارث', 'ارث\u200Cبری'], ['رهی', 'نوع\u200Cنام'],
  ['بانام', 'نام\u200Cگذاری'], ['به', 'پیشوند'], ['و', 'جداساز'],
  ['خود', 'self'], ['والد', 'super'],
  ['پوشش', 'decorator'],
]

const FUNCTION_COMPLETIONS = [
  ['بخوان', 'خواندن فایل'], ['بسته\u200Cاست', 'بسته بودن کانال'], ['ببند', 'بستن'],
  ['تأخیری', 'اجرای تأخیری'], ['بساز\u200Cاز', 'yield from'], ['بساز', 'yield'],
  ['بنویس', 'چاپ'], ['برگردان', 'بازگشت'], ['بیافزا', 'افزودن'],
  ['حذف\u200Cکن', 'حذف'], ['حذفکن', 'حذف'], ['بده', 'پرتاب خطا'],
  ['بیار', 'وارد کردن'], ['بگیر', 'گرفتن ورودی/خطا'],
]

const TYPE_COMPLETIONS = [
  ['صحیح', 'عدد صحیح'], ['اعشاری', 'عدد اعشاری'], ['متن', 'رشته'], ['فهرست', 'لیست'],
  ['گنجه', 'دیکشنری'], ['قفسه', 'تاپل'], ['بقچه', 'zip'], ['نگاشت', 'map'],
  ['بازه', 'range'], ['طول', 'طول'], ['نوع', 'نوع'], ['جمع', 'مجموع'],
  ['کمینه', 'کمینه'], ['بیشینه', 'بیشینه'], ['مرتب', 'مرتب\u200Cسازی'], ['شمارش', 'شمارش'],
  ['پالایش', 'فیلتر'], ['بازکردن', 'باز کردن فایل'], ['اجرا', 'اجرا'], ['کانال', 'کانال'],
  ['هویت', 'شناسه'], ['برو', 'goroutine'],
]

const MODULE_COMPLETIONS = [
  ['ریاضی', 'ماژول ریاضی'], ['تصادفی', 'ماژول تصادفی'], ['زمان', 'ماژول زمان'], ['تقویم', 'ماژول تاریخ'],
  ['سیستم', 'ماژول سیستم'], ['مسیر', 'ماژول مسیر'], ['سیستم\u200Cعامل', 'ماژول OS'], ['رشته\u200Cها', 'ماژول رشته'],
  ['عبارت\u200Cمنظم', 'ماژول regex'], ['رجکس', 'ماژول regex'], ['جیسون', 'ماژول JSON'], ['اینترنت', 'ماژول URL'],
  ['درخواست', 'ماژول requests'], ['مجموعه\u200Cداده', 'ماژول collections'], ['تابع\u200Cابزار', 'ماژول itertools'],
  ['عملکرد', 'ماژول functools'], ['پایگاه\u200Cداده', 'ماژول sqlite3'],
]

const EXCEPTION_COMPLETIONS = [
  ['خطای\u200Cصفر', 'خطای تقسیم بر صفر'], ['خطای\u200Cمقدار', 'خطای مقدار'], ['خطای\u200Cنوع', 'خطای نوع'],
  ['خطای\u200Cکلید', 'خطای کلید'], ['خطای\u200Cنمایه', 'خطای اندیس'], ['خطای\u200Cفایل', 'خطای فایل'],
  ['توقف\u200Cتکرار', 'توقف تکرار'], ['خطا', 'خطای پایه'],
]

const LITERAL_COMPLETIONS = [
  ['درست', 'بولی درست'], ['غلط', 'بولی غلط'], ['تهی', 'تهی (None)'],
]

// Snippets — verb-final syntax, guillemet strings, Persian digit literals.
const SNIPPETS = [
  snippetCompletion(
    'تعریف \${1:نام}(\${2:خود و پارامتر}):\n    «\${3:سلام}» بنویس',
    { label: 'تعریف', type: 'snippet', detail: 'تعریف تابع' }
  ),
  snippetCompletion(
    'تعریف \${1:نام}(\${2:خود و پارامتر}) -> \${3:صحیح}:\n    \${4:} برگردان',
    { label: 'تعریف-خروجی', type: 'snippet', detail: 'تابع با نوع خروجی' }
  ),
  snippetCompletion(
    'گونه \${1:نام}:\n    ساخت(\${2:خود و پارامتر}):\n        \${3:فیلد}ِ خود = \${3:فیلد}\n    تعریف \${4:روش}(\${5:خود}):\n        «\${6:صدای گونه}» بنویس',
    { label: 'گونه', type: 'snippet', detail: 'گونه (کلاس)' }
  ),
  snippetCompletion(
    'گونه \${1:فرزند} وارث \${2:پدر}:\n    تعریف \${3:روش}(\${4:خود}):\n        \${5:روش}ِ()والدِ خود',
    { label: 'گونه-وارث', type: 'snippet', detail: 'گونه با ارث‌بری' }
  ),
  snippetCompletion(
    'رابط \${1:نام}:\n    تعریف \${2:روش}(\${3:خود}) -> \${4:متن}:',
    { label: 'رابط', type: 'snippet', detail: 'رابط (interface)' }
  ),
  snippetCompletion(
    'اگر \${1:شرط} == \${2:مقدار} باشد:\n    «\${3:انجام شد}» بنویس',
    { label: 'اگر', type: 'snippet', detail: 'دستور شرطی' }
  ),
  snippetCompletion(
    'اگر \${1:شرط} == \${2:مقدار} باشد:\n    «\${3:بله}» بنویس\nوگرنه:\n    «\${4:خیر}» بنویس',
    { label: 'اگر-وگرنه', type: 'snippet', detail: 'شرطی با وگرنه' }
  ),
  snippetCompletion(
    'اگر \${1:شرط} == \${2:۱} باشد:\n    \${3:}\nوگرنه اگر \${1:شرط} == \${4:۲} باشد:\n    \${5:}\nوگرنه:\n    \${6:}',
    { label: 'اگر-وگرنه-اگر', type: 'snippet', detail: 'زنجیره شرطی' }
  ),
  snippetCompletion(
    'برای \${1:متغیر} از \${2:۰} تا \${3:۱۰}:\n    «\${4:تکرار}» بنویس',
    { label: 'برای', type: 'snippet', detail: 'حلقه برای' }
  ),
  snippetCompletion(
    'برای \${1:متغیر} از \${2:۰} تا \${3:۱۰} گام \${4:۲}:\n    \${5:}',
    { label: 'برای-گام', type: 'snippet', detail: 'حلقه با گام' }
  ),
  snippetCompletion(
    'برای \${1:عنصر} در \${2:فهرست}:\n    \${1:عنصر} بنویس',
    { label: 'برای-در', type: 'snippet', detail: 'پیمایش فهرست' }
  ),
  snippetCompletion(
    'تاوقتی \${1:شرط} == \${2:درست} باشد:\n    \${3:}',
    { label: 'تاوقتی', type: 'snippet', detail: 'حلقه تاوقتی' }
  ),
  snippetCompletion(
    'بپا:\n    \${1:عملیات خطرناک}\nخطای‌\${2:صفر} بگیر:\n    «\${3:خطا رخ داد}» بنویس\nدرنهایت:\n    \${4:پاک‌سازی()}',
    { label: 'بپا', type: 'snippet', detail: 'بلوک بپا/خطا/درنهایت' }
  ),
  snippetCompletion(
    'خطای‌\${1:صفر} بگیر بانام \${2:err}:\n    «\${2:err}» بنویس',
    { label: 'خطا-بانام', type: 'snippet', detail: 'گرفتن خطا با نام' }
  ),
  snippetCompletion(
    'با بازکردن(\${1:«مسیر فایل»}) بانام \${2:ف}:\n    \${3:محتوا} = بخوانِ()\${2:ف}\n    «\${3:محتوا}» بنویس',
    { label: 'با', type: 'snippet', detail: 'بلوک با بازکردن' }
  ),
  snippetCompletion(
    'برو \${1:تابع}(\${2:})',
    { label: 'برو', type: 'snippet', detail: 'تارک (goroutine)' }
  ),
  snippetCompletion(
    '\${1:ch} = کانال(\${2:صحیح} و \${3:۱۰})\n\${1:ch} << \${4:مقدار}\n\${5:دریافت} = >>\${1:ch}\n\${1:ch} ببند',
    { label: 'کانال', type: 'snippet', detail: 'ایجاد و استفاده از کانال' }
  ),
  snippetCompletion(
    'پوشش \${1:نام}\nتعریف \${2:تابع}(\${3:خود}):\n    \${4:}',
    { label: 'پوشش', type: 'snippet', detail: 'اعمال پوشش (decorator)' }
  ),
  snippetCompletion(
    'تعریف \${1:تولیدکننده}(\${2:خود}):\n    برای \${3:ای} در \${4:داده}:\n        \${3:ای} بساز',
    { label: 'مولد', type: 'snippet', detail: 'تابع مولد (generator)' }
  ),
  snippetCompletion(
    '\${1:نتیجه} و \${2:خطا} = \${3:کاری}()\nاگر \${2:خطا} == تهی نباشد:\n    \${2:خطا} بده\n\${1:نتیجه} برگردان',
    { label: 'چندمقداری', type: 'snippet', detail: 'بازگشت چندمقداری' }
  ),
  snippetCompletion(
    '\${1:پاک‌سازی()} تأخیری',
    { label: 'تأخیری', type: 'snippet', detail: 'اجرای تأخیری (defer)' }
  ),
  snippetCompletion(
    '\${1:نتیجه} = [\${2:ای} * ۲ برای \${2:ای} در \${3:بازه}(۱۰)]',
    { label: 'کامپرهنشن', type: 'snippet', detail: 'تولید فهرست' }
  ),
  snippetCompletion(
    '\${1:داده} |> \${2:تابع۱} |> \${3:تابع۲}',
    { label: 'pipe', type: 'snippet', detail: 'زنجیره pipe' }
  ),
  snippetCompletion(
    '«\${1:سلام دنیا}» بنویس',
    { label: 'بنویس', type: 'snippet', detail: 'چاپ رشته' }
  ),
]

// User-defined identifiers from the current document: variables (plain `=`
// assignment), function names (تعریف …( ), class names (گونه …), and for-loop
// variables (برای … از/در). Deduplicated: a function/class definition wins
// over a plain variable of the same name.
function scanDocumentIdentifiers(docText) {
  const idents = new Map() // name → 'variable' | 'function' | 'class'
  const idRe = /[\u0621-\u064A\u0670-\u06FFA-Za-z_][\u0621-\u064A\u0670-\u06FFA-Za-z0-9_\u200C]*/
  const fnRe = new RegExp('^تعریف\\s+(' + idRe.source + ')\\s*\\(')
  const clsRe = new RegExp('^گونه\\s+(' + idRe.source + ')')
  const varRe = new RegExp('^(' + idRe.source + ')\\s*=(?!=)')
  const forRe = new RegExp('^برای\\s+(' + idRe.source + ')\\s+(از|در)')
  for (const line of docText.split('\n')) {
    const trimmed = line.replace(/^\s+/, '')
    // Function definition: تعریف name(
    const fnMatch = trimmed.match(fnRe)
    if (fnMatch) {
      idents.set(fnMatch[1], 'function')
      continue
    }
    // Class definition: گونه name
    const clsMatch = trimmed.match(clsRe)
    if (clsMatch) {
      idents.set(clsMatch[1], 'class')
      continue
    }
    // Variable assignment: name = (not ==, +=, …)
    const varMatch = trimmed.match(varRe)
    if (varMatch) {
      if (!idents.has(varMatch[1])) idents.set(varMatch[1], 'variable')
      continue
    }
    // For-loop variable: برای name از/در
    const forMatch = trimmed.match(forRe)
    if (forMatch) {
      if (!idents.has(forMatch[1])) idents.set(forMatch[1], 'variable')
      continue
    }
  }
  return idents
}

function kolangCompletionSource(context) {
  const word = context.matchBefore(COMPLETION_RE)
  if (word.from === word.to && !context.explicit) return null

  const prefix = word.text
  let options = []
  for (const [label, detail] of KEYWORD_COMPLETIONS) options.push({ label, type: 'keyword', detail: docDetail(label, detail) })
  for (const [label, detail] of FUNCTION_COMPLETIONS) options.push({ label, type: 'function', detail: docDetail(label, detail) })
  for (const [label, detail] of TYPE_COMPLETIONS) options.push({ label, type: 'type', detail: docDetail(label, detail) })
  for (const [label, detail] of MODULE_COMPLETIONS) options.push({ label, type: 'namespace', detail: docDetail(label, detail) })
  for (const [label, detail] of EXCEPTION_COMPLETIONS) options.push({ label, type: 'class', detail: docDetail(label, detail) })
  for (const [label, detail] of LITERAL_COMPLETIONS) options.push({ label, type: 'variable', detail: docDetail(label, detail) })
  options.push(...SNIPPETS)

  // User-defined identifiers from the current document. boost 5 keeps them
  // below prefix-matched builtins (boost 10) but above unboosted options.
  const docIdents = scanDocumentIdentifiers(context.state.doc.toString())
  for (const [name, type] of docIdents) {
    options.push({ label: name, type, detail: 'تعریف\u200Cشده در برنامه', boost: 5 })
  }

  // Prefix filter — only offer labels that start with what was typed.
  if (prefix) {
    options = options.filter((o) => o.label.startsWith(prefix))
  }

  // Boost prefix matches so they float to the top.
  options = options.map((o) =>
    prefix && o.label.startsWith(prefix) ? { ...o, boost: (o.boost || 0) + 10 } : o
  )

  // Deduplicate by label — a snippet with the same label as a plain
  // completion wins (it is richer, e.g. بنویس/اگر/تعریف/بپا/…).
  const seen = new Map()
  for (const o of options) {
    const existing = seen.get(o.label)
    if (!existing || existing.type !== 'snippet') seen.set(o.label, o)
  }
  options = [...seen.values()]

  return { from: word.from, options, validFor: VALID_FOR_RE }
}

// ---------------------------------------------------------------------------
// Contextual completion — class methods.
//
// Scans the document for `گونه X:` class definitions and, when the cursor is
// right after an ezafe (U+0650) following `خود` (self) or a class name, offers
// that class's methods. This is the FIRST completion source in the override
// array, so it wins whenever it matches.
// ---------------------------------------------------------------------------

function scanClasses(docText) {
  const classes = []
  const lines = docText.split('\n')
  let currentClass = null
  let classIndent = 0
  for (const line of lines) {
    const indent = line.match(/^(\s*)/)[1].length
    const classMatch = line.match(/^\s*گونه\s+([\u0621-\u064A\u0670-\u06FFA-Za-z_][\u0621-\u064A\u0670-\u06FFA-Za-z0-9_\u200C]*)/)
    if (classMatch) {
      currentClass = { name: classMatch[1], methods: [] }
      classes.push(currentClass)
      classIndent = indent
      continue
    }
    if (currentClass && indent > classIndent) {
      const methodMatch = line.match(/^\s*تعریف\s+([\u0621-\u064A\u0670-\u06FFA-Za-z_][\u0621-\u064A\u0670-\u06FFA-Za-z0-9_\u200C]*)\s*\(/)
      if (methodMatch) currentClass.methods.push(methodMatch[1])
    } else if (indent <= classIndent && line.trim() && !line.trim().startsWith('/')) {
      if (!line.match(/^\s*(تعریف|گونه|رابط|پوشش)/)) {
        currentClass = null
      }
    }
  }
  return classes
}

// Nearest enclosing class: scan lines before `pos` backwards for a `گونه`
// line at lower indentation than the cursor line, then collect its methods.
function findEnclosingClass(docText, pos) {
  const before = docText.slice(0, pos)
  const lines = before.split('\n')
  const cursorIndent = (lines[lines.length - 1].match(/^(\s*)/) || ['', ''])[1].length

  const allLines = docText.split('\n')
  for (let i = lines.length - 2; i >= 0; i--) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('/')) continue
    const indent = (line.match(/^(\s*)/) || ['', ''])[1].length
    if (indent >= cursorIndent) continue
    const classMatch = line.match(/^\s*گونه\s+([\u0621-\u064A\u0670-\u06FFA-Za-z_][\u0621-\u064A\u0670-\u06FFA-Za-z0-9_\u200C]*)/)
    if (!classMatch) continue
    // Collect methods up to the next line at the same or smaller indent.
    const methods = []
    for (let j = i + 1; j < allLines.length; j++) {
      const l = allLines[j]
      if (!l.trim() || l.trim().startsWith('/')) continue
      const li = (l.match(/^(\s*)/) || ['', ''])[1].length
      if (li <= indent) break
      const methodMatch = l.match(/^\s*تعریف\s+([\u0621-\u064A\u0670-\u06FFA-Za-z_][\u0621-\u064A\u0670-\u06FFA-Za-z0-9_\u200C]*)\s*\(/)
      if (methodMatch) methods.push(methodMatch[1])
    }
    return { name: classMatch[1], methods }
  }
  return null
}

function kolangContextualCompletionSource(context) {
  const doc = context.state.doc.toString()
  const before = doc.slice(0, context.pos)

  // Case 1: «خودِ» (self + ezafe) → methods of the enclosing class.
  if (before.endsWith('خودِ') || before.endsWith('خود\u0650')) {
    const enclosing = findEnclosingClass(doc, context.pos)
    if (enclosing && enclosing.methods.length) {
      return {
        from: context.pos,
        options: enclosing.methods.map((m) => ({
          label: m,
          type: 'method',
          detail: `روشِ ${enclosing.name}`,
          boost: 20,
        })),
        validFor: /^[\u0621-\u064A\u0670-\u06FFA-Za-z0-9_\u200C]*$/,
      }
    }
  }

  // Case 2: «<ClassName>ِ» → methods of that class.
  const classAccessMatch = before.match(/([\u0621-\u064A\u0670-\u06FFA-Za-z_][\u0621-\u064A\u0670-\u06FFA-Za-z0-9_\u200C]*)\u0650$/)
  if (classAccessMatch) {
    const classes = scanClasses(doc)
    const cls = classes.find((c) => c.name === classAccessMatch[1])
    if (cls && cls.methods.length) {
      return {
        from: context.pos,
        options: cls.methods.map((m) => ({
          label: m,
          type: 'method',
          detail: `روشِ ${cls.name}`,
          boost: 20,
        })),
        validFor: /^[\u0621-\u064A\u0670-\u06FFA-Za-z0-9_\u200C]*$/,
      }
    }
  }

  return null // fall through to main source
}

function kolangCompletion() {
  // Explicit options: activateOnTyping/closeOnBlur are the defaults, but
  // being explicit guards against config drift; override replaces the
  // language completion source with the kolang ones. The contextual source
  // comes FIRST so class-method completion wins whenever it applies.
  return autocompletion({
    override: [kolangContextualCompletionSource, kolangCompletionSource],
    activateOnTyping: true,
    defaultKeymap: true,
    closeOnBlur: true,
  })
}

// ---------------------------------------------------------------------------
// Hover documentation.
//
// Looks up the word under the mouse in the docs and shows a tooltip with the
// Persian description. Only shows when the pointer is over an actual word.
// ---------------------------------------------------------------------------

function kolangHoverSource(view, pos, side) {
  const { from, to, text } = view.state.doc.lineAt(pos)
  let start = pos
  let end = pos
  while (start > from && HOVER_CHAR.test(text[start - from - 1])) start--
  while (end < to && HOVER_CHAR.test(text[end - from])) end++
  if (start === pos && end === pos) return null // pointer not over a word
  const word = text.slice(start - from, end - from)
  const entry = DOC_MAP.get(word)
  if (!entry) return null
  const kindLabel = DOC_KIND_LABELS[entry.kind]
  return {
    pos: start,
    end,
    above: true,
    create() {
      const dom = document.createElement('div')
      dom.className = 'cm-kolang-hover'
      if (kindLabel) {
        const kind = document.createElement('div')
        kind.className = 'cm-kolang-hover-kind'
        kind.textContent = kindLabel
        dom.appendChild(kind)
      }
      const desc = document.createElement('div')
      desc.className = 'cm-kolang-hover-desc'
      desc.textContent = entry.desc
      dom.appendChild(desc)
      return { dom }
    },
  }
}

function kolangHover() {
  return hoverTooltip(kolangHoverSource)
}

export { kolangTheme, kolangCompletion, kolangHover }
