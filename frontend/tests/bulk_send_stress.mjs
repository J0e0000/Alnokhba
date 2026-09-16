import assert from 'node:assert/strict'
import { sendWhatsApp, closeReusableWhatsAppWindow } from '../src/lib/helpers.js'

const opens = []
const navigations = []
const popup = {
  closed: false,
  focus() {},
  location: { set href(value) { navigations.push(value) } },
}
globalThis.window = { open: (url, target) => { opens.push({ url, target }); return popup } }
for (let i = 0; i < 250; i++) {
  const ok = sendWhatsApp(`0100000${String(i).padStart(4, '0')}`, `Report ${i}`)
  assert.equal(ok, true)
}
assert.equal(opens.length, 1)
assert.equal(opens[0].target, 'nokhba_whatsapp')
assert.equal(navigations.length, 250)
assert.ok(navigations.every((url) => url.includes('api.whatsapp.com/send')))
closeReusableWhatsAppWindow()
console.log('PASS: 250 sends completed with one reusable WhatsApp popup and 250 navigations')
