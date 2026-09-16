#!/usr/bin/env node
/**
 * Round 9 verification — "old Safari parse check".
 *
 * The fix lowers the Vite build target to safari12/es2019. This script
 * PROVES the shipped bundles are parseable by an ES2019-era engine
 * (which is what iOS 12 Safari effectively is). If any modern syntax
 * (?. ?? ??= class fields etc.) survived transpilation, acorn at
 * ecmaVersion:2019 will throw here.
 *
 * Also scans for modern METHOD usage that must be covered by
 * src/lib/legacyPolyfills.js.
 */
const fs = require('fs')
const path = require('path')
const acorn = require('acorn')

const distAssets = path.join(__dirname, '..', 'dist', 'assets')
const files = fs.readdirSync(distAssets).filter((f) => f.endsWith('.js'))

let failed = false

// Methods that legacyPolyfills.js must cover (checked in dist output usage)
const polyfillCoveredMethods = [
  /\.at\(/g,
  /Object\.hasOwn\(/g,
  /\.replaceAll\(/g,
  /structuredClone\(/g,
  /randomUUID\(/g,
  /\.findLast\(/g,
]

for (const file of files) {
  const p = path.join(distAssets, file)
  const src = fs.readFileSync(p, 'utf8')

  // 1. ES2019 parse check (module — like the browser loads it).
  //    Two ES2020 *grammar* constructs are fine on old iOS Safari and are
  //    neutralized before parsing (parse-only transformation, never shipped):
  //      * `import.meta`   — supported since iOS Safari 11.1
  //      * dynamic import( — supported since iOS Safari 11.1
  //    Everything else ES2020+ (?. ?? ??= ||= &&= class fields #privates
  //    numeric separators BigInt literals static blocks) must NOT appear and
  //    will fail this parse.
  try {
    const neutralized = src
      .replace(/import\.meta/g, '__nokhbaImportMeta__')
      .replace(/(^|[^\w.])import\(/g, '$1__nokhbaDynImport(')
    acorn.parse(neutralized, { ecmaVersion: 2019, sourceType: 'module' })
    console.log(`PASS  parse ES2019  ${file} (${(src.length / 1024).toFixed(0)} kB)`)
  } catch (err) {
    failed = true
    console.log(`FAIL  parse ES2019  ${file}: ${err.message}`)
    // Locate the offending snippet for debugging
    const m = /(\d+):(\d+)/.exec(String(err.message) || '')
    if (m) {
      const line = Number(m[1])
      const lines = src.split('\n')
      const ctx = (lines[line - 1] || '').slice(0, 160)
      console.log(`      near line ${line}: ${ctx}`)
    }
  }

  // 2. Count method usages that must be polyfill-covered (informational)
  let used = []
  for (const re of polyfillCoveredMethods) {
    const n = (src.match(re) || []).length
    if (n > 0) used.push(`${re.source.replace(/\\|\(|\)/g, '')}×${n}`)
  }
  if (used.length) console.log(`      polyfill-covered methods present: ${used.join(', ')}`)
}

// 3. Verify the polyfill file itself parses as ES5 (2017? No — ES5!)
const polyPath = path.join(__dirname, '..', 'src', 'lib', 'legacyPolyfills.js')
const polySrc = fs.readFileSync(polyPath, 'utf8')
try {
  acorn.parse(polySrc, { ecmaVersion: 5, sourceType: 'script' })
  console.log('PASS  legacyPolyfills.js parses as ES5 script')
} catch (err) {
  failed = true
  console.log(`FAIL  legacyPolyfills.js ES5 parse: ${err.message}`)
}

// 4. Verify the polyfill file is included in the main bundle (imported first)
const mainBundle = files.map((f) => fs.readFileSync(path.join(distAssets, f), 'utf8')).join('\n')
const polyfillMarkers = [
  'nokhbaGlobalThis__',
  'String.prototype.replaceAll',
]
for (const marker of polyfillMarkers) {
  if (mainBundle.includes(marker)) {
    console.log(`PASS  polyfill code present in bundle (marker: ${marker})`)
  } else {
    // minifier may have renamed locals but these are string/property keys that survive
    failed = true
    console.log(`FAIL  polyfill marker missing from bundle: ${marker}`)
  }
}

// 5. index.html watchdog present in built HTML
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8')
if (html.includes('__nokhbaBooted') && html.includes('إعادة المحاولة')) {
  console.log('PASS  dist/index.html contains boot watchdog + Arabic fallback')
} else {
  failed = true
  console.log('FAIL  dist/index.html missing boot watchdog')
}

// 6. CSS must be @layer-free (iOS Safari < 15.4 drops ALL @layer blocks →
//    unstyled page). scripts/unwrap-css-layers.mjs runs in npm run build.
const cssFiles = fs.readdirSync(distAssets).filter((f) => f.endsWith('.css'))
if (!cssFiles.length) {
  failed = true
  console.log('FAIL  no CSS files in dist/assets')
}
for (const cf of cssFiles) {
  const cssSrc = fs.readFileSync(path.join(distAssets, cf), 'utf8')
  const layerCount = (cssSrc.match(/@layer/g) || []).length
  if (layerCount > 0) {
    failed = true
    console.log(`FAIL  ${cf} still contains ${layerCount} @layer at-rule(s)`)
  } else {
    console.log(`PASS  ${cf} is @layer-free (visible to iOS Safari 12–15.3)`)
  }
  if (!cssSrc.includes('.flex{') || !cssSrc.includes('.hidden{')) {
    failed = true
    console.log(`FAIL  ${cf} missing core utilities (.flex / .hidden)`)
  }
}

console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS')
process.exit(failed ? 1 : 0)
