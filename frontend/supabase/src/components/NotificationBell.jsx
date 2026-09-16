import { useEffect, useRef, useState } from 'react'
import { animate, prefersReducedMotion } from '../lib/animeMotion'

export default function NotificationBell({ broadcasts, dismissedBroadcasts, onDismiss }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const badgeRef = useRef(null)
  const unreadCount = broadcasts.filter((b) => !dismissedBroadcasts.includes(b.id)).length
  useEffect(() => {
    if (!badgeRef.current || unreadCount === 0 || prefersReducedMotion()) return
    animate(badgeRef.current, { scale: [0.8, 1.18, 1], duration: 360, ease: 'out(4)' })
  }, [unreadCount])

  useEffect(() => {
    const onClickOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} title="الإشعارات" className="relative text-fg-subtle hover:text-fg text-lg">
        🔔
        {unreadCount > 0 && (
          <span ref={badgeRef} className="absolute -top-1.5 -left-1.5 bg-rose-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 mt-2 w-72 glass-card rounded-xl shadow-lg z-30 max-h-80 overflow-y-auto">
          <div className="px-3 py-2 border-b border-subtle text-xs font-bold text-fg">الإشعارات</div>
          {broadcasts.length === 0 ? (
            <p className="text-fg-subtle text-xs text-center py-6">مفيش إشعارات لسه</p>
          ) : (
            <div className="divide-y divide-[var(--surface-border)]">
              {broadcasts.map((b) => {
                const isUnread = !dismissedBroadcasts.includes(b.id)
                return (
                  <button key={b.id} onClick={() => onDismiss(b.id)}
                    className={`w-full text-right px-3 py-2.5 text-xs hover:bg-white/5 ${isUnread ? 'text-fg' : 'text-fg-subtle'}`}>
                    <div className="flex items-start gap-2">
                      {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-brand-gold mt-1 shrink-0" />}
                      <div>
                        <p>{b.message}</p>
                        <p className="text-[10px] text-fg-subtle mt-1">{new Date(b.created_at).toLocaleDateString('ar-EG')}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
