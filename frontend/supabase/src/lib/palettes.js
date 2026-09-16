/**
 * 10 Nokhba-approved color palettes.
 *
 * Each palette defines:
 *   - key: unique identifier stored in workspace_branding.palette_key
 *   - name_ar / name_en: human-facing label
 *   - primary: main brand color (replaces --color-brand-navy)
 *   - primaryLight: lighter shade of primary
 *   - accent: accent/highlight color (replaces --color-brand-gold)
 *   - accentHover: darker shade of accent
 *   - bg: dark background tint (used in dark mode)
 *   - bgLight: light background tint (used in light mode)
 *
 * These are applied as CSS variables on :root by BrandingContext.
 * The default palette is 'nokhba-navy-gold' (the original Nokhba colors).
 *
 * Design principles:
 *   - All palettes are dark-mode-friendly (bg is always a dark tint)
 *   - All accents have sufficient contrast against the primary
 *   - No palette changes the layout/structure — only colors
 *   - The Nokhba identity stays recognizable (logo + app name)
 */

export const PALETTES = [
  {
    key: 'nokhba-navy-gold',
    name_ar: 'النخبة الكلاسيكي',
    name_en: 'Nokhba Classic',
    primary: '#001f43',
    primaryLight: '#1f3a60',
    accent: '#FFD700',
    accentHover: '#e6c200',
    bg: '#00132d',
    bgLight: '#f8fafc',
  },
  {
    key: 'emerald-gold',
    name_ar: 'زمردي ذهبي',
    name_en: 'Emerald Gold',
    primary: '#064e3b',
    primaryLight: '#065f46',
    accent: '#FFD700',
    accentHover: '#e6c200',
    bg: '#022c22',
    bgLight: '#ecfdf5',
  },
  {
    key: 'royal-purple',
    name_ar: 'بنفسجي ملكي',
    name_en: 'Royal Purple',
    primary: '#2e1065',
    primaryLight: '#4c1d95',
    accent: '#fbbf24',
    accentHover: '#f59e0b',
    bg: '#1e1b4b',
    bgLight: '#f5f3ff',
  },
  {
    key: 'sunset-orange',
    name_ar: 'برتقالي الغروب',
    name_en: 'Sunset Orange',
    primary: '#7c2d12',
    primaryLight: '#9a3412',
    accent: '#fde047',
    accentHover: '#facc15',
    bg: '#431407',
    bgLight: '#fff7ed',
  },
  {
    key: 'ocean-teal',
    name_ar: 'تيل المحيط',
    name_en: 'Ocean Teal',
    primary: '#134e4a',
    primaryLight: '#0f766e',
    accent: '#fbbf24',
    accentHover: '#f59e0b',
    bg: '#042f2e',
    bgLight: '#f0fdfa',
  },
  {
    key: 'midnight-blue',
    name_ar: 'أزرق منتصف الليل',
    name_en: 'Midnight Blue',
    primary: '#1e3a8a',
    primaryLight: '#1e40af',
    accent: '#fbbf24',
    accentHover: '#f59e0b',
    bg: '#172554',
    bgLight: '#eff6ff',
  },
  {
    key: 'crimson-rose',
    name_ar: 'قرمزي وردي',
    name_en: 'Crimson Rose',
    primary: '#831843',
    primaryLight: '#9f1239',
    accent: '#fde047',
    accentHover: '#facc15',
    bg: '#500724',
    bgLight: '#fff1f2',
  },
  {
    key: 'forest-green',
    name_ar: 'أخضر الغابة',
    name_en: 'Forest Green',
    primary: '#14532d',
    primaryLight: '#166534',
    accent: '#fde047',
    accentHover: '#facc15',
    bg: '#052e16',
    bgLight: '#f0fdf4',
  },
  {
    key: 'graphite-cyan',
    name_ar: 'رصاصي سماوي',
    name_en: 'Graphite Cyan',
    primary: '#18181b',
    primaryLight: '#27272a',
    accent: '#06b6d4',
    accentHover: '#0891b2',
    bg: '#09090b',
    bgLight: '#f4f4f5',
  },
  {
    key: 'burgundy-cream',
    name_ar: 'خمري كريمي',
    name_en: 'Burgundy Cream',
    primary: '#5b1a1a',
    primaryLight: '#7c2d2d',
    accent: '#fef3c7',
    accentHover: '#fde68a',
    bg: '#3b0d0d',
    bgLight: '#fefce8',
  },
]

/** Get a palette by key, falling back to the default Nokhba palette */
export function getPalette(key) {
  return PALETTES.find((p) => p.key === key) || PALETTES[0]
}

/** The default palette key — used when no branding is configured */
export const DEFAULT_PALETTE_KEY = 'nokhba-navy-gold'
