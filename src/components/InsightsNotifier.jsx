import { useEffect, useRef } from 'react'
import { useWorkspace } from '../store/WorkspaceStore'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import {
  readLocalSnapshot, fetchRemoteState, analysisDue,
} from '../lib/insights/dbStore'
import { runWeeklyPipeline, openShape } from '../lib/insights/runWeekly'

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS NOTIFIER (owner request) — فريق التحليل greets the teacher through
// the NOTIFICATION BELL when the site opens, never as a blocking popup:
//
//   • site opens → if the weekly window is due, the SAME weekly pipeline runs
//     once (runWeeklyPipeline — same engine, same storage, so the due-window
//     advances exactly once and the Settings tab shows the stored report);
//     otherwise the last stored report's open insights are used.
//   • if that report has open (non-resolved) insights, ONE event row lands in
//     teacher_notification_events → the bell badge + a quiet entry in the
//     notification center. Nothing overlays the working screen.
//   • clicking that entry opens the فريق التحليل TAB inside Settings
//     (TeacherNotificationCenter → onOpenInsights → ui.openInsights).
//   • dedupe: one notification per weekly report (localStorage marks the
//     report id as notified) — reopening the site never re-spams the bell.
//
// Zero-attention runs (no open insights) stay silent on purpose: the notifier
// guides, it doesn't nag. Every failure path is swallowed (console.warn) —
// this component must never disturb the session workflow.
// ═══════════════════════════════════════════════════════════════════════════

const NOTIFIED_KEY = (teacherId) => `nk_insights_notified_${teacherId}`
const STARTUP_DELAY_MS = 4000

export default function InsightsNotifier() {
  const ws = useWorkspace()
  const { effectiveTeacherId } = useAuth()
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current || ws.loading || !effectiveTeacherId || !ws.settings) return
    // NOTE: ranRef flips INSIDE the callback — deps (ws.settings) can change
    // right after mount and the cleanup would otherwise clear the pending
    // timer permanently (StrictMode double-run included) and the notifier
    // would never fire for the whole session.
    const timer = setTimeout(async () => {
      ranRef.current = true
      const teacherId = effectiveTeacherId
      try {
        let remote = null
        try { remote = await fetchRemoteState(teacherId) } catch { remote = null }
        const local = readLocalSnapshot(teacherId)
        const lastAt = remote?.latestWeekly?.report?.generatedAt
          || local?.weekly?.report?.generatedAt
          || null

        let openInsights = []
        let reportId = null
        let headline = ''

        if (analysisDue(lastAt)) {
          // Weekly window due — run the shared pipeline once and persist it.
          const prevOpen = openShape(remote?.openInsights || [])
          const dismissedKeys = remote?.dismissedKeys || []
          const snapshot = await runWeeklyPipeline({ teacherId, ws, prevOpen, dismissedKeys })
          reportId = snapshot?.report?.generatedAt || null
          headline = snapshot?.report?.summary || snapshot?.report?.situation?.currentState?.headline || ''
          openInsights = (snapshot?.report?.insights || []).filter((i) => i.status !== 'resolved')
        } else {
          // Window already consumed — remind only about the stored report.
          const source = remote?.latestWeekly || local?.weekly || null
          reportId = source?.report?.generatedAt || null
          headline = source?.report?.summary || source?.report?.situation?.currentState?.headline || ''
          // remote.openInsights is the lifecycle view, but it can be an empty
          // array while the stored report still has open rows (fresh DB
          // mirror / demo) — fall back to the report's own non-resolved list.
          const storedOpen = (source?.report?.insights || []).filter((i) => i.status !== 'resolved')
          openInsights = remote?.openInsights?.length ? remote.openInsights : storedOpen
        }

        if (!openInsights.length || !reportId) return
        let notified = null
        try { notified = localStorage.getItem(NOTIFIED_KEY(teacherId)) } catch { notified = null }
        if (notified === reportId) return

        const attentionCount = openInsights.filter((i) => i.severity === 'needs-attention').length
        const watchCount = openInsights.length - attentionCount
        const parts = []
        if (attentionCount) parts.push(`${attentionCount} ملاحظة محتاجة اهتمام`)
        if (watchCount) parts.push(`${watchCount} ملاحظة للمتابعة`)
        const summaryBits = [headline, parts.length ? parts.join(' و ') : `${openInsights.length} ملاحظات مفتوحة`].filter(Boolean)
        const body = summaryBits.join(' — ')
        const { error } = await supabase.from('teacher_notification_events').insert({
          teacher_id: teacherId,
          event_type: 'student_insight',
          title: 'فريق التحليل — تقرير الوضع',
          body,
          category: 'general',
          is_read: false,
        })
        if (error) { console.warn('insights notify insert failed:', error.message); return }
        try { localStorage.setItem(NOTIFIED_KEY(teacherId), reportId) } catch { /* dedupe best-effort */ }
      } catch (err) {
        console.warn('insights notifier skipped:', err?.message || err)
      }
    }, STARTUP_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.loading, effectiveTeacherId, ws.settings])

  return null
}
