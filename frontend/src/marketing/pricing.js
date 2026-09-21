// ═══════════════════════════════════════════════════════════════════════════
// PRICING — THE single source of truth (Phase 18).
// Every pricing surface (landing plans, /pricing page, trial page, comparison,
// pricing FAQ) reads from this file. NO price numbers are hard-coded anywhere
// else, and none are invented: the product currently has NO self-serve payment
// gateway — plans are activated/renewed over WhatsApp after confirmation
// (verified in SubscriptionGate). So price is `null` and the UI renders the
// honest WhatsApp-based path. When real price numbers are approved, set them
// HERE (monthlyPrice/annualPrice per plan) and every page updates at once.
// ═══════════════════════════════════════════════════════════════════════════

export const TRIAL = {
  days: 7, // verified: Signup page states 7-day free trial
  noCard: true, // verified: signup asks email + password + name only
  autoBilling: false, // verified: no payment gateway connected
  assistance: true, // verified: WhatsApp support from the real number
  afterTrial: 'اشتراك شهري بتفعيل يدوي عبر واتساب', // verified model
  dataRetention: 'بياناتك بتفضل محفوظة بعد انتهاء التجربة — التجديد بيعيد كل حاجة زي ما هي', // verified (SubscriptionGate copy)
}

export const PLANS = [
  {
    id: 'basic',
    name: 'الأساسية',
    who: 'للمدرس الفردي اللي بيبدأ نظامة',
    monthlyPrice: null, // ← أضف السعر المعتمد هنا لما يتثبت
    annualPrice: null,
    studentLimit: 'حتى ٤٠ طالبًا',
    branchLimit: 'مدرس واحد',
    highlighted: false,
    cta: { label: 'ابدأ التجربة المجانية', kind: 'trial' },
    capabilities: [
      'مجموعتان وطلاب حتى ٤٠',
      'مسار الحصة: حضور، تفاعل، واجب',
      'بوابة الطالب برابط QR',
      'تقارير واتساب أساسية',
      'التطبيق على الموبايل (PWA)',
    ],
  },
  {
    id: 'pro',
    name: 'الاحترافية',
    who: 'للمركز النامي اللي عايز الصورة كاملة',
    monthlyPrice: null,
    annualPrice: null,
    studentLimit: 'طلاب بلا حد عملي',
    branchLimit: 'مدرس + مساعدون',
    highlighted: true,
    cta: { label: 'ابدأ التجربة المجانية', kind: 'trial' },
    capabilities: [
      'كل قدرات الأساسية — بلا حد للطلاب',
      'الامتحانات والدرجات بأقسامها',
      'قائمة الإرسال المحصّنة للواتساب',
      'فريق التحليل الأسبوعي',
      'إشعارات أولياء الأمور والطلاب',
      'مساعدون بصلاحيات محددة',
    ],
  },
  {
    id: 'center',
    name: 'المراكز والفرق',
    who: 'للمركز بأكمله وفريق الشغل',
    monthlyPrice: null,
    annualPrice: null,
    studentLimit: 'كل طلاب المركز',
    branchLimit: 'فريق كامل بمساحات مشتركة',
    highlighted: false,
    cta: { label: 'كلمنا على واتساب', kind: 'whatsapp' },
    capabilities: [
      'كل قدرات الاحترافية',
      'مساحة عمل مشتركة للفريق',
      'متابعة مركزية لكل المجموعات',
      'سجل عمليات وتقارير موسعة',
      'دعم مباشر على واتساب',
    ],
  },
]

export const PRICING_NOTE =
  'الأسعار بتتحدد حسب حجم مركزك وعدد الطلاب، وبتتأكد معك شخصيًا على واتساب قبل أي التزام — من غير دفع أونلاين ولا تجديد تلقائي.'

/** Lightweight plan recommender (Phase 4) — no form, no backend. */
export function recommendPlan({ students, team }) {
  if (students == null) return null
  if (students <= 40 && (team ?? 1) <= 1) return 'basic'
  if (students <= 40 && (team ?? 1) > 1) return 'center'
  return (team ?? 1) > 1 ? 'center' : 'pro'
}
