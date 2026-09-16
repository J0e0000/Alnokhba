// lib/qbFontSetup.js
// Lazy-loads the Amiri Arabic TTF font and registers it with jsPDF.
// Amiri is a high-quality Arabic typeface (SIL Open Font License).
//
// The font files live at /public/fonts/Amiri-Regular.ttf and Amiri-Bold.ttf.
// They are fetched on first PDF generation, then cached by the browser.
// This keeps the main bundle small (~300KB total, only loaded when needed).

import jsPDF from 'jspdf'

const FONT_FILES = {
  'Amiri-Regular.ttf': '/fonts/Amiri-Regular.ttf',
  'Amiri-Bold.ttf': '/fonts/Amiri-Bold.ttf',
}

let _loaded = false
let _loadingPromise = null
let _regularB64 = null
let _boldB64 = null

/**
 * Convert an ArrayBuffer to a base64 string (chunked to avoid call stack limits).
 */
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  const chunkSize = 0x8000 // 32KB chunks
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, chunk)
  }
  return btoa(binary)
}

/**
 * Fetch a font file and return its base64 content.
 */
async function fetchFontAsBase64(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch font: ${url} (${res.status})`)
  const buf = await res.arrayBuffer()
  return arrayBufferToBase64(buf)
}

/**
 * Patch jsPDF so every `new jsPDF()` instance automatically has the Amiri font registered.
 * We monkey-patch the constructor: wrap it so that after the original constructor runs,
 * we call addFileToVFS + addFont on the new instance.
 *
 * This is more reliable than the `addFonts` event hook (which only fires if pushed
 * before the first doc is created).
 */
function patchJsPdfConstructor() {
  if (jsPDF.__amiriPatched) return
  const Original = jsPDF
  const Patched = function (...args) {
    const doc = new Original(...args)
    try {
      if (_regularB64 && !doc.internal.vFS?.['Amiri-Regular.ttf']) {
        doc.addFileToVFS('Amiri-Regular.ttf', _regularB64)
        doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal')
      }
      if (_boldB64 && !doc.internal.vFS?.['Amiri-Bold.ttf']) {
        doc.addFileToVFS('Amiri-Bold.ttf', _boldB64)
        doc.addFont('Amiri-Bold.ttf', 'Amiri', 'bold')
      }
    } catch (e) {
      console.warn('[qbFontSetup] font registration on doc failed:', e?.message)
    }
    return doc
  }
  // Copy static properties
  Object.assign(Patched, Original)
  Patched.prototype = Original.prototype
  Patched.__amiriPatched = true
  // Replace the default export — but since jsPDF is already imported elsewhere,
  // we can't truly replace it. Instead, we also patch the prototype.
  // The most reliable approach: patch the prototype's constructor init.
  return Patched
}

/**
 * Load and register Amiri fonts with jsPDF.
 * Idempotent — safe to call multiple times.
 *
 * After this resolves, any jsPDF doc created via the patched constructor will
 * automatically have Amiri available via:
 *   doc.setFont('Amiri', 'normal')
 *   doc.setFont('Amiri', 'bold')
 *
 * For docs created before this loads (rare), call registerFontsOnDoc(doc) manually.
 */
export async function ensureArabicFonts() {
  if (_loaded) return
  if (_loadingPromise) return _loadingPromise

  _loadingPromise = (async () => {
    [_regularB64, _boldB64] = await Promise.all([
      fetchFontAsBase64(FONT_FILES['Amiri-Regular.ttf']),
      fetchFontAsBase64(FONT_FILES['Amiri-Bold.ttf']),
    ])

    // Patch the prototype so EVERY jsPDF instance gets the Amiri font on demand.
    // We wrap setFont so that when 'Amiri' is requested, we lazy-register it on the instance.
    const proto = jsPDF.prototype
    if (proto && !proto.__amiriPatched) {
      const origSetFont = proto.setFont
      proto.setFont = function (fontName, fontStyle, options) {
        if (fontName === 'Amiri' && this.internal && this.internal.vFS && !this.internal.vFS['Amiri-Regular.ttf']) {
          try {
            this.addFileToVFS('Amiri-Regular.ttf', _regularB64)
            this.addFont('Amiri-Regular.ttf', 'Amiri', 'normal')
            this.addFileToVFS('Amiri-Bold.ttf', _boldB64)
            this.addFont('Amiri-Bold.ttf', 'Amiri', 'bold')
          } catch (e) {
            console.warn('[qbFontSetup] lazy font registration failed:', e?.message)
          }
        }
        return origSetFont.call(this, fontName, fontStyle, options)
      }
      proto.__amiriPatched = true
    }

    _loaded = true
  })()

  return _loadingPromise
}

/**
 * Register fonts on a SPECIFIC doc instance. Use this for docs created before
 * ensureArabicFonts() resolved (rare — only if a PDF is generated at app startup
 * before the user clicks anything).
 *
 * Also called internally by qbPdf.js before any setFont('Amiri') call.
 */
export async function registerFontsOnDoc(doc) {
  if (!_loaded) await ensureArabicFonts()
  if (doc.internal?.vFS?.['Amiri-Regular.ttf']) return
  try {
    doc.addFileToVFS('Amiri-Regular.ttf', _regularB64)
    doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal')
    doc.addFileToVFS('Amiri-Bold.ttf', _boldB64)
    doc.addFont('Amiri-Bold.ttf', 'Amiri', 'bold')
    // Map italic + bolditalic to the same TTFs (Amiri doesn't ship italic;
    // jsPDF will use the registered normal/bold file, which is acceptable).
    doc.addFont('Amiri-Regular.ttf', 'Amiri', 'italic')
    doc.addFont('Amiri-Bold.ttf', 'Amiri', 'bolditalic')
  } catch (e) {
    console.warn('[qbFontSetup] registerFontsOnDoc failed:', e?.message)
  }
}

/**
 * Returns the font family name to use for a given language.
 * - Arabic / mixed → 'Amiri' (the embedded Arabic font)
 * - English → 'helvetica' (jsPDF built-in, smaller)
 */
export function fontFamilyForLanguage(language) {
  if (language === 'en') return 'helvetica'
  return 'Amiri'
}

/**
 * Pre-warm the font cache. Call this on app startup or when the QB section opens
 * so the first PDF generation feels instant.
 */
export function prefetchFonts() {
  ensureArabicFonts().catch((e) => {
    console.warn('[qbFontSetup] prefetch failed (will retry on next PDF):', e?.message)
  })
}
