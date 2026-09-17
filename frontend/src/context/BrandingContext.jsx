import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthContext'
import { useTheme } from './ThemeContext'
import { getPalette, DEFAULT_PALETTE_KEY } from '../lib/palettes'

const BrandingContext = createContext(null)

// Relative luminance (WCAG) — used to derive a contrast-safe accent for TEXT.
function luminance(hex) {
  const h = String(hex || '#000').replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrastRatio(l1, l2) {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}
// Darken a hex color by mixing toward black (factor 0..1).
function darken(hex, factor) {
  const h = String(hex || '#000').replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = Math.round(parseInt(full.slice(0, 2), 16) * (1 - factor))
  const g = Math.round(parseInt(full.slice(2, 4), 16) * (1 - factor))
  const b = Math.round(parseInt(full.slice(4, 6), 16) * (1 - factor))
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
// Accent used as TEXT on the app background: light accents (#FFD700) are
// unreadable on light surfaces, so derive a darkened variant that hits
// ≈4.5:1 in light mode; in dark mode the raw accent is already high-contrast.
function textSafeAccent(accent, isDark) {
  if (isDark) return accent
  const target = luminance('#f5f8fc')
  let candidate = accent
  for (let factor = 0.1; factor <= 0.95; factor += 0.05) {
    candidate = darken(accent, factor)
    if (contrastRatio(luminance(candidate), target) >= 4.5) return candidate
  }
  return candidate
}

/**
 * BrandingContext — loads the teacher's workspace branding and applies it
 * as CSS variables on :root. Falls back to the default Nokhba palette
 * (navy/gold) when no branding is configured.
 *
 * CSS variables applied (contrast-safe in BOTH themes):
 *   --brand-navy / --color-brand-navy        → palette.primary
 *   --brand-navy-light / --color-brand-navy-light → palette.primaryLight
 *   --brand-gold / --color-brand-gold        → text-safe accent (theme-aware)
 *   --color-brand-gold-hover                 → accentHover (or darkened)
 *   --app-bg                                 → palette.bg (dark mode only)
 *
 * Branding object shape:
 *   { display_name, center_name, logo_url, palette_key, language,
 *     contact_email, contact_phone, address, social_links,
 *     portal_header_text, portal_welcome_message, report_footer,
 *     exam_header, communication_signature }
 */
export function BrandingProvider({ children }) {
  const { effectiveTeacherId, isAssistant, ownerProfile } = useAuth()
  const { isDark } = useTheme()
  const [branding, setBranding] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!effectiveTeacherId) {
      setBranding(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('workspace_branding')
      .select('*')
      .eq('teacher_id', effectiveTeacherId)
      .maybeSingle()
    if (!error && data) {
      setBranding(data)
    } else {
      setBranding(null)
    }
    setLoading(false)
  }, [effectiveTeacherId])

  useEffect(() => { load() }, [load])

  // Apply CSS variables whenever branding or theme changes — contrast-safe
  // in both themes (a light accent like #FFD700 is darkened for light mode).
  useEffect(() => {
    const paletteKey = branding?.palette_key || DEFAULT_PALETTE_KEY
    const palette = getPalette(paletteKey)
    const root = document.documentElement
    const accent = textSafeAccent(palette.accent, isDark)
    const accentHover = isDark ? palette.accentHover : textSafeAccent(palette.accentHover, isDark)
    root.style.setProperty('--brand-navy', palette.primary)
    root.style.setProperty('--brand-navy-light', palette.primaryLight)
    root.style.setProperty('--brand-gold', accent)
    root.style.setProperty('--brand-gold-hover', accentHover)
    root.style.setProperty('--color-brand-navy', palette.primary)
    root.style.setProperty('--color-brand-navy-light', palette.primaryLight)
    root.style.setProperty('--color-brand-gold', accent)
    root.style.setProperty('--color-brand-gold-hover', accentHover)
    // Only override --app-bg in dark mode (light mode keeps its own bg)
    if (isDark) {
      root.style.setProperty('--app-bg', palette.bg)
    } else {
      root.style.removeProperty('--app-bg')
    }
  }, [branding, isDark])

  const updateBranding = useCallback(async (patch) => {
    if (!effectiveTeacherId) return { error: { message: 'Not authenticated' } }
    const { data, error } = await supabase
      .from('workspace_branding')
      .upsert({ teacher_id: effectiveTeacherId, ...patch, updated_at: new Date().toISOString() })
      .select()
      .single()
    if (!error) setBranding(data)
    return { data, error }
  }, [effectiveTeacherId])

  const value = {
    branding,
    loading,
    updateBranding,
    refresh: load,
    // Convenience getters with sensible defaults
    displayName: branding?.display_name || ownerProfile?.full_name || '',
    centerName: branding?.center_name || '',
    logoUrl: branding?.logo_url || '',
    paletteKey: branding?.palette_key || DEFAULT_PALETTE_KEY,
    language: branding?.language || 'ar',
    isAssistant,
  }

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  )
}

export function useBranding() {
  const ctx = useContext(BrandingContext)
  if (!ctx) throw new Error('useBranding must be used inside BrandingProvider')
  return ctx
}
