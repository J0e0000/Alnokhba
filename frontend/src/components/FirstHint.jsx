import { useFirstVisit } from '../lib/useFirstVisit'

// ═══════════════════════════════════════════════════════════════════════════
// FirstHint (brief §20) — a one-time contextual callout at the top of a
// surface. Shows ONCE (persisted), dismissible, teaches product RULES rather
// than decoration. Never interrupts experienced users again.
// ═══════════════════════════════════════════════════════════════════════════
export default function FirstHint({ id, title, body, isArabic = true }) {
  const [show, markSeen] = useFirstVisit(id)
  if (!show) return null
  return (
    <div className="nk-hint" role="note">
      <div className="min-w-0">
        <b className="block mb-1">{title}</b>
        <p className="m-0 text-[.76rem] leading-6">{body}</p>
      </div>
      <button type="button" className="nk-hint__ok" onClick={markSeen}>
        {isArabic ? 'فهمت ✓' : 'Got it ✓'}
      </button>
    </div>
  )
}
