// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC PRICING PAGE — reads ONLY from ../pricing.js (single source of truth).
// Honest model: 14-day full trial, no card, WhatsApp-based activation/renewal.
// After the trial: account PAUSED (not deleted) + 30-day data retention.
// ═══════════════════════════════════════════════════════════════════════════
import { useState } from 'react'
import MarketingLayout, { SectionHead, TrialCta, WaCta, FaqList } from '../MarketingLayout.jsx'
import { useSeo, faqSchema, breadcrumbSchema } from '../seo.js'
import { PLANS, TRIAL, PRICING_NOTE, recommendPlan, formatPrice, fmtAr } from '../pricing.js'
import { track, WHATSAPP_URL, SCREENS } from '../config.js'

const PRICE_FAQS = [
  ['إزاي بتحسبوا السعر؟', 'السعر باين جوّه كل باقة فوق: اشتراك شهري بالجنيه المصري بيتبع حجم مركزك — عدد الطلاب النشطين وعدد الفروع. السعر بيتأكد معك شخصيًا على واتساب قبل أي دفع، ومفيش تجديد تلقائي.'],
  ['هل في تجربة مجانية؟', `أيوه — تجربة مجانية ${fmtAr(TRIAL.days)} يوم بكامل المميزات الأساسية (طلاب، حصص، حضور، واجبات، امتحانات، مصروفات، تقارير، تحليلات)، من غير بطاقة دفع ومن غير تجديد تلقائي. تعرف جرب المنصة على بيانات مركزك الحقيقية قبل أي قرار.`],
  ['هل محتاج بطاقة دفع؟', 'لا. إنشاء الحساب بيحتاج الاسم ورقم الواتساب والإيميل وكلمة مرور بس، ومفيش أي وسيلة دفع مرتبطة بالحساب. التفعيل والتجديد بيتم بعد تأكيدك على واتساب.'],
  ['إيه اللي بيحصل بعد انتهاء التجربة؟', `الحساب بيتوقف مؤقتًا — مش حذف مباشر. بياناتك بتفضل محفوظة ${fmtAr(TRIAL.retentionDays)} يوم، ولو قررت تكمل بتفعّل الباقة على واتساب وكل حاجة ترجع زي ما هي. لو عدّت المدة من غير تجديد، البيانات بتتأرشف وتتشال حسب السياسة — فقرار الرجعة بيفضل مفتوح طوال المدة.`],
  ['أقدر أغيّر الباقة بعدين؟', 'أيوه — تقدر ترفع أو تنزّل باقتك في أي وقت حسب حجم مركزك، والتعديل بيتم على واتساب مباشرة.'],
  ['في خصم للدفع السنوي؟', 'لو تحب تدفع سنوي، كلمنا على واتساب وهن اتفق معاك على الشرط المناسب لحجم مركزك — من غير أي التزام لحد ما تتأكد بنفسك.'],
]

function PlanCard({ plan }) {
  const recommend = () => {
    track('pricing_plan_selected', { plan: plan.id })
    if (plan.cta.kind === 'whatsapp') window.open(WHATSAPP_URL, '_blank', 'noopener')
    else window.location.assign('/?auth=signup')
  }
  return (
    <div className={`relative flex flex-col rounded-3xl border p-8 ${plan.highlighted ? 'border-nk-300/45 bg-gradient-to-b from-nk-400/[0.10] to-white/[0.03] shadow-2xl shadow-nk-500/10' : 'border-white/10 bg-white/[0.05]'}`}>
      {plan.highlighted && (
        <span className="absolute -top-3.5 right-6 rounded-full bg-gradient-to-l from-[#FB9C1B] to-[#E07F00] px-3.5 py-1.5 text-[11px] font-black text-[#1D0E03] shadow-lg shadow-nk-500/25">
          الأكثر اختيارًا
        </span>
      )}
      <h2 className="text-2xl font-black">{plan.name}</h2>
      <p className="mt-1.5 text-sm leading-6 text-slate-400">{plan.who}</p>
      <div className="mt-5 rounded-2xl border border-white/10 bg-[#0D1C3D]/60 px-4 py-3.5">
        <div className="text-2xl font-black text-[#FBBF6D]">{formatPrice(plan)}</div>
        <div className="mt-1 text-xs leading-5 text-slate-400">{plan.monthlyPrice == null ? 'بيتفق عليه حسب حجم شغلك — كلمنا على واتساب.' : 'بيتأكد وبيتفعل معك على واتساب قبل أي دفع — مفيش دفع أونلاين.'}</div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-white/5 px-3 py-2.5"><dt className="font-bold text-slate-400">الطلاب النشطون</dt><dd className="mt-0.5 font-black">{plan.studentLimit}</dd></div>
        <div className="rounded-xl bg-white/5 px-3 py-2.5"><dt className="font-bold text-slate-400">الفروع</dt><dd className="mt-0.5 font-black">{plan.branchLimit}</dd></div>
      </dl>
      <ul className="mt-6 flex-1 space-y-3">
        {plan.capabilities.map((c) => (
          <li key={c} className="flex items-start gap-2.5 text-sm leading-6 text-slate-200">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#FB9C1B]" aria-hidden="true" /> {c}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={recommend}
        className={`mt-8 min-h-13 w-full rounded-2xl px-5 py-3.5 text-sm font-black transition hover:-translate-y-0.5 ${plan.highlighted ? 'bg-gradient-to-l from-[#FB9C1B] to-[#E07F00] text-[#1D0E03] shadow-xl shadow-nk-500/25' : 'border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10'}`}
      >
        {plan.cta.label}
      </button>
    </div>
  )
}

function Recommender() {
  const [students, setStudents] = useState('')
  const rec = recommendPlan({ students: students ? Number(students) : null })
  const plan = PLANS.find((p) => p.id === rec)
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-7 sm:p-9">
      <h2 className="text-2xl font-black">أنهي باقة تناسبك؟</h2>
      <p className="mt-2 text-sm leading-7 text-slate-400">اكتب عدد الطلاب النشطين تقريبًا — وهنقولك الباقة المناسبة فورًا.</p>
      <div className="mt-6 max-w-md">
        <label className="block">
          <span className="text-sm font-black text-slate-300">عدد الطلاب النشطين تقريبًا</span>
          <input
            type="number" min="1" inputMode="numeric" value={students}
            onChange={(e) => setStudents(e.target.value)}
            placeholder="مثال: 120"
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#0D1C3D]/70 px-4 py-3 text-sm font-bold text-white outline-none focus:border-[#FB9C1B]"
          />
        </label>
      </div>
      {plan && (
        <div className="mt-6 rounded-2xl border border-nk-300/30 bg-nk-400/[0.08] p-5">
          <p className="text-sm leading-7 text-slate-200">
            بناءً على إجابتك: باقة <b className="font-black text-[#FBBF6D]">{plan.name}</b> هي الأنسب لبدايتك —
            وتقدر تغيّرها في أي وقت لما مركزك يكبر.
          </p>
          <button onClick={() => { track('pricing_plan_selected', { plan: plan.id, source: 'recommender' }); window.location.assign(plan.cta.kind === 'whatsapp' ? WHATSAPP_URL : '/?auth=signup') }} className="mt-4 min-h-11 rounded-xl bg-gradient-to-l from-[#FB9C1B] to-[#E07F00] px-5 text-sm font-black text-[#1D0E03]">
            {plan.cta.label}
          </button>
        </div>
      )}
    </div>
  )
}

// Exported for the build-time prerender (scripts/prerender.mjs).
export const SEO = {
  title: 'الأسعار — باقات نظام إدارة المركز التعليمي | النخبة',
  description: 'باقات واضحة بالجنيه المصري: Starter ٣٩٩ وGrowth ٧٩٩ وPro ١٬٤٩٩ جنيه شهريًا حسب عدد الطلاب، وتجربة مجانية ١٤ يوم بدون بطاقة — تفعيل وإلغاء بدون التزام وعلى واتساب.',
  path: '/pricing',
  image: SCREENS.reports,
  jsonLd: [faqSchema(PRICE_FAQS), breadcrumbSchema([{ name: 'الرئيسية', path: '/' }, { name: 'الأسعار', path: '/pricing' }])],
}

export default function PricingPage() {
  useSeo(SEO)
  return (
    <MarketingLayout active="/pricing">
      <section className="mx-auto max-w-7xl px-5 pb-10 pt-14 sm:px-8">
        <span className="lp-eyebrow">الأسعار</span>
        <h1 className="mt-5 max-w-3xl text-4xl font-black leading-[1.2] tracking-tight sm:text-5xl">
          ابدأ مجانًا — وادفع بس لما تشوف الفايدة.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300">
          أسعار واضحة بالجنيه المصري على قد حجم مركزك — وتبدأ بتجربة مجانية {fmtAr(TRIAL.days)} يوم بكامل المميزات وبلا بطاقة دفع.
          التفعيل بيتم على واتساب مباشرة من غير تجديد تلقائي ولا مفاجآت.
        </p>
      </section>

      <section className="mx-auto max-w-7xl px-5 sm:px-8" aria-label="الباقات">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((p) => <PlanCard key={p.id} plan={p} />)}
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">{PRICING_NOTE}</p>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <Recommender />
      </section>

      <section className="mx-auto max-w-3xl px-5 pb-16 sm:px-8">
        <SectionHead center eyebrow="أسئلة الأسعار" title="كل اللي محتاج تعرفه قبل ما تبدأ." />
        <div className="mt-10"><FaqList faqs={PRICE_FAQS} source="pricing" /></div>
      </section>

      <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8">
        <div className="grid gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-7 sm:grid-cols-3 sm:p-9">
          {[
            ['من غير بطاقة', 'التجربة المجانية مش محتاجة أي وسيلة دفع — حسابك بيفتح بإيميل وكلمة مرور.'],
            ['من غير تجديد تلقائي', 'مفيش خصم تلقائي ولا التزام صامت: أي دفع بيتم بعد ما تتأكد بنفسك على واتساب.'],
            ['الحساب بيتوقف — مش بيتشال', `لو انتهت التجربة وملّكشت، حسابك بيتوقف مؤقتًا وبياناتك تفضل محفوظة ${fmtAr(TRIAL.retentionDays)} يوم — الرجعة بترجّع كل حاجة زي ما هي.`],
          ].map(([t, d]) => (
            <div key={t}>
              <h3 className="font-black text-[#FBBF6D]">{t}</h3>
              <p className="mt-2 text-sm leading-7 text-slate-300/90">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <TrialCta big source="pricing-bottom" />
          <WaCta big source="pricing-bottom" />
        </div>
      </section>
    </MarketingLayout>
  )
}
