#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  css-compat.mjs — Final Round: post-build CSS compatibility pass (iOS)
 * ═══════════════════════════════════════════════════════════════════════════
 *  With `cssTarget: 'safari13'` in vite.config.js, Lightning CSS already:
 *    - converts oklch()/lch() base values (0 oklch left in output),
 *    - keeps wide-gamut palette as color(display-p3 ...) — supported since
 *      Safari 12.1,
 *    - emits a STATIC srgb fallback BEFORE every @supports-guarded
 *      color-mix() (guards use `@supports (color:color-mix(in lab, red, red))`
 *      which fails on Safari < 16.2 → the static value wins).
 *  This script only sweeps the last residues Lightning cannot fix:
 *
 *   1. `100dvh` / `100svh` → emit a `vh` fallback declaration first
 *      (dvh needs Safari 15.4+; without it the shell height collapses).
 *   2. `inset: X` (single value) → expand to top/right/bottom/left
 *      (inset shorthand needs Safari 14.5+).
 *
 *  It also PRINTS a residue report (color-mix / oklch / lab / @property /
 *  dvh counts) so a broken build is caught immediately.
 *  Idempotent — safe to run twice. Only touches dist/assets/*.css.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS_DIR = new URL('./../dist/assets/', import.meta.url).pathname
const files = readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.css'))
if (files.length === 0) {
  console.error('[css-compat] no CSS files found in dist/assets — did `vite build` run?')
  process.exit(1)
}

// ── dvh/svh/lvh → vh fallback declaration (prepended, old browsers use it) ──
function rewriteViewportUnits(css) {
  let changed = 0
  // match a declaration whose value contains dvh/svh/lvh; lead = { ; } or start
  css = css.replace(/([{;}]|^)((?:min-|max-)?height)\s*:\s*([^;{}]*\d(?:\.\d+)?(?:dvh|svh|lvh)[^;{}]*)/g, (full, lead, prop, value) => {
    const fallback = value.replace(/\b(\d+(?:\.\d+)?)(?:dvh|svh|lvh)\b/g, '$1vh')
    if (fallback === value) return full
    changed++
    return `${lead}${prop}:${fallback};${prop}:${value}`
  })
  return { css, changed }
}

// ── inset: X (single value) → top/right/bottom/left ─────────────────────────
function rewriteInset(css) {
  let changed = 0
  css = css.replace(/([{;}]|^)inset\s*:\s*(-?[\d.]+(?:px|rem|em|%|vw|vh)?)\s*(?=[;}])/g, (full, lead, value) => {
    changed++
    return `${lead}top:${value};right:${value};bottom:${value};left:${value}`
  })
  return { css, changed }
}

// ── main ─────────────────────────────────────────────────────────────────────
let totalChanges = 0
for (const file of files) {
  const path = join(ASSETS_DIR, file)
  let css = readFileSync(path, 'utf8')

  const vp = rewriteViewportUnits(css)
  const ins = rewriteInset(vp.css)
  css = ins.css
  const changed = vp.changed + ins.changed
  if (changed > 0) {
    writeFileSync(path, css)
    console.log(`[css-compat] ${file}: ${changed} rewrites (vh-fallback:${vp.changed}, inset:${ins.changed})`)
  } else {
    console.log(`[css-compat] ${file}: clean`)
  }
  totalChanges += changed
}

// ── residue report (informational — build gate) ──────────────────────────────
let fatal = false
for (const file of files) {
  const css = readFileSync(join(ASSETS_DIR, file), 'utf8')
  const residue = {
    colorMix: (css.match(/color-mix\(/g) || []).length,
    oklch: (css.match(/oklch\(/g) || []).length,
    lab: (css.match(/lab\(/g) || []).length,
    atProperty: (css.match(/@property/g) || []).length,
    dvh: (css.match(/dvh|svh/g) || []).length,
  }
  console.log(`[css-compat] residue ${file}:`, JSON.stringify(residue))
  // oklch ANYWHERE outside @supports would kill colors on Safari 13-15.3 —
  // Lightning should have converted them all; if not, fail the build loudly.
  if (residue.oklch > 0) {
    console.error(`[css-comapt] FATAL: ${residue.oklch} oklch() survived in ${file} — old-iOS colors will break`)
    fatal = true
  }
}
console.log(`[css-compat] done — ${totalChanges} total rewrites`)
if (fatal) process.exit(1)
