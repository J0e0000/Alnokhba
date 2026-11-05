import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// ── DEMO MODE ────────────────────────────────────────────────────────────────
// True ONLY when no production credentials exist (this preview sandbox).
// In production (real .env) the real supabase-js client is used and the demo
// adapter is never imported — no mock behavior ships to production.
export const IS_DEMO = !supabaseUrl || !supabaseAnonKey

// supabaseClient must export a synchronous client object; in demo mode the
// adapter is imported dynamically and exposed through a lazy proxy that
// queues early calls until the module resolves.
let resolved = null
if (IS_DEMO) {
  let pendingResolve = null
  if (typeof window !== 'undefined') {
    window.__nokhbaDemoReady = new Promise((r) => { pendingResolve = r })
  }
  const ready = import('../demo/demoClient.js').then((mod) => {
    resolved = mod.default
    if (pendingResolve) pendingResolve(resolved)
    return resolved
  }).catch((err) => {
    /* Network failure (rare): keep the app in the graceful loading state —
       the 15s boot watchdog offers the retry screen. No unhandled rejection. */
    console.warn('[NOKHBA] demo backend module failed to load:', err)
    return null
  })
} else {
  // PROD/DEV fetch guard (see watchdog note below): production wraps every
  // supabase fetch in a hard timeout so a stalled mobile connection can
  // never freeze the app on an infinite «جاري التحميل...» screen. The old
  // dev-only perf instrumentation (devPerf markQuery) was removed here when
  // the watchdog landed — devPerf.js stays for any other dev tooling.
  const baseFetch = (...args) => globalThis.fetch(...args)
  /* PROD FETCH WATCHDOG (stuck-boot fix, 2026-11-05).
     WHY: on real mobile networks a TCP connection sometimes STALLS — the
     request never completes AND never fails, so every await hangs FOREVER.
     Every «جاري التحميل...» screen in the app (Gate, portal Promise.all,
     WorkspaceStore, areas) sits on top of a fetch, so ONE stalled fetch =
     the app looks permanently broken to that user. The profile chain
     already had per-attempt timeouts; the portal/areas/workspace queries
     did NOT.
     FIX: hard 20s cap on EVERY production supabase fetch + one silent
     automatic retry for idempotent GETs (retried GET is always safe; POSTs
     surface their error to the existing per-screen retry UIs instead of
     hanging). Storage endpoints get a 120s cap instead of 20s — a real
     multi-MB upload on slow mobile data is LEGITIMATELY slower than 20s.
     ES2019-safe: no AbortSignal.timeout(). */
  const WATCHDOG_MS = 20000
  const WATCHDOG_STORAGE_MS = 120000
  const prodFetch = (...args) => {
    const url = String(args[0] || '')
    const options = args[1] || {}
    const cap = url.includes('/storage/v1/') ? WATCHDOG_STORAGE_MS : WATCHDOG_MS
    const method = String(options.method || 'GET').toUpperCase()
    const idempotent = method === 'GET' || method === 'HEAD'
    const runOnce = () => new Promise((resolve, reject) => {
      // Abort the underlying request on timeout so a stalled socket is
      // actually released — EXCEPT when the caller supplied its own signal
      // (then we leave their request untouched and only stop waiting).
      const ownsSignal = !options.signal
      const ctrl = ownsSignal ? new AbortController() : null
      const timer = setTimeout(() => {
        if (ctrl) { try { ctrl.abort() } catch { /* already aborted */ } }
        reject(new Error('nokhba-fetch-watchdog-timeout'))
      }, cap)
      Promise.resolve(baseFetch(url, ctrl ? { ...options, signal: ctrl.signal } : options)).then(
        (v) => { clearTimeout(timer); resolve(v) },
        (e) => { clearTimeout(timer); reject(e) },
      )
    })
    if (!idempotent) return runOnce()
    return runOnce().catch((e) => {
      if (`${e?.message || ''}`.includes('nokhba-fetch-watchdog-timeout')) {
        console.warn('[supabaseClient] stalled GET retried after watchdog:', url.split('?')[0])
        return runOnce()
      }
      throw e
    })
  }
  resolved = createClient(supabaseUrl, supabaseAnonKey, { global: { fetch: prodFetch } })
}

/* Deep-queueing placeholder (preview-panel crash fix, 2026-09-17).

   On slow/proxied networks the demo chunk can still be downloading when
   AuthProvider's first effect runs `supabase.auth.getSession()`. The old
   placeholder only handled DIRECT calls (`supabase.from(...)`): the
   intermediate access `supabase.auth` returned the queue function itself,
   so `.getSession` on it threw
   "TypeError: supabase.auth.getSession is not a function" and the
   ProductionErrorBoundary took the screen.

   Instead, every pre-resolution access returns a CALLABLE proxy that
   records the access path. When the final call happens (or a nested path
   is called), the whole path is replayed against the resolved client:

     supabase.auth.getSession({...})  → client.auth.getSession({...})
     supabase.auth.onAuthStateChange(cb) → client.auth.onAuthStateChange(cb)

   The proxy deliberately hides `then`/symbols so it can never be awaited
   or coerced by mistake. Only AuthProvider touches the client this early;
   every other consumer mounts deep inside the authed tree, long after the
   demo module has resolved. */
function lazyQueued(path) {
  const fn = function (...args) {
    /* The module may resolve between proxy creation and this call — replay
       directly if it already has. */
    if (resolved) {
      let parent = resolved
      for (let i = 0; i < path.length - 1; i++) parent = parent?.[path[i]]
      const method = parent?.[path[path.length - 1]]
      return typeof method === 'function' ? method.apply(parent, args) : method
    }
    const ready = (typeof window !== 'undefined' && window.__nokhbaDemoReady)
      ? window.__nokhbaDemoReady
      : Promise.resolve(resolved)

    /* onAuthStateChange is consumed SYNCHRONOUSLY by callers
       (`const { data: listener } = supabase.auth.onAuthStateChange(cb)` →
       later `listener.subscription.unsubscribe()`). Returning the replay
       promise broke that contract ("Cannot read properties of undefined
       (reading 'subscription')" — blocked-module simulation, 2026-09-17).
       Return the real shape NOW; forward the callback once resolved. */
    if (path[path.length - 1] === 'onAuthStateChange' && typeof args[0] === 'function') {
      const cb = args[0]
      let registered = null
      const ensure = (client) => {
        if (!registered) registered = client.auth.onAuthStateChange(cb)
        return registered
      }
      if (resolved) { try { ensure(resolved) } catch { /* ignore */ } }
      else ready.then(ensure).catch(() => { /* demo never loaded — watchdog owns recovery */ })
      return {
        data: {
          subscription: {
            unsubscribe() {
              const drop = (client) => {
                try { ensure(client).data.subscription.unsubscribe() } catch { /* ignore */ }
                registered = null
              }
              if (resolved) drop(resolved)
              else ready.then(drop).catch(() => { /* ignore */ })
            },
          },
        },
      }
    }

    return ready.then((client) => {
      let parent = client
      for (let i = 0; i < path.length - 1; i++) parent = parent?.[path[i]]
      const method = parent?.[path[path.length - 1]]
      return typeof method === 'function' ? method.apply(parent, args) : method
    })
  }
  return new Proxy(fn, {
    get(_target, p) {
      if (typeof p === 'symbol') return undefined
      if (p === 'then') return undefined /* never a thenable itself */
      return lazyQueued([...path, String(p)])
    },
  })
}

export const supabase = new Proxy({}, {
  get(_target, prop) {
    if (prop === '__isDemo') return IS_DEMO
    const c = resolved
    if (!c) {
      // Demo module still importing — queue at ANY access depth.
      return lazyQueued([String(prop)])
    }
    const v = c[prop]
    return typeof v === 'function' ? v.bind(c) : v
  },
})

// Bridge: expose the backend URL to the index.html diagnostics engine so the
// crash report can show backend reachability (see window.__NOKHBA_DIAG).
try {
  if (supabaseUrl && typeof window !== 'undefined') window.__NOKHBA_SUPABASE_URL__ = supabaseUrl
  if (IS_DEMO && typeof window !== 'undefined') window.__NOKHBA_DEMO__ = true
} catch { /* engine optional */ }
