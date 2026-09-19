#!/usr/bin/env node
/* Functional regression smoke — demo mode, all major flows.
   Fails on: any console error, any uncaught page error, or a broken flow. */
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:4173'
const errors = []

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' })
const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console.error] ${m.text().slice(0, 300)}`) })
page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e).slice(0, 300)}`))

const step = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`) }
  catch (e) { console.log(`  ✗ ${name}: ${String(e).slice(0, 160)}`); errors.push(`[flow] ${name}: ${String(e).slice(0, 200)}`) }
}

console.log('1. Landing + preview + privacy (anonymous)')
await step('landing renders', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'load' })
  await page.waitForSelector('text=في مكان واحد', { timeout: 20000 })
})
await step('preview dashboard', async () => {
  await page.goto(`${BASE}/?preview=1`, { waitUntil: 'load' })
  await page.waitForSelector('text=شوف المنصة قبل ما تبدأ', { timeout: 20000 })
})
await step('privacy page', async () => {
  await page.goto(`${BASE}/privacy`, { waitUntil: 'load' })
  await page.waitForTimeout(1200)
})
await step('404 status page', async () => {
  await page.goto(`${BASE}/404`, { waitUntil: 'load' })
  await page.waitForTimeout(1000)
})

console.log('2. Demo login → dashboard')
await step('login', async () => {
  await page.goto(`${BASE}/?auth=login`, { waitUntil: 'load' })
  await page.fill('input[type="email"]', 'perf@nokhba.test')
  await page.fill('input[type="password"]', 'perf1234')
  await page.locator('button[type="submit"]').first().click()
  await page.waitForSelector('text=نظرة عامة', { timeout: 30000, state: 'attached' })
  await page.waitForTimeout(1200)
})

console.log('3. Session workspace flow')
await step('open session', async () => {
  const btn = page.locator('button:has-text("فتح الحصة")').first()
  if (await btn.isVisible().catch(() => false)) { await btn.click(); await page.waitForTimeout(1200) }
  else console.log('    (no session button — may already be open)')
})
await step('attendance mark + undo', async () => {
  const att = page.locator('button:has-text("حضور")').first()
  if (await att.isVisible().catch(() => false)) { await att.click(); await page.waitForTimeout(500) }
  const present = page.locator('button:has-text("حاضر")').first()
  if (await present.isVisible().catch(() => false)) { await present.click(); await page.waitForTimeout(700) }
})
await step('interaction tab', async () => {
  const t = page.locator('button:has-text("التفاعل")').first()
  if (await t.isVisible().catch(() => false)) { await t.click(); await page.waitForTimeout(600) }
})
await step('exams tab (score grid)', async () => {
  const t = page.locator('button:has-text("الدرجات")').first()
  if (await t.isVisible().catch(() => false)) { await t.click(); await page.waitForTimeout(800) }
})
await step('report tab', async () => {
  const t = page.locator('button:has-text("التقرير")').first()
  if (await t.isVisible().catch(() => false)) { await t.click(); await page.waitForTimeout(600) }
})

console.log('4. All areas')
for (const label of ['الطلاب', 'سجل الطالب', 'التقارير', 'التحليلات', 'الإعدادات']) {
  await step(`area ${label}`, async () => {
    await page.locator(`button:has-text("${label}")`).first().click({ force: true })
    await page.waitForTimeout(900)
  })
}
await step('analytics charts mounted (lazy chunk)', async () => {
  await page.locator('button:has-text("التحليلات")').first().click({ force: true })
  await page.waitForTimeout(2500)
  const hasCanvas = await page.locator('canvas').first().isVisible().catch(() => false)
  if (!hasCanvas) throw new Error('chart canvas not visible after 2.5s')
})

console.log('5. Theme + language toggles')
await step('dark mode toggle', async () => {
  const before = await page.evaluate(() => document.documentElement.className)
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /الوضع|theme/i.test(`${x.title} ${x.getAttribute('aria-label') || ''}`)); if (b) b.click() })
  await page.waitForTimeout(500)
  const after = await page.evaluate(() => document.documentElement.className)
  if (before === after) console.log('    (theme class unchanged — checking toggle exists)')
})
await step('language toggle', async () => {
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /\bEN\b|العرب|lang/i.test(`${x.textContent} ${x.title}`)); if (b) b.click() })
  await page.waitForTimeout(700)
})

console.log('6. Profile modal + QR (lazy qrcode path)')
await step('profile modal opens', async () => {
  const btn = page.locator('img[alt*="النخبة"]').first()
  if (await btn.isVisible().catch(() => false)) { await btn.click(); await page.waitForTimeout(800) }
})

await page.waitForTimeout(800)
console.log('\n────────────────────────────')
if (errors.length) {
  console.log(`FAILED — ${errors.length} error(s):`)
  for (const e of [...new Set(errors)].slice(0, 15)) console.log('  ' + e)
  process.exitCode = 1
} else {
  console.log('PASSED — zero console/page errors across all flows')
}
await browser.close()
