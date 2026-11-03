#!/usr/bin/env node
/** Local CSP test server: serves frontend/dist with the production vercel.json headers. */
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'

const ROOT = '/home/z/my-project/frontend/dist'
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://*.supabase.co https://*.posthog.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.posthog.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests"

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.webp': 'image/webp' }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    let p = decodeURIComponent(url.pathname)
    let file = join(ROOT, p)
    try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html') } catch { /* fall through */ }
    let body
    try { body = await readFile(file) } catch {
      // SPA rewrite (excluding assets/app-v2/boot/fonts)
      if (!/^\/(assets|app-v2|boot|fonts)\//.test(p)) file = join(ROOT, 'index.html')
      else { res.writeHead(404).end('nf'); return }
      try { body = await readFile(file) } catch { res.writeHead(404).end('nf'); return }
    }
    const headers = {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
    }
    if (/\/app-v2\//.test(file)) headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    if (/\/boot\//.test(file)) headers['Cache-Control'] = 'public, max-age=3600, must-revalidate'
    res.writeHead(200, headers).end(body)
  } catch (e) {
    res.writeHead(500).end(String(e))
  }
})
server.listen(4199, () => console.log('CSP test server on :4199'))
