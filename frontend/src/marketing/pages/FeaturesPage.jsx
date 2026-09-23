// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC FEATURES PAGE — categories, not a wall of cards. Every capability
// listed here exists in the product today (no payments management claim).
// ═══════════════════════════════════════════════════════════════════════════
import MarketingLayout, { Shot, TrialCta, WaCta, CtaBand } from '../MarketingLayout.jsx'
import { useSeo, breadcrumbSchema } from '../seo.js'
import { SCREENS, track } from '../config.js'

const CATEGORIES = [
  {
    title: 'إدارة الطلاب',
    value: 'ملف كامل لكل طالب: بياناته، مجموعته، نقاطه، إنذاراته، وسجل حضوره وواجباته — وترتيب يدوي جوه كل مجموعة.',
    shot: SCREENS.students,
    alt: 'قائمة الطلاب في منصة النخبة مع البحث والتصفية وأزرار QR وترقية الحالة',
    points: ['بحث فوري بالاسم أو الكود أو الهاتف', 'إضافة مجموعة طلاب دفعة واحدة من شاشة الحضور', 'نقاط ورتب تحفّز الطالب', 'ترحيل سريع بين المجموعات مع سجل كامل'],
  },
  {
    title: 'مسار الحصة',
    value: 'كل شغل الحصة في مساحة واحدة بدون تنقل بين شاشات: حضور، تفاعل، واجب، امتحان، تقرير — والحفظ التلقائي معاك في كل خطوة.',
    shot: SCREENS.session,
    alt: 'مساحة الحصة في منصة النخبة: تبويبات الحضور والتفاعل والواجب والامتحانات والتقرير',
    points: ['حصص اليوم قدامك من أول شاشة', 'الحصة تفضل مفتوحة وقابلة للاستكمال — الحفظ مش الإنهاء', 'موضوع الدرس والواجب بيتسجلوا مع كل حصة', 'إنهاء الحصة بيقفل المسار ويثبت البيانات'],
  },
  {
    title: 'الحضور والغياب',
    value: 'قائمة سريعة بالبحث: علامة حاضر أو غائب بلمسة واحدة، أو امسح QR الطالب — والأسبوع بيتلخص تلقائي من الجمعة للخميس.',
    points: ['حضور مجموعة كاملة في ثوانٍ', 'قراءة QR الطالب لتسجيل الحضور', 'قاعدة أسبوع واحد للكل: الجمعة ← الخميس', 'حدود إنذار غياب قابلة للضبط مع تنبيهات'],
  },
  {
    title: 'الواجبات',
    value: 'متابعة الواجب بثلاث حالات واضحة (مكتمل، ناقص، لم يتم) جوه نفس مسار الحصة — تاريخ كل طالب محفوظ أسبوع بأسبوع.',
    points: ['حالة واجب لكل طالب في كل حصة', 'إشعار ولي الأمر بالواجب غير المنجز', 'مؤشرات تسليم تظهر في التحليل الأسبوعي'],
  },
  {
    title: 'الامتحانات والدرجات',
    value: 'أنشئ امتحان بأقسام ودرجة لكل قسم، اربطه بحصته، وسجّل الدرجات — والنتيجة توصل للطالب بشرح يفهمه ولي الأمر.',
    points: ['امتحان بأقسام متعددة ودرجة قصوى لكل قسم', 'ربط الامتحان بالحصة — بيقيس الجزء المُختبر', 'تعديل الدرجات بعد التسجيل مع سجل', 'نتيجة مكتوبة بلغة واضحة مش رقم جاف'],
  },
  {
    title: 'التقارير',
    value: 'تقارير جاهزة لكل طالب ولأولياء الأمور بتتبني تلقائيًا من بيانات الحضور والواجب والنتائج — بدون كتابة يدوية.',
    shot: SCREENS.reports,
    alt: 'شاشة التقارير في منصة النخبة مع قوالب وتصفية حسب المجموعة',
    points: ['قوالب رسايل قابلة للتخصيص', 'تقرير الحصة والأسبوع والغياب', 'نسخ احتياطي دوري لبيانات المركز', 'حماية من الإرسال المكرر'],
  },
  {
    title: 'التواصل عبر واتساب',
    value: 'قائمة إرسال منظمة: كل طالب برسالته الصح، مراجعة قبل الإرسال، واستكمال من حيث توقفت حتى لو الموبايل نقلّك لواتساب.',
    points: ['توليد الرسالة تلقائيًا من بيانات الطالب', 'مراجعة واستبعاد وتعديل قبل الإرسال', 'طابور محصّن يكمل بعد أي مقاطعة', 'تنبيه لو الرسالة اتبعتت قبل كده'],
  },
  {
    title: 'فريق التحليل',
    value: 'مراجعة أسبوعية لكل مجموعة: مفيش أرقام بلا معنى — كل رؤية معاها التحقق والاتجاه وعدد المتأثرين وخطوة مقترحة.',
    shot: SCREENS.insights,
    alt: 'تقرير فريق التحليل الأسبوعي في منصة النخبة مع مؤشرات الحضور والواجبات والامتحانات',
    points: ['مؤشرات حضور وواجب وامتحان باتجاهاتها', 'رؤى بس لما يكون فيه أثر مادي حقيقي', 'أسباب صريحة قابلة للتتبع', 'دورة حياة: جديد ← يتفاقم ← يتحسّن ← محلول'],
  },
  {
    title: 'بوابة الطالب وولي الأمر',
    value: 'رابط QR واحد يفتح صفحة واضحة للطالب أو ولي الأمر: حضوره، واجبه، نتايجه، والإشعارات — من غير لوحة ولا كلمة سر.',
    points: ['رابط دائم يشتغل مع الـ QR الحالي', 'صفحة عربية بسيطة مناسبة للموبايل', 'إشعارات وإعلانات توصل في مكانها'],
  },
  {
    title: 'الفريق والصلاحيات',
    value: 'نظام فريق عمل كامل: مساعدون بصلاحيات محددة، وفصل نهائي لبيانات كل حساب على مستوى السيرفر.',
    points: ['حسابات مساعدة مرتبطة بمدرس رئيسي', 'صلاحيات محددة لكل دور', 'عزل بيانات صارم (RLS) على مستوى الصف', 'سجل عمليات للمتابعة'],
  },
]

// Exported for the build-time prerender (scripts/prerender.mjs).
export const SEO = {
  title: 'المميزات — نظام إدارة مركز تعليمي متكامل | النخبة',
  description: 'إدارة الطلاب والمجموعات، مسار الحصة، الحضور والغياب، الواجبات، الامتحانات، تقارير واتساب لأولياء الأمور، فريق التحليل، وبوابة طالب QR — كلها في منصة عربية واحدة.',
  path: '/features',
  image: SCREENS.dashboard,
  jsonLd: breadcrumbSchema([{ name: 'الرئيسية', path: '/' }, { name: 'المميزات', path: '/features' }]),
}

export default function FeaturesPage() {
  useSeo(SEO)
  return (
    <MarketingLayout active="/features">
      <section className="mx-auto max-w-7xl px-5 pb-8 pt-14 sm:px-8">
        <span className="lp-eyebrow">مميزات المنصة</span>
        <h1 className="mt-5 max-w-3xl text-4xl font-black leading-[1.2] tracking-tight sm:text-5xl">
          كل أدوات المركز — مظبوطة لشغل المدرس الحقيقي.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300">
          مش مجرد شاشات — ده مسار شغل يومي متكامل: من تسجيل الحضور لحد ما ولي الأمر يستلم التقرير ويفهمه.
          كل ميزة هنا شغالة فعلًا في المنصة النهاردة.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <TrialCta big source="features-top" />
          <WaCta big source="features-top" />
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-5 pb-20 sm:px-8">
        {CATEGORIES.map((c, i) => (
          <article
            key={c.title}
            onMouseEnter={() => track('feature_view', { feature: c.title })}
            className={`grid items-center gap-8 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 sm:p-9 lg:grid-cols-2 ${i % 2 ? '' : ''}`}
          >
            <div className={i % 2 ? 'lg:order-2' : ''}>
              <h2 className="text-2xl font-black">{c.title}</h2>
              <p className="mt-3 leading-8 text-slate-300/90">{c.value}</p>
              <ul className="mt-5 space-y-2.5">
                {c.points.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm leading-7 text-slate-200">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#FB9C1B]" aria-hidden="true" /> {p}
                  </li>
                ))}
              </ul>
            </div>
            {c.shot ? (
              <Shot screen={c.shot} alt={c.alt} className="w-full" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
                {c.points.slice(0, 4).map((p, j) => (
                  <div key={p} className={`rounded-2xl border border-white/10 bg-[#0D1C3D]/70 p-4 text-xs font-bold leading-6 text-slate-300 ${j === 0 ? 'sm:col-span-2' : ''}`}>
                    {p}
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>

      <CtaBand
        title="جرّب المنصة على بيانات مركزك الحقيقية."
        sub="تجربة مجانية ١٤ يوم — من غير بطاقة وبلا التزام. ولو محتاج مساعدة في الإعداد، إحنا على واتساب."
      />
    </MarketingLayout>
  )
}
