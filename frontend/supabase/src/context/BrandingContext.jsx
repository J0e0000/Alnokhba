import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthContext'
import { getPalette, DEFAULT_PALETTE_KEY } from '../lib/palettes'

const BrandingContext = createContext(null)

/**
 * BrandingContext — loads the teacher's workspace branding and applies it
 * as CSS variables on :root. Falls back to the default Nokhba palette
 * (navy/gold) when no branding is configured.
 *
 * CSS variables applied:
 *   --color-brand-navy        → palette.primary
 *   --color-brand-navy-light  → palette.primaryLight
 *   --color-brand-gold        → palette.accent
 *   --color-brand-gold-hover  → palette.accentHover
 *   --app-bg                   → palette.bg (dark mode)
 *
 * Branding object shape:
 *   { display_name, center_name, logo_url, palette_key, language,
 *     contact_email, contact_phone, address, social_links,
 *     portal_header_text, portal_welcome_message, report_footer,
 *     exam_header, communication_signature }
 */
export function BrandingProvider({ children }) {
  const { effectiveTeacherId, isAssistant, ownerProfile } = useAuth()
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

  // Apply CSS variables whenever branding changes
  useEffect(() => {
    const paletteKey = branding?.palette_key || DEFAULT_PALETTE_KEY
    const palette = getPalette(paletteKey)
    const root = document.documentElement
    root.style.setProperty('--color-brand-navy', palette.primary)
    root.style.setProperty('--color-brand-navy-light', palette.primaryLight)
    root.style.setProperty('--color-brand-gold', palette.accent)
    root.style.setProperty('--color-brand-gold-hover', palette.accentHover)
    // Only override --app-bg if we're in dark mode (light mode keeps its own bg)
    if (!document.documentElement.classList.contains('light')) {
      root.style.setProperty('--app-bg', palette.bg)
    }
  }, [branding])

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
