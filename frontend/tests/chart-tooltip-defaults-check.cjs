#!/usr/bin/env node
/* Round 15 — Chart.js tooltip crash + non-intrusive runtime diagnostics proof.
 *
 * USER REPORT (2026-09-10, live dashboard, Windows Chrome):
 *   Uncaught TypeError: Cannot read properties of undefined (reading 'call')
 *     at Tooltip._positionChanged → handleEvent → afterEvent → notifyPlugins
 *   …repeated on every mousemove over the attendance/scores charts, which
 *   auto-opened the Round 11 diagnostic overlay mid-work (read by the user
 *   as "the system reloads itself + this error appears").
 *
 * ROOT CAUSE (verified against chart.js@4.5.1 dist source):
 *   src/components/Charts.jsx did
 *       Chart.defaults.plugins.tooltip = { …styling… }
 *   — a WHOLESALE REPLACEMENT of Chart.js's global tooltip defaults, which
 *   wipes every built-in key it doesn't list: position:'average', enabled,
 *   mode, intersect, callbacks… On hover, Tooltip._positionChanged runs
 *       positioners[options.position].call(this, items, event)
 *   with options.position === undefined → positioners[undefined] ===
 *   undefined → ".call" of undefined → the exact reported TypeError.
 *
 * THIS TEST PROVES:
 *   A) Source: Charts.jsx merges (Object.assign) instead of replacing.
 *   B) Runtime: with the OLD replacement semantics, the chart.js 4.5.1
 *      positioner lookup throws the user's exact error; with the NEW merge
 *      semantics (same styling literal extracted from the real source file)
 *      it cannot throw, styling is applied, and built-ins survive.
 *   C) index.html (source + built): runtime errors while the app is alive
 *      now raise the red badge only — the full overlay auto-open branch
 *      (shownCount === 0 → show('runtime')) is gone; boot failures and
 *      React crashes still open the overlay; badge click still opens the
 *      full report; error capture/persistence is untouched.
 *   D) Built bundle: tooltip styling shipped + no wholesale
 *      `.plugins.tooltip = {` assignment survives minification.
 */
const fs = require('fs')
const path = require('path')

const FE = path.join(__dirname, '..')
let failed = false
const fail = (msg) => { failed = true; console.log('  FAIL  ' + msg) }
const ok = (msg) => console.log('  OK    ' + msg)

/* strip comments so code-pattern checks can't be fooled by comment text */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/* ══ A) source wiring ═══════════════════════════════════════════════════ */
const chartsPath = path.join(FE, 'src', 'components', 'Charts.jsx')
const chartsSrc = fs.readFileSync(chartsPath, 'utf8')
const chartsCode = stripComments(chartsSrc)

if (/Object\.assign\(Chart\.defaults\.plugins\.tooltip,\s*\{/.test(chartsCode)) ok('Charts.jsx MERGES tooltip styling via Object.assign (Round 15 fix)')
else fail('Charts.jsx must use Object.assign(Chart.defaults.plugins.tooltip, {...})')

if (!/\bChart\.defaults\.plugins\.tooltip\s*=\s*\{/.test(chartsCode)) ok('Charts.jsx no longer REPLACES the tooltip defaults object')
else fail('Charts.jsx still contains the destructive `Chart.defaults.plugins.tooltip = {` assignment')

if (/import Chart from 'chart\.js\/auto'/.test(chartsSrc)) ok('chart.js/auto import intact (single registration path)')

/* extract the REAL styling literal from the source (no duplication) */
const litMatch = chartsCode.match(/Object\.assign\(Chart\.defaults\.plugins\.tooltip,\s*(\{[\s\S]*?\})\s*\)/)
if (!litMatch) { fail('cannot extract the tooltip styling literal from Charts.jsx'); process.exit(1) }
const styling = new Function('return (' + litMatch[1] + ')')()
if (styling.backgroundColor === '#0E2954' && styling.padding === 10 && styling.cornerRadius === 8 && styling.displayColors === false) {
  ok(`styling literal extracted from source (${Object.keys(styling).length} keys) and parses`)
} else {
  fail('extracted styling literal looks wrong: ' + JSON.stringify(styling))
}

/* ══ B) runtime proof — chart.js 4.5.1 semantics ════════════════════════ */
/* built-in defaults exactly as chart.js@4.5.1 ships them (see the plugin
 * `defaults` block in dist/chart.umd.js) + the two built-in positioners */
const builtinTooltipDefaults = {
  enabled: true, external: null, position: 'average',
  backgroundColor: 'rgba(0,0,0,0.8)', titleColor: '#fff', titleFont: { weight: 'bold' },
  bodyColor: '#fff', bodyFont: {}, callbacks: { label: function () { return 'label' } },
  mode: 'nearest', intersect: true,
}
const positioners = {
  average: function () { return { x: 10, y: 20 } },
  nearest: function () { return { x: 30, y: 40 } },
}
/* the exact statement chart.js 4.5.1 executes on every hover event */
const positionChanged = (tooltip) => {
  const pos = positioners[tooltip.options.position].call(tooltip, [], {})
  return pos !== false && (tooltip.caretX !== pos.x || tooltip.caretY !== pos.y)
}

/* OLD behavior (Round ≤ 14 = what is deployed live): wholesale replacement */
const oldDefaults = styling /* what `Chart.defaults.plugins.tooltip = styling` leaves behind */
const oldTooltip = { caretX: 0, caretY: 0, options: Object.assign({}, oldDefaults) }
let oldThrew = null
try { positionChanged(oldTooltip) } catch (e) { oldThrew = e }
if (oldThrew && oldThrew instanceof TypeError && /Cannot read propert.*'call'/.test(oldThrew.message)) {
  ok(`CONTROL: old replacement semantics reproduce the live crash — TypeError: ${oldThrew.message}`)
} else {
  fail('old replacement semantics should throw the exact reported TypeError, got: ' + (oldThrew && oldThrew.message))
}
if (oldTooltip.options.position === undefined) ok('CONTROL: old code resolves options.position === undefined (positioners[undefined] → .call of undefined)')

/* NEW behavior (Round 15): merge onto the intact built-in defaults */
const newDefaults = Object.assign({}, builtinTooltipDefaults, styling) /* what Object.assign produces on the live object */
const newTooltip = { caretX: 0, caretY: 0, options: Object.assign({}, newDefaults) }
let newThrew = null
try { positionChanged(newTooltip) } catch (e) { newThrew = e }
if (!newThrew) ok('FIX: merge semantics — positioner resolves + .call() runs with ZERO throw on hover')
else fail('merge semantics must not throw: ' + newThrew.message)

if (newTooltip.options.position === 'average') ok("FIX: built-in position:'average' survives the styling merge")
else fail('position default lost: ' + newTooltip.options.position)
if (newTooltip.options.enabled === true && newTooltip.options.mode === 'nearest' && typeof newTooltip.options.callbacks.label === 'function') {
  ok('FIX: other built-ins survive too (enabled / mode / callbacks)')
} else {
  fail('built-in tooltip defaults were clobbered by the merge')
}
if (newTooltip.options.backgroundColor === '#0E2954' && newTooltip.options.titleColor === '#D4A373' && newTooltip.options.padding === 10) {
  ok('FIX: our styling IS applied on top (colors / padding / radius)')
} else {
  fail('styling keys not applied: ' + JSON.stringify(newTooltip.options))
}

/* ══ C) diagnostic engine — badge instead of screen hijack ══════════════ */
const srcHtml = fs.readFileSync(path.join(FE, 'index.html'), 'utf8')
const srcHtmlCode = stripComments(srcHtml)

if (!/shownCount\s*===\s*0\s*\)\s*\{\s*show\('runtime'\)/.test(srcHtmlCode)) ok('engine: first-runtime-error overlay auto-open branch REMOVED (badge path only)')
else fail('engine still auto-opens the overlay for the first runtime error')
if (/else\s*\{\s*updateBadge\(\)\s*\}/.test(srcHtmlCode.replace(/\s+/g, ' '))) ok('engine: runtime errors while booted → updateBadge() only')
else fail('engine runtime-error path must call updateBadge()')
if (/if \(!booted\(\)\)\s*\{\s*show\('boot'\)/.test(srcHtmlCode)) ok('engine: boot failures STILL open the overlay (blank-page protection intact)')
else fail('boot-failure overlay behavior must stay')
if (/function showReactError/.test(srcHtmlCode) && /show\('react'\)/.test(srcHtmlCode)) ok('engine: React crashes STILL open the non-dismissable overlay')
else fail('react-crash overlay behavior must stay')
if (/badgeEl\.onclick = function \(\) \{ show\('runtime'\) \}/.test(srcHtmlCode)) ok('engine: red badge click still opens the full report (one tap)')
else fail('badge → full report path missing')
if (/function persistCrash/.test(srcHtmlCode) && srcHtmlCode.includes('__nokhbaLastCrash')) ok('engine: error capture + persistence untouched')
else fail('crash capture/persistence must not change')

/* ══ D) built output (run AFTER `npm run build`) ════════════════════════ */
const distHtmlPath = path.join(FE, 'dist', 'index.html')
if (fs.existsSync(distHtmlPath)) {
  const distHtml = fs.readFileSync(distHtmlPath, 'utf8')
  const distHtmlCode = stripComments(distHtml)
  if (!/shownCount\s*===\s*0\s*\)\s*\{\s*show\('runtime'\)/.test(distHtmlCode)) ok('dist/index.html: runtime-error auto-open branch gone from the SHIPPED engine')
  else fail('dist/index.html still auto-opens the overlay on first runtime error')
  if (/badgeEl\.onclick = function \(\) \{ show\('runtime'\) \}/.test(distHtmlCode)) ok('dist/index.html: badge → report path shipped')

  const assetsDir = path.join(FE, 'dist', 'assets')
  const bundleFile = fs.readdirSync(assetsDir).filter((f) => f.startsWith('index-') && f.endsWith('.js'))[0]
  if (bundleFile) {
    const blob = fs.readFileSync(path.join(assetsDir, bundleFile), 'utf8')
    if (blob.includes('#0E2954') && blob.includes('Cairo')) ok(`dist bundle: tooltip styling shipped (${bundleFile})`)
    else fail('dist bundle missing tooltip styling strings')
    if (/Object\.assign\(\w+\.defaults\.plugins\.tooltip\s*,\s*\{/.test(blob)) ok('dist bundle: merge call survives minification (Object.assign on .defaults.plugins.tooltip)')
    else fail('dist bundle: Object.assign merge call not found (did the build pick up the fix?)')
    if (!/\w+\.defaults\.plugins\.tooltip\s*=\s*\{/.test(blob)) ok('dist bundle: no wholesale tooltip-defaults assignment anywhere')
    else fail('dist bundle still contains a wholesale .plugins.tooltip = { assignment')
  } else {
    fail('no index-*.js bundle in dist/assets')
  }
} else {
  fail('dist/index.html not built — run npm run build first (source-level checks above already ran)')
}

if (failed) { console.log('\nCHART TOOLTIP + DIAGNOSTIC BADGE CHECK: FAILED'); process.exit(1) }
console.log('\nCHART TOOLTIP + DIAGNOSTIC BADGE CHECK: PASSED — hover crash eliminated, runtime errors badge-only')
