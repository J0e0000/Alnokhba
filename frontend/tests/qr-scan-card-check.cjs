// Round 9 regression check — QR scanner resolves ANY student QR.
// The student card QR encodes the PORTAL LINK ({SITE}/qr/{token}). The scanner
// used to only match raw student UUIDs locally, so scanning a student's own
// card ALWAYS failed with "ده رابط بوابة الطالب" (circular: the card QR *is*
// the portal link). This verifies the fix:
//   1. Token path: scans resolve via student_qr_tokens (token → student_id).
//   2. URL extraction keeps working (/qr/TOKEN, query + hash stripped).
//   3. Revoked tokens are filtered out (revoked_at is null).
//   4. Fresh-closure indirection: html5-qrcode gets a stable callback that
//      always runs the LATEST handleDecoded (students list never freezes).
//   5. Offline/lookup-failure shows a retry hint, not "unknown code".
//   6. Cross-group students get a clear message.
//   7. No stale "رابط البوابة" circular error remains.
const fs = require('fs')

const read = (f) => fs.readFileSync(f, 'utf8')
let failures = 0
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

console.log('QR scanner card-fix regression checks:')

const scanner = read('src/components/QRScannerModal.jsx')
const mirror = fs.existsSync('supabase/src/components/QRScannerModal.jsx')
  ? read('supabase/src/components/QRScannerModal.jsx')
  : null

// 1. token → student resolution exists and queries the right table/fields
check('scanner imports the supabase client', /import\s*\{[^}]*supabase[^}]*\}\s*from\s*['"]\.\.\/lib\/supabaseClient['"]/.test(scanner))
check('token lookup queries student_qr_tokens', scanner.includes(".from('student_qr_tokens')"))
check('token lookup selects student_id', /\.select\('student_id'\)/.test(scanner))
check('token lookup filters by scanned code', scanner.includes(".eq('token', code)"))
check('revoked tokens are excluded', scanner.includes(".is('revoked_at', null)"))

// 2. URL extraction still handles /qr/ links (query + hash stripped)
check('/qr/ URL extraction with ?query and #hash stripping', scanner.includes("rawCode.split('/qr/').pop().split('?')[0].split('#')[0].trim()"))

// 3. fresh-closure indirection — the camera never freezes the students list
check('stable ref declared for latest handleDecoded', scanner.includes('const handleDecodedRef = useRef(null)'))
check('ref updated every render', scanner.includes('handleDecodedRef.current = handleDecoded'))
check('html5-qrcode receives the ref-indirection callback', scanner.includes('(decodedText) => handleDecodedRef.current?.(decodedText)'))
check('scanner no longer registers the raw closure', !/CONFIG,\s*\n?\s*handleDecoded,/.test(scanner))

// 4. failure states are honest
check('lookup failure shows a connection retry hint', scanner.includes('تعذر التحقق من الكود'))
check('unknown/revoked code suggests regenerating the card', scanner.includes('الكود غير معروف أو ملغي'))
check('cross-group student gets a clear message', scanner.includes('مش في القائمة المعروضة'))

// 5. the circular error is gone
check('circular "portal link, not attendance code" error removed', !scanner.includes('مش كود الحضور'))

// 6. mirror copy (embedded supabase app) stays in sync
if (mirror) {
  check('supabase mirror copy has the same token lookup', mirror.includes(".from('student_qr_tokens')") && mirror.includes('handleDecodedRef'))
  check('supabase mirror copy has no circular error either', !mirror.includes('مش كود الحضور'))
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll QR scanner card-fix checks passed')
