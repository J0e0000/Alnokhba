/**
 * diagnostics.js — Round 11 React ↔ engine bridge.
 * ----------------------------------------------------------------------------
 * The Comprehensive Diagnostic & Error Capture System lives INLINE in
 * index.html (window.__NOKHBA_DIAG) so it can catch boot-time parsing and
 * syntax errors BEFORE (and even WITHOUT) this bundle. This module is the
 * thin, defensive bridge the React world uses to hand crashes to that engine:
 *
 *   ProductionErrorBoundary → showDiagnostics() → engine.showReactError()
 *                                            └→ full diagnostic overlay:
 *                                               error name/message, file:line:col,
 *                                               stack trace, environment data
 *                                               (userAgent, iOS version, screen,
 *                                               PWA mode, storage/auth state) and
 *                                               live self-tests + Copy-JSON and
 *                                               Force-Reload-Clear-Storage actions.
 *
 * If the engine is somehow missing (SSR, tests, exotic hosts) everything
 * degrades to console output — it must never throw.
 */

function getEngine() {
  return typeof window !== 'undefined' && window.__NOKHBA_DIAG ? window.__NOKHBA_DIAG : null
}

/**
 * Forward a caught error to the diagnostic engine (paints the overlay).
 * @param {{ error?: unknown, componentStack?: string, source?: string }} info
 * @returns {boolean} true when the engine handled it
 */
export function showDiagnostics({ error, componentStack, source } = {}) {
  const engine = getEngine()
  if (engine && typeof engine.showReactError === 'function') {
    engine.showReactError({ error, componentStack })
    return true
  }
  // Engine missing — fall back to the console so Safari Web Inspector still
  // shows the crash payload.
  // eslint-disable-next-line no-console
  console.error('[NOKHBA_DIAGNOSTIC_FALLBACK]', {
    source,
    error,
    componentStack,
    time: new Date().toISOString(),
  })
  return false
}

/** Open the diagnostic panel manually (self-tests + environment). */
export function openDiagnosticPanel() {
  const engine = getEngine()
  if (engine) {
    engine.show('manual')
    return true
  }
  return false
}

/** Build the full JSON crash/diagnostic payload (same JSON the Copy button produces). */
export function getDiagnosticPayload() {
  const engine = getEngine()
  return engine ? engine.buildPayload('manual') : null
}

const diagnostics = { showDiagnostics, openDiagnosticPanel, getDiagnosticPayload }
export default diagnostics
