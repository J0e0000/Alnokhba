#!/usr/bin/env node
/* Capture every page/section of Alnokhba Edu and compose a visual-tour PDF.
   Live site: landing, login, signup, privacy, QR portal.
   Demo build: dashboard, day timeline, session workspace tabs, all areas,
   dark mode, mobile views.
   Output: download/Alnokhba-Website-Tour-<date>.pdf via Chromium print. */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const DEMO = process.argv[2] || 'http://localhost:4174'
const LIVE = 'https://al-nokhbba.vercel.app'
const OUTDIR = '/home/z/my-project/perf-results/tour'
fs.mkdirSync(OUTDIR, { recursive: true })

const shots = []
async function snap(page, name, labelAr, labelEn, opts = {}) {
  // Hide transient connectivity banners so the tour shows the app itself.
  await page.evaluate(() => document.querySelectorAll('[role="alert"]').forEach((e) => { e.style.display = 'none' })).catch(() => {})
  const file = path.join(OUTDIR, `${shots.length + 1}-${name}.png`)
  await page.screenshot({ path: file, fullPage: !!opts.full, ...(opts.clip ? { clip: opts.clip } : {}) })
  shots.push({ file, labelAr, labelEn })
  console.log(`  ✓ ${labelEn}`)
}

const browser = await chromium.launch()
console.log('1/4 LIVE public pages')
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' })
  await page.goto(`${LIVE}/`, { waitUntil: 'load' }); await page.waitForTimeout(2500)
  await snap(page, 'landing-hero', 'الصفحة الرئيسية — الواجهة', 'Landing — hero', {})
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await page.waitForTimeout(900)
  await snap(page, 'landing-features', 'الرئيسية — المزايا والأسئلة', 'Landing — features & footer', {})
  await page.goto(`${LIVE}/?auth=login`, { waitUntil: 'load' }); await page.waitForTimeout(1500)
  await snap(page, 'login', 'تسجيل الدخول', 'Login', {})
  await page.goto(`${LIVE}/?auth=signup`, { waitUntil: 'load' }); await page.waitForTimeout(1500)
  await snap(page, 'signup', 'إنشاء حساب', 'Signup', {})
  await page.goto(`${LIVE}/privacy`, { waitUntil: 'load' }); await page.waitForTimeout(1500)
  await snap(page, 'privacy', 'سياسة الخصوصية', 'Privacy page', {})
  await page.goto(`${LIVE}/qr/baselinetesttoken12345`, { waitUntil: 'load' }); await page.waitForTimeout(2500)
  await snap(page, 'qr-portal', 'بوابة الطالب (رابط QR)', 'Student Portal (QR link)', {})
  await page.close()
}

console.log('2/4 DEMO — teacher flows (desktop)')
let page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' })
await page.goto(`${DEMO}/?auth=login`, { waitUntil: 'load' })
await page.fill('input[type="email"]', 'perf@nokhba.test')
await page.fill('input[type="password"]', 'perf1234')
await page.locator('button[type="submit"]').first().click()
await page.waitForSelector('text=نظرة عامة', { timeout: 30000, state: 'attached' })
await page.waitForTimeout(1800)
for (const label of ['إغلاق', 'تخطي', 'تم', 'إنهاء', 'التالي']) {
  const b = page.locator(`button:has-text("${label}")`).first()
  if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await page.waitForTimeout(300) }
}
await snap(page, 'dashboard', 'لوحة اليوم — نظرة عامة', 'Dashboard — today overview', { full: true })

await step_open_session()
async function step_open_session() {
  const card = page.locator('.nk-session-card').first()
  if (await card.isVisible().catch(() => false)) { await card.click(); await page.waitForTimeout(1800) }
}

const TABS = [
  ['الحضور', 'workspace-attendance', 'مساحة الحصة — الحضور', 'Workspace — attendance'],
  ['التفاعل', 'workspace-homework', 'مساحة الحصة — التفاعل والواجب', 'Workspace — interaction & homework'],
  ['الدرجات', 'workspace-exams', 'مساحة الحصة — الدرجات', 'Workspace — exams'],
  ['التقرير', 'workspace-report', 'مساحة الحصة — التقرير والإنهاء', 'Workspace — report & finish'],
]
for (const [tab, name, ar, en] of TABS) {
  const b = page.locator(`button:has-text("${tab}")`).first()
  if (await b.isVisible().catch(() => false)) { await b.click({ force: true }); await page.waitForTimeout(900); await snap(page, name, ar, en, { full: true }) }
}
// exit workspace back to overview if a close button exists
const backBtn = page.locator('button:has-text("نظرة عامة"), button[aria-label*="رجوع"]').first()
if (await backBtn.isVisible().catch(() => false)) { await backBtn.click({ force: true }).catch(() => {}); await page.waitForTimeout(600) }

const AREAS = [
  ['الطلاب', 'students', 'إدارة الطلاب', 'Students area'],
  ['سجل الطالب', 'history', 'سجل الطالب', 'Student history'],
  ['التقارير', 'reports', 'التقارير و QR', 'Reports & QR'],
  ['التحليلات', 'analytics', 'التحليلات والرسوم', 'Analytics & charts'],
  ['الإعدادات', 'settings', 'الإعدادات', 'Settings'],
]
for (const [label, name, ar, en] of AREAS) {
  await page.locator(`button:has-text("${label}")`).first().click({ force: true })
  await page.waitForTimeout(name === 'analytics' ? 2600 : 1000)
  await snap(page, name, ar, en, { full: name === 'students' })
}

console.log('3/4 Dark mode')
{
  // JS click — the offline/alert banner may overlay the topbar and intercept
  // real pointer events (Playwright actionability), but the button still works.
  const themeBefore = await page.evaluate(() => document.documentElement.className)
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /الوضع|theme/i.test(`${x.title} ${x.getAttribute('aria-label') || ''}`)); if (b) b.click() })
  await page.waitForTimeout(800)
  await page.locator('button:has-text("نظرة عامة")').first().click({ force: true }).catch(() => {})
  await page.waitForTimeout(900)
  await snap(page, 'dark-dashboard', 'الوضع الليلي — لوحة اليوم', 'Dark mode — dashboard', { full: true })
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /الوضع|theme/i.test(`${x.title} ${x.getAttribute('aria-label') || ''}`)); if (b) b.click() })
  await page.waitForTimeout(500)
  console.log(`  (theme ${themeBefore} → ${await page.evaluate(() => document.documentElement.className)})`)
}
await page.close()

console.log('4/4 Mobile (390px)')
{
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-EG', isMobile: true, hasTouch: true })
  await m.goto(`${DEMO}/?auth=login`, { waitUntil: 'load' })
  await m.fill('input[type="email"]', 'perf@nokhba.test')
  await m.fill('input[type="password"]', 'perf1234')
  await m.locator('button[type="submit"]').first().click()
  await m.waitForSelector('text=نظرة عامة', { timeout: 30000, state: 'attached' })
  await m.waitForTimeout(1800)
  for (const label of ['إغلاق', 'تخطي', 'تم', 'إنهاء', 'التالي']) {
    const b = m.locator(`button:has-text("${label}")`).first()
    if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await m.waitForTimeout(300) }
  }
  await snap(m, 'mobile-dashboard', 'الجوال — لوحة اليوم', 'Mobile — dashboard', { full: true })
  const card = m.locator('.nk-session-card').first()
  if (await card.isVisible().catch(() => false)) { await card.click(); await m.waitForTimeout(1600); await snap(m, 'mobile-workspace', 'الجوال — مساحة الحصة', 'Mobile — session workspace', { full: true }) }
  await m.locator('button:has-text("الطلاب")').first().click({ force: true }).catch(() => {})
  await m.waitForTimeout(900)
  await snap(m, 'mobile-students', 'الجوال — الطلاب', 'Mobile — students', {})
  await m.close()
}
await browser.close()

// ── compose PDF via Chromium print (native Arabic shaping) ────────────────
const imgs = shots.map((s, i) => {
  const b64 = fs.readFileSync(s.file).toString('base64')
  return `<section class="shot"><h2><span class="n">${i + 1}</span> ${s.labelEn} <span class="ar">— ${s.labelAr}</span></h2><img src="data:image/png;base64,${b64}"/></section>`
}).join('\n')

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 14mm 12mm; }
  * { font-family: 'Segoe UI', Tahoma, 'Noto Sans', sans-serif; box-sizing: border-box; }
  body { margin: 0; color: #172033; }
  .cover { page-break-after: always; display: flex; flex-direction: column; justify-content: center; height: 250mm; }
  .cover h1 { font-size: 30px; margin: 0 0 8px; }
  .cover .sub { color: #64748b; font-size: 13px; line-height: 1.9; }
  .cover .box { margin-top: 26px; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px; background: #f8fafc; font-size: 12px; line-height: 2; }
  .shot { page-break-inside: avoid; margin: 0 0 14px; }
  .shot h2 { font-size: 12.5px; margin: 0 0 5px; color: #0E2954; }
  .shot h2 .n { display: inline-block; background: #0E2954; color: #fff; border-radius: 6px; padding: 1px 7px; margin-inline-end: 6px; font-size: 11px; }
  .shot h2 .ar { color: #64748b; font-weight: 600; }
  .shot img { width: 100%; border: 1px solid #e2e8f0; border-radius: 10px; }
</style></head><body dir="rtl">
<div class="cover">
  <h1>Alnokhba Edu — Website Tour<br/><span style="font-size:20px;color:#64748b">جولة مصورة في كل صفحات وأقسام المنصة</span></h1>
  <div class="sub">Generated ${new Date().toISOString().slice(0, 10)} · after the performance optimization round (deploy ${new Date().toISOString().slice(11, 16)} UTC)</div>
  <div class="box">
    <b>Live site:</b> https://al-nokhbba.vercel.app<br/>
    <b>Pages captured:</b> ${shots.length} screenshots — public pages (landing, login, signup, privacy, student QR portal) + teacher workspace (dashboard, session tabs, students, history, reports, analytics, settings) + dark mode + mobile 390px views.<br/>
    <b>Note:</b> teacher-area screenshots use the demo dataset (بيئة تجريبية) — no real student data is included.
  </div>
</div>
${imgs}
</body></html>`

const tmp = path.join(OUTDIR, 'tour.html')
fs.writeFileSync(tmp, html)
const p2 = await chromium.launch()
const pg = await p2.newPage()
await pg.goto(`file://${tmp}`, { waitUntil: 'load' })
const out = `/home/z/my-project/download/Alnokhba-Website-Tour-2026-09-19.pdf`
fs.mkdirSync(path.dirname(out), { recursive: true })
await pg.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } })
await p2.close()
console.log(`PDF written: ${out} (${Math.round(fs.statSync(out).size / 1024)} KB, ${shots.length} shots)`)
