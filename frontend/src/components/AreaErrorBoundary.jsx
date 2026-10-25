import React from 'react'

/* Crash telemetry with ZERO bundle cost: do NOT import posthog here — a
   static import would pull the whole posthog-js library (~300 KB) into the
   main bundle (real regression measured in the 2026-10-26 build). Instead:
   capture through the window bridge posthog.js installs (window.__nkPosthog),
   or push into window.__nkQueue which posthog init drains (last 200) when it
   loads idle. If analytics never loaded, the console error below still logs. */
function reportCrash(area, payload) {
  try {
    const ph = typeof window !== 'undefined' && window.__nkPosthog
    if (ph && typeof ph.capture === 'function') { ph.capture('area_crash', payload); return }
    if (typeof window !== 'undefined') {
      if (!Array.isArray(window.__nkQueue)) window.__nkQueue = []
      window.__nkQueue.push({ event: 'area_crash', ...payload })
    }
  } catch { /* analytics must never break recovery */ }
}

/**
 * AreaErrorBoundary — crash CONTAINMENT for one screen/area (security+speed
 * audit 2026-10-26: "many pages crash" response, part 1).
 *
 * Before: a render crash ANYWHERE fell through to the root
 * ProductionErrorBoundary → the whole workspace was replaced by the
 * fullscreen recovery card and "retry" meant a FULL page reload (all boot
 * queries re-run, all in-progress work lost).
 *
 * Now: each top-level area (home/session/exam/task/onlineExam/students/
 * history/homework/reports/settings) is wrapped. A crash inside ONE area
 * shows a compact in-flow recovery card while the shell (nav, banners,
 * notifications) keeps working — and "إعادة المحاولة" remounts just that
 * area, no reload, no lost state elsewhere.
 *
 * Every catch is forwarded to PostHog (area + top message) so recurring
 * crash sources become visible in analytics instead of anecdotal.
 */
export default class AreaErrorBoundary extends React.Component {
  state = { hasError: false, errorId: '' }

  static getDerivedStateFromError() {
    return { hasError: true, errorId: `NK-${Date.now().toString(36).toUpperCase()}` }
  }

  componentDidCatch(error, info) {
    try { window.__NOKHBA_BOOTED__ = true } catch { /* older browsers */ }
    try { window.__nokhbaBooted = true } catch { /* older browsers */ }
    const area = this.props.area || 'unknown'
    reportCrash(area, {
      area,
      message: String(error?.message || 'unknown').slice(0, 220),
      stack_head: String(error?.stack || '').slice(0, 500),
      errorId: this.state.errorId,
    })
    console.error('[NOKHBA_AREA_ERROR]', area, {
      error: error?.message || 'unknown error',
      componentStack: (info?.componentStack || '').split('\n').slice(0, 5).join(' | '),
      errorId: this.state.errorId,
      time: new Date().toISOString(),
    })
  }

  reset = () => this.setState({ hasError: false, errorId: '' })

  render() {
    if (!this.state.hasError) return this.props.children
    const isArabic = this.props.isArabic !== false
    return (
      <div
        dir={isArabic ? 'rtl' : 'ltr'}
        role="alert"
        style={{
          margin: '24px auto',
          maxWidth: 460,
          background: 'rgba(255,255,255,0.9)',
          border: '1px solid rgba(148,163,184,0.3)',
          borderRadius: 20,
          padding: '22px 20px',
          textAlign: 'center',
          boxShadow: '0 12px 30px rgba(15,23,42,0.08)',
          fontFamily: "'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif",
          color: '#142D62',
        }}
      >
        <div style={{ fontSize: 30, marginBottom: 8 }}>🛠️</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 900 }}>
          {isArabic ? 'الصفحة دي وقعت — الباقي شغال' : 'This screen hit a snag'}
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, lineHeight: 1.8, color: '#64748b' }}>
          {isArabic
            ? 'بياناتك محفوظة وتقدر تكمل باقي الصفحات عادي. جرّب تعيد فتح الصفحة دي.'
            : 'Your data is safe and the rest of the app keeps working. Try reopening this screen.'}
        </p>
        <button
          type="button"
          onClick={this.reset}
          style={{
            background: '#142D62', color: '#fff', border: 'none', borderRadius: 12,
            padding: '10px 22px', fontSize: 13.5, fontWeight: 900, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {isArabic ? 'إعادة فتح الصفحة' : 'Retry this screen'}
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            display: 'block', margin: '10px auto 0', background: 'transparent', color: '#64748b',
            border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit',
          }}
        >
          {isArabic ? 'تحديث كامل للتطبيق' : 'Full app refresh'}
        </button>
        <p style={{ margin: '14px 0 0', fontSize: 11, color: '#94a3b8' }}>
          {isArabic ? 'لو بتتكرر كل مرة، افتح صفحة التشخيص وابعت لنا الكود:' : 'If it repeats, open the diagnostics page and send us:'} {this.state.errorId}
        </p>
      </div>
    )
  }
}
