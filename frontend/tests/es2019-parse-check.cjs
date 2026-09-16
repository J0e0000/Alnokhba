#!/usr/bin/env node
/* ES2019 grammar proof: parse every dist JS bundle with an ES2019-only
 * parser (acorn) the way old Safari's parser would. Any ES2020+ syntax
 * (optional chaining, nullish coalescing, logical assignment, class
 * static blocks, private fields, top-level await...) throws SyntaxError.
 * This is the exact failure that blanked the page on iPhones <= 16.3.
 *
 * Two constructs are exempted by preprocessing because they are ES2020
 * *grammar* but have shipped in Safari since iOS 11.1 (2018), long before
 * the iOS 13 floor we target:
 *   - import.meta   (iOS 11.1+, caniuse)
 *   - import() dynamic import (iOS 11.1+, caniuse)
 * Everything else must parse under ecmaVersion: 2019. */
const acorn = require('acorn')
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'dist', 'assets')
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
let failed = false

for (const f of files) {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8')
  // Exempt the two iOS-11.1-era constructs, keep everything else strict.
  const src = raw
    .replace(/import\.meta/g, 'IMPORT_META_DOT')
    .replace(/import\(/g, '__dynamicImport(')
  try {
    acorn.parse(src, { ecmaVersion: 2019, sourceType: 'module' })
    console.log(`  OK    ${f} — pure ES2019 grammar (${(raw.length / 1024).toFixed(0)} KB)`)
  } catch (e) {
    failed = true
    console.log(`  FAIL  ${f} — ${e.message}`)
    const pos = Math.max(0, (e.pos || 0) - 60)
    console.log('        context: ...' + src.slice(pos, pos + 120).replace(/\n/g, ' ') + '...')
  }
}

if (failed) { console.log('\nES2019 PARSE PROOF: FAILED — bundle still contains newer syntax'); process.exit(1) }
console.log('\nES2019 PARSE PROOF: PASSED — bundle grammar parses on Safari 13 / iOS 13 and newer')
