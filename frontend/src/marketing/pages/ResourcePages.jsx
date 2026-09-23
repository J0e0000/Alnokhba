// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC RESOURCES pages — hub + article renderer (Phase 8 / GEO content).
// ═══════════════════════════════════════════════════════════════════════════
import MarketingLayout, { CtaBand, TrialCta } from '../MarketingLayout.jsx'
import { useSeo, articleSchema, breadcrumbSchema } from '../seo.js'
import { ARTICLES } from '../articles.js'
import { SCREENS } from '../config.js'

// Real product screenshot per article (og:image) — keyed by slug.
const ARTICLE_IMAGES = {
  'what-is-center-management-system': SCREENS.dashboard,
  'attendance-management': SCREENS.mobile,
  'excel-vs-center-management': SCREENS.reports,
  'choose-center-management-egypt': SCREENS.insights,
}

export function ResourcesPage() {
  useSeo({
    title: 'المصادر — أدلة إدارة مراكز التعليم | النخبة',
    description: 'أدلة عملية لإدارة مراكز ودروس التعليم: ما هو نظام إدارة المركز، إدارة الحضور والغياب، Excel مقابل النظام المتخصص، وكيف تختار نظامك في مصر.',
    path: '/resources',
    image: SCREENS.insights,
    jsonLd: breadcrumbSchema([{ name: 'الرئيسية', path: '/' }, { name: 'المصادر', path: '/resources' }]),
  })
  return (
    <MarketingLayout active="/resources">
      <section className="mx-auto max-w-7xl px-5 pb-10 pt-14 sm:px-8">
        <span className="lp-eyebrow">المصادر</span>
        <h1 className="mt-5 max-w-3xl text-4xl font-black leading-[1.2] tracking-tight sm:text-5xl">
          أدلة عملية لإدارة مركزك — مكتوبة من داخل الشغل.
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300">
          لا حشو ولا كلام عام: كل دليل هنا بيجاوب على سؤال حقيقي بيسأله أصحاب المراكز قبل وأثناء التحول لنظام إدارة.
        </p>
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8">
        <div className="grid gap-4 md:grid-cols-2">
          {ARTICLES.map((a) => (
            <article key={a.slug} className="lp-glow-card flex flex-col rounded-3xl border border-white/10 bg-white/[0.05] p-7">
              <h2 className="text-xl font-black leading-8">
                <a href={a.path} className="transition hover:text-[#FBBF6D]">{a.title}</a>
              </h2>
              <p className="mt-3 flex-1 text-sm leading-7 text-slate-300/90">{a.description}</p>
              <a href={a.path} className="mt-5 inline-flex items-center gap-2 text-sm font-black text-[#FBBF6D]">
                اقرأ الدليل <span aria-hidden="true">←</span>
              </a>
            </article>
          ))}
        </div>
      </section>
      <CtaBand title="طبّق اللي قريته على مركزك مباشرة." sub="ابدأ تجربة مجانية ١٤ يوم — وشوف المسار بنفسك." />
    </MarketingLayout>
  )
}

function ArticleBlock({ b }) {
  const [kind, a, bb] = b
  if (kind === 'h') return <h2 className="mt-10 text-2xl font-black leading-9">{a}</h2>
  if (kind === 'p') return <p className="mt-4 leading-8 text-slate-300/95">{a}</p>
  if (kind === 'qa') {
    return (
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
        <h3 className="font-black text-[#FBBF6D]">{a}</h3>
        <p className="mt-2 text-sm leading-7 text-slate-300/90">{bb}</p>
      </div>
    )
  }
  if (kind === 'table') {
    // b = ['table', headers..., row1..., ...] flattened — slice out headers & rows
    const headers = a
    const rows = b.slice(2)
    return (
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm" dir="rtl">
          <thead>
            <tr>
              {a.map((h) => (
                <th key={h} className="border-b border-white/15 bg-white/[0.06] px-4 py-3 text-right font-black text-[#FBBF6D]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={i % 2 ? 'bg-white/[0.03]' : ''}>
                {row.map((c, j) => (
                  <td key={j} className="border-b border-white/10 px-4 py-3 leading-7 text-slate-200">{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return null
}

export function ArticlePage({ article }) {
  useSeo({
    title: `${article.title} | مصادر النخبة`,
    description: article.description,
    path: article.path,
    image: ARTICLE_IMAGES[article.slug],
    jsonLd: [
      articleSchema(article),
      breadcrumbSchema([{ name: 'الرئيسية', path: '/' }, { name: 'المصادر', path: '/resources' }, { name: article.title, path: article.path }]),
    ],
  })
  return (
    <MarketingLayout active="/resources">
      <article className="mx-auto max-w-3xl px-5 pb-16 pt-14 sm:px-8">
        <nav aria-label="مسار الصفحة" className="text-xs font-bold text-slate-400">
          <a href="/" className="hover:text-white">الرئيسية</a> <span aria-hidden="true">←</span>{' '}
          <a href="/resources" className="hover:text-white">المصادر</a> <span aria-hidden="true">←</span>{' '}
          <span className="text-slate-300">{article.title.slice(0, 40)}…</span>
        </nav>
        <h1 className="mt-6 text-3xl font-black leading-[1.3] tracking-tight sm:text-4xl">{article.title}</h1>
        <p className="mt-4 border-r-2 border-[#FB9C1B]/50 pr-4 text-base leading-8 text-slate-300">{article.description}</p>
        <div className="mt-8">
          {article.body.map((b, i) => <ArticleBlock key={i} b={b} />)}
        </div>
        <div className="mt-12 rounded-3xl border border-nk-300/25 bg-gradient-to-b from-nk-400/[0.08] to-transparent p-7 text-center">
          <h2 className="text-xl font-black">جرّب النظام ده على مركزك — مجانًا.</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-slate-300">
            ١٤ يوم تجربة كاملة بدون بطاقة دفع — وشوف الفرق بين الملف والنظام بنفسك.
          </p>
          <div className="mt-5 flex justify-center"><TrialCta big source={`article:${article.slug}`} /></div>
        </div>
      </article>
    </MarketingLayout>
  )
}
