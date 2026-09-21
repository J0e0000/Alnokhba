// ═══════════════════════════════════════════════════════════════════════════
// PRICING — THE single source of truth (Phase 18, prices approved 2026-09).
// Every pricing surface (landing plans, /pricing page, trial page, pricing
// FAQ) reads from this file. NO price numbers are hard-coded anywhere else.
//
// Approved plan table (owner-approved, monthly, EGP):
//   Starter     up to 300 students    1 branch              399 EGP
//   Growth      up to 1,000 students  3 branches            799 EGP
//   Pro         up to 3,000 students  unlimited (5+)        1,499 EGP
//   Enterprise  3,000+ students       custom                custom quote
//
// Honest model rules (verified in code, do not violate):
//  - No self-serve payment gateway exists → activation/renewal happens on
//    WhatsApp after confirmation (SubscriptionGate). No auto-billing.
//  - Trial = time-limited 14 days, full core product, no card. After the
//    trial the account is PAUSED (not deleted) and data is retained for
//    30 days, then archived/deleted per policy. Trial ≠ free account forever.
//  - Backend note: profiles.subscription_expires_at defaults to now()+14d
//    only after migration_045 is applied; until then the admin grants the
//    14-day window manually at activation (تفعيل/تمديد في لوحة الأدمن).
//    Trial quota limits (e.g. max students/branches during trial) are NOT
//    enforced by RLS yet — so we never advertise them as enforced caps.
// ═══════════════════════════════════════════════════════════════════════════

export const TRIAL = {
  days: 14, // approved trial length (owner, 2026-09) — was 7
  noCard: true, // verified: signup asks name + phone + email + password only
  autoBilling: false, // verified: no payment gateway connected
  assistance: true, // verified: WhatsApp support from the real number
  pausedNotDeleted: true, // product decision: expired account is paused, data kept
  retentionDays: 30, // owner decision: data retained 30 days after trial, then archived/deleted per policy
  afterTrial: 'الحساب بيتوقف مؤقتًا (مش حذف) — وبياناتك بتفضل محفوظة ٣٠ يوم، والتجديد بيرجّع كل حاجة زي ما هي',
  dataRetention: 'بياناتك بتفضل محفوظة ٣٠ يوم بعد انتهاء التجربة — التجديد بيعيد كل حاجة زي ما هي',
}

export const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    tagline: 'للبداية صح — سنتر صغير أو مدرس فردي',
    who: 'للمدرس الفردي أو السنتر الصغير اللي بيبدأ نظامة',
    monthlyPrice: 399,
    annualPrice: null, // لا توجد أسعار سنوية معتمدة — تتفق عليها على واتساب
    priceUnit: 'جنيه/شهر',
    studentLimit: 'حتى ٣٠٠ طالب نشط',
    branchLimit: 'فرع واحد',
    highlighted: false,
    cta: { label: 'ابدأ التجربة المجانية', kind: 'trial' },
    capabilities: [
      'طلاب ومجموعات حتى ٣٠٠ طالب نشط',
      'مسار الحصة كامل: حضور، تفاعل، واجب',
      'بوابة الطالب برابط QR',
      'تقارير واتساب لأولياء الأمور',
      'التطبيق على الموبايل (PWA)',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    tagline: 'الأنسب لأغلب المراكز اللي بتكبر',
    who: 'للمركز اللي بيكبر وعايز الصورة كاملة من مكان واحد',
    monthlyPrice: 799,
    annualPrice: null,
    priceUnit: 'جنيه/شهر',
    studentLimit: 'حتى ١٬٠٠٠ طالب نشط',
    branchLimit: '٣ فروع',
    highlighted: true, // الأكثر اختيارًا — التوازن بين السعر والقدرات لأغلب المراكز
    cta: { label: 'ابدأ التجربة المجانية', kind: 'trial' },
    capabilities: [
      'كل قدرات Starter — حتى ١٬٠٠٠ طالب',
      'الامتحانات والدرجات بأقسامها',
      'فريق التحليل الأسبوعي',
      'إشعارات أولياء الأمور والطلاب',
      '٣ فروع — ومساعدون بصلاحيات محددة',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'للمركز الكامل بفروع وفريق شغل',
    who: 'للمركز الكبير أو سلسلة المجموعات اللي محتاجة تحكم كامل',
    monthlyPrice: 1499,
    annualPrice: null,
    priceUnit: 'جنيه/شهر',
    studentLimit: 'حتى ٣٬٠٠٠ طالب نشط',
    branchLimit: 'فروع غير محدودة (٥+)',
    highlighted: false,
    cta: { label: 'ابدأ التجربة المجانية', kind: 'trial' },
    capabilities: [
      'كل قدرات Growth — حتى ٣٬٠٠٠ طالب',
      'فروع غير محدودة تحت إدارة واحدة',
      'قائمة الإرسال المحصّنة للواتساب',
      'تقارير موسّعة وسجل عمليات كامل',
      'دعم مباشر على واتساب',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'للمجموعات والسلاسل التعليمية',
    who: 'للمجموعات والسلاسل اللي عدّت ٣٬٠٠٠ طالب أو محتاجة إعداد خاص',
    monthlyPrice: null, // سعر مخصص — بيتحدد حسب الحجم على واتساب
    annualPrice: null,
    priceUnit: 'سعر مخصص',
    studentLimit: '٣٬٠٠٠+ طالب نشط',
    branchLimit: 'حسب الهيكل بتاعك',
    highlighted: false,
    cta: { label: 'كلمنا على واتساب', kind: 'whatsapp' },
    capabilities: [
      'كل قدرات Pro بلا حد عملي للطلاب',
      'هيكل فروع متعدد بمساحات مشتركة للفريق',
      'إعداد وتفعيل بمساعدة مباشرة',
      'مرونة في البنية حسب حجم شغلك',
      'أولوية في الدعم على واتساب',
    ],
  },
]

export const PRICING_NOTE =
  'الأسعار شهرية بالجنيه المصري وواضحة فوق — بتفعل وبتتجدد عبر واتساب بعد تأكيدك الشخصي. مفيش دفع أونلاين ولا تجديد تلقائي ولا خصم صامت.'

/** Renders the approved price in Arabic-Indic digits, or the custom-quote label. */
export function formatPrice(plan) {
  if (plan.monthlyPrice == null) return plan.priceUnit // 'سعر مخصص'
  return `${plan.monthlyPrice.toLocaleString('ar-EG')} ${plan.priceUnit}`
}

/** Arabic-Indic digits for any number shown inside Arabic copy (14 → ١٤). */
export const fmtAr = (n) => Number(n).toLocaleString('ar-EG')

/** Lightweight plan recommender (no form submit, no backend) — by active students. */
export function recommendPlan({ students }) {
  if (students == null) return null
  if (students <= 300) return 'starter'
  if (students <= 1000) return 'growth'
  if (students <= 3000) return 'pro'
  return 'enterprise'
}
