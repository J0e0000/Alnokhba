import { useEffect, useState } from 'react'

const STEPS = [
  { icon: '⌂', title: 'ابدأ من الرئيسية', body: 'ستجد هنا حصة اليوم، التنبيهات، وحالة طابور الرسائل بسرعة.' },
  { icon: '▦', title: 'الحصص هي مركز العمل', body: 'اختر المجموعة ثم ابدأ الحصة وسجل الحضور والواجب ورابط الدرس.' },
  { icon: '☷', title: 'اعثر على أي طالب بسرعة', body: 'استخدم البحث والمرحلة والمجموعة، ثم نفذ الإجراءات من بطاقة الطالب مباشرة.' },
  { icon: '✉', title: 'الرسائل والتقارير', body: 'عدّل القالب، راجع المعاينة، ثم شغّل الطابور على دفعات مع إمكانية الاستكمال.' },
]

export default function FirstVisitGuide({ onFinish }) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]

  useEffect(() => {
    try { document.body.style.overflow = 'hidden' } catch {}
    return () => { try { document.body.style.overflow = '' } catch {} }
  }, [])

  const finish = () => {
    try { localStorage.setItem('nokhba_first_visit_guide_done', '1') } catch {}
    onFinish?.()
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4" dir="rtl">
      <div className="w-full max-w-md overflow-hidden rounded-[26px] border border-slate-200/80 bg-white/95 text-slate-900 shadow-2xl">
        <div className="h-1.5 bg-gradient-to-l from-emerald-400 via-cyan-400 to-indigo-400" />
        <div className="p-6 sm:p-7">
          <div className="mb-6 flex items-center justify-between">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">دليل سريع {step + 1}/{STEPS.length}</span>
            <button onClick={finish} className="text-sm font-semibold text-slate-400 hover:text-slate-700">تخطي</button>
          </div>
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-2xl text-emerald-300 shadow-lg">{current.icon}</div>
          <h2 className="mb-2 text-2xl font-black tracking-tight">{current.title}</h2>
          <p className="min-h-[52px] text-sm leading-7 text-slate-500">{current.body}</p>
          <div className="mt-7 flex items-center justify-between gap-3">
            <div className="flex gap-1.5">{STEPS.map((_, index) => <span key={index} className={`h-1.5 rounded-full transition-all ${index === step ? 'w-7 bg-slate-900' : 'w-1.5 bg-slate-200'}`} />)}</div>
            <button onClick={() => step === STEPS.length - 1 ? finish() : setStep((value) => value + 1)} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-900/15 transition hover:-translate-y-0.5">
              {step === STEPS.length - 1 ? 'ابدأ الاستخدام' : 'التالي'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
