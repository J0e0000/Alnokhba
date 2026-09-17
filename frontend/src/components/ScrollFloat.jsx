import { useEffect, useRef } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// SCROLL UTILITIES (brief §13/§14) — lightweight, rAF-throttled, and fully
// disabled under prefers-reduced-motion.
//   <ScrollProgress/>  thin progress line pinned to the viewport top
//   <BackToTop/>       floating button that appears after meaningful scrolling
// ═══════════════════════════════════════════════════════════════════════════

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function ScrollProgress() {
  const ref = useRef(null)
  useEffect(() => {
    if (prefersReducedMotion()) return
    let raf = 0
    const update = () => {
      raf = 0
      const el = ref.current
      if (!el) return
      const doc = document.documentElement
      const max = doc.scrollHeight - window.innerHeight
      const pct = max > 200 ? Math.min(100, Math.round((window.scrollY / max) * 100)) : 0
      el.style.opacity = pct > 0 ? '1' : '0'
      el.style.width = `${pct}%`
    }
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [])
  return <div className="nk-scroll-progress" ref={ref} aria-hidden="true" />
}

export function BackToTop() {
  const ref = useRef(null)
  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      const el = ref.current
      if (!el) return
      const show = window.scrollY > 600
      el.style.opacity = show ? '1' : '0'
      el.style.pointerEvents = show ? 'auto' : 'none'
      el.setAttribute('aria-hidden', show ? 'false' : 'true')
    }
    const onScroll = () => { if (!raf) raf = window.requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [])
  return (
    <button
      ref={ref}
      type="button"
      className="nk-fab nk-fab--top"
      onClick={() => window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })}
      aria-label="العودة للأعلى"
      title="العودة للأعلى"
    >
      ↑
    </button>
  )
}

export default ScrollProgress
