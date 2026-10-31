// ═══════════════════════════════════════════════════════════════════════════
// devPerf — lightweight DEVELOPMENT-ONLY diagnostics (performance round).
//
// Answers, while developing: how many times did the big providers render?
// how many Supabase queries did this flow fire? which ones were slow?
//
// IMPORTANT: every counter here is gated behind import.meta.env.DEV, so the
// production bundle tree-shakes this module's call sites to no-ops — it must
// never affect real users. In dev, open the console and inspect:
//   __NK_PERF.renders()   → render counts per labelled component
//   __NK_PERF.queries()   → Supabase query/RPC counts + slow-op list
//   __NK_PERF.reset()     → zero everything
// ═══════════════════════════════════════════════════════════════════════════

const enabled = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV

const state = {
  renderCounts: new Map(),
  queryCounts: new Map(),
  slowOps: [],
}

export function markRender(label) {
  if (!enabled) return
  state.renderCounts.set(label, (state.renderCounts.get(label) || 0) + 1)
}

export function markQuery(label, durationMs) {
  if (!enabled) return
  state.queryCounts.set(label, (state.queryCounts.get(label) || 0) + 1)
  if (durationMs > 800) {
    state.slowOps.push({ label, durationMs: Math.round(durationMs), at: new Date().toISOString() })
    if (state.slowOps.length > 50) state.slowOps.shift()
    console.warn(`[NK_PERF] slow query (${Math.round(durationMs)}ms): ${label}`)
  }
}

if (enabled && typeof window !== 'undefined') {
  window.__NK_PERF = {
    renders: () => Object.fromEntries(state.renderCounts),
    queries: () => ({ counts: Object.fromEntries(state.queryCounts), total: [...state.queryCounts.values()].reduce((a, b) => a + b, 0), slow: state.slowOps }),
    reset: () => { state.renderCounts.clear(); state.queryCounts.clear(); state.slowOps.length = 0 },
  }
}
