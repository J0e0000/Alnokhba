import { useCallback, useEffect, useRef, useState } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// useStageState — workflow-stage + navigation persistence for ONE lesson.
//
// This is TASK state (spec 13: task progress ≠ data completeness) — the
// server owns the DATA (attendance rows, homework, grades); this hook only
// remembers "which workflow stage the teacher explicitly completed" and
// "which tab they were on" so a reload/backgrounding/crash returns them to
// exactly where they were (spec: resilient to reloads).
//
// Keyed per lesson id → switching lessons never leaks state. localStorage
// (not sessionStorage) so a browser kill/reopen still restores.
// ═══════════════════════════════════════════════════════════════════════════

const KEY = (lessonId) => `nokhba_stage_state_v1_${lessonId || 'none'}`

function read(lessonId) {
  try {
    const raw = localStorage.getItem(KEY(lessonId))
    return raw ? JSON.parse(raw) || {} : {}
  } catch { return {} }
}

/** Synchronous read of a lesson's stage state (used for restore-on-mount). */
export function readStageState(lessonId) {
  return read(lessonId)
}

export function useStageState(lessonId) {
  const [state, setState] = useState(() => read(lessonId))
  const lessonRef = useRef(lessonId)
  lessonRef.current = lessonId

  // Lesson switched → adopt that lesson's stored state.
  useEffect(() => {
    setState(read(lessonId))
  }, [lessonId])

  // Persist on every change (tiny object — synchronous write is fine).
  useEffect(() => {
    try { localStorage.setItem(KEY(lessonRef.current), JSON.stringify(state)) } catch { /* storage blocked */ }
  }, [state, lessonId])

  const markStageComplete = useCallback((stage) => {
    setState((s) => ({ ...s, [`${stage}Complete`]: true, [`${stage}CompletedAt`]: new Date().toISOString() }))
  }, [])

  const setTab = useCallback((tab) => {
    setState((s) => (s.tab === tab ? s : { ...s, tab }))
  }, [])

  return [state, markStageComplete, setTab]
}
