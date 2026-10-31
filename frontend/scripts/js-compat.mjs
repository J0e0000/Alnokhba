#!/usr/bin/env node
// js-compat — POST-BUILD ES2019 compatibility pass (Round: security/perf audit)
//
// WHY THIS EXISTS — the production crash root cause (2026-10-26 audit):
// Vite 8 ships rolldown, and `build.target: ['es2019','safari13',...]` was
// SILENTLY NOT applied to every emitted chunk — 4 production chunks
// (main bundle, Charts, PublicQRPage, jspdf) contained raw ES2020 optional
// chaining (`?.`). Any engine without `?.` support (iOS Safari 13.0–13.3,
// old Android WebViews, WhatsApp in-app browsers) throws a SyntaxError while
// PARSING the chunk → blank page / crash on many pages. This is the
// documented "many pages crash" bug.
//
// WHAT THIS DOES: deterministically lowers EVERY dist/assets/*.js to the
// documented browser floor (es2019/safari13) with esbuild after the bundler
// runs, regardless of bundler target behavior. Idempotent — a clean bundle
// passes through byte-identical in content semantics (whitespace may change).
//
// THEN es2019_dist_check.mjs FAILS the build if any chunk still carries
// unlowered ES2020+ syntax, so the guarantee is enforced, not documented.
import { readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { transformSync } from 'esbuild'

const dir = 'dist/assets'
const files = readdirSync(dir).filter((n) => n.endsWith('.js'))
let touched = 0
for (const f of files) {
  const p = `${dir}/${f}`
  const code = readFileSync(p, 'utf8')
  const out = transformSync(code, {
    // es2019 is the strictest constraint here (it demands lowering of ?.
    // and ?? just like iOS 13.0–13.3 does). NOTE: do NOT add 'safari13' to
    // this list — esbuild refuses to lower destructuring for that target
    // ("not supported yet") and the whole pass fails; es2019 alone covers it.
    target: ['es2019'],
    loader: 'js',
    minify: true, // keep the bundle minified like the bundler output
    charset: 'utf8', // do NOT escape Arabic strings to \uXXXX (keeps size down)
    sourcefile: f,
  })
  if (out.code !== code) {
    writeFileSync(p, out.code)
    touched++
  }
}
console.log(`[js-compat] ${files.length} chunk(s) scanned, ${touched} lowered to es2019`)
