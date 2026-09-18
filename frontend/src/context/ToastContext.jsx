import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const ToastContext = createContext(null)

let idCounter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const showToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = ++idCounter
    let added = false
    setToasts((prev) => {
      if (prev.some((toast) => toast.message === message && toast.type === type)) return prev
      added = true
      return [...prev.slice(-3), { id, message, type }]
    })
    if (added) setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), duration)
  }, [])

  const dismiss = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), [])

  const styles = {
    success: 'glass-card border-emerald-500/30 text-emerald-300',
    error: 'glass-card border-rose-500/30 text-rose-300',
    info: 'glass-card border-brand-gold/40 text-fg',
  }
  const icons = { success: '✅', error: '❌', info: 'ℹ️' }
  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* pointer-events-none on the wrapper: an EMPTY toast stack must never
          intercept clicks on content underneath (blocker bug). Individual
          toasts re-enable pointer events. Positioned above the floating
          action stack (left) so they never cover the help / back-to-top
          buttons on mobile or desktop. */}
      <div className="fixed bottom-[11.75rem] lg:bottom-[8.5rem] left-4 z-[100] space-y-2 max-w-xs w-full pointer-events-none" dir="rtl">
        {toasts.map((t) => (
          <div key={t.id} onClick={() => dismiss(t.id)}
            className={`pointer-events-auto border rounded-xl shadow-lg px-4 py-3 text-sm font-semibold flex items-center gap-2 cursor-pointer animate-[fadeIn_0.2s_ease] ${styles[t.type]}`}>
            <span>{icons[t.type]}</span>
            <span className="flex-1">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
