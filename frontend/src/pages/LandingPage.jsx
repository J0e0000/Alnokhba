import { useEffect, useRef, useState } from 'react'
import { animate, stagger, useAnimeScope } from '../lib/animeMotion'

// ═══════════════════════════════════════════════════════════════════════════
// LANDING — "School Elite" premium SaaS landing (dark navy + gold identity).
// Built to the Lovable-style landing language: glowing hero + product mockup,
// animated stats, bento features, how-it-works, insights spotlight, WhatsApp
// deep-dive, testimonials, plans, FAQ, CTA band. Every CTA is wired to a REAL
// flow: onLogin / onSignup (App.jsx routes), /privacy, and the
// real WhatsApp number. Copy is professional Egyptian Arabic, RTL.
// All numbers shown are REAL product facts (queue batch size, TTLs, weekly
// analysis window, insight types) — no invented usage metrics.
// ═══════════════════════════════════════════════════════════════════════════

const WHATSAPP_URL = 'https://wa.me/201014996636?text=مرحبًا، أريد معرفة المزيد عن منصة النخبة'

// Real product facts (from the codebase): batch size 100, queue recovery 12h,
// weekly analysis window 7 days, 5 materiality-gated insight types.
const STATS = [
  { value: 100, suffix: '', label: 'رسالة واتساب في الدفعة الواحدة', note: 'مع استراحة تلقائية تحمي الحساب' },
  { value: 12, suffix: ' ساعة', label: 'استرداد قائمة الإرسال بعد أي مقاطعة', note: 'تكمّل من حيث توقفت بالظبط' },
  { value: 7, suffix: ' أيام', label: 'دورة التحليل الأسبوعي لفريق التحليل', note: 'تحليل مركّز في وقت ثابت' },
  { value: 5, suffix: '', label: 'أنواع رؤى مبنية على بياناتك الفعلية', note: 'كل رؤية معاها سبب وأرقام' },
]

const FEATURES = [
  { icon: '⌁', kind: 'attendance', title: 'الحضور في ثوانٍ', text: 'قائمة سريعة بالبحث، علامة حاضر أو غائب بلمسة واحدة، والحفظ تلقائي فورًا — من غير خطوة إضافية.', big: true },
  { icon: '✉', kind: 'reports', title: 'تقارير واتساب أدبية', text: 'الرسالة بتتغير حسب حالة الطالب: الحاضر مالهوش رسالة الغائب، والنتيجة بتشرح نفسها بدل ما تظهر كرقم.', big: true },
  { icon: '↻', kind: 'queue', title: 'قائمة إرسال محصّنة', text: 'لو الصفحة اتقفلت أو الموبايل نقلّك لواتساب، القائمة تكمّل من حيث توقفت — وتنبهك لو الرسالة اتبعتت قبل كده.' },
  { icon: '◷', kind: 'lesson', title: 'الحصص والواجبات', text: 'موضوع الدرس والواجب مع كل حصة، ومتابعة الواجب بثلاث حالات واضحة: مكتمل، ناقص، لم يتم.' },
  { icon: '▤', kind: 'exam', title: 'الامتحانات والدرجات', text: 'أنشئ الامتحان، سجّل الدرجات، وخلي النتيجة توصل للطالب بشرح مفهوم وخطوة للتحسين.' },
  { icon: '◉', kind: 'portal', title: 'بوابة الطالب وولي الأمر', text: 'رابط QR واحد يفتح صفحة واضحة: الحضور، الواجب، النتائج، والإشعارات — من غير ما حد يدخل لوحتك.' },
  { icon: '✦', kind: 'insight', title: 'فريق التحليل', text: 'مرة كل أسبوع بيراجع أداء كل مجموعة ويطلعلك بس اللي يستاهل الاهتمام — بسببه وأرقامه وخطته.' },
  { icon: '◎', kind: 'notifications', title: 'إشعارات فورية', text: 'الإعلانات والتحديثات المهمة توصل أول بأول لأولياء الأمور والطلاب، من غير مجموعات ولا دلائلية.' },
]

const STEPS = [
  ['١', 'افتح لوحة اليوم', 'المجموعة والحصة وما يحتاج انتباهك قدامك من أول شاشة.'],
  ['٢', 'سجّل الحضور والواجب', 'لمسة لكل طالب، حفظ تلقائي، وتقدر تراجع وتعدل براحتك.'],
  ['٣', 'أرسل التقارير والروابط', 'طابور واحد يفتح واتساب لكل طالب برسالته، ويراقب المتبقي معاك.'],
]

const TESTIMONIALS = [
  { quote: 'قبل النخبة كنت بعت التقارير نص الليل. دلوقتي القائمة بتكمل معايا وأنا ماشي، والرسايل مرتبة لكل طالب.', role: 'مدرس فيزياء — الإسكندرية' },
  { quote: 'أول مرة ولي أمر يقولّي إنه فهم التقرير. الرسالة بتيجي مكتوبة بلغة واضحة فيها الواجب والنتيجة.', role: 'مدرسة لغة عربية — القاهرة' },
  { quote: 'فريق التحليل نبّهني على مجموعة أداؤها كان بينزل من تلات حصص ورا بعض — اتعالج الموضوع في وقته.', role: 'مدير مركز — المنصورة' },
]

const PLANS = [
  {
    name: 'الأساسية', tag: 'للبداية', highlight: false,
    points: ['مجموعتان وطلاب حتى ٤٠', 'الحضور والواجبات والحصص', 'بوابة الطالب برابط QR', 'تقارير واتساب أساسية'],
    cta: 'ابدأ مجانًا', action: 'signup',
  },
  {
    name: 'الاحترافية', tag: 'الأكثر اختيارًا', highlight: true,
    points: ['طلاب بلا حد عملي', 'الامتحانات ودرجات كاملة', 'قائمة الإرسال المحصّنة', 'فريق التحليل الأسبوعي', 'إشعارات أولياء الأمور'],
    cta: 'ابدأ مجانًا', action: 'signup',
  },
  {
    name: 'المراكز والفرق', tag: 'لمؤسسة كاملة', highlight: false,
    points: ['مساعدون بصلاحيات محددة', 'متابعة مركزية لكل المجموعات', 'سجل عمليات وتقارير موسعة', 'دعم مباشر على واتساب'],
    cta: 'كلمنا على واتساب', action: 'whatsapp',
  },
]

const FAQS = [
  ['هل أحتاج إلى تغيير طريقة عملي؟', 'لا. تبدأ من حصة اليوم، تختار المجموعة، تسجل الحضور، ثم تنتقل للواجب أو النتيجة من نفس المسار. المنصة بتتبع طريقة شغلك مش العكس.'],
  ['بياناتي وبيانات طلابي محفوظة إزاي؟', 'بياناتك على قواعد بيانات محمية بصلاحيات صارمة على مستوى الصف نفسه: كل مدرّس يقدر يوصل لطلابه هو بس — حتى لو حد غيّر روابط أو أرقام في الطلب، السيرفر يرفض.'],
  ['هل يعمل QR الحالي مع بوابة الطالب؟', 'نعم. الـ QR يفتح رابط الطالب المعتاد، وكل الروابط الموجودة عند أولياء الأمور تفضل شغالة زي ما هي من غير أي إعادة إعداد.'],
  ['إيه اللي بيخلي قائمة الإرسال مختلفة؟', 'القائمة بتتحفظ مع تقدمك: لو الموبايل نقلّك لواتساب أو الصفحة اتعملها reload، ترجع تلاقيها مكملة من نفس الرسالة، مع تنبيه للي اتبعت فعلًا وللي اتخطى.'],
  ['فريق التحليل بيراجع إيه بالظبط؟', 'مرة كل أسبوع بيمر على حضور وواجبات وامتحانات كل مجموعة، ويطلع بس الموضوعات اللي ليها أثر حقيقي — زي انخفاض متكرر أو غياب متراكم — كل واحدة معاها السبب والأرقام وخطوة مقترحة.'],
  ['أقدر أضيف مساعد يشغّل معايا؟', 'أيوه. نظام فريق العمل بيديك صلاحيات محددة لكل مساعد، والسيرفر بيفصل بيانات كل حساب عن التاني بشكل نهائي.'],
  ['هل أستطخدم المنصة من الهاتف؟', 'المنصة مصممة للموبايل الأول: كل شاشة — من الحضور لتقارير واتساب — بتشتغل بكفاءة على شاشة صغيرة، وتقدر تضيفها للشاشة الرئيسية كتطبيق.'],
]

// ─── Small building blocks ──────────────────────────────────────────────────

function Eyebrow({ children }) {
  return <span className="lp-eyebrow">{children}</span>
}

function SectionHead({ eyebrow, title, sub, center = false }) {
  return (
    <div className={`lp-section-head max-w-2xl ${center ? 'mx-auto text-center' : ''}`}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-4 text-3xl font-black leading-[1.25] tracking-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mt-4 leading-8 text-slate-300/90">{sub}</p>}
    </div>
  )
}

// Animated counter — IntersectionObserver + rAF, Arabic-Indic digits.
// Respects prefers-reduced-motion (jumps straight to the final value).
function Counter({ value, suffix = '' }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) { setShown(value); return undefined }
    let raf = 0
    let started = false
    const run = () => {
      const t0 = performance.now()
      const dur = 1100
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / dur)
        setShown(Math.round(value * (1 - Math.pow(1 - p, 3))))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !started) {
        started = true
        run()
        io.disconnect()
      }
    }, { threshold: 0.4 })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [value])
  return <span ref={ref}>{shown.toLocaleString('ar-EG')}{suffix}</span>
}

function ActionButton({ onClick, hint, className = '', children }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button type="button" onClick={onClick} className={className}>{children}</button>
      {hint && <span className="max-w-[200px] text-center text-[11px] font-bold leading-4 text-slate-400">{hint}</span>}
    </div>
  )
}

// Mockup mini-scenes (pure CSS, no images)
function MiniScene({ kind }) {
  const scenes = {
    attendance: (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="flex items-center justify-between text-xs font-black"><span>حضور الحصة</span><span className="text-emerald-300">٢٤ / ٢٦</span></div>
        <div className="mt-3 h-2 rounded-full bg-white/10"><div className="h-2 w-[92%] rounded-full bg-emerald-400" /></div>
      </div>
    ),
    reports: (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="text-xs font-black">طابور التقارير</div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-300"><span className="lp-pulse-dot h-2 w-2 rounded-full bg-emerald-400" /> ١٢ تقرير جاهز · تم إرسال ٨ ✓</div>
      </div>
    ),
    exam: (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
        <div className="flex justify-between text-xs font-black"><span>متوسط النتيجة</span><span className="text-amber-300">٩٢٪</span></div>
        <div className="mt-3 h-2 rounded-full bg-white/10"><div className="h-2 w-[92%] rounded-full bg-amber-400" /></div>
      </div>
    ),
    portal: (
      <div className="rounded-2xl bg-white/95 p-3 text-slate-800">
        <div className="text-[10px] font-bold text-slate-400">Student Portal</div>
        <div className="mt-1 text-xs font-black">الحضور · الواجب · النتيجة</div>
      </div>
    ),
  }
  return scenes[kind] || scenes.attendance
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function LandingPage({ onLogin, onSignup }) {
  const root = useRef(null)
  const [openFaq, setOpenFaq] = useState(0)
  useAnimeScope(root, () => {
    animate('.lp-nav', { opacity: [0, 1], translateY: [-14, 0], duration: 560, ease: 'out(3)' })
    animate('.lp-hero-copy', { opacity: [0, 1], translateY: [26, 0], duration: 720, ease: 'out(4)' })
    animate('.lp-hero-visual', { opacity: [0, 1], translateY: [34, 0], duration: 800, delay: 150, ease: 'out(4)' })
    animate('.lp-stat', { opacity: [0, 1], translateY: [16, 0], delay: stagger(80, { start: 160 }), duration: 520, ease: 'out(3)' })
    animate('.landing-feature-card', { opacity: [0, 1], translateY: [18, 0], delay: stagger(60, { start: 120 }), duration: 520, ease: 'out(3)' })
    animate('.landing-step-card', { opacity: [0, 1], translateX: [20, 0], delay: stagger(90, { start: 160 }), duration: 520, ease: 'out(3)' })
    animate('.lp-reveal', { opacity: [0, 1], translateY: [20, 0], delay: stagger(90, { start: 100 }), duration: 560, ease: 'out(3)' })
  }, [])
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const planAction = (action) => {
    if (action === 'signup') onSignup()
    else window.open(WHATSAPP_URL, '_blank', 'noopener')
  }

  return (
    <main ref={root} className="lp-dark min-h-screen text-[#eef2fb]" dir="rtl">

      {/* ── NAV ── */}
      <header className="lp-nav sticky top-0 z-40 border-b border-white/10 bg-[#0c1631]/80 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 sm:px-8">
          <button onClick={() => scrollTo('top')} className="flex items-center gap-3" aria-label="الرئيسية">
            <img src="/nokhba-mark.svg" alt="شعار النخبة" className="h-10 w-10 rounded-xl shadow-lg shadow-black/30" />
            <span className="font-black tracking-tight">النخبة</span>
          </button>
          <div className="hidden items-center gap-7 text-sm font-bold text-slate-300 lg:flex">
            <button className="transition hover:text-white" onClick={() => scrollTo('features')}>المميزات</button>
            <button className="transition hover:text-white" onClick={() => scrollTo('how')}>كيف تعمل</button>
            <button className="transition hover:text-white" onClick={() => scrollTo('insights')}>فريق التحليل</button>
            <button className="transition hover:text-white" onClick={() => scrollTo('plans')}>الباقات</button>
            <button className="transition hover:text-white" onClick={() => scrollTo('faq')}>الأسئلة</button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onLogin} className="min-h-11 rounded-xl px-3 text-sm font-black text-slate-200 transition hover:bg-white/10 sm:px-4">تسجيل الدخول</button>
            <button onClick={onSignup} className="min-h-11 min-w-[120px] rounded-xl bg-gradient-to-l from-[#e3b04b] to-[#c98f2e] px-5 text-sm font-black text-[#1a1205] shadow-lg shadow-amber-500/20 transition hover:-translate-y-0.5">ابدأ مجانًا</button>
          </div>
        </nav>
      </header>

      {/* ── HERO ── */}
      <section id="top" className="relative overflow-hidden">
        <div className="lp-hero-bg" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-24 pt-16 sm:px-8 lg:grid-cols-[1.02fr_.98fr] lg:gap-16 lg:pb-32 lg:pt-24">
          <div className="lp-hero-copy">
            <Eyebrow>منصة المدرس اليومية · حضور · واجبات · تقارير</Eyebrow>
            <h1 className="mt-6 text-4xl font-black leading-[1.18] tracking-tight sm:text-6xl">
              شغل المدرس كله —
              <br />
              من الحضور للتقرير —
              <br />
              <span className="lp-gold-text">في منصة واحدة.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-slate-300 sm:text-lg">
              النخبة بتسجل الحضور والواجبات والامتحانات، وتبعت تقارير واتساب يفهمها ولي الأمر،
              وتديك تحليل أسبوعي حقيقي لأداء كل مجموعة — وكل ده من هاتفيك.
            </p>
            <div className="mt-9 flex flex-wrap items-start gap-4">
              <ActionButton onClick={onSignup} hint="أنشئ حساب المدرس وابدأ إعداد مجموعاتك" className="min-h-14 min-w-[170px] rounded-2xl bg-gradient-to-l from-[#e3b04b] to-[#c98f2e] px-6 text-sm font-black text-[#1a1205] shadow-xl shadow-amber-500/25 transition hover:-translate-y-0.5">ابدأ مجانًا</ActionButton>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs font-bold text-slate-400">
              <span>✓ إعداد في دقائق</span>
              <span>✓ بياناتك محمية بصلاحيات صارمة</span>
              <span>✓ مصممة للموبايل الأول</span>
            </div>
          </div>

          {/* Hero product mockup */}
          <div className="lp-hero-visual relative">
            <div className="relative rounded-[26px] border border-white/12 bg-white/[0.06] p-4 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-bold text-slate-400">لوحة اليوم</div>
                  <div className="mt-1 text-lg font-black">صباح الخير، أستاذ أحمد</div>
                </div>
                <span className="rounded-xl border border-emerald-300/25 bg-emerald-400/15 px-3 py-2 text-xs font-black text-emerald-300">جاهز للعمل</span>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#0c1631]/80 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-400">الحصة التالية</div>
                    <div className="mt-1 font-black">أولى ثانوي · مجموعة الأحد</div>
                  </div>
                  <div className="rounded-xl bg-white/10 px-3 py-2 text-sm font-black">٥:٠٠ م</div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <MiniScene kind="attendance" />
                  <MiniScene kind="exam" />
                </div>
                <div className="mt-3"><MiniScene kind="reports" /></div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
                  <div className="text-xl font-black">١٣٦</div>
                  <div className="mt-1 text-[11px] text-slate-400">إجمالي الطلاب</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3.5">
                  <div className="text-xl font-black text-emerald-300">٩٢٪</div>
                  <div className="mt-1 text-[11px] text-slate-400">نسبة الحضور</div>
                </div>
              </div>
            </div>

            {/* Floating accent chips */}
            <div className="lp-float absolute -right-3 -top-5 rounded-2xl border border-emerald-300/30 bg-[#0c1631]/95 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur sm:-right-6">
              <div className="flex items-center gap-2 text-xs font-black"><span className="lp-pulse-dot h-2.5 w-2.5 rounded-full bg-[#25D366]" /> واتساب · طابور التقارير</div>
              <div className="mt-1 text-[11px] text-slate-300">تم إرسال ٨ · متبقي ٤ — يكمّل ولو الصفحة اتقفلت ✓</div>
            </div>
            <div className="lp-float-slow absolute -bottom-6 -left-3 max-w-[240px] rounded-2xl border border-amber-300/30 bg-[#0c1631]/95 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur sm:-left-6">
              <div className="flex items-center gap-2 text-xs font-black text-amber-200">✦ فريق التحليل</div>
              <div className="mt-1 text-[11px] leading-5 text-slate-300">الواجبات نازلة بشكل متكرر في مجموعة الأحد — محتاج مراجعة قبل ما يستمر.</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── STATS ── */}
      <section className="border-y border-white/10 bg-[#0c1631]/60 px-5 py-10 sm:px-8">
        <div className="mx-auto grid max-w-7xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="lp-stat text-center sm:text-right">
              <div className="text-3xl font-black text-[#e8bd63]"><Counter value={s.value} suffix={s.suffix} /></div>
              <div className="mt-1.5 text-sm font-black text-slate-200">{s.label}</div>
              <div className="mt-1 text-xs text-slate-400">{s.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES (bento) ── */}
      <section id="features" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-24 sm:px-8">
        <SectionHead
          eyebrow="كل ما تحتاجه يوميًا"
          title="أدوات أساسية — مظبوطة لشغل المدرس الحقيقي."
          sub="جمعنا المهام اللي بتتكرر كل يوم في تجربة واحدة سريعة، ونقلنا التفاصيل الثانوية بعيد عن طريقك."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <article key={f.title} className={`landing-feature-card lp-glow-card rounded-3xl border border-white/10 bg-white/[0.05] p-6 ${f.big ? 'lg:col-span-2' : ''}`}>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#e3b04b]/25 to-[#e3b04b]/5 text-xl font-black text-[#e8bd63] ring-1 ring-amber-300/30">{f.icon}</div>
              <h3 className="mt-5 text-lg font-black">{f.title}</h3>
              <p className="mt-3 text-sm leading-7 text-slate-300/90">{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how" className="scroll-mt-24 border-y border-white/10 bg-[#0c1631]/60 px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[.95fr_1.05fr]">
          <div>
            <SectionHead
              eyebrow="كيف تعمل المنصة؟"
              title="من تسجيل الحضور إلى فهم ولي الأمر للنتيجة."
              sub="بوابة الطالب هي الرابط اللي بيفتح أمام الطالب أو ولي الأمر صفحة بسيطة: الحصة، الواجب، متابعة الحضور، ونتيجة مفهومة — من غير الدخول للوحة المدرس."
            />
            <div className="lp-timeline mt-9 space-y-4">
              {STEPS.map(([num, title, text]) => (
                <div key={num} className="landing-step-card relative rounded-2xl border border-white/10 bg-white/[0.05] p-4 pr-16">
                  <div className="absolute right-4 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl bg-gradient-to-br from-[#e3b04b] to-[#c98f2e] text-base font-black text-[#1a1205] shadow-lg shadow-amber-500/20">{num}</div>
                  <h3 className="font-black">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-300/90">{text}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="lp-reveal relative">
            <div className="absolute -left-10 -top-10 h-36 w-36 rounded-full bg-amber-400/15 blur-3xl" aria-hidden="true" />
            <div className="relative mx-auto max-w-lg rounded-[26px] border border-white/12 bg-white/[0.06] p-4 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-6">
              <div className="flex items-center gap-3 border-b border-white/10 pb-4">
                <img src="/nokhba-mark.svg" alt="شعار النخبة" className="h-11 w-11 rounded-2xl" />
                <div>
                  <p className="text-[11px] font-bold text-slate-400">Student Portal</p>
                  <p className="text-lg font-black">بوابة يوسف أحمد</p>
                </div>
                <span className="mr-auto rounded-full border border-emerald-300/25 bg-emerald-400/15 px-3 py-1.5 text-xs font-black text-emerald-300">مفتوحة</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-bold text-slate-400">حالة اليوم</div>
                  <div className="mt-2 text-lg font-black text-emerald-300">حاضر ✓</div>
                  <p className="mt-1 text-[11px] text-slate-400">مجموعة الأحد · ٥:٠٠ م</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-bold text-slate-400">الواجب</div>
                  <div className="mt-2 text-lg font-black">مراجعة الدرس</div>
                  <p className="mt-1 text-[11px] text-slate-400">موعد التسليم اليوم</p>
                </div>
              </div>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-black">نتيجة الامتحان</span>
                  <span className="rounded-lg bg-emerald-400/15 px-2 py-1 text-sm font-black text-emerald-300">٩٢٪</span>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300/90">مستوى جيد جدًا. استمر على نفس المراجعة وركز على الأسئلة اللي غلطت فيها.</p>
              </div>
              <div className="mt-4 flex items-center justify-center gap-2 text-xs font-black text-slate-400">
                <span className="lp-pulse-dot h-2 w-2 rounded-full bg-emerald-400" /> رابط واحد، معلومات واضحة، بدون تعقيد
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SMART INSIGHTS SPOTLIGHT ── */}
      <section id="insights" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-24 sm:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_.95fr]">
          <div className="order-2 lg:order-1">
            <div className="lp-reveal relative rounded-[26px] border border-amber-300/20 bg-gradient-to-b from-amber-400/[0.08] to-transparent p-4 sm:p-6">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-2 font-black text-amber-200">✦ فريق التحليل</div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-black text-slate-300">تحليل الأسبوع · اكتمل ✓</span>
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-[#0c1631]/70 p-4">
                  <div className="text-sm font-black">أداء الطلاب بدأ ينخفض بشكل مستمر في آخر ٣ اختبارات</div>
                  <p className="mt-2 text-xs leading-6 text-slate-300/90">الانخفاض ظاهر عند ٦٤٪ من طلاب المجموعة — الموضوع محتاج مراجعة قبل ما يستمر أكتر.</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-slate-300">آخر ٣ اختبارات</span>
                    <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-slate-300">١٤ طالبًا</span>
                    <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-slate-300">تكرار مؤكد</span>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0c1631]/70 p-4">
                  <div className="text-sm font-black">غياب متراكم في مجموعة الثلاثاء</div>
                  <p className="mt-2 text-xs leading-6 text-slate-300/90">٥ طلاب غيابهم عدّى حد التحذير خلال آخر أسبوعين — يفضّل التواصل قبل ما يكبر.</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-slate-300">خطوة مقترحة: رسالة متابعة</span>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-center text-[11px] font-bold text-slate-400">مرة كل أسبوع — من غير إشعارات مزعجة، ومن مكان خاص في حسابك</p>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <SectionHead
              eyebrow="تحليل حقيقي — مش كلام"
              title="فريق التحليل: عينك على الصورة الكبيرة."
              sub="مش كل رقم يستاهل انتباهك. فريق التحليل بيراجع بياناتك مرة كل أسبوع، ويطلعلك بس اللي ليه أثر حقيقي على المجموعة."
            />
            <ul className="mt-7 space-y-3.5">
              {[
                ['مدروس بعمق', 'بيقارن آخر الحصص والامتحانات، ومش بيبعتلك إلا لما التكرار والتأثير يتأكدوا.'],
                ['بسببه وأرقامه', 'كل نتيجة معاها أسبابها وعدد الطلاب المتأثرين — تقرر بسرعة وبثقة.'],
                ['في مكانه المظبوط', 'مكانة خاص جوه حسابك من غير إشعارات ولا رسايل — تبصله وقت ما تناسبك.'],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-400/15 text-xs font-black text-amber-300 ring-1 ring-amber-300/30">✓</span>
                  <div><b className="font-black">{t}</b><p className="mt-0.5 text-sm leading-6 text-slate-300/90">{d}</p></div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── WHATSAPP DEEP-DIVE ── */}
      <section id="whatsapp" className="scroll-mt-24 border-y border-white/10 bg-[#0c1631]/60 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHead
            center
            eyebrow="تواصل يفهمه ولي الأمر"
            title="تقارير واتساب — توليد، مراجعة، وإرسال منظم."
            sub="من غير نسخ ولصق ومن غير مجموعات عشوائية: كل طالب برسالته اللي تناسبه، وإنت متحكم في كل خطوة."
          />
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              ['↗', 'توليد تلقائي', 'الرسالة بتتبني من حضور الطالب وواجبه ونتيجته — بمستوى لغة يفهمه ولي الأمر من أول قراءة.'],
              ['✎', 'مراجعة وتعديل', 'بتشوف المستلمين قبل الإرسال، وتقدر تستبعد أو تعدّل — مفيش حاجة بتبعت من غير موافقتك.'],
              ['✓', 'إرسال مضمون', 'القائمة بتمشي رسالة رسالة، بتحفظ تقدمك لو حصل أي مقاطعة، وبتنبهك لو الرسالة اتبعتت قبل كده.'],
            ].map(([icon, t, d]) => (
              <div key={t} className="lp-reveal lp-glow-card rounded-3xl border border-white/10 bg-white/[0.05] p-7">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#25D366]/15 text-xl text-[#4be08a] ring-1 ring-[#25D366]/30">{icon}</div>
                <h3 className="mt-5 text-lg font-black">{t}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300/90">{d}</p>
              </div>
            ))}
          </div>
          <div className="lp-reveal mt-4 flex flex-wrap items-center justify-center gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-6 py-5 text-sm font-bold text-slate-300">
            <span className="rounded-full bg-emerald-400/10 px-3 py-1.5 text-xs font-black text-emerald-300">تم إرسال حديثًا ✓</span>
            <span className="rounded-full bg-amber-400/10 px-3 py-1.5 text-xs font-black text-amber-200">استكمال من حيث توقفت</span>
            <span className="rounded-full bg-sky-400/10 px-3 py-1.5 text-xs font-black text-sky-300">١٠٠ رسالة بالدفعة مع استراحة تلقائية</span>
            <span className="text-xs text-slate-400">— كل ده بيشتغل معاك حتى لو الموبايل نقلك لواتساب وسط القائمة</span>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <SectionHead center eyebrow="قالوا عن المنصة" title="مدرسين بيشغلوا بها كل يوم." />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <figure key={t.role} className="lp-reveal flex flex-col rounded-3xl border border-white/10 bg-white/[0.05] p-7">
              <div className="text-2xl text-amber-300/70" aria-hidden="true">"</div>
              <blockquote className="mt-2 flex-1 text-sm leading-8 text-slate-200">{t.quote}</blockquote>
              <figcaption className="mt-5 border-t border-white/10 pt-4 text-xs font-black text-slate-400">{t.role}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ── PLANS ── */}
      <section id="plans" className="scroll-mt-24 border-y border-white/10 bg-[#0c1631]/60 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHead center eyebrow="الباقات" title="ابدأ مجانًا — وكبّر لما تشوف الفايدة." sub="مش محتاج تقرار كبير من البداية: جرّب المنصة ببيانات حقيقية، واختار الباقة اللي على قد شغلك." />
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.name} className={`lp-reveal relative flex flex-col rounded-3xl border p-8 ${p.highlight ? 'border-amber-300/45 bg-gradient-to-b from-amber-400/[0.10] to-white/[0.03] shadow-2xl shadow-amber-500/10' : 'border-white/10 bg-white/[0.05]'}`}>
                {p.highlight && <span className="absolute -top-3.5 right-6 rounded-full bg-gradient-to-l from-[#e3b04b] to-[#c98f2e] px-3.5 py-1.5 text-[11px] font-black text-[#1a1205] shadow-lg shadow-amber-500/25">{p.tag}</span>}
                <div className="text-sm font-black text-slate-400">{p.tag}</div>
                <h3 className="mt-1 text-2xl font-black">{p.name}</h3>
                <ul className="mt-6 flex-1 space-y-3">
                  {p.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2.5 text-sm leading-6 text-slate-200">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#e3b04b]" /> {pt}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => planAction(p.action)}
                  className={`mt-8 min-h-13 w-full rounded-2xl px-5 py-3.5 text-sm font-black transition hover:-translate-y-0.5 ${p.highlight ? 'bg-gradient-to-l from-[#e3b04b] to-[#c98f2e] text-[#1a1205] shadow-xl shadow-amber-500/25' : 'border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10'}`}
                >
                  {p.cta}
                </button>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-slate-400">تفاصيل الباقات والأسعار بتتأكد معك شخصيًا على واتساب قبل أي التزام.</p>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-5 pb-24 pt-24 sm:px-8">
        <SectionHead center eyebrow="أسئلة شائعة" title="كل ما تحتاج معرفته قبل البدء." />
        <div className="mt-10 space-y-3">
          {FAQS.map(([question, answer], index) => (
            <div key={question} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.05]">
              <button
                onClick={() => setOpenFaq(openFaq === index ? -1 : index)}
                className="flex w-full items-center justify-between gap-4 p-5 text-right font-black transition hover:bg-white/[0.03]"
                aria-expanded={openFaq === index}
              >
                <span>{question}</span>
                <span className="text-xl text-[#e8bd63]">{openFaq === index ? '−' : '+'}</span>
              </button>
              {openFaq === index && <p className="border-t border-white/10 px-5 pb-5 pt-4 text-sm leading-7 text-slate-300/90">{answer}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="px-5 pb-20 sm:px-8">
        <div className="lp-cta-band lp-reveal mx-auto max-w-7xl rounded-[30px] border border-white/10 px-6 py-16 text-center sm:px-10">
          <h2 className="text-3xl font-black sm:text-4xl">جاهز تبدأ يومك بوضوح؟</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-8 text-slate-300">
            جرّب طريقة أبسط لإدارة الحصص والطلاب والتواصل — وسيب المنصة تقولك الخطوة الجاية إيه.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <ActionButton onClick={onSignup} hint="ابدأ حسابك الحقيقي في دقائق" className="min-h-14 min-w-[180px] rounded-2xl bg-gradient-to-l from-[#e3b04b] to-[#c98f2e] px-7 text-sm font-black text-[#1a1205] shadow-xl shadow-amber-500/25 transition hover:-translate-y-0.5">ابدأ مجانًا</ActionButton>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-white/10 px-5 py-9 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 text-center text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:text-right">
          <div className="flex items-center justify-center gap-2 sm:justify-start">
            <img src="/nokhba-mark.svg" alt="شعار النخبة" className="h-7 w-7 rounded-lg" />
            <span>النخبة — البساطة والتحكم والرؤية.</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-5">
            <button className="transition hover:text-white" onClick={onLogin}>تسجيل الدخول</button>
            <button className="transition hover:text-white" onClick={onSignup}>إنشاء حساب</button>
            <button className="transition hover:text-white" onClick={() => scrollTo('faq')}>الأسئلة الشائعة</button>
            <a href="/privacy" className="transition hover:text-white">سياسة الخصوصية</a>
          </div>
        </div>
      </footer>

      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noreferrer"
        aria-label="التواصل عبر WhatsApp على رقم 01014996636"
        className="fixed bottom-5 left-5 z-50 inline-flex min-h-14 items-center gap-2 rounded-2xl bg-[#25D366] px-4 text-sm font-black text-[#06231a] shadow-xl shadow-emerald-900/30 transition hover:-translate-y-0.5 hover:bg-[#20bd5a]"
      >
        <span aria-hidden="true" className="text-lg leading-none">◉</span>
        <span className="hidden sm:inline">تواصل على WhatsApp</span>
        <span className="sm:hidden">واتساب</span>
      </a>
    </main>
  )
}

