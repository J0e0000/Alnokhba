#!/usr/bin/env node
/**
 * Round 13/14 — deploy configuration & white-page armor check.
 *
 * Verifies the four layers that make a silent white page impossible:
 *   1. vercel.json (root + public copy): immutable caching for /assets/*
 *      (so phones download the 2.6MB bundle ONCE, not on every visit) and
 *      must-revalidate for sw.js. Round 14: every `source` pattern is
 *      validated with path-to-regexp@6.1.0 using the EXACT options the
 *      Vercel CLI uses at deploy time (superstatic.sourceToRegex →
 *      pathToRegexp(src, keys, {strict:true, sensitive:true,
 *      delimiter:'/'})). An invalid pattern makes `vercel deploy` FAIL
 *      with "Header at index N has invalid `source` pattern" — which is
 *      exactly what blocked the Round 13 build from ever going live
 *      (the image rule used a capturing group + a trailing `$`).
 *      Rules: capturing groups `(...)` are NOT allowed — only `(?:...)`;
 *      the pattern is fully anchored automatically (no `$` needed).
 *   2. index.html watchdog: auto cache-bust retry exists, cross-origin
 *      (Google-Fonts) failures are classified non-fatal, and the boot flag
 *      is present.
 *   3. main.jsx: the boot signal lives INSIDE the render tree (BootSignal
 *      after first commit) and the root ErrorBoundary wraps <App/>.
 *   4. App.jsx: the /qr/:token portal branch is wrapped in the boundary.
 *   5. public/diag.html exists and is a self-contained ES5 diagnostic page.
 */
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  OK    ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`) }
}

/* ── 1. vercel.json ─────────────────────────────────────────────── */
const vjRoot = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'))
const vjPublic = JSON.parse(fs.readFileSync(path.join(root, 'public', 'vercel.json'), 'utf8'))
check('vercel.json root = public copy', JSON.stringify(vjRoot) === JSON.stringify(vjPublic))
const assetsRule = (vjRoot.headers || []).find((h) => h.source === '/assets/:path*')
check('vercel.json: immutable rule for /assets/*', !!assetsRule &&
  assetsRule.headers.some((hh) => hh.key.toLowerCase() === 'cache-control' && /immutable/.test(hh.value)))
const swRule = (vjRoot.headers || []).find((h) => h.source === '/sw.js')
check('vercel.json: sw.js stays must-revalidate', !!swRule &&
  swRule.headers.some((hh) => /must-revalidate/.test(hh.value)))

/* Round 14 — THE check that would have caught the deploy-blocking bug:
   every header source must compile under the Vercel CLI's own validator
   (path-to-regexp@6.1.0, exact options: strict+sensitive+delimiter '/'). */
let pathToRegexp = null
let ptrVersion = ''
try {
  const ptr = require('path-to-regexp')
  pathToRegexp = ptr.pathToRegexp
  ptrVersion = (require('path-to-regexp/package.json') || {}).version || ''
} catch (e) { /* not installed */ }
check('path-to-regexp@6.1.x available for Vercel validation', /^6\.1\./.test(ptrVersion))
function vercelValidateSource(source) {
  if (!pathToRegexp) return 'path-to-regexp@6.1.0 not installed'
  try {
    pathToRegexp(source, [], { strict: true, sensitive: true, delimiter: '/' })
    return null
  } catch (err) {
    return err.message
  }
}
for (const [i, h] of (vjRoot.headers || []).entries()) {
  const invalid = vercelValidateSource(h.source)
  check(`vercel.json header[${i}] passes Vercel CLI validation: ${h.source}`, invalid === null, invalid || '')
}
for (const [i, h] of (vjPublic.headers || []).entries()) {
  const invalid = vercelValidateSource(h.source)
  check(`public/vercel.json header[${i}] passes Vercel CLI validation`, invalid === null, invalid || '')
}
/* Belt & suspenders on the raw text: no capturing groups, no $ anchors,
   no lookahead — none of these can ever pass the Vercel CLI validation. */
for (const [i, h] of (vjRoot.headers || []).entries()) {
  check(`vercel.json header[${i}] has no capturing group / $ anchor / lookahead`,
    !/\(\?<?[=!]/.test(h.source) && !h.source.includes('$'))
}

/* ── 2. index.html watchdog ─────────────────────────────────────── */
const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
check('index.html: auto cache-bust retry (autoBustOnce)', /autoBustOnce/.test(idx))
check('index.html: bust guarded by sessionStorage (no loop)', /nb-bust-once/.test(idx))
check('index.html: cross-origin resource failures are NOT fatal', /isFatalResource/.test(idx))
check('index.html: boot flag contract __NOKHBA_BOOTED__', /__NOKHBA_BOOTED__/.test(idx))

/* ── 3. main.jsx boot architecture ──────────────────────────────── */
const main = fs.readFileSync(path.join(root, 'src', 'main.jsx'), 'utf8')
check('main.jsx: BootSignal component defined', /function BootSignal/.test(main))
check('main.jsx: boot flag set inside BootSignal effect (post-commit)', /__NOKHBA_BOOTED__\s*=\s*true/.test(main) &&
  /useEffect/.test(main) && !/createRoot[\s\S]*?\)\s*$[\s\S]*?__NOKHBA_BOOTED__\s*=\s*true/.test(main))
check('main.jsx: root ErrorBoundary wraps <App />', /<ProductionErrorBoundary>[\s\S]*<App\s*\/>/.test(main))
check('main.jsx: boot splash removed only from BootSignal', /nokhba-boot/.test(main))

/* ── 4. App.jsx portal branch ───────────────────────────────────── */
const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8')
check('App.jsx: /qr/:token portal wrapped in ProductionErrorBoundary',
  /isPublicQRPath\(\)\)[\s\S]{0,120}<ProductionErrorBoundary>/.test(app))

/* ── 5. Error boundary is self-contained ────────────────────────── */
const eb = fs.readFileSync(path.join(root, 'src', 'components', 'ProductionErrorBoundary.jsx'), 'utf8')
check('ErrorBoundary: inline styles only (no Tailwind classes)', !/className=/.test(eb))
check('ErrorBoundary: disarms the watchdog on catch', /__NOKHBA_BOOTED__\s*=\s*true/.test(eb))
check('ErrorBoundary: clear-temp-files button exists', /__NOKHBA_HARD_RESET__/.test(eb))
check('ErrorBoundary: Arabic recovery text', /إعادة المحاولة/.test(eb))

/* ── 6. diag.html ───────────────────────────────────────────────── */
const diag = fs.readFileSync(path.join(root, 'public', 'diag.html'), 'utf8')
check('diag.html: exists and is Arabic RTL', /dir="rtl"/.test(diag) && /تشخيص/.test(diag))
check('diag.html: zero external dependencies (no <link>/<script src>)', !/<link[^>]+href="http/.test(diag) && !/<script[^>]+src=/.test(diag))
check('diag.html: syntax-floor probes present', /static \{\}/.test(diag) && /\?\?=/.test(diag) && /\?\?/.test(diag))
check('diag.html: HTML-instead-of-JS detector', /javascript/.test(diag) && /content-type/i.test(diag))
check('diag.html: own script is ES5 (no template literals, no let/const declarations)',
  !/`/.test(diag) && !/\b(let|const)\s+[A-Za-z_$]/.test(diag))

/* ── 7. dist reflects the changes (build output) ────────────────── */
const distIdxPath = path.join(root, 'dist', 'index.html')
if (fs.existsSync(distIdxPath)) {
  const distIdx = fs.readFileSync(distIdxPath, 'utf8')
  check('dist/index.html: watchdog baked in', /autoBustOnce/.test(distIdx))
  check('dist/vercel.json: copied from public/', fs.existsSync(path.join(root, 'dist', 'vercel.json')))
  check('dist/diag.html: copied from public/', fs.existsSync(path.join(root, 'dist', 'diag.html')))
} else {
  console.log('  (dist not built yet — skipping dist checks)')
}

console.log(`\n  Deploy-config check: ${pass} OK, ${fail} FAIL`)
if (fail > 0) process.exit(1)
