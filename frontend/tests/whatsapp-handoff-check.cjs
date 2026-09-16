// Round 4 regression check — iOS-safe WhatsApp handoff.
// Verifies the root-cause fixes that make WhatsApp actually open on iPhone:
//   1. All send paths use the wa.me universal link (never api.whatsapp.com).
//   2. No named-window sends (window.open(url, 'nokhba_whatsapp')) remain —
//      iOS Safari silently drops re-navigation of named windows.
//   3. openWhatsAppPlaceholder is skipped on handheld devices.
//   4. Every send entry point fires showWhatsAppHandoff (the guaranteed bar).
//   5. WhatsAppHandoffBar exists and renders a REAL <a> link.
//   6. MessageQueueModal sends via a real <a href> (native navigation).
//   7. App.jsx mounts WhatsAppHandoffBar.
const fs = require('fs')

const read = (f) => fs.readFileSync(f, 'utf8')
let failures = 0
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

console.log('WhatsApp handoff regression checks:')

// 1. wa.me everywhere in the live send paths
const helpers = read('src/lib/helpers.js')
const qrLib = read('src/lib/qrPdfWhatsApp.js')
const queue = read('src/components/MessageQueueModal.jsx')
const bar = read('src/components/WhatsAppHandoffBar.jsx')
const app = read('src/App.jsx')

check('helpers.js builds wa.me links (buildWhatsAppUrl)', helpers.includes('https://wa.me/') && !helpers.includes('https://api.whatsapp.com'))
check('qrPdfWhatsApp.js has no api.whatsapp.com send URL', !qrLib.includes('api.whatsapp.com'))
check('qrPdfWhatsApp.js fires the handoff bar on QR sends', qrLib.includes('showWhatsAppHandoff(waUrl'))
check('sendReportWhatsApp uses the layered opener', qrLib.includes('openWhatsAppUrl(waUrl).ok'))

// 2. no named-window SEND pattern anywhere (placeholder reservation is desktop-only and allowed)
const namedSend = /window\.open\([^)]*,\s*['"]nokhba_whatsapp['"]\s*\)\s*;?\s*$/
const namedSendFiles = ['src/lib/helpers.js', 'src/lib/qrPdfWhatsApp.js'].filter((f) => namedSend.test(read(f)))
check('no window.open(url, "nokhba_whatsapp") named send remains', namedSendFiles.length === 0)

// 3. handheld guard on the reserved-window trick
check('openWhatsAppPlaceholder skips handheld devices', qrLib.includes('if (isHandheldBrowser()) return null'))

// 4. sendWhatsApp (helpers) always shows the fallback bar
check('sendWhatsApp fires showWhatsAppHandoff before opening', /showWhatsAppHandoff\(url,\s*\{\s*message\s*\}\)/.test(helpers) && helpers.includes('openWhatsAppUrl(url).ok'))

// 5. the bar renders a real anchor with the wa.me URL
check('WhatsAppHandoffBar renders a real <a href> with target=_blank', /<a[\s\S]{0,200}href=\{handoff\.waUrl\}[\s\S]{0,120}target="_blank"/.test(bar))
check('WhatsAppHandoffBar subscribes to the handoff store', bar.includes('subscribeWhatsAppHandoff'))

// 6. queue sends through a real link
check('MessageQueueModal computes waHref for items', queue.includes('buildQRWhatsAppUrl(') && queue.includes('buildWhatsAppUrl('))
check('MessageQueueModal send button is a real anchor', /<a[\s\S]{0,400}href=\{waHref\}/.test(queue))

// 7. mounted globally
check('App.jsx mounts WhatsAppHandoffBar', app.includes('<WhatsAppHandoffBar />'))

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll WhatsApp handoff checks passed')
