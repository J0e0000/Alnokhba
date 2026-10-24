// Task 44l — sanity tests for the WhatsApp renewal receipt builder.
import { buildRenewalReceiptMessage, buildRenewalQueueItem, buildRenewalQueueItems } from '../frontend/src/lib/renewalReceipt.js'

let pass = 0, fail = 0
const assert = (cond, label) => { if (cond) { pass++ } else { fail++; console.error('FAIL:', label) } }

// 1) Full receipt — days mode (camelCase)
const m1 = buildRenewalReceiptMessage({
  name: 'أحمد علي', teamName: 'فريق المعلمين', planName: 'باقة الترم',
  renewedAt: '2026-10-25T12:00:00Z', previousExpiresAt: '2026-10-20T00:00:00Z',
  newExpiresAt: '2026-11-24T23:59:59Z', daysAdded: 35,
})
assert(m1.includes('أكاديمية النخبة التعليمية'), 'branding header')
assert(m1.includes('وصل تجديد اشتراك'), 'receipt title')
assert(m1.includes('أحمد علي'), 'member name')
assert(m1.includes('فريق المعلمين'), 'team name')
assert(m1.includes('باقة الترم'), 'plan name')
assert(m1.includes('تاريخ التجديد'), 'renewal date line')
assert(m1.includes('مدة التجديد: ٣٥ يوم'), 'duration arabic-indic 35')
assert(m1.includes('كان ينتهي'), 'previous expiry line')
assert(m1.includes('ينتهي الاشتراك'), 'new expiry line')
assert(m1.includes('https://al-nokhbba.vercel.app'), 'site link')
assert(m1.includes('شكرًا لانضمامك لنخبة المعلمين'), 'footer')

// 2) Fixed-date renewal (snake_case from edge) — duration falls back to span
const it2 = buildRenewalQueueItem({
  id: 'r-1', name: 'سلمى', phone: '01010235834',
  previous_expires_at: '2026-11-01T00:00:00Z', new_expires_at: '2027-01-01T00:00:00Z',
})
assert(it2.phone === '201010235834', 'phone normalized to 20-prefix')
assert(it2.student === null && it2.name === 'سلمى', 'queue item shape (no student)')
assert(it2.message.includes('مدة التجديد: ٦١ يوم'), `span fallback 61 days → got: ${it2.message.match(/مدة التجديد: [^\n]*/)?.[0]}`)

// 3) Missing phone → filtered out of batch
const batch = buildRenewalQueueItems([
  { id: 'a', name: 'مع رقم', phone: '01155398439', new_expires_at: '2026-12-01' },
  { id: 'b', name: 'بدون رقم', phone: '', new_expires_at: '2026-12-01' },
], { teamName: 'تيم' })
assert(batch.length === 1 && batch[0].name === 'مع رقم', 'batch filters phoneless members')
assert(batch[0].message.includes('فريق: تيم'), 'team context merged')

// 4) Negative days (earlier expiry) labeled
const m4 = buildRenewalReceiptMessage({ name: 'x', daysAdded: -5, newExpiresAt: '2026-01-01' })
assert(m4.includes('تعديل للخلف'), 'negative duration labeled')

console.log(`\n${pass}/${pass + fail} PASS`)
process.exit(fail ? 1 : 0)
