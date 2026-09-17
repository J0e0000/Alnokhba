import { useMemo, useState } from 'react'
import { useEffect } from 'react'
import { useWorkspace, normalizeArabicSearch } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import FirstHint from '../components/FirstHint'
import { supabase } from '../lib/supabaseClient'
import { getStudentRank, getStudentRankPosition, normalizeEgyptianPhone, buildWhatsAppUrl, openWhatsAppUrl, checkAcademicWarning } from '../lib/helpers'

// ═══════════════════════════════════════════════════════════════════════════
// STUDENT HISTORY (rule 21) — quick reference, deliberately NOT a dashboard.
// Search (name / code / phone) → pick a student → compact historical profile
// with WhatsApp / Call. Kept separate from the Session Pipeline.
// ═══════════════════════════════════════════════════════════════════════════
export default function HistoryArea() {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [behaviorLogs, setBehaviorLogs] = useState([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  const matches = useMemo(() => {
    const q = normalizeArabicSearch(search)
    if (!q) return []
    return ws.students.filter((s) => normalizeArabicSearch([s.name, s.code, s.phone].filter(Boolean).join(' ')).includes(q)).slice(0, 8)
  }, [ws.students, search])

  const student = ws.students.find((s) => s.id === selectedId) || null

  useEffect(() => {
    let alive = true
    if (!student) { setBehaviorLogs([]); return }
    setLoadingLogs(true)
    supabase.from('behavior_logs').select('*').eq('teacher_id', ws.effectiveTeacherId || undefined).eq('student_id', student.id).order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => { if (alive) { setBehaviorLogs(data || []); setLoadingLogs(false) } })
      .catch(() => { if (alive) setLoadingLogs(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, student?.id])

  const attendanceHistory = useMemo(() => {
    if (!student) return []
    return (ws.allAttendance || []).filter((r) => r.student_id === student.id).slice(0, 20)
  }, [ws.allAttendance, student])

  const examHistory = useMemo(() => (student ? ws.examScoresByStudent[student.id] || [] : []), [ws.examScoresByStudent, student])

  if (!student) {
    return (
      <div>
        <FirstHint
          id="history-search"
          isArabic={isArabic}
          title={isArabic ? 'ابحث عن طالب لعرض سجله' : 'Search a student to view their record'}
          body={isArabic
            ? 'اكتب الاسم أو الكود أو الهاتف — السجل يعرض الحضور والدرجات والنقاط، مع أزرار تواصل مباشرة.'
            : 'Type a name, code or phone — the record shows attendance, grades and points, with direct contact buttons.'}
        />
        <h1 className="text-lg font-black mb-1">{isArabic ? 'سجل الطالب' : 'Student history'}</h1>
        <p className="text-[.74rem] text-fg-muted mb-4">{isArabic ? 'ابحث بالاسم أو الكود أو الهاتف لعرض السجل السريع.' : 'Search by name, code, or phone for a quick history view.'}</p>
        <input
          className="glass-input rounded-xl px-4 py-3 text-sm w-full max-w-md"
          placeholder={isArabic ? '🔍 اكتب الاسم أو الكود أو الهاتف...' : 'Search name / code / phone...'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="grid gap-2 mt-4 max-w-md">
          {matches.map((s, i) => (
            <button key={`${s.id}-${i}`} className="nk-row w-full text-right" onClick={() => setSelectedId(s.id)}>
              <span className="min-w-0">
                <b className="truncate">{s.name}</b>
                <small>{s.code || ''}{s.group_name ? ` · ${s.group_name}` : ''}{s.phone ? ` · ${s.phone}` : ''}</small>
              </span>
              <span className="nk-pill nk-pill-gold">{getStudentRank(s.points || 0, ws.ranks)}</span>
            </button>
          ))}
          {search && matches.length === 0 && <p className="text-center py-6 text-sm text-fg-muted">{isArabic ? 'لا نتائج' : 'No results'}</p>}
        </div>
      </div>
    )
  }

  const rank = getStudentRank(student.points || 0, ws.ranks)
  const position = getStudentRankPosition(student.id, ws.students)
  const phone = normalizeEgyptianPhone(student.phone)
  const waUrl = phone ? buildWhatsAppUrl(phone, (ws.settings?.msg_welcome || 'مرحبًا {studentName}').replace('{studentName}', student.name)) : null
  const presentCount = attendanceHistory.filter((r) => r.status === 'حاضر').length
  const absentCount = attendanceHistory.filter((r) => r.status === 'غائب').length
  const attendancePct = presentCount + absentCount > 0 ? Math.round((presentCount / (presentCount + absentCount)) * 100) : null
  const academicWarning = checkAcademicWarning(examHistory)

  return (
    <div>
      <FirstHint
        id="history-surface"
        isArabic={isArabic}
        title={isArabic ? 'سجل الطالب — للمراجعة والتواصل فقط' : 'Student History — review & contact only'}
        body={isArabic
          ? 'هنا تراجع تاريخ الطالب وتتواصل مع ولي أمره. تعديل بيانات الحصة (حضور، واجب، درجات) يتم من داخل مساحة الحصة فقط.'
          : 'Review a student\'s history and contact their parent here. Session data (attendance, homework, grades) is edited inside the Session Workspace only.'}
      />
      <button className="btn-ghost rounded-xl px-4 py-2 text-[.75rem] font-extrabold mb-4" onClick={() => { setSelectedId(null); setSearch('') }}>
        → {isArabic ? 'بحث آخر' : 'New search'}
      </button>

      <div className="glass-card p-5 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black m-0">{student.name}</h2>
            <p className="text-[.74rem] text-fg-muted m-0 mt-1">
              {student.code || ''}{student.group_name ? ` · ${student.group_name}` : ''}{student.stage ? ` · ${student.stage}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            {waUrl && (
              <a className="action-button !min-h-[2.7rem] !min-w-0 !px-4 text-[.75rem]" style={{ background: '#0c6b50', borderColor: '#0c6b50', color: '#fff' }} href={waUrl} target="_blank" rel="noreferrer">
                ✆ WhatsApp
              </a>
            )}
            {phone && (
              <a className="action-button !min-h-[2.7rem] !min-w-0 !px-4 text-[.75rem]" href={`tel:+${phone}`} style={{ background: 'var(--info-bg)', color: 'var(--info-strong)', borderColor: 'var(--info-border)' }}>
                📞 {isArabic ? 'اتصال' : 'Call'}
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-4">
          <span className="nk-pill nk-pill-gold">{rank} · {student.points || 0} {isArabic ? 'نقطة' : 'pts'}</span>
          <span className="nk-pill nk-pill-neutral">{isArabic ? 'الترتيب' : 'Rank'}: {position}</span>
          {(student.warnings || 0) > 0 && <span className="nk-pill nk-pill-danger">⚠ {isArabic ? 'إنذارات' : 'Warnings'}: {student.warnings}</span>}
          {attendancePct !== null && <span className={`nk-pill ${attendancePct >= 75 ? 'nk-pill-live' : 'nk-pill-pending'}`}>{isArabic ? 'نسبة الحضور' : 'Attendance'}: {attendancePct}%</span>}
          {academicWarning && <span className="nk-pill nk-pill-danger">⚠ {isArabic ? 'إنذار أكاديمي' : 'Academic warning'}</span>}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="glass-card p-4">
          <h3 className="text-[.85rem] font-extrabold mt-0 mb-3">{isArabic ? 'سجل الحضور (أحدث 20)' : 'Attendance (latest 20)'}</h3>
          {attendanceHistory.length === 0 ? (
            <p className="text-[.74rem] text-fg-muted m-0">{isArabic ? 'لا يوجد سجل حضور بعد' : 'No attendance records yet'}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {attendanceHistory.map((r, i) => (
                <span key={`${r.id || 'r'}-${r.lesson_session_id || ''}-${i}`} className={`nk-pill ${r.status === 'حاضر' ? 'nk-pill-live' : r.status === 'غائب' ? 'nk-pill-danger' : 'nk-pill-neutral'}`} title={r.recorded_at ? new Date(r.recorded_at).toLocaleDateString('ar-EG') : ''}>
                  {r.status === 'حاضر' ? '✓' : r.status === 'غائب' ? '✗' : '○'} {r.recorded_at ? new Date(r.recorded_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }) : ''}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="glass-card p-4">
          <h3 className="text-[.85rem] font-extrabold mt-0 mb-3">{isArabic ? 'الدرجات' : 'Exam scores'}</h3>
          {examHistory.length === 0 ? (
            <p className="text-[.74rem] text-fg-muted m-0">{isArabic ? 'لا توجد درجات بعد' : 'No exam scores yet'}</p>
          ) : (
            <div className="grid gap-1.5">
              {examHistory.slice(-6).reverse().map((ex, i) => {
                const max = (ex.max_score_per_section || 0) * Object.keys(ex.section_scores || {}).length
                const pct = max ? Math.round((ex.total_score / max) * 100) : 0
                return (
                  <div key={`${ex.id || 'ex'}-${i}`} className="flex items-center justify-between gap-2 text-[.74rem]">
                    <span className="truncate">{ex.exam_title || 'امتحان'}</span>
                    <span className={`nk-pill ${pct >= 60 ? 'nk-pill-live' : 'nk-pill-danger'}`}>{ex.total_score} / {max} · {pct}%</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="glass-card p-4 md:col-span-2">
          <h3 className="text-[.85rem] font-extrabold mt-0 mb-3">{isArabic ? 'الملاحظات والنقاط (أحدث 30)' : 'Behavior log (latest 30)'}</h3>
          {loadingLogs ? (
            <p className="text-[.74rem] text-fg-muted m-0">{isArabic ? 'جاري التحميل...' : 'Loading...'}</p>
          ) : behaviorLogs.length === 0 ? (
            <p className="text-[.74rem] text-fg-muted m-0">{isArabic ? 'لا ملاحظات بعد' : 'No notes yet'}</p>
          ) : (
            <div className="grid gap-1.5 max-h-64 overflow-y-auto">
              {behaviorLogs.map((log, i) => (
                <div key={`${log.id || 'log'}-${i}`} className="flex items-center justify-between gap-2 text-[.74rem] border-b border-subtle pb-1.5">
                  <span className="truncate">{log.note}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <small className="text-fg-subtle">{log.created_at ? new Date(log.created_at).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }) : ''}</small>
                    <span className={`nk-pill ${(log.points_delta || 0) > 0 ? 'nk-pill-live' : (log.points_delta || 0) < 0 ? 'nk-pill-danger' : 'nk-pill-neutral'}`}>
                      {(log.points_delta || 0) > 0 ? `+${log.points_delta}` : log.points_delta || 0}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
