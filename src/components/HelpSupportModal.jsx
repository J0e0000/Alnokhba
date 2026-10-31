import { useState } from 'react'
import Modal from './Modal'

// ═══════════════════════════════════════════════════════════════════════════
// HELP & SUPPORT (spec 20) — FAQ moved OUT of the main workflow into
// Settings → Help & Support. Contains the FAQ accordion, the interactive
// tour launcher, and the support contact line. Nothing here is required for
// the daily pipeline — it is help content living in its proper place.
// ═══════════════════════════════════════════════════════════════════════════
const FAQ_ITEMS = [
  ['كيف أبدأ يومي في المنصة؟',
   'من الرئيسية: كل حصة مجدولة اليوم تظهر كبطاقة. اضغط "فتح الحصة" لتبدأ مساحة العمل، سجّل الحضور، ثم انتقل للتفاعل والواجب والامتحانات من نفس الشاشة بدون تنقل.'],
  ['كيف أضيف طلاب جدد بسرعة؟',
   'من صفحة الطلاب: "طالب جديد" لإضافة طالب واحد، أو "إضافة عدة طلاب" لإضافة مجموعة دفعة واحدة. عند اختيار مجموعة، مرحلة الطالب تتحدد تلقائيًا من المجموعة — ولا تظهر إلا المجموعات المتوافقة مع المرحلة.'],
  ['لماذا مرحلة الطالب اتغيرت لما اخترت المجموعة؟',
   'المجموعة هي المرجع الرسمي للمرحلة الدراسية. لما ينضم الطالب لمجموعة، مرحلته تُورَّث منها تلقائيًا حتى لا تتعارض بياناته مع مجموعته في التقارير والفلترة.'],
  ['كيف أرسل تقارير الحضور لأولياء الأمور؟',
   'بعد إنهاء الحصة (أو من تبويب التقارير): اختر المستلمين — الحاضرون فقط، الغائبون فقط، الكل، أو تحديد يدوي. رسالة الحاضر تختلف عن رسالة الغائب، ورصيد الإنذارات يُحسب تلقائيًا من بيانات الطالب الحقيقية.'],
  ['ماذا يحدث عند وصول الإنذارات للحد؟',
   'حسب سياسة النظام الحالية: عند بلوغ عدد الإنذارات المحدد في الإعدادات، يُمنع دخول الطالب مؤقتًا عبر بوابة الطالب (QR). الحد قابل للتعديل من الإعدادات ← النقاط والرتب والتنبيهات.'],
  ['أين أجد الأسئلة الشائعة والجولة التفاعلية؟',
   'هنا — من الإعدادات ← المساعدة والدعم. الجولة التفاعلية تشرح الشاشة الحالية بخطوة بخطوة مع إبراز العنصر المستهدف، ويمكن تشغيلها في أي وقت وتخطيها متى شئت.'],
]

export default function HelpSupportModal({ open, onClose, onStartTour }) {
  const [openFaq, setOpenFaq] = useState(0)
  return (
    <Modal open={open} onClose={onClose} title="المساعدة والدعم">
      <button
        className="w-full btn-gold rounded-xl px-4 py-3 text-[.8rem] font-extrabold mb-4 flex items-center justify-center gap-2"
        onClick={onStartTour}
      >
        ▶ ابدأ الجولة التفاعلية — شرح الشاشة خطوة بخطوة
      </button>

      <h4 className="text-[.8rem] font-extrabold m-0 mb-2">الأسئلة الشائعة</h4>
      <div className="space-y-2">
        {FAQ_ITEMS.map(([question, answer], index) => (
          <div key={question} className="glass-card overflow-hidden">
            <button
              className="w-full text-right flex items-center justify-between gap-2 px-3.5 py-2.5 bg-transparent border-0 cursor-pointer font-[inherit]"
              onClick={() => setOpenFaq(openFaq === index ? -1 : index)}
              aria-expanded={openFaq === index}
            >
              <b className="text-[.76rem]">{question}</b>
              <span className="text-fg-muted shrink-0">{openFaq === index ? '−' : '+'}</span>
            </button>
            {openFaq === index && <p className="m-0 px-3.5 pb-3 text-[.72rem] leading-6 text-fg-muted">{answer}</p>}
          </div>
        ))}
      </div>

      <div className="nk-notice mt-4 !text-[.7rem]">
        تحتاج مساعدة مباشرة؟ راسلنا على البريد الموجود في صفحة الترحيب، أو من لوحة الأدمن إن كانت متاحة لحسابك — وسيتم الرد في أقرب وقت.
      </div>
    </Modal>
  )
}
