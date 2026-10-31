import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// TOUR OVERLAY — spotlight tutorial (spec 17–19, 35)
//
// "Look HERE" — the whole page is blurred/dimmed behind four shade panels;
// only the step's target element stays sharp, highlighted by a gold ring.
// The tooltip card is positioned DYNAMICALLY from getBoundingClientRect —
// never hardcoded coordinates — and follows the target through resize and
// scroll. On phones the card takes the free space above/below the target and
// never covers it; the target is scrolled into view automatically.
// Every step is skippable and finishing/skipping always returns the UI to
// normal (the tour can never permanently block the app).
// ═══════════════════════════════════════════════════════════════════════════

const PAD = 8 // breathing room around the highlighted target

function findTarget(selector) {
  if (!selector) return null
  const nodes = document.querySelectorAll(selector)
  for (const node of nodes) {
    // Skip elements hidden by responsive rules (offsetParent is null for
    // display:none subtrees) — desktop sidebar vs mobile bottom-nav etc.
    if (node.offsetParent !== null) return node
  }
  return nodes[0] || null
}

export default function TourOverlay({ steps = [], onDone }) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState(null)
  const [vw, setVw] = useState(() => window.innerWidth)
  const [vh, setVh] = useState(() => window.innerHeight)
  const rafRef = useRef(0)
  const step = steps[index]

  const measure = useCallback(() => {
    setVw(window.innerWidth)
    setVh(window.innerHeight)
    const el = findTarget(step?.target)
    if (!el) { setRect(null); return }
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) { setRect(null); return }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
  }, [step?.target])

  // Scroll the target into view, then measure after the smooth scroll settles.
  useLayoutEffect(() => {
    const el = findTarget(step?.target)
    if (el?.scrollIntoView) {
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch { el.scrollIntoView() }
    }
    measure()
    const t1 = setTimeout(measure, 120)
    const t2 = setTimeout(measure, 400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [index, step?.target, measure])

  // Track scroll/resize with a rAF throttle so the ring and card follow live.
  useEffect(() => {
    const schedule = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(measure)
    }
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    window.visualViewport?.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.visualViewport?.removeEventListener('resize', schedule)
    }
  }, [measure])

  const finish = () => onDone?.()
  const next = () => (index + 1 >= steps.length ? finish() : setIndex((i) => i + 1))
  const back = () => setIndex((i) => Math.max(0, i - 1))

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') finish()
      if (e.key === 'ArrowLeft') next() // RTL: left arrow = forward
      if (e.key === 'ArrowRight') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, steps.length])

  // ── Geometry ──────────────────────────────────────────────────────────────
  const ring = rect
    ? {
        top: Math.max(0, rect.top - PAD),
        left: Math.max(0, rect.left - PAD),
        width: Math.min(vw, rect.width + PAD * 2),
        height: Math.min(vh, rect.height + PAD * 2),
      }
    : null
  const shades = ring ? [
    { top: 0, left: 0, width: '100%', height: ring.top },
    { top: ring.top + ring.height, left: 0, width: '100%', height: Math.max(0, vh - ring.top - ring.height) },
    { top: ring.top, left: 0, width: ring.left, height: ring.height },
    { top: ring.top, left: ring.left + ring.width, width: Math.max(0, vw - ring.left - ring.width), height: ring.height },
  ] : [{ top: 0, left: 0, width: '100%', height: '100%' }]

  // Tooltip placement: prefer below the target, then above, then centered.
  const CARD_W = Math.min(330, vw - 24)
  const CARD_H_EST = 190
  let cardStyle
  if (ring) {
    const spaceBelow = vh - (ring.top + ring.height)
    const spaceAbove = ring.top
    if (spaceBelow >= Math.min(CARD_H_EST, spaceAbove) || spaceBelow > 220) {
      cardStyle = { top: Math.min(ring.top + ring.height + 10, vh - CARD_H_EST - 10), width: CARD_W }
    } else {
      cardStyle = { top: Math.max(10, ring.top - CARD_H_EST - 10), width: CARD_W }
    }
    const centered = ring.left + ring.width / 2 - CARD_W / 2
    cardStyle.left = Math.max(12, Math.min(centered, vw - CARD_W - 12))
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: CARD_W }
  }
  cardStyle.maxHeight = vh - 24
  cardStyle.overflowY = 'auto'

  return (
    <div className="nk-tour" role="dialog" aria-modal="true" aria-label={step?.title || 'الجولة التعريفية'}>
      {shades.map((s, i) => (
        <div key={i} className="nk-tour__shade" style={s} onClick={next} aria-hidden="true" />
      ))}
      {ring && <div className="nk-tour__ring" style={ring} aria-hidden="true" />}
      <div className="nk-tour__card glass-card" style={cardStyle}>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="nk-pill nk-pill-gold !text-[.62rem]">{index + 1} / {steps.length}</span>
          <button className="btn-ghost !min-h-0 rounded-lg px-2.5 py-1 text-[.66rem] font-extrabold" onClick={finish}>
            تخطي الجولة ✕
          </button>
        </div>
        <h3 className="text-[.9rem] font-black m-0 mb-1.5">{step?.title}</h3>
        <p className="text-[.76rem] leading-6 text-fg-muted m-0 mb-3">{step?.body}</p>
        <div className="flex items-center gap-1.5 mb-3" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className="nk-tour__dot" style={i === index ? { background: 'var(--brand-gold)', width: 18 } : undefined} />
          ))}
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost rounded-xl px-4 py-2.5 text-[.74rem] font-extrabold" disabled={index === 0} onClick={back} style={index === 0 ? { opacity: 0.4 } : undefined}>
            → السابق
          </button>
          <button className="btn-gold flex-1 rounded-xl px-4 py-2.5 text-[.74rem] font-extrabold" onClick={next}>
            {index + 1 >= steps.length ? 'تم — يلا نبدأ ✓' : 'التالي ←'}
          </button>
        </div>
      </div>
    </div>
  )
}
