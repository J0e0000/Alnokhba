#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   perf-measure.mjs — Alnokhba Edu performance measurement harness
   Usage:
     node scripts/perf-measure.mjs --base=http://localhost:4173 --label=before \
          --profile=desktop|mobile --out=perf-results/before-desktop.json [--live]
   Scenarios:
     landing, login_to_dashboard, boot_metrics, open_session, mark_attendance,
     search_typing, nav_students, nav_history, nav_reports, nav_analytics,
     nav_settings, warm_reload
   Metrics per scenario: TTFB, FCP, LCP, CLS, long tasks, DOM nodes,
   resource bytes/count by type, elapsed + busy time for action scenarios.
   ───────────────────────────────────────────────────────────────────────── */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const args = {}
for (const a of process.argv.slice(2)) {
  if (a.startsWith('--')) {
    const eq = a.indexOf('=')
    if (eq > -1) args[a.slice(2, eq)] = a.slice(eq + 1)
    else args[a.slice(2)] = true
  }
}

const BASE = args.base || 'http://localhost:4173'
const LABEL = args.label || 'run'
const PROFILE = args.profile || 'desktop'
const OUT = args.out || `perf-results/${LABEL}-${PROFILE}.json`
const LIVE = !!args.live

const PROFILES = {
  desktop: { viewport: { width: 1280, height: 800 }, cpu: 1, net: null },
  mobile: { viewport: { width: 390, height: 844 }, cpu: 4, net: { downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8, latency: 150 } },
}

const OBSERVERS = `
window.__metrics = { lcp: 0, cls: 0, fcp: 0, longTasks: [], events: [] };
try {
  new PerformanceObserver((l) => { const e = l.getEntries(); if (e.length) window.__metrics.lcp = e[e.length - 1].startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
} catch (e) {}
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__metrics.cls += e.value }).observe({ type: 'layout-shift', buffered: true })
} catch (e) {}
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__metrics.fcp = e.startTime }).observe({ type: 'paint', buffered: true })
} catch (e) {}
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__metrics.longTasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) }) }).observe({ type: 'longtask', buffered: true })
} catch (e) {}
`

async function snapshot(page, extra = {}) {
  return await page.evaluate((extra) => {
    const m = window.__metrics || {}
    const nav = performance.getEntriesByType('navigation')[0] || {}
    const paint = performance.getEntriesByType('paint') || []
    const res = performance.getEntriesByType('resource') || []
    const byType = {}
    for (const r of res) {
      let t = r.initiatorType
      if (r.name.endsWith('.woff2') || r.name.includes('fonts.gstatic')) t = 'font'
      else if (/\.js(\?|$)|\.mjs(\?|$)/.test(r.name) || t === 'script') t = 'script'
      else if (/\.css(\?|$)/.test(r.name)) t = 'css'
      else if (/\.(png|svg|jpg|webp|ico)(\?|$)/.test(r.name)) t = 'image'
      else if (t === 'xmlhttprequest' || t === 'fetch') t = 'api'
      byType[t] = byType[t] || { count: 0, bytes: 0 }
      byType[t].count += 1
      byType[t].bytes += (r.transferSize || r.encodedBodySize || 0)
    }
    const totalBytes = res.reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0)
    return {
      ttfb: Math.round(nav.responseStart || 0),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEvent: Math.round(nav.loadEventEnd || 0),
      fcp: Math.round(m.fcp || (paint.find((p) => p.name === 'first-contentful-paint') || {}).startTime || 0),
      lcp: Math.round(m.lcp || 0),
      cls: +(m.cls || 0).toFixed(4),
      longTaskCount: (m.longTasks || []).length,
      longTaskTotalMs: (m.longTasks || []).reduce((s, t) => s + t.dur, 0),
      longTasks: (m.longTasks || []).slice(0, 25),
      domNodes: document.getElementsByTagName('*').length,
      requests: res.length,
      transferBytes: totalBytes,
      byType,
      ...extra,
    }
  }, extra)
}

async function busyTime(page) {
  return await page.evaluate(() => {
    const m = window.__metrics || { longTasks: [] }
    return { count: m.longTasks.length, totalMs: m.longTasks.reduce((s, t) => s + t.dur, 0) }
  })
}

async function main() {
  const p = PROFILES[PROFILE]
  const browser = await chromium.launch({ headless: true })
  const results = { label: LABEL, profile: PROFILE, base: BASE, live: LIVE, at: new Date().toISOString(), scenarios: {} }

  async function newPage(withThrottle = true) {
    const ctx = await browser.newContext({ viewport: p.viewport, deviceScaleFactor: PROFILE === 'mobile' ? 2 : 1, locale: 'ar-EG' })
    if (withThrottle) {
      const cdp = await ctx.newCDPSession(ctx.pages()[0] || (await ctx.newPage()))
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu })
      if (p.net) await cdp.send('Network.enable'), await cdp.send('Network.emulateNetworkConditions', { offline: false, ...p.net })
    }
    const page = await ctx.newPage()
    await page.addInitScript(OBSERVERS)
    return { ctx, page }
  }

  // ── 1. landing ──────────────────────────────────────────────────────────
  {
    const { ctx, page } = await newPage()
    const t0 = Date.now()
    await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 60000 })
    await page.waitForTimeout(PROFILE === 'mobile' ? 4000 : 1500)
    results.scenarios.landing = await snapshot(page, { wallClockMs: Date.now() - t0 })
    await ctx.close()
  }

  // ── 1b. QR portal page (live) ───────────────────────────────────────────
  if (args['qr-path']) {
    const { ctx, page } = await newPage()
    const t0 = Date.now()
    await page.goto(`${BASE}${args['qr-path']}`, { waitUntil: 'load', timeout: 60000 })
    await page.waitForTimeout(PROFILE === 'mobile' ? 5000 : 2000)
    results.scenarios.qr_page = await snapshot(page, { wallClockMs: Date.now() - t0 })
    await ctx.close()
  }

  // ── 2. login → dashboard (demo) ─────────────────────────────────────────
  let dashPage, dashCtx
  {
    const { ctx, page } = await newPage()
    const t0 = Date.now()
    await page.goto(`${BASE}/?auth=login`, { waitUntil: 'load', timeout: 60000 })
    const loginVisible = await page.locator('input[type="email"]').first().isVisible().catch(() => false)
    results.scenarios.login_page = await snapshot(page, { wallClockMs: Date.now() - t0, hadLoginForm: loginVisible })
    if (loginVisible && !LIVE) {
      const t1 = Date.now()
      await page.fill('input[type="email"]', 'perf@nokhba.test')
      await page.fill('input[type="password"]', 'perf1234')
      await page.locator('button[type="submit"]').first().click()
      // wait for the dashboard shell (nav labels) to appear
      await page.waitForSelector('text=نظرة عامة', { timeout: 45000, state: 'attached' })
      await page.waitForTimeout(PROFILE === 'mobile' ? 3500 : 1500)
      results.scenarios.login_to_dashboard = await snapshot(page, { wallClockMs: Date.now() - t1 })
      dashPage = page; dashCtx = ctx
    } else { await ctx.close() }
  }

  if (!dashPage) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
    console.log(`Wrote ${OUT} (no dashboard flow${LIVE ? ' — live mode' : ''})`)
    await browser.close(); return
  }

  // ── 3. warm reload (cached JS) ──────────────────────────────────────────
  {
    const t0 = Date.now()
    await dashPage.reload({ waitUntil: 'load' })
    await dashPage.waitForSelector('text=نظرة عامة', { timeout: 45000, state: 'attached' })
    await dashPage.waitForTimeout(PROFILE === 'mobile' ? 3000 : 1200)
    results.scenarios.warm_reload = await snapshot(dashPage, { wallClockMs: Date.now() - t0 })
  }

  // ── helper: run an action scenario with fresh long-task window ──────────
  async function action(name, fn, settleMs) {
    await dashPage.evaluate(() => { if (window.__metrics) window.__metrics.longTasks = [] })
    const t0 = Date.now()
    try { await fn() } catch (e) { results.scenarios[name] = { error: String(e).slice(0, 200) }; return }
    await dashPage.waitForTimeout(settleMs)
    const snap = await snapshot(dashPage, { wallClockMs: Date.now() - t0 })
    const busy = await busyTime(dashPage)
    results.scenarios[name] = { ...snap, actionBusy: busy }
  }

  // ── 4. open session workspace ───────────────────────────────────────────
  const openBtn = dashPage.locator('button:has-text("فتح الحصة")').first()
  const hasSession = await openBtn.isVisible().catch(() => false)
  if (hasSession) {
    await action('open_session', async () => { await openBtn.click() }, PROFILE === 'mobile' ? 3000 : 1200)
  } else {
    results.scenarios.open_session = { skipped: 'no open-session button visible' }
  }

  // ── 5. mark attendance (first student status button in workspace) ───────
  {
    // try common attendance buttons inside the workspace
    const cand = dashPage.locator('button:has-text("حاضر")').first()
    const vis = await cand.isVisible().catch(() => false)
    if (vis) await action('mark_attendance', async () => { await cand.click() }, 1500)
    else results.scenarios.mark_attendance = { skipped: 'no attendance button visible' }
  }

  // ── 6. search typing ────────────────────────────────────────────────────
  {
    const search = dashPage.locator('input[type="search"], input[placeholder*="بحث"]').first()
    const vis = await search.isVisible().catch(() => false)
    if (vis) {
      await action('search_typing', async () => {
        await search.click()
        for (const ch of ['ا', 'ح', 'م', 'د']) await search.type(ch, { delay: 120 })
      }, 800)
    } else results.scenarios.search_typing = { skipped: 'no search input visible' }
  }

  // ── 7. navigate through all areas ───────────────────────────────────────
  for (const [key, label] of [['nav_students', 'الطلاب'], ['nav_history', 'سجل الطالب'], ['nav_reports', 'التقارير'], ['nav_analytics', 'التحليلات'], ['nav_settings', 'الإعدادات']]) {
    await action(key, async () => {
      const btn = dashPage.locator(`button:has-text("${label}")`).first()
      await btn.click({ force: true })
    }, PROFILE === 'mobile' ? 2200 : 900)
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2))
  console.log(`Wrote ${OUT}`)
  const s = results.scenarios
  const fmt = (x) => x == null ? '—' : typeof x === 'number' ? `${x}ms` : x
  for (const [k, v] of Object.entries(s)) {
    if (v.error || v.skipped) { console.log(`  ${k}: ${v.error || v.skipped}`); continue }
    console.log(`  ${k}: LCP=${fmt(v.lcp)} FCP=${fmt(v.fcp)} JS=${Math.round((v.byType?.script?.bytes || 0) / 1024)}KB req=${v.requests} LT=${v.longTaskCount} busy=${v.actionBusy?.totalMs ?? v.longTaskTotalMs}ms dom=${v.domNodes}`)
  }
  await browser.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
