import { useEffect, useState } from 'react'
import { useUI } from '../shell/UIContext'
import { useLanguage } from '../context/LanguageContext'

// ═══════════════════════════════════════════════════════════════════════════
// TUTORIAL (brief §19–§21) — REBUILT around the CURRENT product:
// 1 Home/My Day  2 Select a day  3 Open a session  4 Attendance  5 Interaction
// 6 Homework  7 Exams  8 Review  9 Finish  10 Report  11 Student History
// 12 Reports  13 Analytics  14 Communication  15 Search  16 Settings.
// It teaches the IMPORTANT RULES (Save ≠ Finish; attendance never blocks;
// required stages gate advancing; History is read+contact only).
//
// Contextual onboarding (one-time FirstHint callouts per surface) lives in
// FirstHint.jsx; this component is the full step-through tour. It never
// nags: runs once (localStorage 'nk-tour-done-v2'), skippable, restartable
// from the Help Center or the floating help button.
// ═══════════════════════════════════════════════════════════════════════════

const TOUR_FLAG = 'nk-tour-done-v2'

const STEPS = (ar) => [
  {
    area: 'home',
    title: ar ? 'مرحبًا بك في النخبة 👋' : 'Welcome to Alnokhba 👋',
    body: ar
      ? 'هذه نظرة عامة على يومك الدراسي. من هنا تبدأ كل حصة وتدير كل شيء بمسار واحد — بلا شاشات متفرقة.'
      : 'This is your day at a glance. Every session starts here and runs in ONE pipeline — no scattered screens.',
  },
  {
    area: 'home',
    title: ar ? '٢ · اختر اليوم من الشريط الزمني' : '2 · Pick a day from the timeline',
    body: ar
      ? 'الشريط أعلى الصفحة يعرض الأيام. اضغط أي يوم لعرض حصصه، أو تنقّل بأسهم ‹ ›. زر «اليوم» يعيدك للحاضر فورًا.'
      : 'The strip at the top shows days. Tap any day to see its sessions, or move with ‹ ›. "Today" snaps you back instantly.',
  },
  {
    area: 'home',
    title: ar ? '٣ · افتح حصة' : '3 · Open a session',
    body: ar
      ? 'اضغط بطاقة المجموعة: حصة جديدة تبدأ، حصة جارية تُستأنف، وحصة منتهية تُعرض للمراجعة مع بياناتها كاملة.'
      : 'Tap a group card: a new session opens, a running one resumes, and a completed one opens for review with all its data.',
  },
  {
    area: 'home',
    title: ar ? '٤ · الحضور — سجل صريح لكل طالب' : '4 · Attendance — explicit records',
    body: ar
      ? 'داخل مساحة الحصة سجّل «حاضر» أو «غائب» لكل طالب، أو امسح رمز QR. تذكّر القاعدة المهمة: الحضور اختياري — عدم رصد طالب لا يمنعك من أي شيء.'
      : 'In the workspace mark حاضر/غائب per student, or scan their QR. Remember the key rule: attendance is OPTIONAL — an unmarked student never blocks anything.',
  },
  {
    area: 'home',
    title: ar ? '٥ و٦ · التفاعل والواجب' : '5 & 6 · Interaction & homework',
    body: ar
      ? 'المرحلة الثانية للتفاعل (نجمة/ذهبية/مساعدة) ورصد الواجب (مكتمل/ناقص/لم يتم) — للحاضرين فقط. هذه مرحلة مطلوبة: لن تتمكن من المتابعة بطلاب ناقصين، والنظام سيخبرك بأسمائهم بالضبط.'
      : 'Stage 2 records interaction (star/golden/help) and homework (done/partial/missing) — present students only. This stage IS required: you cannot advance with missing students, and the system tells you exactly who.',
  },
  {
    area: 'home',
    title: ar ? '٧ · الامتحانات' : '7 · Exams',
    body: ar
      ? 'أنشئ امتحانًا وأدخل درجات الحاضرين. لا يوجد امتحان؟ المرحلة لا تمنع التقدم. درجات الحفظ تخصّص النقاط تلقائيًا ويمكن تعديلها لاحقًا.'
      : 'Create an exam and grade present students. No exam? The stage never blocks. Saving awards points automatically and grades stay editable.',
  },
  {
    area: 'home',
    title: ar ? '٨ · المراجعة والتقدم' : '8 · Review & progress',
    body: ar
      ? 'شريط التقدم أعلى مساحة العمل يحسب من سجلات حقيقية: تفاعل، واجب، وامتحانات إن وُجدت. زر «عرض الطلاب الناقصين» يصفي القائمة لمن يحتاج إنجازًا.'
      : 'The progress strip computes from REAL saved records: interaction, homework, and exams when linked. "Show missing students" filters the list to exactly who needs handling.',
  },
  {
    area: 'home',
    title: ar ? '٩ · قاعدة ذهبية: الحفظ ≠ الإنهاء' : '9 · Golden rule: Save ≠ Finish',
    body: ar
      ? 'كل ضغطة تُحفظ فورًا في قاعدة البيانات. أما «إنهاء الحصة» فهو إجراء منفصل في تبويب التقرير — لا شيء يُغلق تلقائيًا أبدًا.'
      : 'Every click saves instantly to the database. "Finish session" is a separate, explicit action in the Report tab — nothing ever closes automatically.',
  },
  {
    area: 'home',
    title: ar ? '١٠ · التقرير وإنهاء الحصة' : '10 · Report & finish',
    body: ar
      ? 'اكتب موضوع الدرس والواجب ورابط الفيديو، ثم أنهِ الحصة. بعدها تُطبَّق قاعدة النظام على غير المرصودين ويصل تحديث أولياء الأمور.'
      : 'Write the lesson topic, homework and video link, then finish. The existing server rule applies to unmarked students and parents get the update.',
  },
  {
    area: 'history',
    title: ar ? '١١ · سجل الطالب — مراجعة وتواصل فقط' : '11 · Student History — review & contact only',
    body: ar
      ? 'هنا تراجع تاريخ الطالب (حضور، درجات، نقاط) وتتواصل مع ولي أمره. التعديل يتم من مساحة الحصة أو شاشة الطلاب — السجل نفسه للقراءة والتواصل فقط.'
      : 'Review a student\'s history (attendance, grades, points) and contact their parent. Editing happens in the workspace or Students — this surface is read + contact only.',
  },
  {
    area: 'reports',
    title: ar ? '١٢ · التقارير' : '12 · Reports',
    body: ar
      ? 'جهّز تقارير الحصص وأرسلها لأولياء الأمور عبر واتساب برسائل جاهزة.'
      : 'Prepare session reports and send them to parents via ready-made WhatsApp messages.',
  },
  {
    area: 'analytics',
    title: ar ? '١٣ · التحليلات' : '13 · Analytics',
    body: ar
      ? 'رؤية أسبوعية للحضور والتفاعل لكل مجموعة — تساعدك ترى الميل قبل أن يتحول لمشكلة.'
      : 'A weekly view of attendance and interaction per group — spot trends before they become problems.',
  },
  {
    area: 'home',
    title: ar ? '١٤ · التواصل' : '14 · Communication',
    body: ar
      ? 'زر ✆ بجوار أي طالب يفتح واتساب برسالة جاهزة، والرسائل الجماعية من شاشة الطلاب بعد تحديد عدة طلاب.'
      : 'The ✆ button next to any student opens WhatsApp with a ready message; bulk messages from Students after multi-select.',
  },
  {
    area: 'home',
    title: ar ? '١٥ · البحث الشامل' : '15 · Global search',
    body: ar
      ? 'اضغط Ctrl+K في أي وقت للبحث عن طالب أو حصة أو امتحان أو صفحة أو سؤال مساعدة — والنتيجة تنقلك إليه مباشرة. جرّبه الآن!'
      : 'Press Ctrl+K anytime to search students, sessions, exams, pages, or help — results navigate straight there. Try it now!',
  },
  {
    area: 'settings',
    title: ar ? '١٦ · الإعدادات' : '16 · Settings',
    body: ar
      ? 'المجموعات وجدول الأسبوع والنقاط وقوالب الرسائل — كل ما يخص شكل عملك يُضبط من هنا، وكل شيء يظهر في الرئيسية لكل يوم.'
      : 'Groups, weekly schedule, points and message templates — your setup lives here and drives what Home shows for each day.',
  },
  {
    area: 'help',
    title: ar ? 'أنت جاهز 🎉' : 'You are ready 🎉',
    body: ar
      ? 'مركز المساعدة يوجد هنا دائمًا: أسئلة شائعة، حل مشكلات، وإعادة هذه الجولة. زر ؟ العائم يفتحه من أي شاشة.'
      : 'The Help Center is always here: FAQ, troubleshooting, and this tour again. The floating ? button opens it from anywhere.',
  },
]

export const TOUR_DONE = () => {
  try { return localStorage.getItem(TOUR_FLAG) === '1' } catch { return true }
}
export const markTourDone = () => {
  try { localStorage.setItem(TOUR_FLAG, '1') } catch { /* ignore */ }
}
export const restartTour = () => {
  try { localStorage.removeItem(TOUR_FLAG) } catch { /* ignore */ }
}

export default function Tutorial({ open, onClose }) {
  const ui = useUI()
  const { isArabic } = useLanguage()
  const ar = isArabic
  const [step, setStep] = useState(0)

  const steps = STEPS(ar)

  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  // Each step navigates to its area so the tour shows the REAL UI (brief §19).
  useEffect(() => {
    if (!open) return
    const target = steps[step]?.area
    if (target && ui.area !== target) ui.setArea(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, open])

  if (!open) return null

  const s = steps[step]
  const finish = () => { markTourDone(); onClose() }

  return (
    <div
      className="fixed left-0 right-0 z-[96] px-4 nk-tour"
      style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}
      role="dialog"
      aria-modal="false"
      aria-label={ar ? 'الجولة التفاعلية' : 'Guided tour'}
    >
      <div className="glass-card max-w-lg mx-auto p-5">
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="nk-pill nk-pill-gold">{ar ? 'الجولة' : 'Tour'} · {step + 1}/{steps.length}</span>
          <button className="text-[.7rem] font-extrabold text-fg-muted hover:text-fg" onClick={finish}>
            {ar ? 'تخطي ✕' : 'Skip ✕'}
          </button>
        </div>
        <h3 className="text-[1rem] font-extrabold mt-0 mb-1.5">{s.title}</h3>
        <p className="text-[.8rem] leading-7 text-fg-muted mt-0 mb-4">{s.body}</p>

        <div className="flex items-center gap-1.5 mb-4" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={`nk-tour__dot ${i === step ? 'nk-tour__dot--on' : ''}`} />
          ))}
        </div>

        <div className="flex gap-2">
          {step > 0 && (
            <button className="btn-ghost action-button !min-h-[2.75rem]" onClick={() => setStep((x) => x - 1)}>
              {ar ? '→ السابق' : '← Back'}
            </button>
          )}
          <button className="btn-navy action-button !min-h-[2.75rem]" onClick={() => (step === steps.length - 1 ? finish() : setStep((x) => x + 1))}>
            {step === steps.length - 1 ? (ar ? 'ابدأ الاستخدام ✓' : 'Start using it ✓') : (ar ? 'التالي ←' : 'Next →')}
          </button>
        </div>
      </div>
    </div>
  )
}
