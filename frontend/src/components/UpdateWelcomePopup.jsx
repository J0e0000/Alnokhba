import { useEffect, useRef } from 'react'
import { UPDATE_POPUP_CONTENT } from '../lib/platformUpdates'

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE WELCOME POPUP (review round 5, note #23) — shown ONCE per teacher
// on the first open after this update: what's new (card redesign v3, coded
// blank cards + assign-to-student, bulk print) as a short friendly tutorial.
// Closing it dismisses forever (DB row + localStorage mirror — see
// platformUpdates.js). The ◔ header launcher re-opens it on demand.
// ═══════════════════════════════════════════════════════════════════════════
export default function UpdateWelcomePopup({ onDismiss }) {
  const ctaRef = useRef(null)

  useEffect(() => {
    ctaRef.current?.focus?.()
    const onKey = (e) => { if (e.key === 'Escape') onDismiss?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  const { title, subtitle, steps, cta, hint } = UPDATE_POPUP_CONTENT

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onClick={() => onDismiss?.()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="glass-card w-full max-w-md rounded-3xl p-5 sm:p-6 max-h-[86vh] overflow-y-auto"
        style={{ borderTop: '3px solid var(--brand-gold)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-1">
          <span className="text-3xl leading-none shrink-0" aria-hidden="true">🎴</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-black m-0 text-fg">{title}</h2>
            <p className="text-fg-muted text-[.78rem] mt-1 mb-0 leading-relaxed">{subtitle}</p>
          </div>
        </div>

        <ol className="list-none p-0 m-0 mt-4 flex flex-col gap-2.5">
          {steps.map((s, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-2xl p-3"
              style={{ background: 'var(--surface-container, rgba(20,45,98,.06))', border: '1px solid var(--surface-border)' }}
            >
              <span
                className="shrink-0 w-8 h-8 rounded-full grid place-items-center text-base"
                style={{ background: 'rgba(201,151,28,.14)' }}
                aria-hidden="true"
              >
                {s.icon}
              </span>
              <div className="flex-1 min-w-0">
                <p className="m-0 text-[.82rem] leading-relaxed text-fg">{s.text}</p>
              </div>
              <span
                className="shrink-0 w-5 h-5 rounded-full text-[.62rem] font-black grid place-items-center mt-0.5"
                style={{ background: 'var(--brand-navy)', color: '#fff' }}
                aria-hidden="true"
              >
                {i + 1}
              </span>
            </li>
          ))}
        </ol>

        <button
          ref={ctaRef}
          className="btn-gold w-full rounded-2xl px-4 py-3 text-[.85rem] font-extrabold mt-4"
          onClick={() => onDismiss?.()}
        >
          {cta}
        </button>
        <p className="text-fg-muted text-[.68rem] text-center mt-2.5 mb-0">{hint}</p>
      </div>
    </div>
  )
}
