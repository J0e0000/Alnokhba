#!/usr/bin/env node
// es2019_dist_check — build gate. GROUND TRUTH for "can iOS Safari 13.0 parse it?".
//
// Method (v2 — v1 had false positives): re-transform each dist chunk with
// esbuild at target=es2019 using the SAME minify settings as the input, then
// compare token-probe counts. Identical minification on both sides makes the
// counts comparable (v1 used minify:false for the output, which rewrites `.5`
// to `0.5` and fake-flagged `r?.5:i` ternaries as optional chaining).
//
// Probe regex is also refined: real optional chaining is `?.` followed by an
// identifier / [ / ( — `?.5` is a ternary over a `.5` decimal literal.
import { readdirSync, readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'

const dir = 'dist/assets'
const probes = [
  [/[\w)\]'"`]\?\.(?=[a-zA-Z_$\[(])/g, '?.  optional chaining'],
  [/\?\?(?![=.])/g, '??  nullish coalescing'],
  [/\?\?=/g, '??= logical assignment'],
  [/&&=/g, '&&= logical assignment'],
  [/\|\|=/g, '||= logical assignment'],
  [/static\s*\{/g, 'static{ class static block'],
]
let bad = 0
for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
  const code = readFileSync(`${dir}/${f}`, 'utf8')
  let out
  try {
    out = transformSync(code, {
      target: ['es2019'],
      loader: 'js',
      minify: true, // SAME mode as the input bundle → counts are comparable
      charset: 'utf8',
      sourcefile: f,
    })
  } catch (e) {
    console.error(`❌ ${f}: esbuild cannot even parse it: ${String(e).slice(0, 160)}`)
    bad++
    continue
  }
  const diffs = []
  for (const [re, label] of probes) {
    const nIn = (code.match(re) || []).length
    const nOut = (out.code.match(re) || []).length
    if (nIn > nOut) diffs.push(`${label} ${nIn}→${nOut}`)
  }
  if (diffs.length) {
    console.error(`❌ ${f}: unlowered ES2020+ syntax → ${diffs.join(' | ')}`)
    bad++
  }
}
// CORRUPTION GUARD (2026-10-26 incident): the now-removed js-compat post-build
// pass re-minified every chunk with esbuild at target=es2019, which LOWERED
// `import.meta` into a plain `const u={}` — Vite's preload helper then ran
// `new URL(dep, undefined)` and EVERY lazy chunk threw
// "Failed to construct 'URL': Invalid URL" (all pages crashed behind the
// area error boundaries). `import.meta` is a RUNTIME feature (Safari 11.1+,
// far below the iOS 13 floor), NOT syntax — es2019 targets must keep it
// verbatim, and no post-build pass may strip it. The Vite preload helper
// always references import.meta.url; if it vanishes from the dist, lazy
// preload URLs are broken. This tripwire fails the build loudly in that case.
let totalMeta = 0
for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
  totalMeta += (readFileSync(`${dir}/${f}`, 'utf8').match(/import\.meta/g) || []).length
}
if (totalMeta === 0) {
  console.error(`❌ import.meta vanished from dist — lazy preload URL bases are broken (es2019-lowering-style corruption); every lazy import would throw "Invalid URL"`)
  bad++
}
if (bad) {
  console.error(`\n[es2019_dist_check] ${bad} chunk(s) violate the documented browser floor (iOS 13 / Safari 13).`)
  process.exit(1)
}
console.log(`[es2019_dist_check] all dist chunks are ES2019-clean ✅ (import.meta intact: ${totalMeta} refs)`)
