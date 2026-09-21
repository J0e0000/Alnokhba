// ═══════════════════════════════════════════════════════════════════════════
// MARKETING ROUTER — maps public paths to pages. No router library: the app
// already gates by window.location.pathname (same pattern as /privacy), and
// inter-page navigation uses real <a href> so every marketing URL is a clean,
// directly-loadable address (works with Vercel/Netlify SPA rewrites).
// ═══════════════════════════════════════════════════════════════════════════
import FeaturesPage from './pages/FeaturesPage.jsx'
import PricingPage from './pages/PricingPage.jsx'
import { SolutionsPage, AboutPage, ContactPage, TrialPage } from './pages/CorePages.jsx'
import { ResourcesPage, ArticlePage } from './pages/ResourcePages.jsx'
import { getArticle } from './articles.js'
import { track } from './config.js'
import { useEffect } from 'react'

export default function MarketingRouter() {
  const path = window.location.pathname
  useEffect(() => { track('page_view', { path }) }, [path])

  if (path === '/features') return <FeaturesPage />
  if (path === '/pricing') return <PricingPage />
  if (path === '/solutions') return <SolutionsPage />
  if (path === '/about') return <AboutPage />
  if (path === '/contact') return <ContactPage />
  if (path === '/trial') return <TrialPage />
  if (path === '/resources') return <ResourcesPage />
  const slug = path.match(/^\/resources\/([a-z0-9-]+)\/?$/)?.[1]
  if (slug) {
    const article = getArticle(slug)
    if (article) return <ArticlePage article={article} />
  }
  // Unknown marketing path → home (never a dead end)
  window.location.replace('/')
  return null
}
