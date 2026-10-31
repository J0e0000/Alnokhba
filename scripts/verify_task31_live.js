// Task 31 live verification: boot SW registration gone, on-demand registration present, portal card reordered
const BASE = 'https://al-nokhbba.vercel.app'
async function getText(url) {
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.text()
}
const html = await getText(BASE + '/')
const entry = (html.match(/assets\/index-[\w-]+\.js/) || [])[0]
console.log('live entry:', entry)
const entryJs = await getText(`${BASE}/${entry}`)

const regCalls = [...entryJs.matchAll(/serviceWorker\.register\(.`\/sw\.js[^)]*\)/g)].length
console.log('SW register calls in entry:', regCalls, regCalls === 1 ? 'OK (on-demand only)' : 'FAIL')
console.log('boot-register pattern (register after caches cleanup) absent:', !/caches\.delete\([^)]*\)[^;]*;?.*serviceWorker\.register/.test(entryJs.slice(entryJs.indexOf('getRegistrations') - 200, entryJs.indexOf('getRegistrations') + 700)) ? 'OK' : 'CHECK')
console.log('getRegistration early-out present:', entryJs.includes('getRegistration(`/`)') || entryJs.includes("getRegistration(`/`)") ? 'OK' : 'FAIL')

// portal chunk
const portalRef = (entryJs.match(/[\w-]*PublicQRPage-[\w-]+\.js/) || [])[0]
console.log('portal chunk:', portalRef)
const portal = await getText(`${BASE}/assets/${portalRef.replace(/^.*\//, '')}`)
const hasBtn = portal.includes('تفعيل إشعارات ولي الأمر') || portal.includes('\\u062a\\u0641\\u0639\\u064a\\u0644')
console.log('enable button present:', hasBtn ? 'OK' : 'check-escaped')
// init from permission granted: look for permission===`granted` near useState area
console.log('permission-granted init present:', /permission===.granted./.test(portal) ? 'OK' : 'FAIL')
// collapsed default: useState(!1) count — just report
console.log('useState(!1) occurrences in portal chunk:', (portal.match(/useState\(!1\)/g) || []).length)
