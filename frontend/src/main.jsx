import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

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

// Apply language & direction BEFORE React renders (prevents RTL/LTR flicker)
const savedLang = localStorage.getItem('app-language') === 'en' ? 'en' : 'ar'
document.documentElement.setAttribute('dir', savedLang === 'ar' ? 'rtl' : 'ltr')
document.documentElement.setAttribute('lang', savedLang)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
