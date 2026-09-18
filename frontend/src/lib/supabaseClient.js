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
  // PERF (performance round, dev-only): in dev builds the client gets a tiny
  // instrumented fetch that counts every REST/RPC call and flags slow ones
  // into __NK_PERF (see src/lib/devPerf.js). Production keeps the stock
  // client — zero instrumentation cost, zero behavior change.
  const baseFetch = (...args) => globalThis.fetch(...args)
  const instrumentedFetch = import.meta.env.DEV
    ? async (url, options = {}) => {
        const t0 = performance.now()
        try {
          return await baseFetch(url, options)
        } finally {
          try {
            const u = String(url)
            const label = u.includes('/rest/v1/rpc/')
              ? `rpc:${u.split('/rest/v1/rpc/')[1].split('?')[0]}`
              : `table:${u.split('/rest/v1/')[1]?.split('?')[0] || 'auth'}`
            const { markQuery } = await import('./devPerf')
            markQuery(label, performance.now() - t0)
          } catch { /* diagnostics never break the app */ }
        }
      }
    : undefined
  resolved = createClient(supabaseUrl, supabaseAnonKey, instrumentedFetch ? { global: { fetch: instrumentedFetch } } : undefined)
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
