// ═══════════════════════════════════════════════════════════════════════════
// SEO head manager for the SPA marketing site.
// Each marketing page calls setSeo() on mount — it updates title/meta/canonical
// and injects JSON-LD. Previous page tags are cleaned up on unmount so pages
// never leak each other's metadata.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect } from 'react'
import { SITE_URL } from './config.js'

const JSONLD_ID = 'nk-jsonld'

function setMeta(attr, key, content) {
  if (!content) return
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

/**
 * @param {{ title: string, description: string, path: string, image?: {src: string, w: number, h: number}, jsonLd?: object|object[] }} cfg
 *
 * `image` = real product screenshot (see config.js SCREENS). When provided we
 * set page-specific og:image + twitter card so WhatsApp/Facebook shares show
 * the actual product instead of the generic logo. Omitted → template statics
 * (logo / summary card) stay untouched.
 */
export function setSeo({ title, description, path, image, jsonLd }) {
  const url = SITE_URL + path
  document.title = title
  setMeta('name', 'description', description)
  setMeta('property', 'og:title', title)
  setMeta('property', 'og:description', description)
  setMeta('property', 'og:url', url)
  if (image) {
    setMeta('property', 'og:image', SITE_URL + image.src)
    setMeta('property', 'og:image:width', String(image.w))
    setMeta('property', 'og:image:height', String(image.h))
    setMeta('property', 'og:image:alt', title)
    setMeta('name', 'twitter:card', 'summary_large_image')
    setMeta('name', 'twitter:image', SITE_URL + image.src)
  }
  let link = document.head.querySelector('link[rel="canonical"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'canonical'
    document.head.appendChild(link)
  }
  link.href = url
  if (jsonLd) {
    document.getElementById(JSONLD_ID)?.remove()
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.id = JSONLD_ID
    script.textContent = JSON.stringify(jsonLd)
    document.head.appendChild(script)
  }
  return () => {
    document.getElementById(JSONLD_ID)?.remove()
  }
}

/** useSeo hook — sets on mount, restores on unmount. */
export function useSeo(cfg) {
  useEffect(() => setSeo(cfg), [cfg.title, cfg.description, cfg.path]) // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Shared schema builders (GEO / Phase 9) ────────────────────────────────
export const orgSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'النخبة | Alnokhba Edu',
  url: SITE_URL,
  logo: `${SITE_URL}/logo-512.png`,
  description: 'منصة عربية لإدارة مراكز وأنظمة التعليم: الطلاب، الحصص، الحضور والغياب، الواجبات، الامتحانات، التقارير، وتحليل الأداء.',
  areaServed: ['EG', 'SA', 'MENA'],
  knowsLanguage: ['ar', 'en'],
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer support',
    availableLanguage: ['Arabic', 'English'],
  },
}

export const softwareAppSchema = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'النخبة | Alnokhba Edu',
  applicationCategory: 'BusinessApplication',
  applicationSubCategory: 'Education Center Management System',
  operatingSystem: 'Web, Android, iOS (PWA)',
  inLanguage: 'ar',
  url: SITE_URL,
  description: 'نظام إدارة مراكز تعليمية: طلاب، مجموعات، حصص، حضور وغياب، واجبات، امتحانات ودرجات، تقارير أولياء أمور عبر واتساب، وتحليل أداء أسبوعي.',
  featureList: [
    'إدارة الطلاب والمجموعات',
    'مسار الحصة: حضور، تفاعل، واجب، امتحان، تقرير',
    'تقارير واتساب لأولياء الأمور مع قائمة إرسال منظمة',
    'بوابة طالب برابط QR',
    'فريق التحليل: رؤى أسبوعية مبنية على قواعد وتحقق من الأثر',
  ],
}

export const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'النخبة | Alnokhba Edu',
  url: SITE_URL,
  inLanguage: 'ar',
}

export const faqSchema = (faqs) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map(([q, a]) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
})

export const breadcrumbSchema = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: it.name,
    item: SITE_URL + it.path,
  })),
})

export const articleSchema = (a) => ({
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: a.title,
  description: a.description,
  inLanguage: 'ar',
  author: { '@type': 'Organization', name: 'النخبة | Alnokhba Edu' },
  publisher: { '@type': 'Organization', name: 'النخبة | Alnokhba Edu', logo: { '@type': 'ImageObject', url: `${SITE_URL}/logo-512.png` } },
  mainEntityOfPage: SITE_URL + a.path,
  datePublished: a.date,
  dateModified: a.date,
})
