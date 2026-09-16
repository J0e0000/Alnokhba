import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLanguage } from '../context/LanguageContext'

const TOURS = {
  quick: {
    ar: 'جولة سريعة',
    en: 'Quick tour',
    steps: [
      { section: 'dashboard', target: 'dashboard-overview', title: { ar: 'الرئيسية', en: 'Dashboard' }, body: { ar: 'هنا بتشوف ملخص سريع عن الطلاب والحضور والتنبيهات.', en: 'See a quick overview of students, attendance, and alerts here.' } },
      { section: 'students', target: 'student-search', title: { ar: 'البحث عن الطلاب', en: 'Find students' }, body: { ar: 'ابحث بالاسم أو المرحلة أو المجموعة للوصول للطالب بسرعة.', en: 'Search by name, stage, or group to find a student quickly.' } },
      { section: 'sessions', target: 'sessions-workspace', title: { ar: 'الحصص', en: 'Sessions' }, body: { ar: 'اختار المجموعة، سجل الحضور والواجب، وبعدها احفظ البيانات لإنهاء الحصة.', en: 'Choose a group, record attendance and homework, then save to finish the session.' } },
      { section: 'exams', target: 'create-exam-btn', title: { ar: 'الدرجات', en: 'Grades' }, body: { ar: 'من هنا تسجل الامتحانات والدرجات، وتظهر النتائج في متابعة الطالب.', en: 'Record exams and grades here; results appear in student follow-up.' } },
      { section: 'reports', target: 'reports-scope', title: { ar: 'التقارير', en: 'Reports' }, body: { ar: 'حدد المجموعة والحصة أولًا، ثم اختار نوع التقرير أو الرسالة.', en: 'Choose the exact group and session first, then select a report or message.' } },
    ],
  },
  daily: {
    ar: 'الاستخدام اليومي',
    en: 'Daily use',
    steps: [
      { section: 'sessions', target: 'session-group-select', title: { ar: 'اختيار المجموعة', en: 'Choose a group' }, body: { ar: 'اختار المجموعة التي ستعمل عليها اليوم؛ بيانات الحصة تظل مرتبطة بها.', en: 'Choose today’s group; session data stays connected to it.' } },
      { section: 'sessions', target: 'sessions-workspace', title: { ar: 'مساحة الحصة', en: 'Session workspace' }, body: { ar: 'سجل الحضور بالضغط على حالة الطالب أو استخدم QR، ثم اكتب الدرس والواجب.', en: 'Mark attendance or use QR, then enter the lesson and homework.' } },
      { section: 'sessions', target: 'finish-session-btn', title: { ar: 'حفظ وإنهاء الحصة', en: 'Save and finish' }, body: { ar: 'هذا الزر يحفظ البيانات ويثبت الحالة النهائية وينهي الحصة.', en: 'This button saves the data, finalizes statuses, and closes the session.' } },
      { section: 'reports', target: 'reports-scope', title: { ar: 'إرسال المتابعة', en: 'Send follow-up' }, body: { ar: 'بعد إنهاء الحصة، حددها هنا لإرسال التقارير للمجموعة المقصودة فقط.', en: 'After finishing, select the session here to send reports to the intended group only.' } },
    ],
  },
  students: {
    ar: 'إدارة الطلاب',
    en: 'Student management',
    steps: [
      { section: 'students', target: 'add-student-btn', title: { ar: 'إضافة طالب', en: 'Add a student' }, body: { ar: 'أضف طالبًا جديدًا من هنا، ثم اربطه بالمجموعة والمرحلة المناسبة.', en: 'Add a student here, then connect them to the right group and stage.' } },
      { section: 'students', target: 'student-search', title: { ar: 'الفلاتر الذكية', en: 'Smart filters' }, body: { ar: 'استخدم البحث والمرحلة والمجموعة والحالة معًا لتقليل النتائج بسرعة.', en: 'Combine search, stage, group, and status filters to narrow results quickly.' } },
      { section: 'students', target: 'student-list', title: { ar: 'بطاقة الطالب', en: 'Student list' }, body: { ar: 'افتح ملف الطالب لتعديل بياناته، متابعة النقاط، أو إرسال رابط Student Portal.', en: 'Open a student profile to edit data, review points, or send the Student Portal link.' } },
      { section: 'students', target: 'student-select-all', title: { ar: 'تحديد جماعي', en: 'Bulk selection' }, body: { ar: 'استخدم مربع التحديد هنا لاختيار أكثر من طالب، ثم تظهر لك إجراءات جماعية آمنة.', en: 'Use this checkbox to select multiple students; bulk actions will then appear.' } },
    ],
  },
  results: {
    ar: 'الدرجات والتقارير',
    en: 'Grades and reports',
    steps: [
      { section: 'exams', target: 'create-exam-btn', title: { ar: 'رصد الدرجات', en: 'Record grades' }, body: { ar: 'أنشئ الامتحان وسجل الدرجات؛ النظام يستخدمها في متابعة مستوى الطالب.', en: 'Create an exam and record scores; the system uses them in student progress.' } },
      { section: 'reports', target: 'reports-scope', title: { ar: 'اختيار نطاق التقرير', en: 'Report scope' }, body: { ar: 'اختار المجموعة والحصة المنتهية حتى لا تُرسل التقارير لطلاب غير مقصودين.', en: 'Choose the group and completed session so reports never go to unintended students.' } },
      { section: 'reports', target: 'reports-download-btn', title: { ar: 'التقارير والرسائل', en: 'Reports and messages' }, body: { ar: 'من هنا تبدأ تجهيز التقرير أو الرسالة، ويمكنك مراجعة المحتوى قبل الإرسال.', en: 'Start a report or message here and review the content before sending.' } },
    ],
  },
}

const TOUR_ORDER = ['quick', 'daily', 'students', 'results']
const STORAGE_KEY = 'nokhba_interactive_tutorial_v1_seen'
const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

function getTargetRect(targetId) {
  if (!targetId) return null
  const element = document.querySelector(`[data-tour="${targetId}"]`)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  if (!rect.width || !rect.height) return null
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height, radius: getComputedStyle(element).borderRadius || '14px' }
}

function safeReadSeen() {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

function safeMarkSeen() {
  try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* private browsing */ }
}

export default function InteractiveTutorial({ activeSection, onNavigate, onOpenSettings, menuOpen = false, onMenuClose }) {
  const { isArabic } = useLanguage()
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [tourKey, setTourKey] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [rect, setRect] = useState(null)
  const [tooltipStyle, setTooltipStyle] = useState({})
  const tooltipRef = useRef(null)
  const repositionTimer = useRef(null)

  const tour = tourKey ? TOURS[tourKey] : null
  const step = tour?.steps[stepIndex] || null
  const label = useCallback((value) => value?.[isArabic ? 'ar' : 'en'] || value?.ar || '', [isArabic])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!safeReadSeen()) setWelcomeOpen(true)
    }, 900)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!step) return undefined
    if (step.section && activeSection !== step.section) {
      onNavigate?.(step.section)
      setRect(null)
      return undefined
    }

    const measure = () => {
      const nextRect = getTargetRect(step.target)
      if (!nextRect) {
        setRect(null)
        return
      }
      setRect(nextRect)
      window.requestAnimationFrame(() => {
        const tooltip = tooltipRef.current
        if (!tooltip) return
        const gap = 18
        const margin = 12
        const width = tooltip.offsetWidth || Math.min(330, window.innerWidth - margin * 2)
        const height = tooltip.offsetHeight || 210
        const candidates = window.innerWidth < 640
          ? [
              { top: nextRect.top + nextRect.height + gap, left: (window.innerWidth - width) / 2 },
              { top: nextRect.top - height - gap, left: (window.innerWidth - width) / 2 },
            ]
          : [
              { top: nextRect.top, left: nextRect.left + nextRect.width + gap },
              { top: nextRect.top, left: nextRect.left - width - gap },
              { top: nextRect.top + nextRect.height + gap, left: nextRect.left },
              { top: nextRect.top - height - gap, left: nextRect.left },
            ]
        const selected = candidates.find((candidate) => candidate.top >= margin && candidate.top + height <= window.innerHeight - margin && candidate.left >= margin && candidate.left + width <= window.innerWidth - margin) || candidates[0]
        setTooltipStyle({ top: clamp(selected.top, margin, Math.max(margin, window.innerHeight - height - margin)), left: clamp(selected.left, margin, Math.max(margin, window.innerWidth - width - margin)) })
      })
    }

    const target = document.querySelector(`[data-tour="${step.target}"]`)
    if (target) {
      const targetRect = target.getBoundingClientRect()
      if (targetRect.top < 80 || targetRect.bottom > window.innerHeight - 70) target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    }
    measure()
    repositionTimer.current = setTimeout(measure, 360)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      clearTimeout(repositionTimer.current)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step, activeSection, onNavigate])

  const finish = useCallback(() => {
    safeMarkSeen()
    setWelcomeOpen(false)
    onMenuClose?.()
    setTourKey(null)
    setStepIndex(0)
  }, [onMenuClose])

  const skip = useCallback(() => finish(), [finish])

  const startTour = useCallback((key) => {
    safeMarkSeen()
    setWelcomeOpen(false)
    onMenuClose?.()
    setTourKey(key)
    setStepIndex(0)
  }, [onMenuClose])

  const next = () => {
    if (!tour || stepIndex >= tour.steps.length - 1) return finish()
    setStepIndex((value) => value + 1)
  }

  const previous = () => setStepIndex((value) => Math.max(0, value - 1))

  const tourButtons = useMemo(() => TOUR_ORDER.map((key) => ({ key, label: label(TOURS[key]) })), [label])

  return (
    <>
      {/* The launcher now lives inside the sidebar menu (Dashboard.jsx) — no more
          floating button that overlaps other floating elements. */}
      {(welcomeOpen || menuOpen) && !tourKey && (
        <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-950/45 p-4 backdrop-blur-sm sm:items-center" dir={isArabic ? 'rtl' : 'ltr'}>
          <div className="w-full max-w-md rounded-[28px] border border-white/70 bg-white p-6 text-slate-900 shadow-2xl sm:p-7">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg"><span className="material-symbols-outlined">explore</span></div>
              <button type="button" onClick={skip} className="text-sm font-bold text-slate-400 hover:text-slate-700">{isArabic ? 'مش دلوقتي' : 'Not now'}</button>
            </div>
            <h2 className="text-2xl font-black tracking-tight">{isArabic ? 'أهلًا بيك في منصة النخبة' : 'Welcome to Al-Nokhba'}</h2>
            <p className="mt-2 text-sm leading-7 text-slate-500">{isArabic ? 'خلينا ناخد جولة سريعة نتعرف فيها على أهم أجزاء المنصة من داخل الواجهة نفسها.' : 'Take a quick guided tour of the most important parts, directly inside the real interface.'}</p>
            {welcomeOpen && !menuOpen ? (
              <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
                <button type="button" onClick={() => startTour('quick')} className="flex-1 rounded-2xl bg-slate-900 px-4 py-3.5 text-sm font-black text-white transition hover:bg-slate-700">{isArabic ? 'ابدأ الجولة' : 'Start tour'}</button>
                <button type="button" onClick={() => { safeMarkSeen(); setWelcomeOpen(false) }} className="flex-1 rounded-2xl border border-slate-200 px-4 py-3.5 text-sm font-black text-slate-600 transition hover:bg-slate-50">{isArabic ? 'مش دلوقتي' : 'Not now'}</button>
              </div>
            ) : (
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {tourButtons.map(({ key, label: tourLabel }) => <button type="button" key={key} onClick={() => startTour(key)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-start text-sm font-black text-slate-700 transition hover:border-amber-300 hover:bg-amber-50">{tourLabel}</button>)}
              </div>
            )}
            {menuOpen && onOpenSettings && <button type="button" onClick={() => { skip(); onOpenSettings() }} className="mt-4 text-xs font-bold text-slate-400 underline underline-offset-4">{isArabic ? 'افتح الإعدادات' : 'Open settings'}</button>}
          </div>
        </div>
      )}

      {tourKey && step && (
        <div className="fixed inset-0 z-[1000]" dir={isArabic ? 'rtl' : 'ltr'}>
          <div className="fixed inset-x-0 top-0 bg-slate-950/70" style={{ height: rect ? Math.max(0, rect.top - 8) : 0 }} />
          <div className="fixed bottom-0 left-0 bg-slate-950/70" style={{ top: rect ? rect.top - 8 : 0, width: rect ? Math.max(0, rect.left - 8) : '50%' }} />
          <div className="fixed bottom-0 right-0 bg-slate-950/70" style={{ top: rect ? rect.top - 8 : 0, width: rect ? Math.max(0, window.innerWidth - rect.left - rect.width - 8) : '50%' }} />
          <div className="fixed inset-x-0 bottom-0 bg-slate-950/70" style={{ top: rect ? rect.top + rect.height + 8 : '50%' }} />
          {rect && <div className="pointer-events-none fixed border-2 border-amber-300 shadow-[0_0_0_5px_rgba(251,191,36,0.20),0_0_32px_rgba(251,191,36,0.65)]" style={{ top: rect.top - 8, left: rect.left - 8, width: rect.width + 16, height: rect.height + 16, borderRadius: rect.radius }} />}
          <div ref={tooltipRef} className="fixed z-[1003] w-[min(330px,calc(100vw-24px))] rounded-[24px] border border-white/80 bg-white p-5 text-slate-900 shadow-2xl transition-[top,left] duration-200 ease-out" style={rect ? tooltipStyle : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.12em] text-amber-600">{isArabic ? `خطوة ${stepIndex + 1} من ${tour.steps.length}` : `Step ${stepIndex + 1} of ${tour.steps.length}`}</p>
                <h3 className="mt-1 text-xl font-black">{label(step.title)}</h3>
              </div>
              <button type="button" onClick={skip} className="text-lg font-black text-slate-300 hover:text-slate-700" aria-label={isArabic ? 'تخطي الجولة' : 'Skip tour'}>×</button>
            </div>
            <p className="mt-3 text-sm leading-7 text-slate-500">{label(step.body)}</p>
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold leading-5 text-amber-800">{isArabic ? 'اتفرج على المكان المضيء، وجرب بنفسك بعد ما تخلص الجولة.' : 'Notice the highlighted area, then try it yourself after the tour.'}</p>
            <div className="mt-5 flex items-center justify-between gap-2">
              <button type="button" onClick={previous} disabled={stepIndex === 0} className="rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-black text-slate-600 disabled:cursor-not-allowed disabled:opacity-35">{isArabic ? 'السابق' : 'Previous'}</button>
              <button type="button" onClick={next} className="rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white transition hover:bg-slate-700">{stepIndex === tour.steps.length - 1 ? (isArabic ? 'خلصنا' : 'Finish') : (isArabic ? 'التالي' : 'Next')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export { TOURS }
