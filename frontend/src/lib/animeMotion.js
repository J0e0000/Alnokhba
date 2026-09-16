import { useEffect } from 'react'
import { animate, createScope, stagger } from 'animejs'

export { animate, createScope, stagger }

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function useAnimeScope(rootRef, setup, deps = []) {
  useEffect(() => {
    if (!rootRef?.current || prefersReducedMotion()) return undefined
    const scope = createScope({ root: rootRef }).add(setup)
    return () => scope.revert()
    // The caller controls intentional reruns through deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export function playFeedback(target, kind = 'success') {
  if (!target || prefersReducedMotion()) return
  const success = kind === 'success'
  animate(target, {
    scale: success ? [0.96, 1.04, 1] : [1, 1.025, 0.985, 1],
    translateX: success ? 0 : [0, -8, 8, -5, 5, 0],
    borderColor: success ? ['#10b981', '#f59e0b'] : ['#fb7185', '#f59e0b'],
    duration: success ? 420 : 360,
    ease: success ? 'out(4)' : 'inOut(2)',
  })
}

export function revealNumber(element, value, duration = 650) {
  if (!element || prefersReducedMotion()) return
  const target = Number(value) || 0
  const state = { value: 0 }
  animate(state, {
    value: target,
    duration,
    ease: 'out(3)',
    onUpdate: () => { element.textContent = Number.isInteger(target) ? String(Math.round(state.value)) : state.value.toFixed(1) },
  })
}
