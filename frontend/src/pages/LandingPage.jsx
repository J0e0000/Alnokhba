import { useEffect, useRef, useState } from 'react'
import { animate, stagger, useAnimeScope } from '../lib/animeMotion'
import { setSeo, faqSchema, softwareAppSchema, websiteSchema, orgSchema } from '../marketing/seo.js'
import { WHATSAPP_URL, SCREENS, track } from '../marketing/config.js'
import { PLANS, TRIAL, formatPrice, fmtAr } from '../marketing/pricing.js'
import { FaqList } from '../marketing/MarketingLayout.jsx'

// ═══════════════════════════════════════════════════════════════════════════
// LANDING — 17-section conversion architecture (Arabic-first, RTL).
// Identity: the product's own navy + gold system. Every claim is verified:
// no testimonials, no customer logos, no invented metrics. The stats band
// carries the owner-set speed numbers (85% / 92% / 10× / 60s). Product
// visuals are REAL screenshots captured from the running app (demo data).
// ═══════════════════════════════════════════════════════════════════════════

// Owner-set speed stats (LANDING-4) — the teacher's saved time.
const STATS = [
  { value: 85, suffix: '٪', label: 'وقت أقل في إرسال التقارير', note: 'التقرير بيتولد من بيانات الحصة تلقائيًا' },
  { value: 92, suffix: '٪', label: 'متابعة ودقة أعلى مع أولياء الأمور', note: 'كل طالب برسالته الصح: حضوره وواجبه ونتيجته' },
  { value: 10, suffix: ' أضعاف', label: 'أسرع من الطريقة اليدوية', note: 'من غير نسخ ولصق ولا كتابة يدوية' },
  { value: 60, suffix: ' ثانية', label: 'تسجيل حضور مجموعة كاملة', note: 'لمسة لكل طالب والحفظ التلقائي فوري' },
]

const PROBLEMS = [
  ['▤', 'الحضور في دفتر', 'ورقة بتمر في الحصة، ومراجعة الغياب بقت ذاكرة لا ملف.'],
  ['▦', 'الطلاب في ملف Excel', 'ملف عند كل مدرّس بنسخة مختلفة — ومحدش عارف أنهي النسخة الصح.'],
  ['✉', 'واتساب متفرق', 'رسايل يدوية واحدة واحدة، ومفيش حاجة بتوثّق إيه اللي اتبعت فعلاً.'],
  ['◎', 'المدفوعات والحصص مش واضحة', 'مين دفع ومين تأخر — سؤال بياخد معركة تتبع كل شهر.'],
  ['✎', 'نتايج متفرقة', 'الامتحان بيتسجل في ورقة، والتحليل بيضل مؤجل لآخر الترم.'],
  ['◔', 'تقارير بتتجمع إيدوي', 'آخر كل أسبوع معركة تجميع: حضور وواجب ودرجات من تلات مصادر.'],
]

const WORKFLOW = [
  ['أنشئ المجموعة', 'المرحلة والجدول والألوان'],
  ['حدد مواعيد الحصص', 'أسبوعيًا وبتكرار تلقائي'],
  ['الحضور', 'لمسة لكل طالب أو QR'],
  ['التفاعل', 'نقاط وملاحظات لحظية'],
  ['الواجب', 'مكتمل · ناقص · لم يتم'],
  ['الامتحان والدرجات', 'بأقسام ومرتبط بالحصة'],
  ['التقرير', 'يتولد تلقائيًا ويُراجع'],
  ['إنهاء الحصة', 'كل حاجة محفوظة وموثقة'],
]

const FEATURES = [
  ['إدارة الطلاب', 'ملف كامل لكل طالب: مجموعته ونقاطه وإنذاراته وسجل حضوره وواجباته — وبحث فوري بالاسم أو الكود.'],
  ['مسار الحصة', 'حضور وتفاعل وواجب وامتحان وتقرير في مساحة واحدة — من غير تنقل بين شاشات.'],
  ['الحضور والغياب', 'لمسة لكل طالب أو مسح QR، وقاعدة أسبوع موحدة من الجمعة للخميس لكل المركز.'],
  ['الواجبات', 'ثلاث حالات واضحة لكل طالب في كل حصة، ومتابعة التسليم أسبوع بأسبوع.'],
  ['الامتحانات والدرجات', 'امتحان بأقسام ودرجة قصوى لكل قسم، ومرتبط بحصته — بيقيس الجزء اللي اتشرح.'],
  ['التقارير', 'تقارير أولياء أمور بتتبني تلقائيًا من البيانات — جاهزة للمراجعة والإرسال في دقيقة.'],
  ['التواصل عبر واتساب', 'قائمة إرسال منظمة بمراجعة قبل الإرسال واستكمال بعد أي مقاطعة.'],
  ['فريق التحليل', 'مراجعة أسبوعية بترصد الأنماط المهمة بس — بسببه وأرقامه وخطته المقترحة.'],
]

const TEACHER_FLOW = [
  ['حصص اليوم', 'من أول شاشة: المجموعة والوقت والحصة الجاهزة.'],
  ['افتح الحصة', 'مساحة واحدة فيها كل تبويبات الشغل.'],
  ['الحضور', 'لمسة لكل طالب — حفظ تلقائي فوري.'],
  ['التفاعل والواجب', 'نقاط وملاحظات وحالة واجب لكل طالب.'],
  ['الامتحان', 'درجات بأقسام من نفس المسار.'],
  ['التقرير', 'بيتبنى تلقائيًا — تراجعه وت بعته.'],
  ['إنهاء الحصة', 'تثبيت كل حاجة — والحصة تفضل قابلة للاستكمال قبل الإنهاء.'],
]

const OWNER_POINTS = [
  ['صورة لحظية', 'الحضور والواجبات والنتايج محدثة أول بأول — من غير ما تستدعي حد.'],
  ['متابعة بلا لاحقة', 'كل مدرّس شغال في مساحته، والبيانات بتتجمع عندك تلقائيًا.'],
  ['تقارير جاهزة', 'تقرير أي طالب أو مجموعة بضغطة — للمعاينة أو لأولياء الأمور.'],
  ['تحليل أسبوعي', 'ملخص بيقولك الوضع عامل إزاي وأنهي نقاط تستاهل تدخلك.'],
]

const HOW = [
  ['١', 'ابدأ حسابك', 'اسمك وإيميلك وكلمة مرور — من غير بطاقة دفع. التجربة المجانية ١٤ يوم بكامل المميزات.'],
  ['٢', 'جهّز بيانات مركزك', 'أنشئ مجموعاتك، ضيف طلابك (دفعة واحدة)، واضبط جدول الأسبوع — في جلسة واحدة.'],
  ['٣', 'شغّل مركزك', 'افتح حصة اليوم وسجّل الشغل منه — والتقارير والتحليل بيتكفلوا بنفسهم.'],
]

const AUDIENCE = [
  ['السنتر الصغير', 'مجموعتين ودفتر حضور؟ ابدأ منظم من أول يوم — بدون أي تعقيد.'],
  ['المركز النامي', 'الطلاب بيزيدوا؟ مركز البيانات قبل ما الكبر يتحول فوضى.'],
  ['مدير أكاديمي', 'تابع كل المجموعات والمدرسين من مكان واحد بتحديث لحظي.'],
  ['صاحب المركز', 'اعرف اللي بيحصل من غير ما تلاحق الفريق — التقارير جاهزة عندك.'],
  ['المدرّس', 'شغلك اليومي كله في مساحة حصة واحدة — من موبايلك.'],
  ['فريق العمل', 'مساعدون بصلاحيات محددة وبيانات مفصولة بأمان على مستوى السيرفر.'],
]

const FAQS = [
  ['النخبة إيه بالظبط؟', 'منصة عربية لإدارة مراكز التعليم: بتدير الطلاب والمجموعات ومسار الحصة (حضور، تفاعل، واجب، امتحان) وبتولد تقارير واتساب لأولياء الأمور وبتعمل مراجعة أسبوعية لأداء كل مجموعة — كل ده من مكان واحد ومن الموبايل.'],
  ['لِمين مناسبة؟', 'لأي حد بيدير مجموعة طلاب أو أكتر: سنتر دروس، أكاديمية، مدرّس خصوصي بقائمة بتطول، أو مدير أكاديمي بيدير فريق مدرسين.'],
  ['أقدر أدير كام طالب؟', 'الباقات بتتبع حجم شغلك: Starter حتى ٣٠٠ طالب نشط، Growth حتى ١٬٠٠٠، Pro حتى ٣٬٠٠٠ بفروع غير محدودة، وEnterprise لما تعدّي كده — وكلها بنفس المميزات الأساسية.'],
  ['بتدعم الفروع المتعددة؟', 'المنصة بيدعم فريق عمل بمساعدون بصلاحيات محددة ومساحة مشتركة — ودي طريقة عمل المراكز اللي بيتوسع دلوقتي. لو عندك بنية فروع أكبر، كلمنا على واتساب ونراجع وضعك معاك.'],
  ['المدرسين بيشتغلوا من الموبايل؟', 'أيوه — المنصة مصممة موبايل-أول: كل شاشة من الحضور للتقارير شغالة بكفاءة على الهاتف، وتقدر تضيفها للشاشة الرئيسية كتطبيق.'],
  ['الحضور بيشتغل إزاي؟', 'من جوه مسار الحصة نفسه: قايمة سريعة بالبحث ولمسة لكل طالب أو مسح QR — والحفظ تلقائي فوري. والأسبوع بيتلخص من الجمعة للخميس بقاعدة موحدة.'],
  ['أقدر أنقل طلابي الحاليين؟', 'أيوه — ضيفهم دفعة واحدة من شاشة الإضافة السريعة (اسم ورقم اختياري لكل طالب)، أو دخّلهم من ملف Excel عبر أدوات الاستيراد الموجودة في المنصة.'],
  ['في تجربة مجانية؟', `أيوه — ${fmtAr(TRIAL.days)} يوم بكامل المميزات الأساسية، من غير بطاقة دفع ومن غير تجديد تلقائي. وبعد التجربة الحساب بيتوقف مؤقتًا (مش حذف) وبياناتك تفضل محفوظة ${fmtAr(TRIAL.retentionDays)} يوم. شوف صفحة التجربة المجانية للتفاصيل.`],
  ['الأسعار إزاي؟', 'أسعار واضحة بالجنيه المصري: تبدأ من ٣٩٩ ج/شهر لباقة Starter (حتى ٣٠٠ طالب) وبتكبر مع مركزك — والتفعيل بيتأكد معك شخصيًا على واتساب. مفيش دفع أونلاين ولا خصم صامت.'],
  ['بياناتي وطلابي محمية إزاي؟', 'كل حساب مفصول على مستوى صفوف قاعدة البيانات نفسها (RLS): محدش غيرك يقدر يوصل بيانات مركزك حتى لو غيّر روابط في الطلب — السيرفر هو اللي بيرفض، مش الواجهة.'],
  ['أقدر ألغي؟', 'أي وقت — مفيش عقد ولا التزام. وبما إن مفيش تجديد تلقائي، مجرد ما ما تكملش الدفع الحساب بيتوقف مؤقتًا وبياناتك تفضل محفوظة ٣٠ يوم — مش حذف فوري.'],
  ['بتدعم واتساب إزاي؟', 'بتوليد تقارير جاهزة من بيانات الطالب، مراجعتها قبل الإرسال، وبعتهم عبر واتساب بقائمة منظمة بتكمّل من حيث توقفت حتى لو غلقت الصفحة — مع حماية من الإرسال المكرر.'],
]

// ── Small building blocks ──────────────────────────────────────────────────
function Counter({ value, suffix = '' }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(value); return undefined }
    let raf = 0
    let started = false
    const run = () => {
      const t0 = performance.now()
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / 1100)
        setShown(Math.round(value * (1 - Math.pow(1 - p, 3))))
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !started) { started = true; run(); io.disconnect() }
    }, { threshold: 0.4 })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [value])
  return <span ref={ref}>{shown.toLocaleString('ar-EG')}{suffix}</span>
}

function SectionHead({ eyebrow, title, sub, center = false }) {
  return (
    <div className={`lp-section-head max-w-2xl ${center ? 'mx-auto text-center' : ''}`}>
      <span className="lp-eyebrow">{eyebrow}</span>
      <h2 className="mt-4 text-3xl font-black leading-[1.25] tracking-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mt-4 leading-8 text-slate-300/90">{sub}</p>}
    </div>
  )
}

function Shot({ s, alt, className = '', priority = false }) {
  return (
    <img
      src={s.src} width={s.w} height={s.h} alt={alt}
      loading={priority ? 'eager' : 'lazy'} decoding="async"
      className={`rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/40 ${className}`}
    />
  )
}

const signup = () => '/?auth=signup'

// Homepage SEO — exported so the build-time prerender (scripts/prerender.mjs)
// injects the exact same head tags + JSON-LD into the static HTML.
export const SEO = {
  title: 'النخبة — شغّل مركزك التعليمي كله من مكان واحد | برنامج إدارة السنتر',
  description: 'نظام إدارة مراكز تعليمية عربي: الطلاب والحصص والحضور والواجبات والامتحانات وتقارير واتساب لأولياء الأمور وتحليل أسبوعي — من الموبايل. تجربة مجانية ١٤ يوم بدون بطاقة.',
  path: '/',
  image: SCREENS.dashboard,
  jsonLd: [orgSchema, websiteSchema, softwareAppSchema, faqSchema(FAQS)],
}

export default function LandingPage({ onLogin, onSignup }) {
  const root = useRef(null)
  useEffect(() => {
    const cleanup = setSeo(SEO)
    return cleanup
  }, [])
  useAnimeScope(root, () => {
    animate('.lp-nav', { opacity: [0, 1], translateY: [-14, 0], duration: 560, ease: 'out(3)' })
    animate('.lp-hero-copy', { opacity: [0, 1], translateY: [26, 0], duration: 720, ease: 'out(4)' })
    animate('.lp-hero-visual', { opacity: [0, 1], translateY: [34, 0], duration: 800, delay: 150, ease: 'out(4)' })
    animate('.lp-stat', { opacity: [0, 1], translateY: [16, 0], delay: stagger(80, { start: 160 }), duration: 520, ease: 'out(3)' })
    animate('.landing-feature-card', { opacity: [0, 1], translateY: [18, 0], delay: stagger(60, { start: 120 }), duration: 520, ease: 'out(3)' })
    animate('.lp-reveal', { opacity: [0, 1], translateY: [20, 0], delay: stagger(90, { start: 100 }), duration: 560, ease: 'out(3)' })
  }, [])
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <main ref={root} className="lp-dark min-h-screen text-[#eef2fb]" dir="rtl">
      {/* ── NAV (§2 architecture: simple, real links) ── */}
      <header className="lp-nav sticky top-0 z-40 border-b border-white/10 bg-[#0D1C3D]/80 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 sm:px-8" aria-label="التنقل الرئيسي">
          <a href="/" className="flex items-center gap-3" aria-label="النخبة — الرئيسية">
            <img src="/nokhba-mark.svg" alt="شعار النخبة" className="h-10 w-10 rounded-xl shadow-lg shadow-black/30" />
            <span className="font-black tracking-tight">النخبة</span>
          </a>
          <div className="hidden items-center gap-7 text-sm font-bold text-slate-300 lg:flex">
            <a className="transition hover:text-white" href="/features">المميزات</a>
            <a className="transition hover:text-white" href="/solutions">الحلول</a>
            <a className="transition hover:text-white" href="/pricing">الأسعار</a>
            <button className="transition hover:text-white" onClick={() => scrollTo('insights')}>فريق التحليل</button>
            <a className="transition hover:text-white" href="/resources">المصادر</a>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onLogin} className="min-h-11 rounded-xl px-3 text-sm font-black text-slate-200 transition hover:bg-white/10 sm:px-4">تسجيل الدخول</button>
            <a href={signup()} onClick={() => track('trial_cta_click', { source: 'nav' })} className="inline-flex min-h-11 min-w-[120px] items-center justify-center rounded-xl bg-gradient-to-l from-[#FB9C1B] to-[#E07F00] px-5 text-sm font-black text-[#1D0E03] shadow-lg shadow-nk-500/20 transition hover:-translate-y-0.5">ابدأ التجربة المجانية</a>
          </div>
        </nav>
      </header>

      {/* ── SECTION 1 — HERO ── */}
      <section id="top" className="relative overflow-hidden">
        <div className="lp-hero-bg" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-16 sm:px-8 lg:grid-cols-[1.02fr_.98fr] lg:gap-16 lg:pb-28 lg:pt-24">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow">منصة إدارة مراكز التعليم · حضور · واجبات · تقارير · تحليل</span>
            <h1 className="mt-6 text-4xl font-black leading-[1.18] tracking-tight sm:text-6xl">
              شغّل مركزك التعليمي كله —
              <br />
              <span className="lp-gold-text">من مكان واحد.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-slate-300 sm:text-lg">
              الطلاب والمدرسين والحصص والحضور والواجبات والامتحانات وتقارير أولياء الأمور وتحليل الأداء —
              النخبة بتجمع مسار الشغل اليومي كله في نظام واحد بيفهمه المدرس ويستخدمه من موبايله.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <a href={signup()} onClick={() => track('trial_cta_click', { source: 'hero' })} className="inline-flex min-h-14 min-w-[190px] items-center justify-center rounded-2xl bg-gradient-to-l from-[#FB9C1B] to-[#E07F00] px-7 text-sm font-black text-[#1D0E03] shadow-xl shadow-nk-500/25 transition hover:-translate-y-0.5">ابدأ التجربة المجانية</a>
              <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => track('whatsapp_click', { source: 'hero' })} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-[#25D366]/30 bg-[#25D366]/10 px-7 text-sm font-black text-[#4be08a] transition hover:bg-[#25D366]/20">
                <span aria-hidden="true">◉</span> تواصل معنا عبر واتساب
              </a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs font-bold text-slate-400">
              <span>✓ تجربة ١٤ يوم من غير بطاقة</span>
              <span>✓ بيانات محمية على مستوى قاعدة البيانات</span>
              <span>✓ مصممة للموبايل الأول</span>
            </div>
          </div>

          {/* REAL product interface — captured from the running app */}
          <div className="lp-hero-visual relative">
            <div className="relative rounded-[26px] border border-white/12 bg-white/[0.06] p-3 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-4">
              <div className="mb-3 flex items-center justify-between px-1">
                <div className="text-[11px] font-bold text-slate-400">مسار الحصة — واجهة حقيقية من المنصة</div>
                <span className="rounded-xl border border-emerald-300/25 bg-emerald-400/15 px-3 py-1.5 text-[10px] font-black text-emerald-300">لقطة حية</span>
              </div>
              <Shot s={SCREENS.session} alt="مساحة الحصة الحقيقية في منصة النخبة: تبويبات الحضور والتفاعل والواجب والامتحانات والتقرير" priority className="w-full" />
            </div>
            <div className="lp-float absolute -right-3 -top-5 rounded-2xl border border-emerald-300/30 bg-[#0D1C3D]/95 px-4 py-3 shadow-xl shadow-black/40 backdrop-blur sm:-right-6">
              <div className="flex items-center gap-2 text-xs font-black"><span className="lp-pulse-dot h-2.5 w-2.5 rounded-full bg-[#25D366]" /> واتساب · قائمة الإرسال</div>
              <div className="mt-1 text-[11px] text-slate-300">بتكمّل من حيث توقفت — حتى لو الصفحة اتقفلت ✓</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 2 — OWNER-SET SPEED STATS ── */}
      <section className="border-y border-white/10 bg-[#0D1C3D]/60 px-5 py-10 sm:px-8" aria-label="مؤشرات السرعة">
        <div className="mx-auto grid max-w-7xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="lp-stat text-center sm:text-right">
              <div className="text-3xl font-black text-[#FBBF6D]"><Counter value={s.value} suffix={s.suffix} /></div>
              <div className="mt-1.5 text-sm font-black text-slate-200">{s.label}</div>
              <div className="mt-1 text-xs text-slate-400">{s.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── SECTION 3 — PRODUCT SHOWCASE (real screenshots) ── */}
      <section id="showcase" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-24 sm:px-8">
        <SectionHead
          eyebrow="شوف المنصة نفسها"
          title="واجهات حقيقية — مش تصميمات دعائية."
          sub="دي شاشات المنصة الفعلية بأسماء وبيانات تجريبية: من لوحة اليوم لحد تقرير فريق التحليل."
        />
        <div className="mt-12 space-y-16">
          {[
            [SCREENS.dashboard, 'لوحة اليوم', 'مجموعاتك وحصصك وما يحتاج انتباهك — قدامك من أول شاشة كل ما تفتح المنصة.', 'لوحة اليوم في منصة النخبة تعرض حصص اليوم ونظرة عامة'],
            [SCREENS.students, 'إدارة الطلاب', 'ملف كامل لكل طالب، بحث فوري، وإضافة مجموعة طلاب دفعة واحدة من شاشة الحضور.', 'قائمة الطلاب في منصة النخبة مع البحث وأزرار QR'],
            [SCREENS.reports, 'التقارير', 'تقارير أولياء الأمور بتتبنى تلقائيًا من حضور الطالب وواجبه ونتايجه — تراجعها وتبعتها.', 'شاشة التقارير في منصة النخبة مع قوالب الرسائل'],
            [SCREENS.insights, 'فريق التحليل', 'ملخص أسبوعي بيقولك الوضع عامل إزاي — ويسيبك للنقاط المهمة بس.', 'تقرير فريق التحليل الأسبوعي في منصة النخبة'],
          ].map(([s, t, d, alt], i) => (
            <div key={t} className={`grid items-center gap-8 lg:grid-cols-[.9fr_1.1fr] ${i % 2 ? '' : ''}`}>
              <div className={i % 2 ? 'lg:order-2' : ''}>
                <h3 className="text-2xl font-black">{t}</h3>
                <p className="mt-3 leading-8 text-slate-300/90">{d}</p>
                <a href="/features" className="mt-4 inline-flex items-center gap-2 text-sm font-black text-[#FBBF6D]">كل المميزات <span aria-hidden="true">←</span></a>
              </div>
              <Shot s={s} alt={alt} className={`w-full ${i % 2 ? 'lg:order-1' : ''}`} />
            </div>
          ))}
        </div>
      </section>

      {/* ── SECTION 4 — THE PROBLEM ── */}
      <section className="scroll-mt-24 border-y border-white/10 bg-[#0D1C3D]/60 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHead
            center
            eyebrow="المشكلة اللي كل مركز بيعرفها"
            title="كل يوم المركز بيكبر… والبيانات بتتوزع أكتر."
            sub="الطلاب في مكان، والحضور في مكان تاني، والمدفوعات في ملف، والتقارير بتتجمع إيدويًا. ومحدش شايل الصورة الكاملة."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PROBLEMS.map(([icon, t, d]) => (
              <div key={t} className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-400/10 text-lg text-rose-300 ring-1 ring-rose-300/25">{icon}</div>
                <h3 className="mt-4 font-black">{t}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-300/90">{d}</p>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-8 text-slate-300">
            النتيجة: وقت المدرس بيتاكل في تنسيق بدل تدريس، وولي الأمر مش متابع، والمشاكل المهمة —
            غياب متراكم أو مستوى نازل — بتظهر متأخرة.
          </p>
        </div>
      </section>

      {/* ── SECTION 5 — THE ALNOKHBA APPROACH: ONE CONNECTED WORKFLOW ── */}
      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <SectionHead
          center
          eyebrow="طريقة النخبة"
          title="مش مجموعة ميزات — مسار شغل واحد متصل."
          sub="كل خطوة بتغذي اللي بعدها: الحضور بيدخل في التقرير، والواجب والدرجات بيدخلوا في التحليل. من غير نسخ بين الشاشات."
        />
        <ol className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="مسار الشغل المتصل">
          {WORKFLOW.map(([t, d], i) => (
            <li key={t} className="lp-reveal relative rounded-2xl border border-white/10 bg-white/[0.05] p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#FB9C1B] to-[#E07F00] text-sm font-black text-[#1D0E03]">{i + 1}</span>
                <h3 className="font-black">{t}</h3>
              </div>
              <p className="mt-2 text-xs leading-6 text-slate-400">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── SECTION 6 — CORE FEATURES (categories → /features) ── */}
      <section id="features" className="scroll-mt-24 border-y border-white/10 bg-[#0D1C3D]/60 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHead
            eyebrow="قدرات المنصة"
            title="أدوات أساسية — مظبوطة لشغل المدرس الحقيقي."
            sub="جمعنا المهام اللي بتتكرر كل يوم في تجربة واحدة سريعة، ونقلنا التفاصيل الثانوية بعيد عن طريقك."
          />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(([t, d]) => (
              <article key={t} className="landing-feature-card lp-glow-card rounded-3xl border border-white/10 bg-white/[0.05] p-6">
                <h3 className="text-lg font-black text-[#FBBF6D]">{t}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300/90">{d}</p>
              </article>
            ))}
          </div>
          <div className="mt-10 text-center">
            <a href="/features" className="inline-flex min-h-12 items-center rounded-2xl border border-white/15 bg-white/5 px-7 text-sm font-black text-slate-100 transition hover:bg-white/10">استعرض كل المميزات بالتفصيل</a>
          </div>
        </div>
      </section>

      {/* ── SECTION 7 — TEACHER WORKFLOW ── */}
      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-[.95fr_1.05fr]">
          <div>
            <SectionHead
              eyebrow="شغل المدرس داخل الحصة"
              title="الحصة بتفتح مرة… وبتقفل لما تخلص شغلك."
              sub="مسار واضح من أول شاشة لحد التقرير — والحفظ التلقائي معاك في كل خطوة. لو الموبايل نقلك لواتساب وسط الشغل، ترجع تلاقي كل حاجة زي ما هي."
            />
            <div className="mt-4 rounded-2xl border border-nk-300/25 bg-nk-400/[0.07] p-4 text-sm leading-7 text-nk-100/90">
              <b className="font-black">الحفظ مش الإنهاء:</b> الحصة تفضل مفتوحة وقابلة للاستكمال في أي وقت —
              الإنهاء بتحسمه أنت لما تخلص، وساعتها كل حاجة بتتثبت في السجل.
            </div>
          </div>
          <div className="lp-timeline space-y-3">
            {TEACHER_FLOW.map(([t, d], i) => (
              <div key={t} className="relative rounded-2xl border border-white/10 bg-white/[0.05] p-4 pr-16">
                <div className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl bg-gradient-to-br from-[#FB9C1B] to-[#E07F00] text-sm font-black text-[#1D0E03]">{i + 1}</div>
                <h3 className="font-black">{t}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-300/90">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 8 — OWNER / MANAGEMENT VIEW ── */}
      <section className="scroll-mt-24 border-y border-white/10 bg-[#0D1C3D]/60 px-5 py-24 sm:px-8">
        <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.05fr_.95fr]">
          <div className="order-2 lg:order-1">
            <Shot s={SCREENS.dashboard} alt="لوحة اليوم في منصة النخبة — نظرة المدير على حصص اليوم والطلاب" className="w-full" />
          </div>
          <div className="order-1 lg:order-2">
            <SectionHead
              eyebrow="لصاحب المركز والمدير"
              title="اعرف اللي بيحصل من غير ما تلاحق الفريق."
              sub="البيانات بتتحدث لحظيًا مع شغل المدرسين — وإنت بتشوف الصورة الكاملة من مكانك."
            />
            <ul className="mt-7 space-y-3.5">
              {OWNER_POINTS.map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-nk-400/15 text-xs font-black text-nk-300 ring-1 ring-nk-300/30">✓</span>
                  <div><b className="font-black">{t}</b><p className="mt-0.5 text-sm leading-6 text-slate-300/90">{d}</p></div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── SECTION 9 — SMART INSIGHTS (rules + validation, NOT "AI") ── */}
      <section id="insights" className="mx-auto max-w-7xl scroll-mt-24 px-5 py-24 sm:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_.95fr]">
          <div className="order-2 lg:order-1">
            <div className="lp-reveal relative rounded-[26px] border border-nk-300/20 bg-gradient-to-b from-nk-400/[0.08] to-transparent p-4 sm:p-6">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-2 font-black text-nk-200">✦ فريق التحليل</div>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-black text-slate-300">تحليل الأسبوع · اكتمل ✓</span>
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-[#0D1C3D]/70 p-4">
                  <div className="text-sm font-black">غياب مجموعة الأحد عالي وزايد</div>
                  <p className="mt-2 text-xs leading-6 text-slate-300/90">الغياب وصل ٣٤٪ في آخر ٤ أسابيع مقابل ١٨٪ الشهر اللي فاته — وبيأثر على ٧٧ طالب.</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-slate-300">نسبة الغياب فوق الحد المقلق</span>
                    <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-slate-300">ارتفاع ١٦ نقطة</span>
                    <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-slate-300">٧٧ طالب متأثر</span>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-[#0D1C3D]/70 p-4">
                  <div className="text-sm font-black">تسليم الواجب نازل بشكل ملحوظ</div>
                  <p className="mt-2 text-xs leading-6 text-slate-300/90">النسبة نزلت لـ ٣٥٪ في آخر ٤ أسابيع بعد ما كانت ٨٢٪ — مراجعة نوع الواجب والتواصل مع أولياء الأمور أول خطوة.</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-bold text-slate-300">خطوة مقترحة: تذكير لأولياء الأمور</span>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-center text-[11px] font-bold text-slate-400">مرة كل أسبوع — في مكان خاص جوه حسابك، من غير إشعارات مزعجة</p>
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <SectionHead
              eyebrow="تحليل مبني على قواعد وتحقق — مش ذكاء اصطناعي عام"
              title="فريق التحليل: عينك على الصورة الكبيرة."
              sub="مش كل رقم يستاهل انتباهك. كل نمط بيمر بسلسلة تحقق: قياس ← اكتشاف ← تحقق ← اتجاه ← أثر — ومش بيوصلك غير اللي عدّى الكل."
            />
            <ul className="mt-7 space-y-3.5">
              {[
                ['ما هو «أثر مادي»؟', 'انخفاض بسيط في أسبوع واحد مش رؤية. الانخفاض المستمر اللي بيلمس جزء كبير من المجموعة — ده اللي بيوصللك.'],
                ['بسببه وأرقامه', 'كل رؤية معاها نسبة التغير وعدد الطلاب المتأثرين والفترة — تقرر بسرعة وبثقة.'],
                ['بيتعرف على التحسن', 'لما الموقف يتحسن، الرؤية بتتعلّم «بتتحسّن» وبعدين بتتحل لوحدها — من غير تكرار مزعج.'],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-nk-400/15 text-xs font-black text-nk-300 ring-1 ring-nk-300/30">✓</span>
                  <div><b className="font-black">{t}</b><p className="mt-0.5 text-sm leading-6 text-slate-300/90">{d}</p></div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── SECTION 10 — WHATSAPP ── */}
      <section id="whatsapp" className="scroll-mt-24 border-y border-white/10 bg-[#0D1C3D]/60 px-5 py-24 sm:px-8">
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
            <span className="rounded-full bg-nk-400/10 px-3 py-1.5 text-xs font-black text-nk-200">استكمال من حيث توقفت</span>
            <span className="rounded-full bg-sky-400/10 px-3 py-1.5 text-xs font-black text-sky-300">قوالب قابلة للتخصيص</span>
            <span className="text-xs text-slate-400">— وكل ده بيشتغل من موبايلك</span>
          </div>
        </div>
      </section>

      {/* ── SECTION 11 — MOBILE ── */}
      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-[.9fr_1.1fr]">
          <div>
            <SectionHead
              eyebrow="مصمم للموبايل الأول"
              title="مركزك مش بيقف لما تسيب المكتب."
              sub="وسط الحصة، في المواصلات، ولا في قعدة مع ولي أمر — الشغل كله من موبايلك: الحضور، البحث، الواجب، الامتحانات، والتقارير."
            />
            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {['حضور بلمسة واحدة', 'بحث فوري بين الطلاب', 'قائمة الإرسال من الجيب', 'بوابة الطالب على الموبايل', 'إضافة للشاشة الرئيسية (PWA)', 'يعمل مع شبكات الموبايل الضعيفة'].map((t) => (
                <li key={t} className="flex items-center gap-2.5 text-sm font-bold text-slate-200">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-nk-400/15 text-xs font-black text-nk-300 ring-1 ring-nk-300/30">✓</span> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative mx-auto w-full max-w-[340px]">
            <div className="rounded-[36px] border border-white/12 bg-white/[0.06] p-3 shadow-2xl shadow-black/40 backdrop-blur-xl">
              <Shot s={SCREENS.mobile} alt="تسجيل الحضور من الموبايل في منصة النخبة" className="w-full rounded-[26px]" priority={false} />
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 12 — HOW IT WORKS ── */}
      <section className="scroll-mt-24 border-y border-white/10 bg-[#0D1C3D]/60 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHead center eyebrow="إزاي تبدأ؟" title="٣ خطوات — ومركزك شغال." />
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {HOW.map(([n, t, d]) => (
              <div key={n} className="relative rounded-3xl border border-white/10 bg-white/[0.05] p-7">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FB9C1B] to-[#E07F00] text-lg font-black text-[#1D0E03] shadow-lg shadow-nk-500/20">{n}</div>
                <h3 className="mt-5 text-lg font-black">{t}</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300/90">{d}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center"><a href="/trial" className="text-sm font-black text-[#FBBF6D] underline decoration-nk-400/40 underline-offset-4">تفاصيل التجربة المجانية</a></div>
        </div>
      </section>

      {/* ── SECTION 13 — WHO IT'S FOR ── */}
      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <SectionHead center eyebrow="لِمين النخبة؟" title="من مجموعة صغيرة… لمركز بيدير فريق." />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AUDIENCE.map(([t, d]) => (
            <div key={t} className="rounded-3xl border border-white/10 bg-white/[0.05] p-6">
              <h3 className="font-black text-[#FBBF6D]">{t}</h3>
              <p className="mt-2 text-sm leading-7 text-slate-300/90">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center"><a href="/solutions" className="text-sm font-black text-[#FBBF6D] underline decoration-nk-400/40 underline-offset-4">شوف الحلول حسب دورك في المركز</a></div>
      </section>

      {/* ── SECTION 14 — PRICING TEASER (config-driven) ── */}
      <section id="plans" className="scroll-mt-24 border-y border-white/10 bg-[#0D1C3D]/60 px-5 py-24 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHead center eyebrow="الباقات" title="أسعار واضحة — ابدأ مجانًا وكبّر لما تشوف الفايدة." sub={`تجربة مجانية ${fmtAr(TRIAL.days)} يوم بكل المميزات ومن غير بطاقة. بعدها تختار الباقة اللي على قد شغلك — والتفعيل بيتم على واتساب.`} />
          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {PLANS.map((p) => (
              <div key={p.id} className={`lp-reveal relative flex flex-col rounded-3xl border p-7 ${p.highlighted ? 'border-nk-300/45 bg-gradient-to-b from-nk-400/[0.10] to-white/[0.03] shadow-2xl shadow-nk-500/10' : 'border-white/10 bg-white/[0.05]'}`}>
                {p.highlighted && <span className="absolute -top-3.5 right-6 rounded-full bg-gradient-to-l from-[#FB9C1B] to-[#E07F00] px-3.5 py-1.5 text-[11px] font-black text-[#1D0E03] shadow-lg shadow-nk-500/25">الأكثر اختيارًا</span>}
                <div className="text-sm font-black text-slate-400">{p.who}</div>
                <h3 className="mt-1 text-2xl font-black">{p.name}</h3>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-3xl font-black text-[#FBBF6D]">{formatPrice(p)}</span>
                </div>
                <div className="mt-2 text-sm font-black text-slate-300">{p.studentLimit}</div>
                <ul className="mt-5 flex-1 space-y-2.5">
                  {p.capabilities.slice(0, 3).map((c) => (
                    <li key={c} className="flex items-start gap-2.5 text-sm leading-6 text-slate-200">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#FB9C1B]" /> {c}
                    </li>
                  ))}
                </ul>
                <a href="/pricing" onClick={() => track('pricing_view', { source: 'landing-plan', plan: p.id })} className={`mt-7 min-h-12 w-full rounded-2xl px-5 py-3.5 text-center text-sm font-black transition hover:-translate-y-0.5 ${p.highlighted ? 'bg-gradient-to-l from-[#FB9C1B] to-[#E07F00] text-[#1D0E03] shadow-xl shadow-nk-500/25' : 'border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10'}`}>
                  تفاصيل الباقة
                </a>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-xs text-slate-400">مفيش دفع أونلاين ولا تجديد تلقائي — التفعيل بيتأكد معك شخصيًا على واتساب.</p>
        </div>
      </section>

      {/* ── SECTION 15 — FAQ (high-intent, verified answers) ── */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-5 pb-24 pt-24 sm:px-8">
        <SectionHead center eyebrow="أسئلة شائعة" title="كل ما تحتاج معرفته قبل البدء." />
        <div className="mt-10" onClick={() => {}}>
          <FaqList faqs={FAQS} source="landing" />
        </div>
      </section>

      {/* ── SECTION 16 — FINAL CTA ── */}
      <section className="px-5 pb-20 sm:px-8">
        <div className="lp-cta-band lp-reveal mx-auto max-w-7xl rounded-[30px] border border-white/10 px-6 py-16 text-center sm:px-10">
          <h2 className="text-3xl font-black sm:text-4xl">جاهز تشغّل مركزك من مكان واحد؟</h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-8 text-slate-300">
            تجربة مجانية ١٤ يوم بكامل المميزات — من غير بطاقة دفع. ولو حابب تسأل الأول، إحنا على واتساب.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a href={signup()} onClick={() => track('trial_cta_click', { source: 'final' })} className="inline-flex min-h-14 min-w-[190px] items-center justify-center rounded-2xl bg-gradient-to-l from-[#FB9C1B] to-[#E07F00] px-7 text-sm font-black text-[#1D0E03] shadow-xl shadow-nk-500/25 transition hover:-translate-y-0.5">ابدأ تجربتك المجانية</a>
            <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" onClick={() => track('whatsapp_click', { source: 'final' })} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-[#25D366]/30 bg-[#25D366]/10 px-7 text-sm font-black text-[#4be08a] transition hover:bg-[#25D366]/20">
              <span aria-hidden="true">◉</span> تواصل معنا عبر واتساب
            </a>
          </div>
        </div>
      </section>

      {/* ── SECTION 17 — FOOTER ── */}
      <footer className="border-t border-white/10 bg-[#09142E] px-5 py-12 sm:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-3">
              <img src="/nokhba-mark.svg" alt="شعار النخبة" className="h-9 w-9 rounded-xl" />
              <span className="font-black">النخبة</span>
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-400">منصة عربية لإدارة مراكز التعليم: الطلاب والحصص والحضور والامتحانات والتقارير والتحليل — من مكان واحد.</p>
          </div>
          {[
            ['المنتج', [['المميزات', '/features'], ['الأسعار', '/pricing'], ['الحلول', '/solutions'], ['المصادر', '/resources']]],
            ['الشركة', [['من نحن', '/about'], ['تواصل معنا', '/contact'], ['التجربة المجانية', '/trial']]],
            ['قانوني', [['سياسة الخصوصية', '/privacy'], ['تسجيل الدخول', '/?auth=login'], ['إنشاء حساب', '/?auth=signup']]],
          ].map(([title, links]) => (
            <nav key={title} aria-label={title}>
              <h3 className="text-sm font-black text-slate-200">{title}</h3>
              <ul className="mt-4 space-y-2.5 text-sm text-slate-400">
                {links.map(([label, href]) => (
                  <li key={href + label}>
                    {href.startsWith('/?') ? (
                      <button className="transition hover:text-white" onClick={href === '/?auth=login' ? onLogin : onSignup}>{label}</button>
                    ) : (
                      <a className="transition hover:text-white" href={href}>{label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mx-auto mt-10 max-w-7xl border-t border-white/10 pt-6 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} النخبة — كل الحقوق محفوظة.
        </div>
      </footer>

      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noreferrer"
        onClick={() => track('whatsapp_click', { source: 'floating' })}
        aria-label="التواصل عبر WhatsApp على رقم 01014996636"
        className="fixed bottom-5 left-5 z-50 inline-flex min-h-12 items-center gap-2 rounded-2xl bg-[#25D366] px-4 text-sm font-black text-[#06231a] shadow-xl shadow-emerald-900/30 transition hover:-translate-y-0.5 hover:bg-[#20bd5a]"
      >
        <span aria-hidden="true" className="text-lg leading-none">◉</span>
        <span className="hidden sm:inline">واتساب</span>
      </a>
    </main>
  )
}
