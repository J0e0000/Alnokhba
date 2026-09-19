import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ─────────────────────────────────────────────────────────────────────────────
// iOS compatibility (Round 9)
//
// Vite 8 (Rolldown) defaults to a "baseline widely available" target
// (Safari 16+). The default build shipped ES2022 syntax — class static
// blocks (`static{...}`, Safari 16.4+), logical assignment (`??=`, iOS 14+)
// and optional chaining — which makes older iPhones (anything below
// iOS 16.4) throw a SyntaxError while PARSING the bundle: the whole app
// never runs and the page stays blank.
//
// Lowering the floor to ES2019 + Safari 13 (iOS 13, 2019) transpiles all of
// that down, so the same bundle parses on iPhone 6s and newer.
// Runtime APIs that the compiler cannot lower (Array.prototype.at,
// Object.hasOwn, ...) are polyfilled inline in index.html before the
// module scripts load.
// ─────────────────────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: ['es2019', 'safari13', 'chrome87', 'edge88', 'firefox78', 'ios13'],
    // Downlevel CSS alongside the JS so older WebKit doesn't hit syntax it
    // can't parse while minifying (Round 10).
    cssTarget: ['safari13', 'ios13', 'chrome87', 'firefox78'],
  },
  // ── Why NOT @vitejs/plugin-legacy (Round 10 decision) ──────────────────────
  // plugin-legacy exists for browsers WITHOUT ES-module support (iOS Safari
  // ≤ 10.x, ~2016). Our floor is iOS 13 (2019): ES modules, import.meta and
  // dynamic import() all work, and the es2019 target transpiles the syntax.
  // Runtime API gaps are covered by the targeted inline polyfills in
  // index.html (~2 KB) instead of a full core-js bundle (~40 KB gzipped on
  // EVERY load). Adding plugin-legacy here would double the artifact size,
  // add a SystemJS runtime, and risk breaking this Rolldown/Vite 8 build —
  // for an audience that does not exist in the wild anymore.
  // The ES2019 grammar check (tests/es2019-parse-check.cjs) keeps this
  // guarantee enforced on every future build.
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
  },
})
