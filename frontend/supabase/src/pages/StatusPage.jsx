const STATES = {
  404: { title: 'الصفحة غير موجودة', body: 'الرابط الذي فتحته غير متاح أو تم نقله. ارجع إلى الصفحة الرئيسية للمتابعة.', icon: '404' },
  403: { title: 'ليس لديك صلاحية', body: 'حسابك لا يملك صلاحية الوصول إلى هذه الصفحة. إذا كان هذا غير متوقع، تواصل مع المسؤول.', icon: '403' },
  500: { title: 'حدث خطأ مؤقت', body: 'تعذر إكمال العملية الآن. بياناتك لم تُحذف، ويمكنك المحاولة مرة أخرى.', icon: '!' },
  network: { title: 'تعذر الاتصال', body: 'تحقق من اتصال الإنترنت ثم حاول مرة أخرى.', icon: '↻' },
  expired: { title: 'الرابط منتهي', body: 'هذا الرابط لم يعد صالحًا. اطلب رابطًا جديدًا من المدرس أو ولي الأمر.', icon: '⌁' },
}

export default function StatusPage({ code = 404, onHome, onRetry }) {
  const state = STATES[code] || STATES[404]
  return <main className="min-h-screen bg-brand-bg px-5 py-10 text-fg" dir="rtl"><div className="mx-auto flex min-h-[70vh] max-w-lg items-center justify-center"><section className="glass-card w-full p-8 text-center sm:p-10"><div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-xl font-black text-slate-700">{state.icon}</div><h1 className="text-2xl font-black">{state.title}</h1><p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-fg-muted">{state.body}</p><div className="mt-7 flex flex-wrap justify-center gap-3">{onRetry && <button onClick={onRetry} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-black text-white">حاول مرة أخرى</button>}<button onClick={onHome || (() => { window.location.href = '/' })} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-700">العودة للرئيسية</button></div></section></div></main>
}
