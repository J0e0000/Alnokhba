      /* ══════════════════════════════════════════════════════════════════
         STORAGE GENERATION MIGRATION — pipeline cutover guard.
         The frontend was fully rebuilt (pipeline UI). Browsers that used
         the OLD dashboard on the SAME origin still hold localStorage keys
         in old formats; shape mismatches crash the new UI during render
         (ProductionErrorBoundary "حدثت مشكلة بسيطة"). This runs ONCE per
         browser: if the stored generation stamp ≠ current frontend
         generation, wipe app-owned temp state (localStorage,
         sessionStorage, SW registrations, caches) and re-stamp.
         REAL user data lives in Supabase and is NEVER stored here, so
         nothing server-side is affected. Strict ES5, runs before modules.
         ══════════════════════════════════════════════════════════════════ */
      (function () {
        var GEN_KEY = 'nk-store-gen'
        var CURRENT_GEN = 'pipeline-1'
        var stored = null
        try { stored = window.localStorage.getItem(GEN_KEY) } catch (e) { return } /* storage blocked → nothing to migrate */
        if (stored === CURRENT_GEN) return /* fast path: this browser is already on the new generation */
        try { window.localStorage.clear() } catch (e) {}
        try { if (window.sessionStorage) window.sessionStorage.clear() } catch (e) {}
        try {
          if (window.caches && window.caches.keys) {
            window.caches.keys().then(function (keys) {
              keys.forEach(function (k) { try { window.caches.delete(k) } catch (e) {} })
            }).catch(function () {})
          }
        } catch (e) {}
        try {
          if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
            navigator.serviceWorker.getRegistrations().then(function (regs) {
              regs.forEach(function (r) { try { r.unregister() } catch (e) {} })
            }).catch(function () {})
          }
        } catch (e) {}
        try { window.localStorage.setItem(GEN_KEY, CURRENT_GEN) } catch (e) {}
      })();
      /* SEMICOLON FIX (perf round): this IIFE previously ended without a
         semicolon, so the next line's `(function () { … })()` was parsed as
         a CALL of this IIFE's return value (undefined) — a TypeError that
         killed the rest of the boot layer (splash re-paint, auto-bust,
         15s watchdog) on every fresh browser. */

      /* ══════════════════════════════════════════════════════════════════
         NOKHBA BOOT LAYER (Round 9–14) — strict ES5, runs BEFORE modules.
         1. paintLoader: instant splash so the phone never shows a white page
            while the 2.6MB bundle downloads.
         2. isFatalResource + autoBustOnce: if a CORE app asset fails to load
            (stale cache / bad deploy), reload ONCE with a cache-busting query
            — guarded by sessionStorage('nb-bust-once') so it can never loop.
            Cross-origin failures (fonts/analytics) are NOT fatal.
         3. 15s boot watchdog: if the app never signals
            window.__NOKHBA_BOOTED__ / window.__nokhbaBooted, show an Arabic
            fallback with a safe retry button instead of a silent white page.
         4. __NOKHBA_HARD_RESET__: "clear temp files" escape hatch used by the
            production error boundary (caches + service worker only — never
            user data, which lives server-side).
         ══════════════════════════════════════════════════════════════════ */
      (function () {
        var NB_BUST_KEY = 'nb-bust-once'

        function paintLoader() {
          if (document.getElementById('nokhba-boot')) return
          var wrap = document.createElement('div')
          wrap.id = 'nokhba-boot'
          wrap.innerHTML =
            '<div class="nb-logo"><img src="/nokhba-mark.svg" alt="النخبة" width="64" height="64" /></div>' +
            '<div class="nb-ring"></div>' +
            '<div class="nb-txt">جاري فتح النخبة…</div>'
          document.body.appendChild(wrap)
        }

        function bootFailedMessage() {
          var wrap = document.getElementById('nokhba-boot')
          if (!wrap) { paintLoader(); wrap = document.getElementById('nokhba-boot') }
          if (!wrap) return
          wrap.innerHTML =
            '<div class="nb-watchdog">' +
            '<h1>نظام الآيفون قديم شوية</h1>' +
            '<p>الصفحة محتاجت تحديث بسيط عشان تفتح على هذا الجهاز. اضغط الزر تحت لإعادة المحاولة — لو استمرت المشكلة، حدّث Safari من الإعدادات أو جرّب متصفح Chrome.</p>' +
            '<button type="button" onclick="window.location.reload()">إعادة المحاولة</button>' +
            '</div>'
        }

        /* Resource errors only (capture phase). Decides whether a failed
           script/style is OURS (fatal) or third-party (never fatal). */
        function isFatalResource(ev) {
          var t = ev && ev.target
          if (!t || !t.tagName) return false
          var tag = t.tagName.toUpperCase()
          if (tag !== 'SCRIPT' && tag !== 'LINK') return false
          var url = String((tag === 'LINK' ? t.href : t.src) || '')
          if (!url) return false
          /* cross-origin (fonts, analytics, CDNs) → non-fatal by definition */
          if (url.indexOf(window.location.origin) !== 0) return false
          /* our hashed bundles and stylesheets are core */
          return (tag === 'SCRIPT' && /\.js(\?|$)/.test(url)) || (tag === 'LINK' && /\.css(\?|$)/.test(url))
        }

        function autoBustOnce() {
          try {
            if (window.sessionStorage && window.sessionStorage.getItem(NB_BUST_KEY)) return
            if (window.sessionStorage) window.sessionStorage.setItem(NB_BUST_KEY, String(Date.now()))
          } catch (e) { /* private mode — just reload without the guard */ }
          try {
            var u = window.location.pathname + '?nbv=' + Date.now() + window.location.hash
            window.location.replace(u)
          } catch (e) { window.location.reload() }
        }

        window.addEventListener('error', function (ev) {
          try {
            if (!isFatalResource(ev)) return
            autoBustOnce()
          } catch (e) { /* never block the page */ }
        }, true)

        /* 15s watchdog — the app must signal the boot flag; else show fallback */
        setTimeout(function () {
          try {
            if (window.__NOKHBA_BOOTED__ || window.__nokhbaBooted) return
            bootFailedMessage()
          } catch (e) { /* keep whatever is on screen */ }
        }, 15000)

        /* Escape hatch used by the production error boundary (ES5-safe) */
        window.__NOKHBA_HARD_RESET__ = function () {
          var done = 0
          function finish() {
            done += 1
            if (done === 2) window.location.reload()
          }
          try {
            if (window.caches && caches.keys) {
              caches.keys().then(function (keys) {
                var jobs = keys.filter(function (k) { return /workbox|vite|pwa|precache|nokhba/i.test(k) })
                  .map(function (k) { return caches.delete(k) })
                return Promise.all(jobs)
              }).then(finish).catch(finish)
            } else { finish() }
          } catch (e) { finish() }
          try {
            if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
              navigator.serviceWorker.getRegistrations().then(function (regs) {
                return Promise.all(regs.map(function (r) { return r.unregister() }))
              }).then(finish).catch(finish)
            } else { finish() }
          } catch (e) { finish() }
          try {
            if (window.sessionStorage) window.sessionStorage.removeItem(NB_BUST_KEY)
          } catch (e) { /* ignore */ }
        }

        /* Paint the splash as soon as a body exists (script runs in <head>) */
        function startPaint() {
          paintLoader()
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', startPaint)
        } else {
          startPaint()
        }
      })()
