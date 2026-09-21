// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC PRICING PAGE — reads ONLY from ../pricing.js (single source of truth).
// Honest model: 7-day free trial, no card, WhatsApp-based activation/renewal.
// ═══════════════════════════════════════════════════════════════════════════
import { useState } from 'react'
import MarketingLayout, { SectionHead, TrialCta, WaCta, FaqList } from '../MarketingLayout.jsx'
import { useSeo, faqSchema, breadcrumbSchema } from '../seo.js'
import { PLANS, TRIAL, PRICING_NOTE, recommendPlan } from '../pricing.js'
import { track, WHATSAPP_URL } from '../config.js'

const PRICE_FAQS = [
  ['إزاي بتحسبوا السعر؟', PRICING_NOTE],
  ['هل في تجربة مجانية؟', `أيوه — تجربة مجانية ${TRIAL.days} أيام بكامل المميزات، من غير بطاقة دفع ومن غير تجديد تلقائي. تعرف جرب المنصة على بيانات مركزك الحقيقية قبل أي قرار.`],
  ['هل محتاج بطاقة دفع؟', 'لا. إنشاء الحساب بيحتاج الاسم والإيميل وكلمة مرور بس، ومفيش أي وسيلة دفع مرتبطة بالحساب. التفعيل والتجديد بيتم بعد تأكيدك على واتساب.'],
  ['إيه اللي بيحصل بعد انتهاء التجربة؟', 'بياناتك بتفضل محفوظة زي ما هي. لو قررت تكمل، بتتواصل معنا على واتساب وبتتفق على الباقة المناسبة وبيتفعل حسابك فور تأكيد الدفع. لو مجتش تكمل، مفيش أي خصم تلقائي ولا التزام.'],
  ['أقدر أغيّر الباقة بعدين؟', 'أيوه — تقدر ترفع أو تنزّل باقتك في أي وقت حسب حجم مركزك، والتعديل بيتم على واتساب مباشرة.'],
  ['في خصم للدفع السنوي؟', 'الدفع السنوي متاح وبيقدم سعر أفضل — التفاصيل والأرقام المعتمدة بتتأكد معك على واتساب حسب حجم مركزك.'],
]

function PlanCard({ plan }) {
  const recommend = () => {
    track('pricing_plan_selected', { plan: plan.id })
    if (plan.cta.kind === 'whatsapp') window.open(WHATSAPP_URL, '_blank', 'noopener')
    else window.location.assign('/?auth=signup')
  }
  return (
    <div className={`relative flex flex-col rounded-3xl border p-8 ${plan.highlighted ? 'border-amber-300/45 bg-gradient-to-b from-amber-400/[0.10] to-white/[0.03] shadow-2xl shadow-amber-500/10' : 'border-white/10 bg-white/[0.05]'}`}>
      {plan.highlighted && (
        <span className="absolute -top-3.5 right-6 rounded-full bg-gradient-to-l from-[#e3b04b] to-[#c98f2e] px-3.5 py-1.5 text-[11px] font-black text-[#1a1205] shadow-lg shadow-amber-500/25">
          الأكثر اختيارًا
        </span>
      )}
      <h2 className="text-2xl font-black">{plan.name}</h2>
      <p className="mt-1.5 text-sm leading-6 text-slate-400">{plan.who}</p>
      <div className="mt-5 rounded-2xl border border-white/10 bg-[#0c1631]/60 px-4 py-3.5">
        <div className="text-lg font-black text-[#e8bd63]">حسب حجم مركزك</div>
        <div className="mt-1 text-xs leading-5 text-slate-400">السعر بيتأكد معك شخصيًا على واتساب قبل أي التزام — ومفيش دفع أونلاين.</div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-white/5 px-3 py-2.5"><dt className="font-bold text-slate-400">الطلاب</dt><dd className="mt-0.5 font-black">{plan.studentLimit}</dd></div>
        <div className="rounded-xl bg-white/5 px-3 py-2.5"><dt className="font-bold text-slate-400">الفريق</dt><dd className="mt-0.5 font-black">{plan.branchLimit}</dd></div>
      </dl>
      <ul className="mt-6 flex-1 space-y-3">
        {plan.capabilities.map((c) => (
          <li key={c} className="flex items-start gap-2.5 text-sm leading-6 text-slate-200">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#e3b04b]" aria-hidden="true" /> {c}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={recommend}
        className={`mt-8 min-h-13 w-full rounded-2xl px-5 py-3.5 text-sm font-black transition hover:-translate-y-0.5 ${plan.highlighted ? 'bg-gradient-to-l from-[#e3b04b] to-[#c98f2e] text-[#1a1205] shadow-xl shadow-amber-500/25' : 'border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10'}`}
      >
        {plan.cta.label}
      </button>
    </div>
  )
}

function Recommender() {
  const [students, setStudents] = useState('')
  const [team, setTeam] = useState('')
  const ids = { '1': 1, '2-3': 2, '4+': 5 }
  const rec = recommendPlan({ students: students ? Number(students) : null, team: team ? ids[team] : null })
  const plan = PLANS.find((p) => p.id === rec)
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-7 sm:p-9">
      <h2 className="text-2xl font-black">أنهي باقة تناسبك؟</h2>
      <p className="mt-2 text-sm leading-7 text-slate-400">اختيارين بس — وهنقولك الباقة المناسبة فورًا.</p>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-black text-slate-300">عدد الطلاب النشطين تقريبًا</span>
          <input
            type="number" min="1" inputMode="numeric" value={students}
            onChange={(e) => setStudents(e.target.value)}
            placeholder="مثال: 120"
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#0c1631]/70 px-4 py-3 text-sm font-bold text-white outline-none focus:border-[#e3b04b]"
          />
        </label>
        <label className="block">
          <span className="text-sm font-black text-slate-300">عدد اللي بيشتغلوا معاك</span>
          <select
            value={team} onChange={(e) => setTeam(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#0c1631]/70 px-4 py-3 text-sm font-bold text-white outline-none focus:border-[#e3b04b]"
          >
            <option value="">اختر…</option>
            <option value="1">لوحدي</option>
            <option value="2-3">٢ إلى ٣</option>
            <option value="4+">٤ أو أكتر</option>
          </select>
        </label>
      </div>
      {plan && (
        <div className="mt-6 rounded-2xl border border-amber-300/30 bg-amber-400/[0.08] p-5">
          <p className="text-sm leading-7 text-slate-200">
            بناءً على إجابتك: باقة <b className="font-black text-[#e8bd63]">{plan.name}</b> هي الأنسب لبدايتك —
            وتقدر تغيّرها في أي وقت لما مركزك يكبر.
          </p>
          <button onClick={() => { track('pricing_plan_selected', { plan: plan.id, source: 'recommender' }); window.location.assign(plan.cta.kind === 'whatsapp' ? WHATSAPP_URL : '/?auth=signup') }} className="mt-4 min-h-11 rounded-xl bg-gradient-to-l from-[#e3b04b] to-[#c98f2e] px-5 text-sm font-black text-[#1a1205]">
            {plan.cta.label}
          </button>
        </div>
      )}
    </div>
  )
}

export default function PricingPage() {
  useSeo({
    title: 'الأسعار — باقات نظام إدارة المركز التعليمي | النخبة',
    description: 'باقات واضحة حسب حجم مركزك: تجربة مجانية ٧ أيام بدون بطاقة، تفعيل وإلغاء بدون التزام، وأسعار بتتأكد معك على واتساب قبل أي دفع.',
    path: '/pricing',
    jsonLd: [faqSchema(PRICE_FAQS), breadcrumbSchema([{ name: 'الرئيسية', path: '/' }, { name: 'الأسعار', path: '/pricing' }])],
  })
  return (
    <MarketingLayout active="/pricing">
      <section className="mx-auto max-w-7xl px-5 pb-10 pt-14 sm:px-8">
        <span className="lp-eyebrow">الأسعار</span>
        <h1 className="mt-5 max-w-3xl text-4xl font-black leading-[1.2] tracking-tight sm:text-5xl">
          ابدأ مجانًا — وادفع بس لما تشوف الفايدة.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300">
          تجربة مجانية {TRIAL.days} أيام بكامل المميزات وبلا بطاقة دفع. بعدها تختار الباقة اللي على قد شغلك —
          والتفعيل بيتم على واتساب مباشرة من غير تجديد تلقائي ولا مفاجآت.
        </p>
      </section>

      <section className="mx-auto max-w-7xl px-5 sm:px-8" aria-label="الباقات">
        <div className="grid gap-5 lg:grid-cols-3">
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
            ['بياناتك بتفضل محفوظة', 'حتى لو التجربة انتهت وملّكشت، بيانات مركزك بتفضل محفوظة لما ترجع.'],
          ].map(([t, d]) => (
            <div key={t}>
              <h3 className="font-black text-[#e8bd63]">{t}</h3>
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
