// ═══════════════════════════════════════════════════════════════════════════
// BUILD-TIME PRERENDER for the public marketing routes.
// Runs INSIDE `bun run build` (after vite build + css-compat) — on the Vercel
// build runner too. No headless browser: it reuses the pattern proven by
// scripts/render-smoke.mjs (vite ssrLoadModule + react-dom/server).
//
// What it does:
//   1. Reads dist/index.html (the real template of THIS build → the hashed
//      asset URLs inside stay valid forever — no cache drift possible).
//   2. Renders each route in PRERENDER_ROUTES to static markup via
//      renderToString (window shimmed — MarketingRouter/pages read
//      window.location.pathname at render time).
//   3. Composes per-route HTML: strips the template's static head tags
//      (title/description/canonical/og/twitter) and injects the page's own
//      head config + JSON-LD; puts the static markup inside <div id="root">.
//   4. Writes dist/<route>/index.html (and overwrites dist/index.html for /).
//
// Runtime behavior: identical UX (boot splash covers until the app mounts;
// React's createRoot clears the container and takes over). Crawlers without
// JS see the full content + JSON-LD.
// ═══════════════════════════════════════════════════════════════════════════
import { createServer } from 'vite'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToString } from 'react-dom/server'

const frontendRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const distDir = join(frontendRoot, 'dist')
const SITE_URL = 'https://al-nokhbba.vercel.app'

if (!existsSync(join(distDir, 'index.html'))) {
  console.error('[prerender] dist/index.html not found — run this after `vite build`')
  process.exit(1)
}
// Always compose from the PRISTINE vite template. dist/index.html gets
// overwritten by this script (homepage), so re-running the script manually
// must never feed a composed file back in as the template. vite build wipes
// dist/ every build → the cache is per-build fresh by construction.
const templateCachePath = join(distDir, 'index.template.html')
const templatePath = existsSync(templateCachePath) ? templateCachePath : join(distDir, 'index.html')
const template = readFileSync(templatePath, 'utf8')
if (!existsSync(templateCachePath)) writeFileSync(templateCachePath, template)

// ── window/document shim (marketing components read location at render time;
//      animejs reads document at MODULE scope once `window` exists) ─────────
if (typeof globalThis.window === 'undefined') globalThis.window = globalThis
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, getContext: () => null }),
    documentElement: { style: {} },
    head: { appendChild() {} },
    body: { appendChild() {} },
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  }
}
if (!window.location || typeof window.location !== 'object') {
  window.location = { pathname: '/', search: '', hash: '', origin: SITE_URL, href: SITE_URL + '/' }
}
// animejs engine.js touches rAF/getComputedStyle at module scope (its own
// isBrowser guard passes once `window` exists, so these must exist too).
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', getPropertyPriority: () => '' })
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
}

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function headBlock(head) {
  const url = SITE_URL + head.path
  const t = []
  t.push(`<title>${esc(head.title)}</title>`)
  t.push(`<meta name="description" content="${esc(head.description)}">`)
  t.push(`<link rel="canonical" href="${url}">`)
  t.push(`<meta property="og:type" content="website">`)
  t.push(`<meta property="og:title" content="${esc(head.title)}">`)
  t.push(`<meta property="og:description" content="${esc(head.description)}">`)
  t.push(`<meta property="og:url" content="${url}">`)
  if (head.image) {
    t.push(`<meta property="og:image" content="${SITE_URL}${head.image.src}">`)
    t.push(`<meta property="og:image:width" content="${head.image.w}">`)
    t.push(`<meta property="og:image:height" content="${head.image.h}">`)
    t.push(`<meta property="og:image:alt" content="${esc(head.title)}">`)
    t.push(`<meta name="twitter:card" content="summary_large_image">`)
    t.push(`<meta name="twitter:title" content="${esc(head.title)}">`)
    t.push(`<meta name="twitter:description" content="${esc(head.description)}">`)
    t.push(`<meta name="twitter:image" content="${SITE_URL}${head.image.src}">`)
  }
  const lds = head.jsonLd ? [].concat(head.jsonLd) : []
  for (const ld of lds) t.push(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`)
  return t.join('\n    ')
}

// Strip the template's static homepage head (the runtime statics) FIRST,
// then inject the page config into the freed title slot — injection must
// never run before stripping, or the strip regexes would delete the newly
// injected tags. Keeps viewport/theme/fonts/boot scripts intact.
function compose(appHtml, head) {
  const stripped = template
    .replace(/<title>[\s\S]*?<\/title>/, '⟪NK_HEAD_SLOT⟫')
    .replace(/<meta name="description"[^>]*>\s*/g, '')
    .replace(/<link rel="canonical"[^>]*>\s*/g, '')
    .replace(/<meta property="og:(?:type|title|description|url|image|image:width|image:height|image:alt)"[^>]*>\s*/g, '')
    .replace(/<meta name="twitter:[^"]*"[^>]*>\s*/g, '')
  return stripped
    .replace('⟪NK_HEAD_SLOT⟫', headBlock(head))
    .replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`)
}

const vite = await createServer({
  root: frontendRoot,
  logLevel: 'error',
  server: { middlewareMode: true },
  appType: 'custom',
})

try {
  const { PRERENDER_ROUTES } = await vite.ssrLoadModule('/src/marketing/prerender-entry.jsx')
  const results = []

  for (const route of PRERENDER_ROUTES) {
    window.location.pathname = route.path
    window.location.href = SITE_URL + route.path
    const appHtml = renderToString(React.createElement(route.Component, route.props || {}))
    if (!appHtml || appHtml.length < 1500) {
      throw new Error(`[prerender] ${route.path}: markup too small (${(appHtml || '').length} chars) — render failed?`)
    }
    const html = compose(appHtml, route.head)
    // Hard validations — a broken head must fail the BUILD, not ship silently.
    const url = SITE_URL + route.path
    const checks = [
      [html.includes(esc(route.head.title)), 'title'],
      [html.includes(`rel="canonical" href="${url}"`), 'canonical'],
      [(html.match(/og:title/g) || []).length === 1, 'og:title exactly once'],
      [(html.match(/<title>/g) || []).length === 1, 'title exactly once'],
      [!route.head.jsonLd || html.includes('application/ld+json'), 'json-ld'],
      [!route.head.image || html.includes(`property="og:image" content="${SITE_URL}${route.head.image.src}"`), 'og:image'],
      [html.includes('<div id="root">') && !html.includes('<div id="root"></div>'), 'root content'],
      // The output must carry THIS route's own markup — catches the
      // silent no-op root replace (e.g. re-running on a composed dist).
      [html.includes(appHtml.slice(0, 120)), 'root carries this route markup'],
    ]
    for (const [ok, label] of checks) {
      if (!ok) throw new Error(`[prerender] ${route.path}: validation failed → ${label}`)
    }
    const outAbs = route.root ? join(distDir, 'index.html') : join(distDir, route.out)
    if (!route.root) mkdirSync(dirname(outAbs), { recursive: true })
    writeFileSync(outAbs, html)
    results.push({ path: route.path, out: route.root ? 'index.html' : route.out, kb: Math.round(html.length / 1024) })
  }

  console.log('[prerender] done:')
  for (const r of results) console.log(`  ${r.path.padEnd(48)} → ${r.out.padEnd(44)} ${r.kb} KB`)
} finally {
  await vite.close().catch(() => {})
}
