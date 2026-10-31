// ═══════════════════════════════════════════════════════════════════════════
// PRICING — THE single source of truth (unified model, owner-approved 2026-10-26).
// Every pricing surface (landing plans, /pricing page, trial page, pricing
// FAQ) reads from this file. NO price numbers are hard-coded anywhere else.
//
// Approved model (owner-approved 2026-10-26): ONE unified plan —
//   500 EGP / month, ANY number of active students, ALL features included.
// The old tiered table (Starter 399 / Growth 799 / Pro 1,499 / Enterprise
// custom) is retired everywhere.
//
// NOTE: multi-branch management is NOT implemented yet — branch fields are
// labelled «قريبًا» everywhere and are not a pricing axis anymore: one
// price, no student cap.
//
// Honest model rules (verified in code, do not violate):
//  - No self-serve payment gateway exists → activation/renewal happens on
//    WhatsApp after confirmation (SubscriptionGate). No auto-billing.
//  - Trial = time-limited 14 days, full core product, no card. After the
//    trial the account is PAUSED (not deleted) and data is retained for
//    DATA PRESERVATION GUARANTEE (owner, 2026-09): expiry PAUSES access only.
//    Nothing is ever auto-deleted — students, attendance, grades, exams,
//    notes, reports, settings and account info are all preserved until the
//    admin intentionally deletes via the admin panel. Trial ≠ free account forever.
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
  // DATA PRESERVATION GUARANTEE: no retention window, no auto-deletion, ever.
  // Expiry pauses access only; renewal restores everything exactly as it was.
  afterTrial: 'الحساب بيتوقف مؤقتًا (مش حذف) — وبياناتك تفضل محفوظة ومش بتتحذف، والتجديد بيرجّع كل حاجة زي ما هي',
  dataRetention: 'بياناتك محفوظة ومش بتتحذف تلقائيًا أبدًا — انتهاء الاشتراك بيوقف الوصول مؤقتًا بس، والتجديد بيعيد كل حاجة زي ما هي',
}

export const PLANS = [
  {
    id: 'nokhba',
    name: 'باقة النخبة',
    tagline: 'باقة واحدة — كل المميزات، أي عدد طلاب',
    who: 'لأي مدرّس أو سنتر أو أكاديمية — من أول طالب لحد آلاف الطلاب',
    monthlyPrice: 500,
    annualPrice: null, // لا توجد أسعار سنوية معتمدة — تتفق عليها على واتساب
    priceUnit: 'جنيه/شهر',
    studentLimit: 'عدد طلاب غير محدود',
    branchLimit: null, // الفروع لسه قيد التطوير — مش محور تسعير
    highlighted: true, // بطاقة واحدة — الإبراز للشكل بس
    cta: { label: 'ابدأ التجربة المجانية', kind: 'trial' },
    // كل سطر هنا متحقق منه في الكود الفعلي (2026-10-26) — مفيش ميزة غير موجودة.
    capabilities: [
      'طلاب ومجموعات بلا حد — ملف كامل لكل طالب وإضافة دفعة واحدة',
      'مسار الحصة: حضور بلمسة أو بمسح QR، تفاعل، وواجب بأحواله — بحفظ تلقائي',
      'امتحانات ودرجات بأقسامها + امتحانات أونلاين ومتابعة المحاولات',
      'واجبات بتتوزع وبتتصحّح من مكانها + تحويل واجب بالصورة لاختبار تفاعلي بالذكاء الاصطناعي',
      'فريق التحليل: مراجعة أسبوعية لمؤشرات كل مجموعة بأسباب وخطوات مقترحة',
      'تقارير واتساب لأولياء الأمور: توليد تلقائي ومراجعة قبل الإرسال وحماية من التكرار',
      'بوابة الطالب وولي الأمر برابط QR: حضور وواجبات ونتايج من غير كلمة سر',
      'حسابات مساعدين لفريق الشغل + إشعارات لحظية + تطبيق موبايل (PWA) + لوجو مخصص',
    ],
  },
]

export const PRICING_NOTE =
  'اشتراك واحد واضح: ٥٠٠ جنيه/شهر لأي عدد من الطلاب وبكل المميزات — بتفعل وبتتجدد عبر واتساب بعد تأكيدك الشخصي. مفيش دفع أونلاين ولا تجديد تلقائي ولا خصم صامت.'

/** Renders the approved price in Arabic-Indic digits, or the custom-quote label. */
export function formatPrice(plan) {
  if (plan.monthlyPrice == null) return plan.priceUnit // 'سعر مخصص'
  return `${plan.monthlyPrice.toLocaleString('ar-EG')} ${plan.priceUnit}`
}

/** Arabic-Indic digits for any number shown inside Arabic copy (14 → ١٤). */
export const fmtAr = (n) => Number(n).toLocaleString('ar-EG')


