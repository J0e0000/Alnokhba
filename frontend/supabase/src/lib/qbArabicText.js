// lib/qbArabicText.js
// Arabic text processing for PDF generation — SELF-CONTAINED (no external deps).
//
// Pipeline: raw text → BiDi reorder → Arabic shape → ready for jsPDF.
//
// This module vendored the Arabic shaping and BiDi logic directly (no external
// npm packages needed). The shaping uses the Unicode Presentation Forms-B block
// (U+FE70–U+FEFF) to convert logical Arabic characters to their connected
// visual forms (isolated/initial/medial/final).
//
// Why this is needed:
//   jsPDF does NOT do Arabic shaping or BiDi reordering natively.
//   Without this module, Arabic renders as disconnected reversed letters.

// ─────────────────────────────────────────────────────────────────────────────
// Arabic letter → presentation form mapping
// Each entry: [isolated, final, initial, medial]
// Letters that don't connect forward (ا د ذ ر ز و ؤ إ أ ء ة ى) only have
// isolated + final forms; initial/medial are set to 0 (use isolated as fallback).
// ─────────────────────────────────────────────────────────────────────────────

const FORMS = {
  // Basic Arabic letters (U+0621–U+064A)
  0x0621: [0xFE80, 0xFE80, 0, 0],            // ء HAMZA (no connection)
  0x0622: [0xFE81, 0xFE82, 0, 0],            // آ ALEF WITH MADDA ABOVE
  0x0623: [0xFE83, 0xFE84, 0, 0],            // أ ALEF WITH HAMZA ABOVE
  0x0624: [0xFE85, 0xFE86, 0, 0],            // ؤ WAW WITH HAMZA ABOVE
  0x0625: [0xFE87, 0xFE88, 0, 0],            // إ ALEF WITH HAMZA BELOW
  0x0626: [0xFE89, 0xFE8A, 0xFE8B, 0xFE8C],  // ئ YEH WITH HAMZA ABOVE
  0x0627: [0xFE8D, 0xFE8E, 0, 0],            // ا ALEF (no forward connection)
  0x0628: [0xFE8F, 0xFE90, 0xFE91, 0xFE92],  // ب BEH
  0x0629: [0xFE93, 0xFE94, 0, 0],            // ة TEH MARBUTA (no forward)
  0x062A: [0xFE95, 0xFE96, 0xFE97, 0xFE98],  // ت TEH
  0x062B: [0xFE99, 0xFE9A, 0xFE9B, 0xFE9C],  // ث THEH
  0x062C: [0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0],  // ج JEEM
  0x062D: [0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4],  // ح HAH
  0x062E: [0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8],  // خ KHAH
  0x062F: [0xFEA9, 0xFEAA, 0, 0],            // د DAL (no forward)
  0x0630: [0xFEAB, 0xFEAC, 0, 0],            // ذ THAL (no forward)
  0x0631: [0xFEAD, 0xFEAE, 0, 0],            // ر REH (no forward)
  0x0632: [0xFEAF, 0xFEB0, 0, 0],            // ز ZAIN (no forward)
  0x0633: [0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4],  // س SEEN
  0x0634: [0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8],  // ش SHEEN
  0x0635: [0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC],  // ص SAD
  0x0636: [0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0],  // ض DAD
  0x0637: [0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4],  // ط TAH
  0x0638: [0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8],  // ظ ZAH
  0x0639: [0xFEC9, 0xFECA, 0xFECB, 0xFECC],  // ع AIN
  0x063A: [0xFECD, 0xFECE, 0xFECF, 0xFED0],  // غ GHAIN
  0x0641: [0xFED1, 0xFED2, 0xFED3, 0xFED4],  // ف FEH
  0x0642: [0xFED5, 0xFED6, 0xFED7, 0xFED8],  // ق QAF
  0x0643: [0xFED9, 0xFEDA, 0xFEDB, 0xFEDC],  // ك KAF
  0x0644: [0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0],  // ل LAM
  0x0645: [0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4],  // م MEEM
  0x0646: [0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8],  // ن NOON
  0x0647: [0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC],  // ه HEH
  0x0648: [0xFEED, 0xFEEE, 0, 0],            // و WAW (no forward)
  0x0649: [0xFBE8, 0xFBE9, 0, 0],            // ى ALEF MAKSURA (no forward)
  0x064A: [0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4],  // ي YEH

  // Arabic-Indic digits (not shaped, but need to stay LTR in BiDi)
  // These are handled separately in BiDi.

  // Additional letters (less common but used in some Arabic text)
  0x0671: [0xFB50, 0xFB51, 0, 0],            // ٱ ALEF WASLA
  0x0679: [0xFB66, 0xFB67, 0xFB68, 0xFB69],  // ٹ TTEH (Urdu)
  0x067A: [0xFB6E, 0xFB6F, 0xFB70, 0xFB71],  // ٺ TTEHEH
  0x067B: [0xFB52, 0xFB53, 0xFB54, 0xFB55],  // ٻ BEEH
  0x067E: [0xFB56, 0xFB57, 0xFB58, 0xFB59],  // پ PEH (Persian/Urdu)
  0x0686: [0xFB7A, 0xFB7B, 0xFB7C, 0xFB7D],  // چ TCHEH (Persian/Urdu)
  0x06A4: [0xFB6A, 0xFB6B, 0xFB6C, 0xFB6D],  // ڤ VEH
  0x06A9: [0xFB8E, 0xFB8F, 0xFB90, 0xFB91],  // ک KEHEH (Persian)
  0x06AF: [0xFB92, 0xFB93, 0xFB94, 0xFB95],  // گ GAF (Persian/Urdu)
  0x06CC: [0xFBFC, 0xFBFD, 0xFBFE, 0xFBFF],  // ی FARSI YEH
}

// Lam-Alef ligatures: when ل (LAM) is followed by ا/أ/إ/آ, they form a ligature
const LAM_ALEF_LIGATURES = {
  0x0627: [0xFEFB, 0xFEFC],  // ل + ا → ﻻ (isolated, final)
  0x0623: [0xFEF7, 0xFEF8],  // ل + أ → ﻷ
  0x0625: [0xFEF9, 0xFEFA],  // ل + إ → ﻹ
  0x0622: [0xFEF5, 0xFEF6],  // ل + آ → ﻵ
}

// Diacritics (harakat) — these don't affect shaping, just pass through
const DIACRITICS = new Set([
  0x064B, 0x064C, 0x064D, 0x064E, 0x064F, 0x0650, 0x0651, 0x0652,
  0x0653, 0x0654, 0x0655, 0x0670, 0x06D6, 0x06D7, 0x06D8, 0x06D9,
  0x06DA, 0x06DB, 0x06DC, 0x06DF, 0x06E0, 0x06E2, 0x06E3, 0x06E4,
  0x06E7, 0x06E8, 0x06EA, 0x06EB, 0x06EC,
])

// Tatweel/kashida (elongation character) — affects shaping
const TATWEEL = 0x0640

// ─────────────────────────────────────────────────────────────────────────────
// Character classification
// ─────────────────────────────────────────────────────────────────────────────

const ARABIC_RANGES = [
  [0x0600, 0x06FF],   // Arabic
  [0x0750, 0x077F],   // Arabic Supplement
  [0xFB50, 0xFDFF],   // Arabic Presentation Forms-A
  [0xFE70, 0xFEFF],   // Arabic Presentation Forms-B
]

export function containsArabic(str) {
  if (!str) return false
  for (const ch of str) {
    const cp = ch.codePointAt(0)
    for (const [lo, hi] of ARABIC_RANGES) {
      if (cp >= lo && cp <= hi) return true
    }
  }
  return false
}

export function detectLanguage(str) {
  if (!str) return 'en'
  let arabic = 0, latin = 0
  for (const ch of str) {
    const cp = ch.codePointAt(0)
    for (const [lo, hi] of ARABIC_RANGES) {
      if (cp >= lo && cp <= hi) { arabic++; break }
    }
    if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A)) latin++
  }
  if (arabic === 0) return 'en'
  if (latin === 0) return 'ar'
  return 'mixed'
}

/**
 * Check if a character is an Arabic letter that can connect forward (to the next letter).
 * Most Arabic letters can; ا د ذ ر ز و ء ة ى cannot.
 */
function canConnectForward(cp) {
  const forms = FORMS[cp]
  if (!forms) return false
  // If initial form exists (non-zero), the letter can connect forward
  return forms[2] !== 0
}

/**
 * Check if a character is an Arabic letter (has shaping forms).
 */
function isArabicLetter(cp) {
  return !!FORMS[cp]
}

/**
 * Check if a character is a diacritic (haraka).
 */
function isDiacritic(cp) {
  return DIACRITICS.has(cp)
}

// ─────────────────────────────────────────────────────────────────────────────
// Lam-Alef ligature pre-processing
// In logical order, LAM (U+0644) followed by ALEF/ALEF_HAMZA forms a ligature.
// This must happen BEFORE BiDi reversal, while characters are still in logical order.
// We replace the two characters with a single ligature placeholder that carries
// the connection state, then the shaping step handles it.
// ─────────────────────────────────────────────────────────────────────────────

const LAM = 0x0644

/**
 * Replace LAM+ALEF sequences with ligature characters (in logical order).
 * We use a special marker to track whether the ligature should be isolated or final.
 * Returns { text: string, ligatures: Map<position, {isolated, final}> }
 */
function preprocessLamAlefLigatures(text) {
  const chars = [...text]
  const result = []
  const ligatureInfo = [] // parallel array: null or {isolated, final}

  let i = 0
  while (i < chars.length) {
    const cp = chars[i].codePointAt(0)
    if (cp === LAM && i + 1 < chars.length) {
      const nextCp = chars[i + 1].codePointAt(0)
      const ligature = LAM_ALEF_LIGATURES[nextCp]
      if (ligature) {
        // Replace the two chars with a single ligature placeholder.
        // We use the isolated code point as the placeholder; the shaping step
        // will replace it with the final form if connected to a previous letter.
        // We mark it with a special property so shaping knows it's a ligature.
        result.push(String.fromCodePoint(ligature[0])) // isolated form as placeholder
        ligatureInfo.push({ isLigature: true, isolated: ligature[0], final: ligature[1] })
        i += 2
        continue
      }
    }
    result.push(chars[i])
    ligatureInfo.push(null)
    i++
  }

  return { text: result.join(''), ligatureInfo }
}

// ─────────────────────────────────────────────────────────────────────────────
// BiDi reordering (simplified)
// Reverses Arabic runs while keeping LTR runs (English, numbers) in order.
// Also reverses the ligatureInfo array in parallel.
// ─────────────────────────────────────────────────────────────────────────────

export function bidiReorder(text) {
  if (!text) return text
  if (!containsArabic(text)) return text

  // Split into runs of Arabic and non-Arabic characters
  const runs = []
  let currentRun = ''
  let currentIsArabic = false
  let started = false

  for (const ch of text) {
    const cp = ch.codePointAt(0)
    const isArab = isArabicLetter(cp) || isDiacritic(cp) || cp === TATWEEL ||
      // Also treat presentation forms (including ligature placeholders) as Arabic
      (cp >= 0xFE70 && cp <= 0xFEFF) || (cp >= 0xFB50 && cp <= 0xFDFF)
    if (!started) {
      currentRun = ch
      currentIsArabic = isArab
      started = true
    } else if (isArab === currentIsArabic) {
      currentRun += ch
    } else {
      runs.push({ text: currentRun, isArabic: currentIsArabic })
      currentRun = ch
      currentIsArabic = isArab
    }
  }
  if (currentRun) {
    runs.push({ text: currentRun, isArabic: currentIsArabic })
  }

  // Determine base direction: if any Arabic run exists, base is RTL
  const hasArabic = runs.some((r) => r.isArabic)
  const baseIsRTL = hasArabic

  if (baseIsRTL) {
    // RTL base: reverse the order of runs
    // Each Arabic run is also reversed (character order)
    return runs
      .slice()
      .reverse()
      .map((r) => (r.isArabic ? r.text.split('').reverse().join('') : r.text))
      .join('')
  } else {
    // LTR base: keep run order, reverse each Arabic run
    return runs
      .map((r) => (r.isArabic ? r.text.split('').reverse().join('') : r.text))
      .join('')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Arabic shaping
// Converts logical Arabic characters to presentation forms based on context.
// Also handles Lam-Alef ligature placeholders (inserted by preprocessLamAlefLigatures).
// ─────────────────────────────────────────────────────────────────────────────

// Lam-Alef ligature code points (used to detect placeholders in the shaped text)
const LAM_ALEF_LIGATURE_CP = new Set([0xFEF5, 0xFEF6, 0xFEF7, 0xFEF8, 0xFEF9, 0xFEFA, 0xFEFB, 0xFEFC])

export function shapeArabic(text) {
  if (!text) return text

  const chars = [...text] // Handle surrogate pairs
  const result = []
  let i = 0

  while (i < chars.length) {
    const ch = chars[i]
    const cp = ch.codePointAt(0)

    // Handle Lam-Alef ligature placeholders (already pre-processed)
    // These are in the U+FEF5–U+FEFC range. If the previous letter connects
    // forward, use the final form (even code point); otherwise use isolated (odd).
    if (LAM_ALEF_LIGATURE_CP.has(cp)) {
      let prevCp = 0
      for (let j = i - 1; j >= 0; j--) {
        const pCp = chars[j].codePointAt(0)
        if (isDiacritic(pCp) || pCp === TATWEEL) continue
        prevCp = pCp
        break
      }
      const prevConnects = isArabicLetter(prevCp) && canConnectForward(prevCp)
      // Ligature pairs: (isolated, final) = (FEF5,FEF6), (FEF7,FEF8), (FEF9,FEFA), (FEFB,FEFC)
      // Isolated = odd, Final = even. If prevConnects, use even (final); else odd (isolated).
      if (prevConnects && cp % 2 === 1) {
        result.push(String.fromCodePoint(cp + 1)) // switch to final form
      } else {
        result.push(ch) // keep as-is
      }
      i++
      continue
    }

    // Handle diacritics: pass through without shaping
    if (isDiacritic(cp)) {
      result.push(ch)
      i++
      continue
    }

    // Handle tatweel: pass through (it's a visual elongation)
    if (cp === TATWEEL) {
      result.push(ch)
      i++
      continue
    }

    // Handle Arabic letters
    const forms = FORMS[cp]
    if (!forms) {
      // Non-Arabic character or already-shaped presentation form: pass through
      result.push(ch)
      i++
      continue
    }

    // Determine context: does the previous character connect forward to this one?
    // Skip diacritics when looking at neighbors
    let prevCp = 0
    for (let j = i - 1; j >= 0; j--) {
      const pCp = chars[j].codePointAt(0)
      if (isDiacritic(pCp) || pCp === TATWEEL) continue
      prevCp = pCp
      break
    }
    const prevConnects = (isArabicLetter(prevCp) && canConnectForward(prevCp)) ||
                         LAM_ALEF_LIGATURE_CP.has(prevCp) // ligatures can connect forward

    // Determine: does the next character connect backward from this one?
    let nextCp = 0
    for (let j = i + 1; j < chars.length; j++) {
      const nCp = chars[j].codePointAt(0)
      if (isDiacritic(nCp) || nCp === TATWEEL) continue
      nextCp = nCp
      break
    }
    const nextIsArabicLetter = isArabicLetter(nextCp) || LAM_ALEF_LIGATURE_CP.has(nextCp)
    const selfConnectsForward = canConnectForward(cp)
    const nextConnects = nextIsArabicLetter && selfConnectsForward

    // Select form based on context
    let formIdx
    if (prevConnects && nextConnects) {
      formIdx = 3 // medial
    } else if (prevConnects && !nextConnects) {
      formIdx = 1 // final
    } else if (!prevConnects && nextConnects) {
      formIdx = 2 // initial
    } else {
      formIdx = 0 // isolated
    }

    // Use the form, or fall back to isolated if the specific form doesn't exist
    let formCp = forms[formIdx]
    if (!formCp) {
      // If the requested form doesn't exist (e.g., initial for ALEF),
      // use final if prevConnects, otherwise isolated
      formCp = prevConnects ? forms[1] || forms[0] : forms[0]
    }

    result.push(String.fromCodePoint(formCp))
    i++
  }

  return result.join('')
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined pipeline
// ─────────────────────────────────────────────────────────────────────────────

export function prepareTextForPdf(text, languageHint = 'auto') {
  if (!text) return ''
  // For pure English, no processing needed
  if (languageHint === 'en' && !containsArabic(text)) return text
  // For auto/ar/mixed → full pipeline:
  // 1. Pre-process Lam-Alef ligatures (in logical order, before BiDi)
  // 2. BiDi reorder (reverse Arabic runs)
  // 3. Shape (convert to presentation forms based on visual context)
  const { text: afterLigatures } = preprocessLamAlefLigatures(text)
  const reordered = bidiReorder(afterLigatures)
  const shaped = shapeArabic(reordered)
  return shaped
}

export function alignForText(text, languageHint = 'auto') {
  if (languageHint === 'en') return 'left'
  if (languageHint === 'ar') return 'right'
  // auto
  const lang = detectLanguage(text)
  if (lang === 'en') return 'left'
  return 'right'
}

export function toArabicDigits(text) {
  if (!text) return text
  const map = { '0': '٠', '1': '١', '2': '٢', '3': '٣', '4': '٤', '5': '٥', '6': '٦', '7': '٧', '8': '٨', '9': '٩' }
  return text.replace(/[0-9]/g, (d) => map[d] || d)
}
