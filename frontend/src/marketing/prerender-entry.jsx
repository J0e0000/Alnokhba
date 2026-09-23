// ═══════════════════════════════════════════════════════════════════════════
// PRERENDER ROUTE TABLE — consumed by scripts/prerender.mjs at build time.
//
// WHY: AI crawlers (GPTBot, ClaudeBot, PerplexityBot…) don't execute JS, so
// the client-rendered marketing pages + their JSON-LD were invisible to them.
// Each route here is rendered to static HTML during `bun run build` (same
// build, same hashed assets — no drift, no headless browser needed).
// At runtime React's createRoot takes the container over (clears the static
// content and mounts the live app) — users see the usual splash → app flow.
// Page head configs are the SAME exported consts the pages use at runtime
// (single source of truth — no copy drift possible).
// ═══════════════════════════════════════════════════════════════════════════
import LandingPage, { SEO as HOME } from '../pages/LandingPage.jsx'
import FeaturesPage, { SEO as FEATURES } from './pages/FeaturesPage.jsx'
import {
  SolutionsPage,
  AboutPage,
  ContactPage,
  TrialPage,
  SEO_SOLUTIONS,
  SEO_ABOUT,
  SEO_CONTACT,
  SEO_TRIAL,
} from './pages/CorePages.jsx'
import PricingPage, { SEO as PRICING } from './pages/PricingPage.jsx'
import { ResourcesPage, ArticlePage, SEO as RESOURCES, articleSeo } from './pages/ResourcePages.jsx'
import PrivacyPage, { SEO as PRIVACY } from '../pages/PrivacyPage.jsx'
import { ARTICLES } from './articles.js'

export const PRERENDER_ROUTES = [
  // root: true → overwrite dist/index.html itself (the SPA entry, which also
  // serves as the rewrite fallback for /qr/* and /?auth=*).
  { path: '/', root: true, Component: LandingPage, head: HOME },
  { path: '/features', out: 'features/index.html', Component: FeaturesPage, head: FEATURES },
  { path: '/solutions', out: 'solutions/index.html', Component: SolutionsPage, head: SEO_SOLUTIONS },
  { path: '/pricing', out: 'pricing/index.html', Component: PricingPage, head: PRICING },
  { path: '/trial', out: 'trial/index.html', Component: TrialPage, head: SEO_TRIAL },
  { path: '/resources', out: 'resources/index.html', Component: ResourcesPage, head: RESOURCES },
  ...ARTICLES.map((article) => ({
    path: article.path,
    out: article.path.replace(/^\//, '') + '/index.html',
    Component: ArticlePage,
    props: { article },
    head: articleSeo(article),
  })),
  { path: '/about', out: 'about/index.html', Component: AboutPage, head: SEO_ABOUT },
  { path: '/contact', out: 'contact/index.html', Component: ContactPage, head: SEO_CONTACT },
  { path: '/privacy', out: 'privacy/index.html', Component: PrivacyPage, head: PRIVACY },
]
