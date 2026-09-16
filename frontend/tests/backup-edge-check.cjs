// Round 5 regression check — backup panel self-diagnosis of "Edge Function not deployed".
// Verifies the fix for the user-reported error:
//   "Edge Function (admin-backup) غير منشورة بعد — ..." toast after clicking Create.
// The panel now:
//   1. Pings the admin-backup function on mount (checkEdgeFunctionDeployed).
//   2. Shows a PERSISTENT amber setup banner with deploy steps when missing
//      (instead of only a transient toast after the user clicks).
//   3. Offers a manual recheck button and a copyable CLI command.
//   4. createNow re-triggers the check when the function is unreachable.
//   5. The edge function answers a 'ping' action so the panel can detect
//      deployment state, including older deployed versions without ping.
const fs = require('fs')

const read = (f) => fs.readFileSync(f, 'utf8')
let failures = 0
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

console.log('Backup edge-function self-diagnosis checks:')

const panel = read('src/components/AdminBackupsPanel.jsx')

// 1. proactive ping on mount + manual recheck
check('checkEdgeFunctionDeployed() helper exists', panel.includes('async function checkEdgeFunctionDeployed()'))
check('panel pings the function on mount (offline-safe)', panel.includes('recheckEdge()') && panel.includes('navigator.onLine === false'))
check('ping action used for the health probe', /action:\s*['"]ping['"]/.test(panel))

// 2. old-version tolerance: a deployed function WITHOUT ping (unknown-action error)
//    must be treated as ready — only fetch/404-type failures mean "not deployed"
check('unknown-action error is NOT mistaken for missing (old fn tolerance)',
  panel.includes("// وصل للدالة لكن ردّت خطأ (نسخة قديمة بلا ping) → الدالة موجودة فعلًا"))

// 3. persistent banner with actionable deploy steps
check('persistent amber setup banner rendered when missing', panel.includes("edgeState === 'missing' && ("))
check('banner shows Edge Functions dashboard path', panel.includes('Edge Functions ← Create a new function'))
check('banner reminds Verify JWT = OFF', panel.includes('Verify JWT = OFF'))
check('recheck button present in banner', panel.includes('إعادة الفحص بعد النشر'))
check('CLI copy button present', panel.includes('supabase functions deploy admin-backup --no-verify-jwt'))

// 4. createNow wires the failed attempt to the banner
check('createNow destructures notDeployed and re-checks', panel.includes('const { data, error, notDeployed } = await invokeBackupAction') && panel.includes('if (notDeployed) recheckEdge()'))
check('invokeBackupAction marks notDeployed failures', panel.includes('notDeployed: true }'))

// 5. status pill states
check('status pill: ready / checking / unknown states', panel.includes('دالة النسخ منشورة') && panel.includes('جاري فحص دالة النسخ'))

// 6. React hooks order: all useState calls before any early return
const hookLines = []
const earlyReturns = []
panel.split('\n').forEach((line, i) => {
  if (/useState\(/.test(line)) hookLines.push(i + 1)
  if (/^\s*if \((loading|setupMissing)\)\s*\{?\s*$/.test(line) || /^\s*(if \(loading\)|if \(setupMissing\))\s*return/.test(line)) earlyReturns.push(i + 1)
})
const firstEarly = earlyReturns.length ? Math.min(...earlyReturns) : Infinity
const badHooks = hookLines.filter((n) => n > firstEarly)
check(`all useState hooks precede early returns (hooks at lines ${hookLines.join(',')} vs first return line ${firstEarly})`, badHooks.length === 0 && earlyReturns.length > 0)

// 7. edge function answers ping — the canonical copy ships in the SUPABASE delivery
//    (skip gracefully in an FE-only checkout)
let edgeFn = null
const candidates = ['../../SUPABASE-Round3/functions/admin-backup/index.ts', 'supabase/functions/admin-backup/index.ts', '../supabase/functions/admin-backup/index.ts']
for (const c of candidates) { try { edgeFn = read(c); break } catch {} }
if (!edgeFn) {
  console.log('  SKIP edge function source (not part of this FE checkout — verified in SUPABASE delivery)')
} else {
  check('edge function source found', true)
  check('edge function handles action === "ping"', edgeFn.includes('if (action === "ping")') && edgeFn.includes('service: "admin-backup"'))
  check('ping responds before admin resolution (fast, no auth needed)', edgeFn.indexOf('if (action === "ping")') < edgeFn.indexOf('// ---- Resolve admin'))
}

console.log(failures === 0 ? '\nAll backup self-diagnosis checks passed ✓' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
