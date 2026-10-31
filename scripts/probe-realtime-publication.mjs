/**
 * Probe the LIVE Supabase realtime publication status for each table.
 * Uses the project's installed supabase-js with the anon key.
 * Subscribing to a table NOT in `supabase_realtime` publication returns
 * a channel error mentioning the publication — that's how we detect it.
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = fs.readFileSync('/home/z/my-project/work/FE-new/.env', 'utf8')
const url = env.match(/VITE_SUPABASE_URL=(\S+)/)?.[1]
const key = env.match(/VITE_SUPABASE_ANON_KEY=(\S+)/)?.[1]

const TABLES = [
  'students', 'lesson_sessions', 'attendance_records', 'session_logs',
  'behavior_logs', 'exam_scores', 'exams', 'group_schedule',
  'broadcast_messages', 'student_notifications', 'announcements',
  'teacher_notification_events', 'homework_tasks',
]

const supabase = createClient(url, key)

const results = await Promise.all(TABLES.map((table) => new Promise((resolve) => {
  const channel = supabase.channel(`probe-${table}-${Date.now()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter: `teacher_id=eq.00000000-0000-0000-0000-000000000000` }, () => {})
    .subscribe((status, err) => {
      let verdict = 'OK'
      const msg = String(err?.message || err?.error?.message || err || '')
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        verdict = /publication|Unable to subscribe|1008|not.*publication/i.test(msg) ? 'NOT_IN_PUBLICATION' : `ERROR:${status}:${msg.slice(0, 120)}`
      } else if (status === 'SUBSCRIBED') {
        verdict = 'OK'
      }
      // also listen for postgres_changes error payloads
      setTimeout(() => { try { supabase.removeChannel(channel) } catch {} }, 500)
      resolve({ table, status, msg: msg.slice(0, 200), verdict })
    })
  // Catch async channel errors (e.g. server error frames)
  setTimeout(() => { try { resolve({ table, status: 'timeout-expected', verdict: 'OK_OR_SILENT' }) } catch {} }, 6000)
})))

for (const r of results) console.log(JSON.stringify(r))
process.exit(0)
