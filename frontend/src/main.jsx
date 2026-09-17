import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
// MUST be the first import — installs runtime method polyfills (.at,
// Object.hasOwn, replaceAll, findLast…) before ANY app code runs.
import './lib/legacyPolyfills.js'
import './index.css'
import App from './App.jsx'
import ProductionErrorBoundary from './components/ProductionErrorBoundary'

if ('serviceWorker' in navigator) window.addEventListener('load', async () => {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.filter((r) => r.scope !== `${location.origin}/`).map((r) => r.unregister()))
    if ('caches' in window) {
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.filter((name) => /workbox|vite|pwa|precache/i.test(name)).map((name) => caches.delete(name)))
    }
    await navigator.serviceWorker.register('/sw.js?v=6', { updateViaCache: 'none' })
  } catch (err) { console.warn('Push service worker registration failed:', err) }
})

/**
 * BootSignal — Round 13/14 boot-flag contract.
 *
 * The index.html boot layer paints an instant splash and starts a 15s
 * watchdog. The flag must be raised from INSIDE the render tree (after the
 * first React commit) — not merely after createRoot() — so a crash during
 * the very first render still leaves the watchdog armed and the user gets
 * the Arabic fallback screen instead of a silent white page. Removing the
 * splash here (and only here) guarantees the app actually painted content.
 */
function BootSignal() {
  useEffect(() => {
    window.__NOKHBA_BOOTED__ = true
    window.__nokhbaBooted = true
    // Notify the index.html diagnostics engine that the app actually painted.
    try { if (window.__NOKHBA_DIAG && window.__NOKHBA_DIAG.markBooted) window.__NOKHBA_DIAG.markBooted() } catch { /* engine optional */ }
    // Remove the splash — unless the diagnostics engine owns the screen
    // (opened with ?diag=1): then the report stays visible on purpose.
    let engineOwnsUI = false
    try { engineOwnsUI = !!(window.__NOKHBA_DIAG && window.__NOKHBA_DIAG.uiActive) } catch { /* engine optional */ }
    const splash = document.getElementById('nokhba-boot')
    if (splash && splash.parentNode && !engineOwnsUI) splash.parentNode.removeChild(splash)
  }, [])
  return null
}

// Apply language & direction BEFORE React renders (prevents RTL/LTR flicker)
const savedLang = localStorage.getItem('app-language') === 'en' ? 'en' : 'ar'
document.documentElement.setAttribute('dir', savedLang === 'ar' ? 'rtl' : 'ltr')
document.documentElement.setAttribute('lang', savedLang)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BootSignal />
    <ProductionErrorBoundary>
      <App />
    </ProductionErrorBoundary>
  </StrictMode>,
)
