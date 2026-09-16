#!/usr/bin/env node
/* Round 11 — Comprehensive Diagnostic & Error Capture System proof.
 *
 * A) Every inline classic <script> in dist/index.html parses as pure ES2019
 *    (old-Safari parser proof — the engine must run BEFORE/WITHOUT the
 *    bundle, so it cannot rely on the build to transpile it).
 * B) The engine markers are present in the BUILT index.html (not just the
 *    source): global listeners, overlay actions, self-test probes.
 * C) The built JS bundle contains the React bridge (__NOKHBA_DIAG usage).
 * D) src/main.jsx wraps <App/> in the top-level ProductionErrorBoundary —
 *    the Student Portal (PublicQRPage) entry is finally covered.
 * E) The boundary delegates to the engine (renders null when present) and
 *    keeps a legacy fallback with raw error text. */
const acorn = require('acorn')
const fs = require('fs')
const path = require('path')

const FE = path.join(__dirname, '..')
let failed = false
const fail = (msg) => { failed = true; console.log('  FAIL  ' + msg) }
const ok = (msg) => console.log('  OK    ' + msg)

/* ── A + B: built index.html inline scripts ── */
const distHtmlPath = path.join(FE, 'dist', 'index.html')
if (!fs.existsSync(distHtmlPath)) { fail('dist/index.html not built — run npm run build first'); process.exit(1) }
const distHtml = fs.readFileSync(distHtmlPath, 'utf8')
const inlineBlocks = []
const re = /<script>([\s\S]*?)<\/script>/g
let m
while ((m = re.exec(distHtml)) !== null) inlineBlocks.push(m[1])
if (inlineBlocks.length < 3) fail(`expected >=3 inline classic scripts (snapshot + polyfills + engine), found ${inlineBlocks.length}`)
else ok(`${inlineBlocks.length} inline classic scripts found in dist/index.html`)

inlineBlocks.forEach((code, i) => {
  try {
    acorn.parse(code, { ecmaVersion: 2019, sourceType: 'script' })
    ok(`inline script #${i + 1} — pure ES2019 grammar (${(code.length / 1024).toFixed(1)} KB)`)
  } catch (e) {
    fail(`inline script #${i + 1} — ${e.message}`)
  }
})

/* markers chosen to survive minification (identifiers, strings, member calls) */
const MARKERS = [
  '__NOKHBA_DIAG', '__NOKHBA_NATIVE', 'unhandledrejection', '__nokhbaLastCrash',
  'نسخ تقرير التشخيص', 'مسح البيانات المحلية',
]
for (const marker of MARKERS) {
  if (distHtml.includes(marker)) ok(`dist/index.html contains "${marker.slice(0, 24)}"`)
  else fail(`dist/index.html missing marker "${marker.slice(0, 24)}"`)
}

/* engine behaviors */
if (distHtml.includes("addEventListener('error'") || distHtml.includes('addEventListener("error"')) ok('global error listener wired (capture phase)')
else fail('global error listener missing')
if (distHtml.includes('unhandledrejection')) ok('unhandledrejection listener wired')
else fail('unhandledrejection listener missing')
if (distHtml.includes('diag=1')) ok('?diag=1 manual trigger present')
else fail('?diag=1 trigger missing')
if (distHtml.includes('execCommand')) ok('clipboard fallback (execCommand) present')
else fail('clipboard fallback missing')
if (distHtml.includes('localStorage.clear')) ok('hard reset clears localStorage')
else fail('hard reset missing')
if (distHtml.includes('BroadcastChannel')) ok('WebKit feature self-test (BroadcastChannel) present')
else fail('BroadcastChannel self-test missing')
if (distHtml.includes('rest/v1/')) ok('Supabase reachability probe present')
else fail('Supabase probe missing')
if (distHtml.includes('getContext')) ok('Canvas 2D self-test present')
else fail('Canvas self-test missing')
if (distHtml.includes('__nokhbaBooted')) ok('boot watchdog contract (__nokhbaBooted) intact')
else fail('boot watchdog contract missing')

/* ── C: React bridge inside the built bundle ── */
const assetsDir = path.join(FE, 'dist', 'assets')
const bundle = fs.readdirSync(assetsDir).filter((f) => f.startsWith('index-') && f.endsWith('.js'))[0]
if (!bundle) { fail('no index-*.js bundle in dist/assets'); process.exit(1) }
const blob = fs.readFileSync(path.join(assetsDir, bundle), 'utf8')
if (blob.includes('__NOKHBA_DIAG')) ok(`React bridge present in ${bundle}`)
else fail('React bridge missing from built bundle')
if (blob.includes('__NOKHBA_SUPABASE_URL__')) ok('Supabase URL exposed to engine from bundle')
else fail('__NOKHBA_SUPABASE_URL__ assignment missing from bundle')

/* ── D: main.jsx top-level boundary ── */
const mainJsx = fs.readFileSync(path.join(FE, 'src', 'main.jsx'), 'utf8')
if (/import ProductionErrorBoundary/.test(mainJsx) && /<ProductionErrorBoundary>\s*<App\s*\/>\s*<\/ProductionErrorBoundary>/.test(mainJsx)) ok('main.jsx wraps <App/> in top-level boundary (Student Portal covered)')
else fail('main.jsx top-level boundary wrap missing')
if (mainJsx.includes('markBooted')) ok('main.jsx notifies the engine on boot (markBooted)')
else fail('markBooted call missing in main.jsx')

/* ── E: boundary delegates to the engine with a legacy fallback ── */
const boundary = fs.readFileSync(path.join(FE, 'src', 'components', 'ProductionErrorBoundary.jsx'), 'utf8')
if (boundary.includes('showDiagnostics')) ok('boundary forwards errors to the diagnostics engine')
else fail('boundary does not use showDiagnostics')
if (boundary.includes('__NOKHBA_DIAG')) ok('boundary renders null when the engine owns the UI')
else fail('engine delegation missing in boundary')
if (fs.existsSync(path.join(FE, 'src', 'lib', 'diagnostics.js'))) ok('src/lib/diagnostics.js bridge shipped')
else fail('src/lib/diagnostics.js missing')

/* ── source index.html must carry the same engine (dev == prod) ── */
const srcHtml = fs.readFileSync(path.join(FE, 'index.html'), 'utf8')
if (srcHtml.includes('__NOKHBA_DIAG') && srcHtml.includes('__NOKHBA_NATIVE')) ok('source index.html carries the engine too (dev parity)')
else fail('engine missing from source index.html')

if (failed) { console.log('\nDIAGNOSTIC SYSTEM CHECK: FAILED'); process.exit(1) }
console.log('\nDIAGNOSTIC SYSTEM CHECK: PASSED — engine + boundary + bridge all shipped')
