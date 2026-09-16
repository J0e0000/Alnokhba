import React from 'react'

export default class ProductionErrorBoundary extends React.Component {
  state = { hasError: false, errorId: '' }

  static getDerivedStateFromError() {
    return { hasError: true, errorId: `NK-${Date.now().toString(36).toUpperCase()}` }
  }

  componentDidCatch(error, info) {
    console.error('[NOKHBA_UI_ERROR]', {
      error: error?.message || 'unknown error',
      componentStack: info?.componentStack || '',
      time: new Date().toISOString(),
    })
  }

  reset = () => {
    this.setState({ hasError: false, errorId: '' })
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <main className="min-h-screen bg-brand-bg px-4 py-10 text-fg" dir="rtl">
        <section className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center">
          <div className="glass-card w-full p-7 text-center sm:p-9">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-2xl text-rose-700">!</div>
            <h1 className="mb-3 text-xl font-black">حدثت مشكلة بسيطة</h1>
            <p className="mb-6 text-sm leading-7 text-fg-muted">لم نتمكن من عرض هذه الصفحة الآن. بياناتك محفوظة، ويمكنك إعادة المحاولة بأمان.</p>
            <button onClick={this.reset} className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-black text-white transition hover:-translate-y-0.5">إعادة المحاولة</button>
            <p className="mt-4 text-[11px] text-fg-subtle">رقم المتابعة: {this.state.errorId}</p>
          </div>
        </section>
      </main>
    )
  }
}
