// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC SOLUTIONS / ABOUT / CONTACT / TRIAL pages — honest, verified claims.
// ═══════════════════════════════════════════════════════════════════════════
import MarketingLayout, { SectionHead, Shot, TrialCta, WaCta, CtaBand } from '../MarketingLayout.jsx'
import { useSeo, breadcrumbSchema } from '../seo.js'
import { SCREENS, track, WHATSAPP_URL } from '../config.js'
import { TRIAL, fmtAr } from '../pricing.js'
import { WA_NUMBER } from '../config.js'

// ── SOLUTIONS — who is Alnokhba for (Phase 13) ────────────────────────────
const PERSONAS = [
  { icon: '◈', title: 'السنتر الصغير', text: 'بدأت بمجموعتين ودفتر حضور؟ انتقل لنظام مرتب من أول يوم — حضور وواجبات وتقارير أولياء أمور بدون أي تعقيد، وتكلفة على قد شغلك.' },
  { icon: '↗', title: 'المركز اللي بيكبر', text: 'عدد الطلاب زاد والشغلة بقت مشكلة؟ مركزّ كل حاجة في مكان واحد قبل ما الكبر يتحول لفوضى: مسار حصة واضح وتحليل أسبوعي يوصلك اللي مهم بس.' },
  { icon: '⌂', title: 'مدير المركز الأكاديمي', text: 'تابع أداء كل المجموعات من مكان واحد: الحضور، الواجبات، الامتحانات، والملاحظات — واعرف مين محتاج تدخل قبل ما المشكلة تكبر.' },
  { icon: '◉', title: 'صاحب المركز', text: 'اعرف اللي بيحصل بدون ما تلاحق الفريق: بيانات محدثة لحظيًا، تقارير جاهزة، وملخص أسبوعي بيقولك الوضع عامل إزاي.' },
  { icon: '✎', title: 'المدرّس', text: 'شغلك اليومي كله في مساحة حصة واحدة: حضور بلمسة، واجب بثلاث حالات، درجات بأقسام، وتقرير بيتبني لوحده — من موبايلك.' },
  { icon: '⌘', title: 'الفرق والمساعدون', text: 'ديلي مساعدين عليك بصلاحيات محددة: كل واحد يشوف اللي يخصه، وبيانات كل حساب مفصولة عن التاني على مستوى السيرفر.' },
]

// Exported for the build-time prerender (scripts/prerender.mjs).
export const SEO_SOLUTIONS = {
  title: 'الحلول — لإدارة مراكز ودروس وأكاديميات | النخبة',
  description: 'حلول النخبة حسب دورك: صاحب مركز، مدير أكاديمي، مدرّس، أو فريق عمل — نظام واحد لإدارة الطلاب والحصص والحضور والتقارير.',
  path: '/solutions',
  image: SCREENS.session,
  jsonLd: breadcrumbSchema([{ name: 'الرئيسية', path: '/' }, { name: 'الحلول', path: '/solutions' }]),
}

export function SolutionsPage() {
  useSeo(SEO_SOLUTIONS)
  return (
    <MarketingLayout active="/solutions">
      <section className="mx-auto max-w-7xl px-5 pb-10 pt-14 sm:px-8">
        <span className="lp-eyebrow">لِمين المنصة؟</span>
        <h1 className="mt-5 max-w-3xl text-4xl font-black leading-[1.2] tracking-tight sm:text-5xl">
          مصممة من داخل شغل المراكز — لكل دور في المركز.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300">
          سواء إنت بتدير مركز كامل أو بتدرّس مجموعة وحدة، النخبة بتظبط مسار الشغل اليومي على مقاسك.
        </p>
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-16 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PERSONAS.map((p) => (
            <article key={p.title} className="lp-glow-card rounded-3xl border border-white/10 bg-white/[0.05] p-7">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FB9C1B]/25 to-[#FB9C1B]/5 text-xl font-black text-[#FBBF6D] ring-1 ring-nk-300/30">{p.icon}</div>
              <h2 className="mt-5 text-lg font-black">{p.title}</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300/90">{p.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="border-y border-white/10 bg-[#0D1C3D]/60 px-5 py-16 sm:px-8">
        <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-2">
          <SectionHead
            eyebrow="مثال حي"
            title="يوم كامل في المركز — من أول لمسة لحد تقرير ولي الأمر."
            sub="افتح الحصة، سجّل الحضور، سجّل الواجب والدرجات، وابعط التقرير — كل ده من نفس الشاشة وبعدّ خطوات قليلة."
          />
          <Shot screen={SCREENS.session} alt="مسار الحصة اليومي في منصة النخبة" className="w-full" priority />
        </div>
      </section>
      <CtaBand title="شوف المنصة على شغل مركزك أنت." sub="تجربة مجانية ١٤ يوم على بياناتك الحقيقية — من غير بطاقة." />
    </MarketingLayout>
  )
}

// ── ABOUT ─────────────────────────────────────────────────────────────────
// Exported for the build-time prerender (scripts/prerender.mjs).
export const SEO_ABOUT = {
  title: 'من نحن — قصة النخبة ومبادئ البناء | النخبة',
  description: 'النخبة منصة عربية لإدارة مراكز التعليم اتبنت من داخل الشغل اليومي للمدرسين: البساطة، السرعة، حماية البيانات، والصدق في كل رقم.',
  path: '/about',
  image: SCREENS.students,
  jsonLd: breadcrumbSchema([{ name: 'الرئيسية', path: '/' }, { name: 'من نحن', path: '/about' }]),
}

export function AboutPage() {
  useSeo(SEO_ABOUT)
  return (
    <MarketingLayout active="/about">
      <section className="mx-auto max-w-3xl px-5 pb-12 pt-14 sm:px-8">
        <span className="lp-eyebrow">من نحن</span>
        <h1 className="mt-5 text-4xl font-black leading-[1.2] tracking-tight sm:text-5xl">
          بنينا النخبة عشان شغل المدرس يستاهل أدوات أحسن.
        </h1>
        <p className="mt-6 leading-8 text-slate-300">
          المنصة اتبنت من ملاحظة بسيطة: المدرّس في مركز التعليم بيقضي يومه بين دفتر حضور، وملفات Excel،
          ورسايل واتساب متفرقة، وتقارير بتتجمع إيدويًا آخر الشهر. كل أداة شغالة لوحدها — ومفيش حد شايل الصورة الكاملة.
        </p>
        <p className="mt-4 leading-8 text-slate-300">
          فبنينا نظام واحد بيقلد مسار الشغل الحقيقي: حصة بتفتح، حضور بيتسجل، واجب بيتابع، امتحان بيدخل،
          وتقرير بيخرج بلغة يفهمها ولي الأمر. من غير تدريب معقد، ومن غير ما المدرّس يغيّر طريقة شغله.
        </p>
      </section>
      <section className="mx-auto max-w-3xl px-5 pb-16 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            ['البساطة أولاً', 'كل ميزة لازم تختصر خطوات — لو زودت خطوة، بتتشال.'],
            ['الصدق في الأرقام', 'مفيش رؤى بلا سبب واضح: كل استنتاج معاه أرقامه القابلة للتتبع.'],
            ['حماية البيانات', 'كل حساب مفصول صراحةً على مستوى صفوف قاعدة البيانات — مش بس في الواجهة.'],
            ['الموبايل مواطن أول', 'المدرّس شغال من الهاتف وسط الحصة — فالتصميم بيبدأ من الشاشة الصغيرة.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-white/10 bg-white/[0.05] p-6">
              <h2 className="font-black text-[#FBBF6D]">{t}</h2>
              <p className="mt-2 text-sm leading-7 text-slate-300/90">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-2xl border border-white/10 bg-[#0D1C3D]/70 p-6 text-sm leading-7 text-slate-300">
          <b className="font-black text-slate-100">بياناتك ملكك:</b> كل بيانات المركز — الطلاب، الحضور، الدرجات،
          التقارير — محفوظة في بنية تحتية محمية بصلاحيات صارمة على مستوى الصف (RLS)، ومحدش غيرك يقدر يوصلها
          حتى لو عرف روابط النظام.
        </div>
      </section>
      <CtaBand title="جرّب المنصة وشوف الفرق بنفسك." sub="١٤ يوم تجربة مجانية على بياناتك الحقيقية." />
    </MarketingLayout>
  )
}

// ── CONTACT ───────────────────────────────────────────────────────────────
// Exported for the build-time prerender (scripts/prerender.mjs).
export const SEO_CONTACT = {
  title: 'تواصل معنا — دعم ومبيعات على واتساب | النخبة',
  description: 'تواصل مع فريق النخبة عبر واتساب: أسئلة عن المنصة، طلب تفعيل أو تجديد، مساعدة في الإعداد، أو اقتراحات — برد سريع في نفس اليوم.',
  path: '/contact',
  image: SCREENS.dashboard,
  jsonLd: breadcrumbSchema([{ name: 'الرئيسية', path: '/' }, { name: 'تواصل', path: '/contact' }]),
}

export function ContactPage() {
  useSeo(SEO_CONTACT)
  const demoLink = () => track('demo_click', { source: 'contact' })
  return (
    <MarketingLayout active="/contact">
      <section className="mx-auto max-w-3xl px-5 pb-12 pt-14 sm:px-8">
        <span className="lp-eyebrow">تواصل</span>
        <h1 className="mt-5 text-4xl font-black leading-[1.2] tracking-tight sm:text-5xl">إحنا على واتساب — قريبين منك.</h1>
        <p className="mt-6 leading-8 text-slate-300">
          أسرع طريقة توصلنا هي واتساب على الرقم <b dir="ltr" className="font-black text-[#FBBF6D]">+{WA_NUMBER.slice(0, 2)} {WA_NUMBER.slice(2)}</b>.
          اكتبلنا اسمك واسم مركزك وسؤالك، وهنرد عليك.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <WaCta big source="contact-hero" label="افتح واتساب دلوقتي" />
          <TrialCta big source="contact-hero" />
        </div>
      </section>
      <section className="mx-auto max-w-3xl px-5 pb-20 sm:px-8">
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-7 sm:p-9">
          <h2 className="text-xl font-black">عشان نقدر نساعدك بسرعة، ابعتلنا:</h2>
          <ul className="mt-4 space-y-3 text-sm leading-7 text-slate-300">
            {['اسمك واسم المركز أو الأكاديمية', 'عدد الطلاب النشطين تقريبًا', 'إيه أكبر تحدي عندك دلوقتي (حضور؟ تقارير؟ متابعة؟)', 'لو عندك سؤال أسعار: عدد اللي بيشتغلوا معاك'].map((t) => (
              <li key={t} className="flex items-start gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#FB9C1B]" aria-hidden="true" /> {t}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm leading-7 text-slate-400">
            بتحب تشوف المنصة بنفسك قبل ما تسأل؟ جرّب{' '}
            <a href="/?auth=signup" onClick={demoLink} className="font-black text-[#FBBF6D] underline decoration-nk-400/40 underline-offset-4">التجربة المجانية</a>{' '}
            — أو شوف صفحة <a href="/features" className="font-black text-[#FBBF6D] underline decoration-nk-400/40 underline-offset-4">المميزات</a>.
          </p>
        </div>
      </section>
    </MarketingLayout>
  )
}

// ── TRIAL ─────────────────────────────────────────────────────────────────
// Exported for the build-time prerender (scripts/prerender.mjs).
export const SEO_TRIAL = {
  title: `تجربة مجانية ${fmtAr(TRIAL.days)} يوم — بدون بطاقة دفع | النخبة`,
  description: `افتح حسابك وجرّب كل مميزات النخبة ${fmtAr(TRIAL.days)} يوم مجانًا: من غير بطاقة، من غير تجديد تلقائي، والحساب بعد التجربة بيتوقف مش بيتشال — وبيانات مركزك تفضل محفوظة.`,
  path: '/trial',
  image: SCREENS.mobile,
  jsonLd: breadcrumbSchema([{ name: 'الرئيسية', path: '/' }, { name: 'التجربة المجانية', path: '/trial' }]),
}

export function TrialPage() {
  useSeo(SEO_TRIAL)
  return (
    <MarketingLayout active="/trial">
      <section className="mx-auto max-w-3xl px-5 pb-12 pt-14 sm:px-8">
        <span className="lp-eyebrow">التجربة المجانية</span>
        <h1 className="mt-5 text-4xl font-black leading-[1.2] tracking-tight sm:text-5xl">
          {fmtAr(TRIAL.days)} يوم بكل المميزات — من غير بطاقة دفع.
        </h1>
        <p className="mt-6 leading-8 text-slate-300">
          سجّل باسمك واسم مركزك وابدأ إعداد مجموعاتك فورًا. جرّب مسار الحصة كامل: الحضور، التفاعل، الواجب،
          الامتحانات، والتقارير — على بيانات مركزك الحقيقية.
        </p>
        <div className="mt-8"><TrialCta big source="trial-hero" /><span className="mx-3 text-slate-500">أو</span><WaCta big source="trial-hero" label="محتاج مساعدة في الإعداد؟" /></div>
      </section>
      <section className="mx-auto max-w-3xl px-5 pb-16 sm:px-8">
        <ol className="space-y-4">
          {[
            ['افتح حسابك', 'الاسم والإيميل وكلمة مرور — خلص. من غير بطاقة دفع ومن غير أي التزام.', 'signup' ],
            ['جهّز مركزك', 'أنشئ مجموعاتك وضيف طلابك (تقدر تضيفهم دفعة واحدة)، واضبط جدول الأسبوع.', 'setup'],
            ['شغّل مركزك', 'افتح حصة اليوم وسجّل الحضور والتقارير — وشوف تقرير فريق التحليل أول أسبوع.', 'run'],
          ].map(([t, d, k], i) => (
            <li key={k} className="relative rounded-2xl border border-white/10 bg-white/[0.05] p-5 pr-16">
              <span className="absolute right-4 top-5 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#FB9C1B] to-[#E07F00] font-black text-[#1D0E03]">{i + 1}</span>
              <h2 className="font-black">{t}</h2>
              <p className="mt-1 text-sm leading-7 text-slate-300/90">{d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {[
            ['مفيش بطاقة دفع', 'إنشاء الحساب بيحتاج بياناتك الأساسية بس — مفيش أي وسيلة دفع مرتبطة.'],
            ['مفيش تجديد تلقائي', 'التجربة بتنتهي وتسيبك حر — مفيش خصم صامت ولا التزام.'],
            ['بعد التجربة: توقف مش حذف', `لما التجربة تخلص، الحساب بيتوقف مؤقتًا — مش حذف مباشر. بياناتك تفضل محفوظة ${fmtAr(TRIAL.retentionDays)} يوم، والتجديد بيرجّع كل حاجة زي ما هي.`],
            ['مساعدة في الإعداد', 'عطّال؟ واتساب مفتوح — بنساعدك تجهز مركزك خطوة بخطوة.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-white/10 bg-white/[0.05] p-5">
              <h3 className="font-black text-[#FBBF6D]">{t}</h3>
              <p className="mt-1.5 text-sm leading-7 text-slate-300/90">{d}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm leading-7 text-slate-400">
          بعد التجربة: تختار باقتك (تبدأ من ٣٩٩ جنيه/شهر) وتتفق على التفاصيل على{' '}
          <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="font-black text-[#FBBF6D] underline decoration-nk-400/40 underline-offset-4">واتساب</a> —
          والتفعيل بيتم فور تأكيد الدفع. الشرح الكامل في صفحة{' '}
          <a href="/pricing" className="font-black text-[#FBBF6D] underline decoration-nk-400/40 underline-offset-4">الأسعار</a>.
        </p>
      </section>
    </MarketingLayout>
  )
}
