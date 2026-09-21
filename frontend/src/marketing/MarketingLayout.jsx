// ═══════════════════════════════════════════════════════════════════════════
// MARKETING SHELL — shared header/footer/UI kit for every public page.
// Navigation uses real <a href> between marketing routes (clean URLs, cached
// bundles, zero router dependency). Visual identity = the product's own
// navy + gold system (lp-* classes already shipped in index.css).
// ═══════════════════════════════════════════════════════════════════════════
import { useState } from 'react'
import { NAV, WHATSAPP_URL, SITE_NAME, track } from './config.js'

const signupHref = '/?auth=signup'
const loginHref = '/?auth=login'

export function TrialCta({ className = '', big = false, source = 'generic' }) {
  return (
    <a
      href={signupHref}
      onClick={() => track('trial_cta_click', { source })}
      className={`inline-flex items-center justify-center rounded-2xl bg-gradient-to-l from-[#e3b04b] to-[#c98f2e] font-black text-[#1a1205] shadow-xl shadow-amber-500/25 transition hover:-translate-y-0.5 ${big ? 'min-h-14 px-7 text-sm' : 'min-h-11 px-5 text-sm'} ${className}`}
    >
      ابدأ التجربة المجانية
    </a>
  )
}

export function WaCta({ className = '', label = 'تواصل معنا عبر واتساب', source = 'generic', big = false }) {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noreferrer"
      onClick={() => track('whatsapp_click', { source })}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl border border-[#25D366]/30 bg-[#25D366]/10 font-black text-[#4be08a] transition hover:bg-[#25D366]/20 ${big ? 'min-h-14 px-7 text-sm' : 'min-h-11 px-5 text-sm'} ${className}`}
    >
      <span aria-hidden="true">◉</span> {label}
    </a>
  )
}

export function SectionHead({ eyebrow, title, sub, center = false }) {
  return (
    <div className={`lp-section-head max-w-2xl ${center ? 'mx-auto text-center' : ''}`}>
      <span className="lp-eyebrow">{eyebrow}</span>
      <h2 className="mt-4 text-3xl font-black leading-[1.25] tracking-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mt-4 leading-8 text-slate-300/90">{sub}</p>}
    </div>
  )
}

export function Shot({ screen, alt, className = '', priority = false }) {
  return (
    <img
      src={screen.src}
      width={screen.w}
      height={screen.h}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={`rounded-2xl border border-white/10 bg-white shadow-2xl shadow-black/40 ${className}`}
    />
  )
}

export function FaqList({ faqs, source }) {
  const [open, setOpen] = useState(0)
  return (
    <div className="space-y-3">
      {faqs.map(([q, a], i) => (
        <div key={q} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.05]">
          <button
            onClick={() => { setOpen(open === i ? -1 : i); track('faq_interaction', { source, question: q }) }}
            className="flex w-full items-center justify-between gap-4 p-5 text-right font-black transition hover:bg-white/[0.03]"
            aria-expanded={open === i}
          >
            <span>{q}</span>
            <span className="text-xl text-[#e8bd63]" aria-hidden="true">{open === i ? '−' : '+'}</span>
          </button>
          {open === i && <p className="border-t border-white/10 px-5 pb-5 pt-4 text-sm leading-7 text-slate-300/90">{a}</p>}
        </div>
      ))}
    </div>
  )
}

export function CtaBand({ title, sub }) {
  return (
    <section className="px-5 pb-20 sm:px-8">
      <div className="lp-cta-band mx-auto max-w-7xl rounded-[30px] border border-white/10 px-6 py-16 text-center sm:px-10">
        <h2 className="text-3xl font-black sm:text-4xl">{title}</h2>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-8 text-slate-300">{sub}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <TrialCta big source="cta-band" />
          <WaCta big source="cta-band" />
        </div>
      </div>
    </section>
  )
}

function Header({ active }) {
  const [open, setOpen] = useState(false)
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0c1631]/85 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 sm:px-8" aria-label="التنقل الرئيسي">
        <a href="/" className="flex items-center gap-3" aria-label={`${SITE_NAME} — الرئيسية`}>
          <img src="/nokhba-mark.svg" alt={`شعار ${SITE_NAME}`} className="h-9 w-9 rounded-xl shadow-lg shadow-black/30" />
          <span className="font-black tracking-tight">{SITE_NAME}</span>
        </a>
        <div className="hidden items-center gap-6 text-sm font-bold text-slate-300 lg:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={`transition hover:text-white ${active === n.href ? 'text-white' : ''}`} aria-current={active === n.href ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          <a href={loginHref} className="min-h-11 rounded-xl px-3 text-sm font-black leading-[2.75rem] text-slate-200 transition hover:bg-white/10">تسجيل الدخول</a>
          <TrialCta source="header" />
        </div>
        <button
          className="min-h-11 rounded-xl px-4 text-sm font-black text-slate-200 lg:hidden"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="القائمة"
        >
          {open ? '✕' : '☰'}
        </button>
      </nav>
      {open && (
        <div className="border-t border-white/10 bg-[#0c1631] px-5 pb-5 pt-3 lg:hidden">
          <div className="grid gap-1">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className={`min-h-11 rounded-xl px-3 text-sm font-bold leading-[2.75rem] text-slate-200 transition hover:bg-white/10 ${active === n.href ? 'bg-white/10 text-white' : ''}`}>
                {n.label}
              </a>
            ))}
            <a href={loginHref} className="min-h-11 rounded-xl px-3 text-sm font-bold leading-[2.75rem] text-slate-200 transition hover:bg-white/10">تسجيل الدخول</a>
            <TrialCta className="mt-2 w-full" source="header-mobile" />
          </div>
        </div>
      )}
    </header>
  )
}

function Footer() {
  const cols = [
    {
      title: 'المنتج',
      links: [
        ['المميزات', '/features'],
        ['الأسعار', '/pricing'],
        ['الحلول', '/solutions'],
        ['المصادر', '/resources'],
      ],
    },
    {
      title: 'الشركة',
      links: [
        ['من نحن', '/about'],
        ['تواصل معنا', '/contact'],
        ['ابدأ التجربة المجانية', '/trial'],
      ],
    },
    {
      title: 'قانوني',
      links: [['سياسة الخصوصية', '/privacy']],
    },
  ]
  return (
    <footer className="border-t border-white/10 bg-[#0a1226] px-5 py-12 sm:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-3">
            <img src="/nokhba-mark.svg" alt={`شعار ${SITE_NAME}`} className="h-9 w-9 rounded-xl" />
            <span className="font-black">{SITE_NAME}</span>
          </div>
          <p className="mt-4 text-sm leading-7 text-slate-400">
            منصة عربية لإدارة مراكز التعليم: الطلاب والحصص والحضور والامتحانات والتقارير والتحليل — من مكان واحد.
          </p>
          <WaCta className="mt-5" source="footer" label="واتساب" />
        </div>
        {cols.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <h3 className="text-sm font-black text-slate-200">{c.title}</h3>
            <ul className="mt-4 space-y-2.5 text-sm text-slate-400">
              {c.links.map(([label, href]) => (
                <li key={href}><a className="transition hover:text-white" href={href}>{label}</a></li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto mt-10 max-w-7xl border-t border-white/10 pt-6 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} {SITE_NAME} — كل الحقوق محفوظة.
      </div>
    </footer>
  )
}

export default function MarketingLayout({ active, children }) {
  return (
    <div className="lp-dark min-h-screen text-[#eef2fb]" dir="rtl">
      <Header active={active} />
      <main>{children}</main>
      <Footer />
      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noreferrer"
        onClick={() => track('whatsapp_click', { source: 'floating' })}
        aria-label="التواصل عبر WhatsApp"
        className="fixed bottom-5 left-5 z-50 inline-flex min-h-12 items-center gap-2 rounded-2xl bg-[#25D366] px-4 text-sm font-black text-[#06231a] shadow-xl shadow-emerald-900/30 transition hover:-translate-y-0.5 hover:bg-[#20bd5a]"
      >
        <span aria-hidden="true" className="text-lg leading-none">◉</span>
        <span className="hidden sm:inline">واتساب</span>
      </a>
    </div>
  )
}
