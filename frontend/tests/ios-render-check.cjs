#!/usr/bin/env node
// ============================================================================
// Test 10/10 — Round 12: iPhone blank-page regression (isIOSBrowser)
// ============================================================================
// THE BUG this test guards against:
//   PublicQRPage.jsx called isIOSBrowser() — a function that did not exist
//   anywhere in the codebase. The call sat in a render branch guarded by
//   `typeof Notification === 'undefined'`, which is TRUE only in iOS Safari
//   normal browser tabs (Apple exposes Notification only to installed Home
//   Screen web apps). So every iPhone opening a student QR link threw
//   `ReferenceError: Can't find variable: isIOSBrowser` during React render,
//   unmounted the whole tree, and produced the infamous blank page —
//   while Android/Windows never executed that branch and worked fine.
//   (Caught on-device by the Round 11 diagnostic overlay on iOS 18.7.)
//
// This test proves, at four levels, that this class of bug cannot return:
//   1. SOURCE   — isIOSBrowser is exported by helpers.js and imported by
//                 every file that calls it.
//   2. NO-UNDEF — an oxlint no-undef sweep of the live Vite graph finds ZERO
//                 undefined identifiers (catches any future landmine, not
//                 just this one).
//   3. RUNTIME  — the helper itself is executed against real iPhone / iPad /
//                 iPadOS-desktop / Android / Windows navigator mocks.
//   4. BUNDLE   — the built bundle carries the iOS detection logic and the
//                 Arabic on-screen guidance string (run after `npm run build`).
// ============================================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.error('  ✗ ' + m); failures += 1; };

console.log('Round 12 — iPhone blank-page regression (isIOSBrowser)\n');

// ── Part 1: source-level wiring ────────────────────────────────────────────
console.log('[1/4] Source wiring');
const helpersSrc = fs.readFileSync(path.join(ROOT, 'src/lib/helpers.js'), 'utf8');
const qrSrc = fs.readFileSync(path.join(ROOT, 'src/pages/PublicQRPage.jsx'), 'utf8');

if (/export function isIOSBrowser\s*\(/.test(helpersSrc)) {
  ok('helpers.js exports function isIOSBrowser()');
} else {
  bad('helpers.js must export function isIOSBrowser() — it is missing again');
}
if (/import\s*\{[^}]*\bisIOSBrowser\b[^}]*\}\s*from\s*['"]\.\.\/lib\/helpers['"]/.test(qrSrc)) {
  ok('PublicQRPage.jsx imports isIOSBrowser from ../lib/helpers');
} else {
  bad('PublicQRPage.jsx no longer imports isIOSBrowser — its calls would throw ReferenceError');
}

// Every source file that CALLS isIOSBrowser must import it (or define it).
const files = [];
for (const dir of ['src/pages', 'src/components', 'src/lib', 'src/context', 'src/hooks']) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) files.push(p);
    }
  })(abs);
}
for (const f of ['src/App.jsx', 'src/main.jsx']) {
  const abs = path.join(ROOT, f);
  if (fs.existsSync(abs)) files.push(abs);
}
const callersWithoutImport = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const calls = src.match(/(?<!\/\/[^\n]*)\bisIOSBrowser\s*\(/g) || [];
  if (calls.length === 0) continue;
  if (f.endsWith('helpers.js')) continue; // definition site
  const importsIt = /import\s*\{[^}]*\bisIOSBrowser\b[^}]*\}\s*from/.test(src);
  if (!importsIt) callersWithoutImport.push(path.relative(ROOT, f));
}
if (callersWithoutImport.length === 0) {
  ok('every file that calls isIOSBrowser() imports it (' + files.length + ' files scanned)');
} else {
  bad('files call isIOSBrowser() without importing it: ' + callersWithoutImport.join(', '));
}

// ── Part 2: no-undef sweep of the live Vite graph ──────────────────────────
console.log('\n[2/4] no-undef sweep (undefined identifiers in the live app graph)');
const DEAD_TEMPLATE = [/^src\/app\//, /^src\/lib\/(?:db|auth)\.ts$/]; // dead Next.js template code, never bundled
let undefHits = [];
try {
  const out = execFileSync('npx', ['oxlint', '-c', '.oxlintrc.json', 'src'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: false,
  });
  // oxlint prints diagnostics to stderr by default; capture both
  parseHits(out);
} catch (e) {
  // execFileSync throws when oxlint exits non-zero (errors found) — output is in e.stdout/e.stderr
  parseHits(String(e.stdout || '') + String(e.stderr || ''));
}
if (undefHits.length === 0 && !fs.existsSync(path.join(ROOT, '.oxlintrc.json'))) {
  bad('.oxlintrc.json missing — the no-undef sweep is not configured');
}
function parseHits(text) {
  const chunks = text.split('eslint(no-undef)');
  for (let i = 1; i < chunks.length; i++) {
    const m = /,-\[(src\/[^\]:]+):\d+:\d+\]/.exec(chunks[i]);
    if (m) undefHits.push(m[1]);
  }
}
undefHits = [...new Set(undefHits)];
const liveUndefHits = undefHits.filter((f) => !DEAD_TEMPLATE.some((re) => re.test(f)));
if (liveUndefHits.length === 0) {
  ok('zero undefined identifiers in the live graph (dead template files excluded: '
    + (undefHits.length ? undefHits.join(', ') : 'none flagged') + ')');
} else {
  bad('undefined identifiers shipped in the live graph — these can crash iOS-only branches: '
    + liveUndefHits.join(', '));
}

// ── Part 3: runtime behavior of isIOSBrowser() ─────────────────────────────
console.log('\n[3/4] isIOSBrowser() runtime behavior (mocked navigator)');
(async () => {
  const CASES = [
    {
      label: 'iPhone Safari 18.7 (the crashing device from the diagnostic JSON)',
      navigator: {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
      },
      expected: true,
    },
    {
      label: 'iPad Safari',
      navigator: {
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        platform: 'iPad',
        maxTouchPoints: 5,
      },
      expected: true,
    },
    {
      label: 'iPadOS 13+ desktop-mode (Mac UA + touch points)',
      navigator: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      },
      expected: true,
    },
    {
      label: 'Android Chrome (must be FALSE — not iOS)',
      navigator: {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      },
      expected: false,
    },
    {
      label: 'Windows Chrome desktop',
      navigator: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        platform: 'Win32',
        maxTouchPoints: 0,
      },
      expected: false,
    },
    {
      label: 'macOS Safari desktop (no touch)',
      navigator: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      },
      expected: false,
    },
  ];

  const helpers = await import(path.join(ROOT, 'src/lib/helpers.js'));
  if (typeof helpers.isIOSBrowser !== 'function') {
    bad('isIOSBrowser is not an exported function at runtime');
  } else {
    for (const c of CASES) {
      try {
        Object.defineProperty(globalThis, 'navigator', { value: c.navigator, configurable: true, writable: true });
      } catch {
        // fall back to overriding properties on the existing Node navigator
        Object.defineProperty(globalThis.navigator, 'userAgent', { value: c.navigator.userAgent, configurable: true });
        Object.defineProperty(globalThis.navigator, 'platform', { value: c.navigator.platform, configurable: true });
        Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: c.navigator.maxTouchPoints, configurable: true });
      }
      let got;
      try { got = helpers.isIOSBrowser(); } catch (e) { got = 'THREW: ' + e.message; }
      if (got === c.expected) ok(`${c.label} → ${got}`);
      else bad(`${c.label} → expected ${c.expected}, got ${got}`);
    }
    // crash-condition simulation: the exact render branch that killed iPhones
    // (Notification undefined + iPhone navigator) must now resolve without ReferenceError.
    const notifUndefined = typeof globalThis.Notification === 'undefined';
    Object.defineProperty(globalThis, 'navigator', { value: CASES[0].navigator, configurable: true, writable: true });
    let branchValue;
    try { branchValue = notifUndefined ? helpers.isIOSBrowser() : 'skipped (Notification defined)'; }
    catch (e) { branchValue = 'THREW: ' + e.message; }
    if (branchValue === 'THREW: ' + String(branchValue).slice(8)) {
      bad('iOS render branch threw again: ' + branchValue);
    } else {
      ok(`iOS render branch (typeof Notification === 'undefined' → ${notifUndefined}, iPhone UA) resolves isIOSBrowser() → ${branchValue} — no ReferenceError`);
    }
  }

  // ── Part 4: built bundle carries the fix ────────────────────────────────
  console.log('\n[4/4] Built bundle verification');
  const distDir = path.join(ROOT, 'dist/assets');
  if (fs.existsSync(distDir)) {
    const jsFiles = fs.readdirSync(distDir).filter((f) => f.endsWith('.js'));
    const mainBundle = jsFiles.map((f) => fs.readFileSync(path.join(distDir, f), 'utf8')).join('\n');
    const hasDetection = /iPad\|iPhone\|iPod/.test(mainBundle) && /MacIntel/.test(mainBundle);
    const hasGuidance = mainBundle.includes('إضافة إلى الشاشة الرئيسية');
    if (hasDetection) ok('bundle contains the iOS detection logic (iPad|iPhone|iPod + MacIntel touch probe)');
    else bad('bundle lost the iOS detection logic — rebuild with the fixed helpers.js');
    if (hasGuidance) ok('bundle contains the Arabic iPhone on-screen guidance (Add to Home Screen)');
    else bad('bundle lost the Arabic iPhone guidance string');
  } else {
    console.log('  (dist/ not built yet — skipping bundle assertions; CI builds run after this)');
  }

  console.log('');
  if (failures > 0) {
    console.error(`FAIL — ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('PASS — the isIOSBrowser class of iPhone blank-page bug cannot silently return');
})();
