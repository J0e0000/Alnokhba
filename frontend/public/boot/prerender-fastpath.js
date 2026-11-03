      /* PRERENDER FAST-PATH (audit 2026-10): build-time prerendered marketing
         pages ship real content inside #root. If content is already there,
         remove the boot splash immediately so HUMANS see the page without
         waiting for JS — crawlers already did. The 15s watchdog contract is
         untouched: BootSignal still sets __NOKHBA_BOOTED__ after React's
         first commit, and ?diag=1 diagnostics always win. Strict ES5. */
      (function () {
        try {
          var root = document.getElementById('root')
          /* dist/index.html (prerendered LANDING) is also served for /?auth=…
             and unknown paths — only fast-path when the prerendered content
             actually matches the URL: any non-root path, or root WITHOUT an
             auth/query string. */
          var own = !!root && !!root.firstChild &&
            (location.pathname !== '/' || !location.search)
          if (own && !/diag=1/.test(window.location.search)) {
            /* HIDE, don't remove: the head boot-layer's paintLoader() runs on
               DOMContentLoaded and re-paints the splash when the node is
               missing. A hidden node makes paintLoader() no-op while
               bootFailedMessage() can still write into it. */
            var splash = document.getElementById('nokhba-boot')
            if (splash) splash.style.display = 'none'
          }
        } catch (e) { /* boot-layer fallbacks still apply */ }
      })()
