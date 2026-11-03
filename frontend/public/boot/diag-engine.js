      /* ══════════════════════════════════════════════════════════════════
         NOKHBA DIAGNOSTIC ENGINE (Round 11–14) — strict ES5, no deps.
         Captures crashes (error + unhandledrejection), runs WebKit feature
         self-tests, probes the Supabase backend, and persists the last crash
         so it survives the reload. Open the portal with ?diag=1 (or after a
         crash on the watchdog screen) to see the report with two actions:
         «نسخ تقرير التشخيص» and «مسح البيانات المحلية».
         React code talks to it ONLY through window.__NOKHBA_DIAG (bridge).
         ══════════════════════════════════════════════════════════════════ */
      (function () {
        var CRASH_KEY = '__nokhbaLastCrash'
        var engine = {
          version: 'nokhba-r14',
          booted: false,
          bootedAt: 0,
          startedAt: new Date().getTime(),
          crashes: [],
          uiActive: false,
        }
        window.__NOKHBA_DIAG = engine
        window.__NOKHBA_NATIVE = true

        function featureSelfTests() {
          var out = {}
          try { out.broadcastChannel = typeof BroadcastChannel !== 'undefined' } catch (e) { out.broadcastChannel = false }
          try {
            var cv = document.createElement('canvas')
            var ctx = cv.getContext && cv.getContext('2d')
            out.canvas2d = !!ctx
          } catch (e) { out.canvas2d = false }
          try { out.localStorage = (function () { localStorage.setItem('__nb_t', '1'); var ok = localStorage.getItem('__nb_t') === '1'; localStorage.removeItem('__nb_t'); return ok })() } catch (e) { out.localStorage = false }
          try { out.esModules = 'noModule' in document.createElement('script') } catch (e) { out.esModules = false }
          try { out.cspBlockedEval = false } catch (e) { /* noop */ }
          return out
        }

        function supabaseUrl() {
          return String(window.__NOKHBA_SUPABASE_URL__ || '')
        }

        function probeSupabase(cb) {
          var url = supabaseUrl()
          if (!url || !window.fetch) { cb('unknown'); return }
          fetch(url + '/rest/v1/', { method: 'HEAD' })
            .then(function (r) { cb('http ' + r.status) })
            .catch(function (e) { cb('network-failed: ' + (e && e.message ? e.message : 'error')) })
        }

        function capture(kind, message, extra) {
          try {
            var entry = {
              kind: kind,
              message: String(message || '').slice(0, 500),
              at: new Date().toISOString(),
              url: window.location.href,
              ua: navigator.userAgent,
              bootFlag: !!(window.__NOKHBA_BOOTED__ || window.__nokhbaBooted),
              sinceStartMs: new Date().getTime() - engine.startedAt,
              features: featureSelfTests(),
              supabaseUrl: supabaseUrl(),
              extra: extra || null,
            }
            engine.crashes.push(entry)
            try { localStorage.setItem(CRASH_KEY, JSON.stringify(entry)) } catch (e) { /* full/private */ }
            if (engine.uiActive || /diag=1/.test(window.location.search)) showPanel()
            return entry
          } catch (e) { /* diagnostics must never throw */ }
        }

        function reportText() {
          var lines = ['== النخبة — تقرير التشخيص ==']
          lines.push('engine: ' + engine.version)
          lines.push('booted: ' + engine.booted + ' (' + (new Date().getTime() - engine.startedAt) + 'ms since start)')
          lines.push('url: ' + window.location.href)
          lines.push('ua: ' + navigator.userAgent)
          lines.push('supabase: ' + (supabaseUrl() || 'غير معروف'))
          lines.push('crashes: ' + engine.crashes.length)
          for (var i = 0; i < engine.crashes.length; i++) {
            lines.push('--- crash ' + (i + 1) + ' ---')
            lines.push(JSON.stringify(engine.crashes[i], null, 2))
          }
          try {
            var last = localStorage.getItem(CRASH_KEY)
            if (last) lines.push('--- last persisted crash ---\n' + last)
          } catch (e) { /* ignore */ }
          return lines.join('\n')
        }

        function copyReport() {
          var text = reportText()
          var done = function () { alert('تم نسخ تقرير التشخيص. ابعت التقرير لصاحب المنصة.') }
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done) })
              return
            }
          } catch (e) { /* fall through */ }
          legacyCopy(text, done)
        }

        function legacyCopy(text, done) {
          try {
            var ta = document.createElement('textarea')
            ta.value = text
            ta.style.position = 'fixed'
            ta.style.opacity = '0'
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            document.body.removeChild(ta)
            done()
          } catch (e) { window.prompt('انسخ التقرير يدويًا:', text) }
        }

        function hardResetLocal() {
          try { localStorage.clear() } catch (e) { /* ignore */ }
          try { if (window.sessionStorage) window.sessionStorage.clear() } catch (e) { /* ignore */ }
          if (typeof window.__NOKHBA_HARD_RESET__ === 'function') { window.__NOKHBA_HARD_RESET__(); return }
          window.location.reload()
        }

        function showPanel() {
          var wrap = document.getElementById('nokhba-boot')
          if (!wrap && document.body) {
            wrap = document.createElement('div')
            wrap.id = 'nokhba-boot'
            document.body.appendChild(wrap)
          }
          if (!wrap) return /* DOM not ready yet — caller retries after DOMContentLoaded */
          engine.uiActive = true
          probeSupabase(function (status) {
            wrap.innerHTML =
              '<div class="nb-watchdog" style="max-width:420px;text-align:right">' +
              '<h1>تقرير التشخيص</h1>' +
              '<p id="nb-diag-summary">جاري التجميع…</p>' +
              '<button type="button" id="nb-diag-copy" style="margin:0 4px">نسخ تقرير التشخيص</button>' +
              '<button type="button" id="nb-diag-reset" style="margin:0 4px;background:#b91c1c">مسح البيانات المحلية</button>' +
              '</div>'
            var summary = document.getElementById('nb-diag-summary')
            if (summary) {
              var f = engine.crashes.length ? engine.crashes[engine.crashes.length - 1].features : featureSelfTests()
              summary.innerHTML =
                'booted: ' + engine.booted + '<br>' +
                'supabase: ' + status + '<br>' +
                'BroadcastChannel: ' + (f.broadcastChannel ? '✓' : '✗') +
                ' — Canvas: ' + (f.canvas2d ? '✓' : '✗') +
                ' — localStorage: ' + (f.localStorage ? '✓' : '✗') + '<br>' +
                'عدد الأعطال المرصودة: ' + engine.crashes.length
            }
            var copyBtn = document.getElementById('nb-diag-copy')
            if (copyBtn) copyBtn.addEventListener('click', copyReport)
            var resetBtn = document.getElementById('nb-diag-reset')
            if (resetBtn) resetBtn.addEventListener('click', hardResetLocal)
          })
        }

        engine.markBooted = function () {
          engine.booted = true
          engine.bootedAt = new Date().getTime() - engine.startedAt
        }
        engine.show = function (error, info) {
          capture('react-boundary', error && (error.message || String(error)), {
            componentStack: info && info.componentStack ? String(info.componentStack).slice(0, 1200) : null,
          })
        }
        engine.isEngineUIActive = function () { return engine.uiActive }
        engine.capture = capture
        engine.showPanel = showPanel

        /* Global listeners: runtime errors + unhandled promise rejections */
        window.addEventListener('error', function (ev) {
          try {
            if (ev && ev.target && (ev.target.tagName === 'SCRIPT' || ev.target.tagName === 'LINK')) return /* resource errors handled by boot layer */
            capture('window-error', ev && ev.message, ev && ev.filename ? { filename: ev.filename + ':' + ev.lineno } : null)
          } catch (e) { /* ignore */ }
        })
        window.addEventListener('unhandledrejection', function (ev) {
          try {
            var r = ev && ev.reason
            capture('unhandledrejection', r && (r.message || String(r)), null)
          } catch (e) { /* ignore */ }
        })

        /* Manual trigger: /?diag=1 opens the panel immediately — but only once
           the body exists (this script runs in <head>). */
        function maybeShowFromUrl() {
          try {
            if (/diag=1/.test(window.location.search)) showPanel()
          } catch (e) { /* ignore */ }
        }
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', maybeShowFromUrl)
        } else {
          maybeShowFromUrl()
        }
      })()
