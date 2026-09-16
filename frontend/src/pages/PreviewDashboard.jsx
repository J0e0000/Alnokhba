import { useState } from 'react'
const makeIcon = (symbol) => function LocalIcon({ className = '' }) {
  return <span aria-hidden="true" className={`inline-flex items-center justify-center leading-none ${className}`}>{symbol}</span>
}

const ArrowLeft = makeIcon('←')
const ArrowRight = makeIcon('→')
const Bell = makeIcon('◉')
const BookOpenCheck = makeIcon('▤')
const CalendarDays = makeIcon('◷')
const Check = makeIcon('✓')
const ChevronLeft = makeIcon('‹')
const ClipboardCheck = makeIcon('✓')
const GraduationCap = makeIcon('⌁')
const LayoutDashboard = makeIcon('▦')
const MessageCircle = makeIcon('◉')
const Send = makeIcon('↗')
const Sparkles = makeIcon('✦')
const Star = makeIcon('★')
const TrendingUp = makeIcon('↗')
const Users = makeIcon('♧')
const X = makeIcon('×')

const TABS = [
  { id: 'overview', label: 'نظرة عامة', icon: LayoutDashboard },
  { id: 'students', label: 'الطلاب', icon: Users },
  { id: 'lessons', label: 'الحصص', icon: CalendarDays },
  { id: 'grades', label: 'الدرجات', icon: GraduationCap },
  { id: 'reports', label: 'التقارير', icon: Send },
  { id: 'portal', label: 'Student Portal', icon: Bell },
]

const STUDENTS = [
  { name: 'يوسف أحمد', group: 'أولى ثانوي · الأحد', attendance: 'حاضر', score: '92%', points: 18 },
  { name: 'سلمى محمد', group: 'أولى ثانوي · الأحد', attendance: 'حاضر', score: '88%', points: 15 },
  { name: 'عمر خالد', group: 'أولى ثانوي · الأحد', attendance: 'متابعة', score: '74%', points: 9 },
  { name: 'مريم علي', group: 'أولى ثانوي · الأحد', attendance: 'حاضر', score: '96%', points: 22 },
]

const TOUR_STEPS = [
  { title: 'ابدأ من لوحة اليوم', text: 'هنا ترى الحصة القادمة، الحضور، وما يحتاج انتباهًا في نظرة واحدة.' },
  { title: 'جرّب التبويبات', text: 'افتح الطلاب أو الحصص أو الدرجات لتشاهد رحلة المدرس كاملة.' },
  { title: 'بيانات تجريبية فقط', text: 'كل ما تراه هنا للشرح فقط. لا يتم حفظ أو تعديل أي بيانات حقيقية.' },
]

function DemoActionButton({ onClick, hint, className = '', children }) {
  return <div className="flex flex-col items-center gap-1"><button type="button" onClick={onClick} className={className}>{children}</button><span className="max-w-[210px] text-center text-[11px] font-bold leading-4 text-slate-400">{hint}</span></div>
}

function DemoBadge() {
  return <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-800"><Sparkles className="h-3.5 w-3.5" /> معاينة تجريبية</span>
}

function MetricCard({ label, value, detail, tone = 'navy', icon: Icon }) {
  const tones = {
    navy: 'bg-slate-900 text-white',
    green: 'bg-emerald-50 text-emerald-800',
    gold: 'bg-amber-50 text-amber-900',
    blue: 'bg-sky-50 text-sky-900',
  }
  return <div className={`rounded-3xl p-5 ${tones[tone]}`}><div className="flex items-center justify-between"><span className="text-xs font-bold opacity-70">{label}</span><Icon className="h-5 w-5 opacity-75" /></div><div className="mt-4 text-3xl font-black tracking-tight">{value}</div><div className="mt-1 text-xs font-bold opacity-70">{detail}</div></div>
}

function Overview({ onDemoAction }) {
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="إجمالي الطلاب" value="١٣٦" detail="في ٦ مجموعات" icon={Users} />
      <MetricCard label="حضور اليوم" value="٩٢٪" detail="أفضل من الأسبوع الماضي" tone="green" icon={ClipboardCheck} />
      <MetricCard label="متوسط الدرجات" value="٨٥٪" detail="آخر امتحان" tone="gold" icon={TrendingUp} />
      <MetricCard label="التقارير الجاهزة" value="٢٤" detail="تنتظر المراجعة" tone="blue" icon={Send} />
    </div>
    <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex items-center justify-between"><div><p className="text-xs font-black text-emerald-700">لوحة اليوم</p><h3 className="mt-1 text-xl font-black">الحصة التالية جاهزة</h3></div><span className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700">٥:٠٠ م</span></div>
        <div className="mt-5 rounded-2xl bg-slate-900 p-5 text-white"><div className="flex items-start justify-between gap-4"><div><p className="text-xs text-slate-300">أولى ثانوي · مجموعة الأحد</p><p className="mt-2 text-lg font-black">المعادلات الخطية</p></div><div className="rounded-2xl bg-white/10 p-3"><BookOpenCheck className="h-6 w-6 text-amber-300" /></div></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs font-bold text-slate-300"><span>٢٤ طالبًا</span><DemoActionButton onClick={() => onDemoAction('هذه معاينة فقط — يمكنك بدء الحضور من المنصة الحقيقية.')} hint="ابدأ تسجيل حضور المجموعة بالـ QR أو يدويًا" className="rounded-xl bg-white px-4 py-2 font-black text-slate-900 transition hover:-translate-y-0.5">ابدأ الحضور ←</DemoActionButton></div></div>
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-center justify-between"><div><p className="text-xs font-black text-amber-700">ما يحتاج انتباهًا</p><h3 className="mt-1 text-xl font-black">٣ طلاب اليوم</h3></div><Bell className="h-5 w-5 text-slate-400" /></div><div className="mt-5 space-y-3">{STUDENTS.slice(1, 4).map((student, index) => <div key={student.name} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3"><div className={`flex h-10 w-10 items-center justify-center rounded-xl font-black ${index === 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'}`}>{student.name.slice(0, 1)}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-black">{student.name}</p><p className="mt-1 text-xs text-slate-500">{index === 0 ? 'يحتاج مراجعة النتيجة' : 'متابعة الواجب'}</p></div><ChevronLeft className="h-4 w-4 text-slate-400" /></div>)}</div></section>
    </div>
  </div>
}

function Students({ onDemoAction }) {
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-black text-emerald-700">إدارة الطلاب</p><h3 className="mt-1 text-xl font-black">كل طالب في مكانه الصحيح</h3></div><DemoActionButton onClick={() => onDemoAction('تم فتح نموذج إضافة طالب — هذه معاينة ولا تحفظ بيانات.')} hint="شاهد كيف تضيف طالبًا وتربطه بمجموعته" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 text-sm font-black text-white"><Users className="h-4 w-4" /> إضافة طالب تجريبي</DemoActionButton></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[650px] text-right text-sm"><thead><tr className="border-b border-slate-100 text-xs text-slate-400"><th className="px-3 py-3 font-bold">الطالب</th><th className="px-3 py-3 font-bold">المجموعة</th><th className="px-3 py-3 font-bold">الحضور</th><th className="px-3 py-3 font-bold">النتيجة</th><th className="px-3 py-3 font-bold">النقاط</th><th /></tr></thead><tbody>{STUDENTS.map((student) => <tr key={student.name} className="border-b border-slate-50"><td className="px-3 py-4 font-black">{student.name}</td><td className="px-3 py-4 text-xs text-slate-500">{student.group}</td><td className="px-3 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${student.attendance === 'حاضر' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{student.attendance}</span></td><td className="px-3 py-4 font-black text-slate-700">{student.score}</td><td className="px-3 py-4 font-black text-amber-700">{student.points}</td><td className="px-3 py-4"><button type="button" onClick={() => onDemoAction(`عرض ملف ${student.name} التجريبي.`)} className="text-xs font-black text-slate-500 hover:text-slate-900">عرض الملف</button></td></tr>)}</tbody></table></div></section>
}

function Lessons({ onDemoAction }) {
  const lessons = [['الأحد', '٥:٠٠ م', 'أولى ثانوي', 'المعادلات الخطية', '٢٤ طالبًا'], ['الثلاثاء', '٦:٣٠ م', 'ثانية إعدادي', 'النسب والتناسب', '١٨ طالبًا'], ['الخميس', '٤:٠٠ م', 'ثالثة إعدادي', 'مراجعة الوحدة', '٢١ طالبًا']]
  return <div className="grid gap-4 lg:grid-cols-3">{lessons.map(([day, time, stage, title, count]) => <article key={day} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white">{day}</span><span className="text-sm font-black text-amber-700">{time}</span></div><p className="mt-6 text-xs font-bold text-emerald-700">{stage}</p><h3 className="mt-2 text-xl font-black">{title}</h3><p className="mt-2 text-sm text-slate-500">{count} · رابط الحصة جاهز</p><DemoActionButton onClick={() => onDemoAction('تم فتح تفاصيل الحصة التجريبية.')} hint="اعرض تفاصيل الموعد والدرس والواجب" className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 py-3 text-sm font-black text-slate-700">فتح الحصة <ArrowLeft className="h-4 w-4" /></DemoActionButton></article>)}</div>
}

function Grades({ onDemoAction }) {
  return <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]"><section className="rounded-3xl bg-slate-900 p-6 text-white"><p className="text-xs font-black text-amber-300">آخر امتحان</p><h3 className="mt-2 text-2xl font-black">المعادلات الخطية</h3><div className="mt-8 flex items-end gap-3"><span className="text-7xl font-black tracking-tight text-amber-300">٨٥٪</span><span className="pb-3 text-sm font-bold text-slate-300">متوسط المجموعة</span></div><div className="mt-8 h-3 rounded-full bg-white/10"><div className="h-3 w-[85%] rounded-full bg-amber-300" /></div><p className="mt-4 text-sm leading-7 text-slate-300">سجّل الدرجات مرة، وخد إشارة واضحة عن التقدير والمتابعة والدعم.</p></section><section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex items-center justify-between"><div><p className="text-xs font-black text-emerald-700">رصد الدرجات</p><h3 className="mt-1 text-xl font-black">قرار أوضح لكل طالب</h3></div><DemoActionButton onClick={() => onDemoAction('تم فتح نموذج امتحان تجريبي.')} hint="أنشئ امتحانًا وسجّل درجات الطلاب" className="rounded-2xl bg-slate-900 px-4 py-2 text-xs font-black text-white">امتحان جديد</DemoActionButton></div><div className="mt-5 space-y-3">{[['يوسف أحمد', '92%', 'يستحق تقدير', 'bg-emerald-50 text-emerald-700'], ['سلمى محمد', '88%', 'ماشي كويس', 'bg-amber-50 text-amber-800'], ['عمر خالد', '74%', 'يحتاج مساعدة', 'bg-rose-50 text-rose-700']].map(([name, score, status, tone]) => <div key={name} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-sm font-black text-slate-700">{name.slice(0, 1)}</div><span className="flex-1 text-sm font-black">{name}</span><span className="font-black text-slate-700">{score}</span><span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${tone}`}>{status}</span></div>)}</div></section></div>
}

function Reports({ onDemoAction }) {
  const queue = [['يوسف أحمد', 'جاهز للمراجعة', '92%'], ['سلمى محمد', 'تمت المراجعة', '88%'], ['عمر خالد', 'يحتاج تعديلًا', '74%']]
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-black text-amber-700">Reports Queue</p><h3 className="mt-1 text-xl font-black">ولّد، راجع، ثم أرسل</h3></div><DemoActionButton onClick={() => onDemoAction('هذه معاينة فقط — الإرسال الفعلي موجود في حسابك الحقيقي.')} hint="راجع الرسائل ثم أرسلها من خلال Queue" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#25D366]/10 px-4 py-3 text-sm font-black text-[#168c46]"><Send className="h-4 w-4" /> إرسال تجريبي</DemoActionButton></div><div className="mt-5 grid gap-3 md:grid-cols-3">{queue.map(([name, status, score], index) => <div key={name} className="rounded-2xl bg-slate-50 p-4"><div className="flex items-center justify-between"><span className="text-sm font-black">{name}</span><span className="text-xs font-black text-slate-500">{score}</span></div><div className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-500"><span className={`h-2.5 w-2.5 rounded-full ${index === 1 ? 'bg-emerald-500' : index === 2 ? 'bg-amber-500' : 'bg-sky-500'}`} />{status}</div></div>)}</div><div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs font-black text-slate-400"><span className="rounded-full bg-slate-100 px-3 py-2">١ توليد</span><ArrowLeft className="h-4 w-4" /><span className="rounded-full bg-slate-100 px-3 py-2">٢ مراجعة</span><ArrowLeft className="h-4 w-4" /><span className="rounded-full bg-slate-100 px-3 py-2">٣ إرسال</span></div></section>
}

function Portal({ onDemoAction }) {
  return <div className="grid items-center gap-5 lg:grid-cols-[.85fr_1.15fr]"><section className="rounded-[2rem] bg-slate-900 p-6 text-white shadow-xl"><div className="flex items-center gap-3 border-b border-white/10 pb-4"><img src="/nokhba-mark.svg" alt="شعار النخبة" className="h-10 w-10 rounded-xl" /><div><p className="text-xs text-slate-300">Student Portal</p><h3 className="font-black">بوابة يوسف أحمد</h3></div></div><div className="mt-5 space-y-3"><div className="rounded-2xl bg-emerald-500/15 p-4"><p className="text-xs text-emerald-200">حالة اليوم</p><p className="mt-1 text-xl font-black text-emerald-100">حاضر ✓</p></div><div className="rounded-2xl bg-white/10 p-4"><p className="text-xs text-slate-300">الواجب</p><p className="mt-1 text-xl font-black">مراجعة الدرس</p></div><div className="rounded-2xl bg-amber-400/15 p-4"><p className="text-xs text-amber-200">النتيجة</p><p className="mt-1 text-xl font-black text-amber-100">٩٢٪</p></div></div></section><section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><DemoBadge /><h3 className="mt-5 text-2xl font-black">ولي الأمر يرى المهم فقط</h3><p className="mt-3 max-w-xl text-sm leading-7 text-slate-500">كل حدث من الحضور والواجب والدرجات يصل إلى نفس الرابط بطريقة بسيطة، بدون الدخول إلى لوحة المدرس.</p><div className="mt-7 space-y-3">{[['المدرس يسجل الحضور', Check], ['المنصة تحدّث الصفحة', Bell], ['ولي الأمر يرى التحديث', MessageCircle]].map(([label, Icon], index) => <div key={label} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm"><Icon className="h-5 w-5" /></div><span className="text-sm font-black">{label}</span>{index < 2 && <ArrowLeft className="mr-auto h-4 w-4 text-slate-400" />}</div>)}</div><DemoActionButton onClick={() => onDemoAction('تم فتح رابط Student Portal التجريبي.')} hint="شاهد ما يراه الطالب وولي الأمر" className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-700">فتح البوابة التجريبية <ArrowLeft className="h-4 w-4" /></DemoActionButton></section></div>
}

export default function PreviewDashboard({ onBack, onLogin }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [tourStep, setTourStep] = useState(0)
  const [toast, setToast] = useState('')

  const demoAction = (message) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const active = TABS.find((tab) => tab.id === activeTab) || TABS[0]
  const ActiveIcon = active.icon
  const renderContent = () => {
    if (activeTab === 'students') return <Students onDemoAction={demoAction} />
    if (activeTab === 'lessons') return <Lessons onDemoAction={demoAction} />
    if (activeTab === 'grades') return <Grades onDemoAction={demoAction} />
    if (activeTab === 'reports') return <Reports onDemoAction={demoAction} />
    if (activeTab === 'portal') return <Portal onDemoAction={demoAction} />
    return <Overview onDemoAction={demoAction} />
  }

  return <main className="min-h-screen bg-[#f4f7fb] text-slate-900" dir="rtl">
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-[#f4f7fb]/95 backdrop-blur-md"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8"><div className="flex items-center gap-3"><div className="rounded-2xl bg-white p-2 shadow-sm"><img src="/nokhba-mark.svg" alt="شعار النخبة" className="h-9 w-9 rounded-xl" /></div><div><p className="text-xs font-bold text-slate-400">Al-Nokhba ELITE</p><p className="font-black">معاينة المنصة</p></div></div><div className="flex items-center gap-2"><button type="button" onClick={onBack} className="hidden items-center gap-2 rounded-2xl px-4 py-3 text-sm font-black text-slate-600 hover:bg-white sm:flex"><ArrowRight className="h-4 w-4" /> العودة للموقع</button><button type="button" onClick={onLogin} className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white">جرّب حسابك</button></div></div></header>
    <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-8"><div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><DemoBadge /><h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">شوف المنصة قبل ما تبدأ</h1><p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">دي جولة تفاعلية ببيانات تجريبية فقط. افتح كل تبويب وشوف النتيجة التي سيحصل عليها المدرس يوميًا.</p></div><div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-6 text-amber-900">لا يتم حفظ أي شيء<br />ولا توجد بيانات حقيقية هنا.</div></div>
      <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_280px] lg:items-start"><section className="min-w-0"><div className="mb-5 flex gap-2 overflow-x-auto rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">{TABS.map(({ id, label, icon: Icon }) => <button type="button" key={id} onClick={() => setActiveTab(id)} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-2xl px-4 text-sm font-black transition ${activeTab === id ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}><Icon className="h-4 w-4" />{label}</button>)}</div><div className="mb-5 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm"><ActiveIcon className="h-5 w-5" /></div><div><p className="text-xs font-bold text-slate-400">معاينة حية</p><h2 className="text-xl font-black">{active.label}</h2></div></div>{renderContent()}</section><aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-24"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-amber-600" /><h2 className="font-black">جولة سريعة</h2></div><button type="button" onClick={onBack} aria-label="إغلاق المعاينة" className="rounded-xl p-2 text-slate-400 hover:bg-slate-50"><X className="h-4 w-4" /></button></div><div className="mt-5 rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black text-emerald-700">٠{tourStep + 1} / ٠{TOUR_STEPS.length}</p><h3 className="mt-3 font-black">{TOUR_STEPS[tourStep].title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{TOUR_STEPS[tourStep].text}</p></div><div className="mt-4 flex gap-2">{TOUR_STEPS.map((step, index) => <button type="button" key={step.title} onClick={() => setTourStep(index)} aria-label={`خطوة ${index + 1}`} className={`h-2 flex-1 rounded-full ${index === tourStep ? 'bg-slate-900' : 'bg-slate-200'}`} />)}</div><div className="mt-5 flex gap-2"><button type="button" disabled={tourStep === 0} onClick={() => setTourStep((step) => Math.max(0, step - 1))} className="flex-1 rounded-2xl border border-slate-200 py-3 text-xs font-black text-slate-600 disabled:opacity-40">السابق</button><button type="button" onClick={() => setTourStep((step) => Math.min(TOUR_STEPS.length - 1, step + 1))} className="flex-1 rounded-2xl bg-slate-900 py-3 text-xs font-black text-white">{tourStep === TOUR_STEPS.length - 1 ? 'تم' : 'التالي'}</button></div></aside></div></div>
    {toast && <div role="status" className="fixed bottom-5 left-5 right-5 z-50 mx-auto max-w-md rounded-2xl bg-slate-900 px-5 py-4 text-center text-sm font-black text-white shadow-2xl sm:left-auto sm:right-8">{toast}</div>}
  </main>
}
