import { useMemo, useState } from 'react'
import { useWorkspace, normalizeArabicSearch } from '../store/WorkspaceStore'
import { useUI } from '../shell/UIContext'
import { HOMEWORK_PRESETS } from '../lib/hwQuiz'
import TourOverlay from '../components/TourOverlay'

// ═══════════════════════════════════════════════════════════════════════════
// HOMEWORK AREA — تبويب «الواجبات» المستقل (Task 44e — طلب المستر)
//   نفس عقد التقارير/الطلاب: صفحة مخصصة مش مساحة مفتوحة من الحصة.
//   • نظرة سريعة: عدد الواجبات، المنشور، التسليمات، المتوسط العام
//   • قوالب بدء سريع: واجب 10 اختيارات / صح وغلط... بضغطة واحدة (smart)
//   • قائمة الواجبات: بحث + فلتر (الكل/منشورة/مغلقة) + لكل واجب نسبة التسليم
//     والمتوسط وأكتر سؤال فيه مشاكل — والضغط يفتح مساحة الواجب
//   • ذكاء: أعلى واجب صعوبة (أقل متوسط) + آخر تسليم + تنبيه الواجبات اللي
//     معاها تسليمات ضعيفة قبل الحصة الجاية
//   • شرح مدمج: جولة مصغرة (؟) تشرح الصفحة — وضمن الجولة العامة في AppShell
// ═══════════════════════════════════════════════════════════════════════════

const HW_TOUR_AR = [
  { target: '[data-tour="hw-new"]', title: 'ابدأ واجب جديد', body: 'اضغط «واجب جديد» — أو استخدم قالبًا جاهزًا من اللي جنبها فيفتح لك عدد أسئلة جاهز فورًا، انت بس حدد الإجابات.' },
  { target: '[data-tour="hw-templates"]', title: 'قوالب سريعة', body: 'مراجعة سريعة (5)، واجب 10 اختيارات، صح وغلط... جوّه البناء كمان تقدر تولّد أي عدد، وتكتب الاختيارات بـ Enter بينقلك للي بعده، وتلصق مفتاح إجابات كامل مرة واحدة.' },
  { target: '[data-tour="hw-list"]', title: 'متابعة التسليمات', body: 'كل واجب ونداه: مين سلّم، النسبة، والمتوسط. اضغط على الواجب تفتح النتائج الكاملة وتحليل أكتر الأسئلة غلط — وتقدر تقفله أو تفتحه تاني.' },
]
const HW_TOUR_EN = [
  { target: '[data-tour="hw-new"]', title: 'Start a new homework', body: 'Tap "New homework" — or pick a ready template next to it and a set of questions is generated instantly; you just pick the answers.' },
  { target: '[data-tour="hw-templates"]', title: 'Quick templates', body: 'Quick review (5), 10 MCQs, true/false... Inside the builder you can also generate any count, type choices with Enter jumping to the next field, and paste a full answer key at once.' },
  { target: '[data-tour="hw-list"]', title: 'Track submissions', body: 'Each homework shows who submitted, rate and average. Tap it for full results and per-question analytics — plus close/reopen controls.' },
]

export default function HomeworkArea() {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = ws
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | published | closed
  const [tourOpen, setTourOpen] = useState(false)

  const tasks = ws.homeworkTasks || []
  const subs = ws.homeworkSubmissions || []

  const perTask = useMemo(() => {
    const m = {}
    tasks.forEach((t) => {
      const rows = subs.filter((s) => s.task_id === t.id)
      const pool = t.group_name ? ws.students.filter((s) => s.group_name === t.group_name) : ws.students
      const vals = rows.map((r) => (Number(t.max_score) > 0 ? (Number(r.score) || 0) / Number(t.max_score) * 100 : 0))
      m[t.id] = {
        solved: rows.length,
        pool: pool.length,
        rate: pool.length ? Math.round((rows.length / pool.length) * 100) : 0,
        avg: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
        lastAt: rows.length ? Math.max(...rows.map((r) => new Date(r.submitted_at || 0).getTime() || 0)) : 0,
      }
    })
    return m
  }, [tasks, subs, ws.students])

  const stats = useMemo(() => {
    const published = tasks.filter((t) => t.status === 'published').length
    const allSubs = subs.length
    const avgs = tasks.map((t) => perTask[t.id]?.avg).filter((v) => v != null)
    return {
      total: tasks.length,
      published,
      subs: allSubs,
      avg: avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null,
    }
  }, [tasks, subs, perTask])

  // ذكاء: أعلى واجب صعوبة (متوسط أقل من 50 وفيه تسليمات)
  const hardest = useMemo(() => {
    const rows = tasks
      .map((t) => ({ t, m: perTask[t.id] }))
      .filter(({ m }) => m && m.avg != null && m.solved > 0)
      .sort((a, b) => a.m.avg - b.m.avg)
    return rows[0] || null
  }, [tasks, perTask])

  const lastSubmissionAt = useMemo(() => {
    let mx = 0
    subs.forEach((s) => { const t = new Date(s.submitted_at || 0).getTime() || 0; if (t > mx) mx = t })
    return mx
  }, [subs])

  const visible = useMemo(() => {
    let rows = [...tasks].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    if (filter === 'published') rows = rows.filter((t) => t.status === 'published')
    if (filter === 'closed') rows = rows.filter((t) => t.status !== 'published')
    const q = normalizeArabicSearch(search)
    if (q) rows = rows.filter((t) => normalizeArabicSearch([t.title, t.group_name].filter(Boolean).join(' ')).includes(q))
    return rows
  }, [tasks, filter, search])

  const openTask = (t) => ui.openTask({ taskId: t.id })
  const newWithPreset = (p) => ui.openTask({ taskId: 'new', preset: { type: p.type, count: p.count } })

  const fmtWhen = (ts) => {
    if (!ts) return ''
    try { return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) } catch { return '' }
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="nk-ws-head">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="nk-ws-muted text-[.62rem] font-black tracking-widest mb-1">HOMEWORK HUB</div>
            <h2 className="text-[1.15rem] sm:text-[1.3rem] font-black m-0 leading-snug">
              {isArabic ? 'الواجبات التفاعلية' : 'Interactive Homework'}
            </h2>
            <p className="nk-ws-muted text-[.72rem] mt-1 mb-0">
              {isArabic
                ? 'واجبات اختيار الإجابة تتحصح لوحدها على السيرفر — الطالب يحل من صفحة الواجبات المخصصة، التسليم مرة واحدة، والدرجة تتسجل في الحصة الجاية.'
                : 'Auto-graded MCQ homework — students answer on the dedicated page, one submission each, grades flow into the next session.'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="btn-ghost rounded-lg px-2.5 py-1.5 text-[.68rem] font-extrabold" onClick={() => setTourOpen(true)} title={isArabic ? 'شرح سريع' : 'Quick tutorial'}>؟ {isArabic ? 'شرح' : 'Tour'}</button>
            <button className="btn-navy rounded-xl px-4 py-2.5 text-[.78rem] font-extrabold cursor-pointer border-0" onClick={() => ui.openTask({ taskId: 'new' })} data-tour="hw-new">
              ＋ {isArabic ? 'واجب جديد' : 'New homework'}
            </button>
          </div>
        </div>

        {/* إحصائيات سريعة */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          <div className="nk-mini"><small>{isArabic ? 'الواجبات' : 'Homework'}</small><b>{stats.total}</b></div>
          <div className="nk-mini nk-mini--gold"><small>{isArabic ? 'منشورة الآن' : 'Published'}</small><b>{stats.published}</b></div>
          <div className="nk-mini nk-mini--ok"><small>{isArabic ? 'إجمالي التسليمات' : 'Submissions'}</small><b>{stats.subs}</b></div>
          <div className="nk-mini nk-mini--info"><small>{isArabic ? 'المتوسط العام %' : 'Overall avg %'}</small><b>{stats.avg != null ? stats.avg : '—'}</b></div>
        </div>

        {/* ذكاء: تنبيهات قبل الحصة الجاية */}
        {hardest && hardest.m.avg < 50 && (
          <div className="nk-notice mt-3" role="status">
            <span className="text-[.72rem] font-bold">
              ⚠ {isArabic
                ? `أعلى واجب صعوبة: «${hardest.t.title}» — متوسط ${hardest.m.avg}% بس من ${hardest.m.solved} حلّوه. حطه في فريق التحليل قبل الحصة الجاية.`
                : `Hardest homework: "${hardest.t.title}" — only ${hardest.m.avg}% average. Review it before the next session.`}
            </span>
          </div>
        )}
        {lastSubmissionAt > 0 && (
          <p className="nk-ws-muted text-[.66rem] mt-2 mb-0">⏱ {isArabic ? 'آخر تسليم' : 'Last submission'}: {fmtWhen(lastSubmissionAt)}</p>
        )}
      </section>

      {/* قوالب البدء السريع */}
      <section className="nk-content" data-tour="hw-templates">
        <h3 className="text-[1rem] font-extrabold mt-0 mb-1">{isArabic ? '⚡ ابدأ من قالب جاهز' : '⚡ Start from a template'}</h3>
        <p className="text-[.74rem] text-fg-muted mt-0 mb-3">
          {isArabic
            ? 'بضغطة واحدة يفتح البناء بعدد أسئلة جاهز — حدد الإجابات وانشر. جوّه البناء تقدر تغير الأنواع وتضيف وتحذف براحتك.'
            : 'One tap opens the builder with questions ready — pick answers and publish. Everything stays editable.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {HOMEWORK_PRESETS.map((p) => (
            <button key={p.key} className="btn-ghost rounded-xl px-3.5 py-2 text-[.72rem] font-extrabold" onClick={() => newWithPreset(p)}>
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {/* قائمة الواجبات */}
      <section className="nk-content" data-tour="hw-list">
        <h3 className="text-[1rem] font-extrabold mt-0 mb-1">{isArabic ? 'كل الواجبات' : 'All homework'}</h3>
        <p className="text-[.74rem] text-fg-muted mt-0 mb-3">
          {isArabic ? 'اضغط أي واجب لفتح النتائج والتحليل وإغلاقه/فتحه.' : 'Tap any homework to open results, analytics and close/reopen.'}
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input className="glass-input rounded-xl px-3.5 py-2.5 text-sm flex-1 min-w-[160px]" placeholder={isArabic ? '🔍 بحث بعنوان الواجب أو المجموعة...' : 'Search by title or group...'} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="flex gap-1.5">
            {[['all', isArabic ? 'الكل' : 'All'], ['published', isArabic ? 'منشورة' : 'Published'], ['closed', isArabic ? 'مغلقة' : 'Closed']].map(([k, label]) => (
              <button key={k} className="rounded-xl px-3 py-2 text-[.7rem] font-extrabold cursor-pointer" style={filter === k
                ? { background: 'var(--brand-navy)', color: '#fff', border: '1px solid var(--brand-navy)' }
                : { background: 'var(--surface-container)', color: 'var(--fg-muted)', border: '1px solid var(--surface-border)' }}
                onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2">
          {visible.map((t) => {
            const m = perTask[t.id] || {}
            const published = t.status === 'published'
            return (
              <button key={t.id} className="nk-row text-start w-full cursor-pointer" style={{ border: '1px solid var(--surface-border)', background: 'var(--surface-container)' }} onClick={() => openTask(t)}>
                <span className="min-w-0">
                  <b className="truncate">{t.title}</b>
                  <small>
                    {[t.group_name || (isArabic ? 'كل الطلاب' : 'All students'),
                      `${(t.questions || []).length} ${isArabic ? 'سؤال' : 'q'}`,
                      t.due_date ? `${isArabic ? 'آخر موعد' : 'due'} ${t.due_date}` : '',
                      m.solved ? `${isArabic ? 'آخر تسليم' : 'last'} ${fmtWhen(m.lastAt)}` : (isArabic ? 'لا تسليمات بعد' : 'no submissions yet'),
                    ].filter(Boolean).join(' · ')}
                  </small>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {m.avg != null && (
                    <span className={`nk-pill !text-[.66rem] ${m.avg >= 50 ? 'nk-pill-gold' : 'nk-pill-danger'}`}>{isArabic ? 'متوسط' : 'avg'} {m.avg}%</span>
                  )}
                  <span className="nk-pill nk-pill-neutral !text-[.66rem]">{m.solved || 0}/{m.pool || 0} {isArabic ? 'سلّموا' : 'in'}</span>
                  <span className={`nk-pill !text-[.66rem] ${published ? 'nk-pill-live' : 'nk-pill-done'}`}>
                    {published ? `● ${isArabic ? 'منشور' : 'Open'}` : `✓ ${isArabic ? 'مغلق' : 'Closed'}`}
                  </span>
                </span>
              </button>
            )
          })}
          {visible.length === 0 && (
            <div className="text-center py-8">
              <p className="text-sm text-fg-muted mb-4">
                {tasks.length === 0
                  ? (isArabic ? 'مفيش واجبات لسه — ابدأ بقالب جاهز فوق وهتخلص في دقيقة.' : 'No homework yet — start from a template above.')
                  : (isArabic ? 'لا نتائج للبحث/الفلتر الحالي.' : 'No matches for the current search/filter.')}
              </p>
              {tasks.length === 0 && (
                <button className="btn-navy action-button !min-h-[3rem]" onClick={() => newWithPreset(HOMEWORK_PRESETS[1])}>
                  {isArabic ? 'ابدأ بواجب 10 اختيارات ←' : 'Start with a 10-MCQ homework →'}
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {tourOpen && (
        <TourOverlay
          steps={isArabic ? HW_TOUR_AR : HW_TOUR_EN}
          onDone={() => setTourOpen(false)}
        />
      )}
    </div>
  )
}

