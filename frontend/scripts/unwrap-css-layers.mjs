#!/usr/bin/env node
/**
 * unwrap-css-layers.mjs — Round 9 ("blank page on iPhone" permanent fix,
 * CSS layer).
 *
 * WHY: Tailwind v4 emits ~91% of the production stylesheet inside cascade
 * `@layer` blocks. Cascade layers are only supported from iOS Safari 15.4 —
 * on older iPhones (iOS 12–15.3) the browser DROPS every @layer block, so
 * the JS-side fix alone would render the app unstyled. Unwrapping the
 * layer wrappers keeps the rule ORDER (theme → base → components →
 * utilities → app custom CSS) which preserves the same effective cascade
 * for this project, while making every rule visible to old Safari.
 *
 * What this script does to dist/assets/*.css (in place):
 *   1. Removes `@layer a,b,c;` forward declarations.
 *   2. Unwraps `@layer name { … }` → `…` (tokenizer: comments, strings,
 *      url() parens and @supports parens are all handled correctly).
 *   3. Expands `inset: <v>` into `top/right/bottom/left` longhands
 *      (Safari < 14.1 lacks `inset`) — original kept for modern browsers.
 *   4. Validates: braces balanced, zero `@layer` remain.
 *
 * Run automatically as part of `npm run build`.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const assetsDir = path.join(__dirname, '..', 'dist', 'assets')

const CODE = 0
const IN_DQ = 1 // inside "..."
const IN_SQ = 2 // inside '...'
const IN_COMMENT = 3 // inside /* ... */

/** Parse the CSS once into a flat event stream we can reason about. */
function analyze(css) {
  const events = [] // {i, type}
  let state = CODE
  let prev = ''
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (state === IN_DQ) {
      if (prev === '\\') { prev = ''; continue }
      if (c === '"') state = CODE
      prev = c
      continue
    }
    if (state === IN_SQ) {
      if (prev === '\\') { prev = ''; continue }
      if (c === "'") state = CODE
      prev = c
      continue
    }
    if (state === IN_COMMENT) {
      if (prev === '*' && c === '/') state = CODE
      prev = c
      continue
    }
    // CODE state
    if (c === '"' && prev !== '\\') { state = IN_DQ; events.push({ i, t: 'str-open' }) }
    else if (c === "'" && prev !== '\\') { state = IN_SQ; events.push({ i, t: 'str-open' }) }
    else if (prev === '/' && c === '*') { state = IN_COMMENT; events.push({ i: i - 1, t: 'comment-open' }) }
    else if (c === '{') events.push({ i, t: 'brace-open' })
    else if (c === '}') events.push({ i, t: 'brace-close' })
    else if (c === ';') events.push({ i, t: 'semi' })
    prev = c
  }
  return { events, endState: state }
}

/** Walk with the analyzer; produce unwrap decisions per @layer occurrence. */
function unwrapLayers(css) {
  const { events, endState } = analyze(css)
  if (endState !== CODE) {
    return { error: `css ends inside ${endState === IN_COMMENT ? 'a comment' : 'a string'}` }
  }

  // Build brace-match map via a stack over events
  const openStack = []
  const match = new Map() // openIndex -> closeIndex (event order)
  for (const ev of events) {
    if (ev.t === 'brace-open') openStack.push(ev.i)
    else if (ev.t === 'brace-close') {
      const open = openStack.pop()
      if (open === undefined) return { error: 'unbalanced braces (extra close)' }
      match.set(open, ev.i)
    }
  }
  if (openStack.length) return { error: 'unbalanced braces (unclosed open)' }

  // Locate @layer occurrences in CODE state
  const layerAt = [] // {start, kind: 'fwd'|'block', braceIdx, closeIdx}
  let state = CODE
  let prev = ''
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (state === IN_DQ) { if (prev === '\\') { prev = ''; continue } if (c === '"') state = CODE; prev = c; continue }
    if (state === IN_SQ) { if (prev === '\\') { prev = ''; continue } if (c === "'") state = CODE; prev = c; continue }
    if (state === IN_COMMENT) { if (prev === '*' && c === '/') state = CODE; prev = c; continue }
    if (c === '"' && prev !== '\\') state = IN_DQ
    else if (c === "'" && prev !== '\\') state = IN_SQ
    else if (prev === '/' && c === '*') state = IN_COMMENT
    else if (c === '@' && css.startsWith('layer', i + 1)) {
      const before = i === 0 ? '' : css[i - 1]
      if (before === '' || /[{;\s}]/.test(before)) {
        // Skip the layer name(s): "@layer theme{" / "@layer a,b,c;" / "@layer{"
        let j = i + 6
        while (j < css.length && css[j] !== ';' && css[j] !== '{') j++
        if (css[j] === ';') layerAt.push({ start: i, kind: 'fwd', endIdx: j })
        else if (css[j] === '{') {
          const close = match.get(j)
          if (close === undefined) return { error: `no matching brace for layer at ${i}` }
          layerAt.push({ start: i, kind: 'block', endIdx: close })
        }
      }
    }
    prev = c
  }

  // Apply edits from the END backwards so indices stay valid
  let out = css
  let count = 0
  for (let k = layerAt.length - 1; k >= 0; k--) {
    const L = layerAt[k]
    if (L.kind === 'fwd') {
      out = out.slice(0, L.start) + out.slice(L.endIdx + 1) // drop "@layer a,b;"
    } else {
      // keep inner content: from '{'+1 to matching '}'
      const braceIdx = css.indexOf('{', L.start)
      out = out.slice(0, L.start) + css.slice(braceIdx + 1, L.endIdx) + out.slice(L.endIdx + 1)
    }
    count++
  }
  return { css: out, unwrapped: count }
}

/** Expand `inset:` shorthand into physical longhands (kept AFTER original). */
function expandInset(css) {
  let expanded = 0
  css = css.replace(/(^|[;{\s])inset:([^;}]+)/g, (full, lead, value) => {
    const parts = value.trim().split(/\s+/)
    let top, right, bottom, left
    if (parts.length === 1) [top, right, bottom, left] = [parts[0], parts[0], parts[0], parts[0]]
    else if (parts.length === 2) { [top, bottom] = parts; [left, right] = parts }
    else if (parts.length === 3) { top = parts[0]; [left, right] = [parts[1], parts[1]]; bottom = parts[2] }
    else { [top, right, bottom, left] = parts }
    expanded++
    return `${lead}inset:${value};top:${top};right:${right};bottom:${bottom};left:${left}`
  })
  return { css, expanded }
}

function balanced(css) {
  const { events, endState } = analyze(css)
  if (endState !== CODE) return false
  let depth = 0
  for (const ev of events) {
    if (ev.t === 'brace-open') depth++
    else if (ev.t === 'brace-close') depth--
    if (depth < 0) return false
  }
  return depth === 0
}

const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.css'))
let failed = false
for (const file of files) {
  const p = path.join(assetsDir, file)
  const original = fs.readFileSync(p, 'utf8')
  const res = unwrapLayers(original)
  if (res.error) {
    console.error(`FAIL  ${file}: ${res.error}`)
    failed = true
    continue
  }
  const { css: finalCss, expanded } = expandInset(res.css)
  const remainingLayers = (finalCss.match(/@layer/g) || []).length
  if (remainingLayers > 0 || !balanced(finalCss)) {
    console.error(`FAIL  ${file}: layers remaining=${remainingLayers} balanced=${balanced(finalCss)}`)
    failed = true
    continue
  }
  fs.writeFileSync(p, finalCss)
  console.log(
    `OK    ${file}: unwrapped ${res.unwrapped} @layer block(s), expanded ${expanded} inset(s), ` +
    `${original.length} → ${finalCss.length} bytes`
  )
}
if (!files.length) {
  console.error('FAIL  no CSS files found in dist/assets — did vite build run?')
  failed = true
}
process.exit(failed ? 1 : 0)
