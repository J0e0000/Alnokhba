import { useState, useEffect } from 'react'
import Modal from './Modal'
import { useBranding } from '../context/BrandingContext'
import { PALETTES } from '../lib/palettes'
import { supabase } from '../lib/supabaseClient'
import { useToast } from '../context/ToastContext'

/**
 * BrandingModal — UI for the teacher to configure their workspace branding.
 * Sections: Identity (display name, center name, logo) | Theme (palette) | Language
 * Saves to workspace_branding table via BrandingContext.updateBranding().
 */
export default function BrandingModal({ open, onClose }) {
  const { branding, updateBranding } = useBranding()
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState('')
  const [form, setForm] = useState({
    display_name: '',
    center_name: '',
    palette_key: 'nokhba-navy-gold',
    language: 'ar',
    contact_email: '',
    contact_phone: '',
    address: '',
    portal_header_text: '',
    portal_welcome_message: '',
    report_footer: '',
    communication_signature: '',
  })

  useEffect(() => {
    if (branding) {
      setForm({
        display_name: branding.display_name || '',
        center_name: branding.center_name || '',
        palette_key: branding.palette_key || 'nokhba-navy-gold',
        language: branding.language || 'ar',
        contact_email: branding.contact_email || '',
        contact_phone: branding.contact_phone || '',
        address: branding.address || '',
        portal_header_text: branding.portal_header_text || '',
        portal_welcome_message: branding.portal_welcome_message || '',
        report_footer: branding.report_footer || '',
        communication_signature: branding.communication_signature || '',
      })
      setLogoPreview(branding.logo_url || '')
    }
  }, [branding, open])

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml']
    if (!allowed.includes(file.type)) {
      showToast('صيغة غير مدعومة. استخدم PNG أو JPG أو SVG.', 'error')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('الحجم كبير. الحد الأقصى 2 ميجابايت.', 'error')
      return
    }
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setLogoPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  const removeLogo = async () => {
    setLogoFile(null)
    setLogoPreview('')
    // If there was a logo saved, remove it from storage
    if (branding?.logo_url) {
      try {
        const url = new URL(branding.logo_url)
        const path = url.pathname.split('/teacher-logos/')[1]
        if (path) await supabase.storage.from('teacher-logos').remove([path])
      } catch {}
    }
  }

  const uploadLogo = async (userId) => {
    if (!logoFile) return branding?.logo_url || null
    const ext = logoFile.name.split('.').pop().toLowerCase()
    const path = `${userId}/logo.${ext}`
    const { error: upErr } = await supabase.storage
      .from('teacher-logos')
      .upload(path, logoFile, { upsert: true, contentType: logoFile.type })
    if (upErr) throw upErr
    const { data } = supabase.storage.from('teacher-logos').getPublicUrl(path)
    return data.publicUrl
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { useAuth } = await import('../context/AuthContext')
      // We can't call useAuth here (it's a hook), so we get the user from the
      // branding context's teacher_id
      const teacherId = branding?.teacher_id
      let logoUrl = branding?.logo_url || null
      if (logoFile && teacherId) {
        logoUrl = await uploadLogo(teacherId)
      } else if (!logoPreview && branding?.logo_url) {
        logoUrl = null // logo was removed
      }

      const { error } = await updateBranding({
        ...form,
        logo_url: logoUrl,
      })
      if (error) throw error
      showToast('تم حفظ الهوية', 'success')
      onClose()
    } catch (err) {
      console.error('Save branding error:', err)
      showToast('فشل الحفظ: ' + (err.message || 'خطأ'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="🎨 هوية المساحة" wide>
      <div className="space-y-5">
        {/* ─── Logo ─── */}
        <div className="flex flex-col items-center">
          <div className="w-24 h-24 rounded-full bg-brand-navy border-2 border-brand-gold flex items-center justify-center overflow-hidden mb-2">
            {logoPreview ? (
              <img src={logoPreview} alt="logo" className="w-full h-full object-cover" />
            ) : (
              <span className="text-3xl">📷</span>
            )}
          </div>
          <div className="flex gap-2">
            <label className="text-xs text-brand-gold-hover hover:text-brand-gold font-bold cursor-pointer">
              {logoPreview ? 'تغيير الشعار' : 'رفع شعار'}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleLogoChange} />
            </label>
            {logoPreview && (
              <button onClick={removeLogo} className="text-rose-400 text-xs">إزالة</button>
            )}
          </div>
          <p className="text-fg-subtle text-[10px] mt-1">PNG / JPG / SVG · حد أقصى 2 ميجابايت</p>
        </div>

        {/* ─── Identity ─── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-fg-subtle mb-1">الاسم المعروض</label>
            <input
              type="text" value={form.display_name} onChange={(e) => handleChange('display_name', e.target.value)}
              placeholder="مستر أحمد"
              className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold"
            />
          </div>
          <div>
            <label className="block text-sm text-fg-subtle mb-1">اسم المركز/المدرسة</label>
            <input
              type="text" value={form.center_name} onChange={(e) => handleChange('center_name', e.target.value)}
              placeholder="أكاديمية النخبة"
              className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold"
            />
          </div>
        </div>

        {/* ─── Palette ─── */}
        <div>
          <label className="block text-sm text-fg-muted mb-2 font-bold">لوحة الألوان</label>
          <div className="grid grid-cols-5 gap-2">
            {PALETTES.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => handleChange('palette_key', p.key)}
                title={p.name_ar}
                className={`aspect-square rounded-lg border-2 transition-all ${form.palette_key === p.key ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                style={{ background: `linear-gradient(135deg, ${p.primary} 0%, ${p.accent} 100%)` }}
              />
            ))}
          </div>
          <p className="text-fg-subtle text-[11px] mt-1">
            {PALETTES.find((p) => p.key === form.palette_key)?.name_ar} · {PALETTES.find((p) => p.key === form.palette_key)?.name_en}
          </p>
        </div>

        {/* ─── Language ─── */}
        <div>
          <label className="block text-sm text-fg-muted mb-2 font-bold">اللغة الافتراضية للمساحة</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleChange('language', 'ar')}
              className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${form.language === 'ar' ? 'bg-brand-gold text-brand-navy border-brand-gold' : 'glass-input border-subtle text-fg-subtle'}`}
            >عربي</button>
            <button
              type="button"
              onClick={() => handleChange('language', 'en')}
              className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${form.language === 'en' ? 'bg-brand-gold text-brand-navy border-brand-gold' : 'glass-input border-subtle text-fg-subtle'}`}
            >English</button>
          </div>
        </div>

        {/* ─── Contact (optional) ─── */}
        <details className="border-t border-subtle pt-3">
          <summary className="text-sm font-bold text-fg-muted cursor-pointer">معلومات التواصل (اختياري)</summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-sm text-fg-subtle mb-1">إيميل التواصل</label>
              <input
                type="email" value={form.contact_email} onChange={(e) => handleChange('contact_email', e.target.value)}
                className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-sm text-fg-subtle mb-1">هاتف التواصل</label>
              <input
                type="tel" value={form.contact_phone} onChange={(e) => handleChange('contact_phone', e.target.value)}
                className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold"
                dir="ltr"
              />
            </div>
          </div>
          <div className="mt-2">
            <label className="block text-sm text-fg-subtle mb-1">العنوان</label>
            <input
              type="text" value={form.address} onChange={(e) => handleChange('address', e.target.value)}
              className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold"
            />
          </div>
        </details>

        {/* ─── Portal & Communication (optional) ─── */}
        <details className="border-t border-subtle pt-3">
          <summary className="text-sm font-bold text-fg-muted cursor-pointer">تخصيص البوابة والرسائل (اختياري)</summary>
          <div className="space-y-3 mt-3">
            <div>
              <label className="block text-sm text-fg-subtle mb-1">عنوان البوابة</label>
              <input
                type="text" value={form.portal_header_text} onChange={(e) => handleChange('portal_header_text', e.target.value)}
                placeholder="مرحباً بكم في بوابة النخبة"
                className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold"
              />
            </div>
            <div>
              <label className="block text-sm text-fg-subtle mb-1">رسالة الترحيب</label>
              <textarea
                value={form.portal_welcome_message} onChange={(e) => handleChange('portal_welcome_message', e.target.value)}
                rows={2}
                className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold"
              />
            </div>
            <div>
              <label className="block text-sm text-fg-subtle mb-1">توقيع الرسائل</label>
              <input
                type="text" value={form.communication_signature} onChange={(e) => handleChange('communication_signature', e.target.value)}
                placeholder="مستر أحمد | نخبة EDU"
                className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold"
              />
            </div>
            <div>
              <label className="block text-sm text-fg-subtle mb-1">تذييل التقارير</label>
              <input
                type="text" value={form.report_footer} onChange={(e) => handleChange('report_footer', e.target.value)}
                placeholder="© 2024 أكاديمية النخبة"
                className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold"
              />
            </div>
          </div>
        </details>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full btn-glow disabled:opacity-50 font-bold py-3 rounded-xl text-sm"
        >
          {saving ? 'جاري الحفظ...' : 'حفظ الهوية'}
        </button>
      </div>
    </Modal>
  )
}
