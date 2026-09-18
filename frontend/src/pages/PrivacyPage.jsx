const WHATSAPP_SUPPORT = 'https://wa.me/201014996636'

// ═══════════════════════════════════════════════════════════════════════════
// PRIVACY PAGE — real destination for the footer link (was a dead <span>).
// Plain, honest Arabic. No auth required; rendered straight from App.jsx.
// ═══════════════════════════════════════════════════════════════════════════
export default function PrivacyPage() {
  return (
    <div dir="rtl" className="min-h-screen" style={{ background: 'var(--brand-bg, #F6F7FB)', color: 'var(--fg, #0F172A)' }}>
      <header className="px-5 py-5 sm:px-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/nokhba-mark.svg" alt="شعار النخبة" className="h-8 w-8 rounded-lg" />
            <b className="text-base">النخبة</b>
          </div>
          <a href="/" className="text-[.78rem] font-extrabold rounded-xl px-4 py-2" style={{ background: 'var(--brand-navy, #0E2954)', color: '#fff' }}>
            الرئيسية
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-16 sm:px-8">
        <h1 className="text-2xl font-black mt-2 mb-2">سياسة الخصوصية</h1>
        <p className="text-[.8rem] text-fg-muted mb-8">آخر تحديث: سبتمبر ٢٠٢٦ — بنكتبها بالعربي البسيط عشان تكون واضحة للكل.</p>

        <section className="glass-card p-5 mb-4">
          <h2 className="text-[1rem] font-black mb-2">١. البيانات اللي بنجمعها</h2>
          <p className="text-[.85rem] leading-8 mb-0">
            المنصة بتجمع الحد الأدنى اللازم لخدمة المراكز التعليمية: اسم الطالب ومرحلته ومجموعته، رقم هاتف ولي الأمر (للتواصل وتقارير واتساب)، بيانات الحضور والواجبات والامتحانات والنقاط، وشعار المركز واسمه لو المدرس اختار يضيفهم. مش بنجمع أي بيانات دفع بنكية، ومفيش تسجيل دخول للطالب — البوابة بتاعته بتفتح برابط خاص بيه فقط.
          </p>
        </section>

        <section className="glass-card p-5 mb-4">
          <h2 className="text-[1rem] font-black mb-2">٢. إزاي بنستخدم البيانات</h2>
          <p className="text-[.85rem] leading-8 mb-0">
            البيانات بتُستخدم في الغرض الواحد اللي اتعملت من أجله: إدارة الحصص والحضور، حساب النقاط والترتيب، تجهيز تقارير أولياء الأمور وإرسالها على واتساب، عرض حالة الطالب في بوابته الشخصية، وإشعارات الحصص والنتائج. مش بنبيع البيانات ولا بنشاركها مع أطراف ثالثة لأغراض تسويقية.
          </p>
        </section>

        <section className="glass-card p-5 mb-4">
          <h2 className="text-[1rem] font-black mb-2">٣. مين شايف البيانات</h2>
          <p className="text-[.85rem] leading-8 mb-0">
            كل مركز (مدرس + مساعديه المعتمدين) شايف بيانات طلابه هو فقط — بيانات كل حساب معزولة عن غيره على مستوى قاعدة البيانات. الطالب/ولي الأمر بيفتح بوابة الطالب برابطه الخاص وبيشوف بياناته هو فقط. فريق التشغيل مش بيوصل لبيانات أي مركز إلا بطلب دعم صريح من المدرس نفسه ولمدة محدودة ومسجلة.
          </p>
        </section>

        <section className="glass-card p-5 mb-4">
          <h2 className="text-[1rem] font-black mb-2">٤. التخزين والحماية</h2>
          <p className="text-[.85rem] leading-8 mb-0">
            البيانات محفوظة على خدمة قواعد بيانات سحابية (Supabase) بتوفر تشفير أثناء النقل والتخزين وصلاحيات وصول مقيدة على مستوى الصفوف. الاتصال بالموقع مؤمّن دايماً بـ HTTPS.
          </p>
        </section>

        <section className="glass-card p-5 mb-4">
          <h2 className="text-[1rem] font-black mb-2">٥. حقوقك</h2>
          <p className="text-[.85rem] leading-8 mb-0">
            تقدر في أي وقت تطلب تصحيح أو حذف بيانات أي طالب — المدرس يقدر يحذف الطالب وسجلاته من داخل المنصة مباشرة، وولي الأمر يقدر يطلب ده من المدرس أو مننا على واتساب الدعم. ولو المدرس قرر يسيّر المركز، بيقفل حسابه من الإعدادات وبنحذف بياناته بطلب منه.
          </p>
        </section>

        <section className="glass-card p-5">
          <h2 className="text-[1rem] font-black mb-2">٦. التواصل</h2>
          <p className="text-[.85rem] leading-8 mb-3">
            أي سؤال عن الخصوصية أو بياناتك — كلمنا على واتساب وهنرد بسرعة.
          </p>
          <a href={WHATSAPP_SUPPORT} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-[.85rem] font-black text-white" style={{ background: '#25D366' }}>
            ✆ تواصل على واتساب
          </a>
        </section>
      </main>

      <footer className="border-t px-5 py-6 text-center text-[.72rem] text-fg-muted">
        النخبة — كل شغل المدرس في مكان واحد
      </footer>
    </div>
  )
}
