import React from 'react'

/**
 * ProductionErrorBoundary — last-resort screen when the portal/dashboard
 * render crashes.
 *
 * Round 13/14 contract (see tests/deploy-config-check.cjs):
 *   - inline styles ONLY (no Tailwind classes) — this screen must render
 *     correctly even if the stylesheet itself was the thing that failed;
 *   - disarms the index.html boot watchdog the moment it catches, so the
 *     user sees THIS actionable screen, not the generic fallback;
 *   - offers a real "clear temp files" escape hatch via the ES5
 *     __NOKHBA_HARD_RESET__() helper defined in index.html (caches +
 *     service worker only — user data lives in the database, never wiped).
 */
export default class ProductionErrorBoundary extends React.Component {
  state = { hasError: false, errorId: '' }

  static getDerivedStateFromError() {
    return { hasError: true, errorId: `NK-${Date.now().toString(36).toUpperCase()}` }
  }

  componentDidCatch(error, info) {
    // Disarm the boot watchdog — the boundary IS the actionable screen now.
    try { window.__NOKHBA_BOOTED__ = true } catch { /* older browsers */ }
    try { window.__nokhbaBooted = true } catch { /* older browsers */ }
    this.showDiagnostics(error, info)
    console.error('[NOKHBA_UI_ERROR]', {
      error: error?.message || 'unknown error',
      componentStack: info?.componentStack || '',
      time: new Date().toISOString(),
    })
  }

  /* Forward the crash to the index.html diagnostics engine (it persists the
     last crash and can display the full report when opened with ?diag=1). */
  showDiagnostics(error, info) {
    try {
      if (window.__NOKHBA_DIAG && typeof window.__NOKHBA_DIAG.show === 'function') {
        window.__NOKHBA_DIAG.show(error, info)
      }
    } catch { /* diagnostics must never break recovery */ }
  }

  reset = () => {
    this.setState({ hasError: false, errorId: '' })
    window.location.reload()
  }

  hardReset = () => {
    if (typeof window.__NOKHBA_HARD_RESET__ === 'function') {
      window.__NOKHBA_HARD_RESET__()
      return
    }
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    // If the diagnostics engine owns the screen (opened with ?diag=1), let it
    // display the crash report instead of duplicating the recovery card.
    try {
      if (window.__NOKHBA_DIAG && typeof window.__NOKHBA_DIAG.isEngineUIActive === 'function' && window.__NOKHBA_DIAG.isEngineUIActive()) {
        return null
      }
    } catch { /* fall through to the normal recovery screen */ }
    const styles = {
      main: {
        minHeight: '100vh',
        padding: '40px 16px',
        background: '#f4f7fb',
        color: '#172033',
        fontFamily: "'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif",
        direction: 'rtl',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      card: {
        width: '100%',
        maxWidth: 440,
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid rgba(148,163,184,0.26)',
        borderRadius: 24,
        padding: '28px 24px',
        textAlign: 'center',
        boxShadow: '0 18px 40px rgba(15,23,42,0.08)',
      },
      icon: {
        width: 56,
        height: 56,
        margin: '0 auto 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 18,
        background: '#fff1f2',
        color: '#be123c',
        fontSize: 24,
        fontWeight: 900,
      },
      title: { margin: '0 0 12px', fontSize: 21, fontWeight: 900 },
      desc: { margin: '0 0 22px', fontSize: 14, lineHeight: 1.9, color: '#64748b' },
      retry: {
        display: 'inline-block',
        background: '#172033',
        color: '#ffffff',
        border: 'none',
        borderRadius: 14,
        padding: '12px 26px',
        fontSize: 14,
        fontWeight: 900,
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      hardReset: {
        display: 'block',
        margin: '10px auto 0',
        background: 'transparent',
        color: '#64748b',
        border: 'none',
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer',
        textDecoration: 'underline',
        fontFamily: 'inherit',
      },
      trace: { marginTop: 18, fontSize: 11, color: '#94a3b8' },
    }
    return (
      <main style={styles.main}>
        <section style={styles.card}>
          <div style={styles.icon}>!</div>
          <h1 style={styles.title}>حدثت مشكلة بسيطة</h1>
          <p style={styles.desc}>لم نتمكن من عرض هذه الصفحة الآن. بياناتك محفوظة، ويمكنك إعادة المحاولة بأمان.</p>
          <button type="button" onClick={this.reset} style={styles.retry}>إعادة المحاولة</button>
          <button type="button" onClick={this.hardReset} style={styles.hardReset}>مسح الملفات المؤقتة وإعادة المحاولة</button>
          <p style={styles.trace}>رقم المتابعة: {this.state.errorId}</p>
        </section>
      </main>
    )
  }
}
