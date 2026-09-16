import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { PALETTES, DEFAULT_PALETTE_KEY } from '../lib/palettes'

/**
 * Onboarding — shown after a new user confirms their email.
 * Asks: "How will you use Nokhba?" → Teacher or Assistant.
 *
 * If Teacher: collects display name, optional center name, logo, palette, language.
 * If Assistant: shows a search box to find their teacher and send a request.
 *
 * On completion, calls onComplete() which App.jsx uses to continue the normal
 * auth flow (show Dashboard for teacher, show "pending" for assistant).
 */
export default function Onboarding({ onComplete }) {
  const { user, profile } = useAuth()
  const [step, setStep] = useState('choose') // choose | teacher | assistant | done
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Teacher form state
  const [displayName, setDisplayName] = useState(profile?.full_name || '')
  const [centerName, setCenterName] = useState('')
  const [paletteKey, setPaletteKey] = useState(DEFAULT_PALETTE_KEY)
  const [language, setLanguage] = useState('ar')
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState('')

  // Assistant form state
  const [teacherSearch, setTeacherSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selectedTeacher, setSelectedTeacher] = useState(null)
  const [requestMessage, setRequestMessage] = useState('')
  const [requestSent, setRequestSent] = useState(false)

  const handleChoose = (type) => {
    setError('')
    setStep(type)
  }

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Validate type
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml']
    if (!allowed.includes(file.type)) {
      setError('صيغة الملف غير مدعومة. استخدم PNG أو JPG أو SVG.')
      return
    }
    // Validate size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setError('حجم الملف كبير. الحد الأقصى 2 ميجابايت.')
      return
    }
    setLogoFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setLogoPreview(ev.target.result)
    reader.readAsDataURL(file)
    setError('')
  }

  const uploadLogo = async () => {
    if (!logoFile || !user) return ''
    const ext = logoFile.name.split('.').pop().toLowerCase()
    const path = `${user.id}/logo.${ext}`
    const { error: upErr } = await (await import('../lib/supabaseClient')).supabase.storage
      .from('teacher-logos')
      .upload(path, logoFile, { upsert: true, contentType: logoFile.type })
    if (upErr) throw upErr
    const { data } = (await import('../lib/supabaseClient')).supabase.storage
      .from('teacher-logos')
      .getPublicUrl(path)
    return data.publicUrl
  }

  const submitTeacher = async () => {
    setLoading(true)
    setError('')
    try {
      const logoUrl = logoFile ? await uploadLogo() : ''
      const { supabase } = await import('../lib/supabaseClient')
      // Update account_type
      await supabase.from('profiles').update({ account_type: 'teacher' }).eq('id', user.id)
      // Upsert branding
      const { error: bErr } = await supabase.from('workspace_branding').upsert({
        teacher_id: user.id,
        display_name: displayName.trim() || profile?.full_name,
        center_name: centerName.trim() || null,
        logo_url: logoUrl || null,
        palette_key: paletteKey,
        language,
      })
      if (bErr) throw bErr
      setStep('done')
      setTimeout(() => onComplete(), 1500)
    } catch (err) {
      console.error('Onboarding teacher error:', err)
      setError(err.message || 'حدث خطأ. حاول مرة أخرى.')
    } finally {
      setLoading(false)
    }
  }

  const searchTeachers = async () => {
    if (!teacherSearch.trim()) return
    const { supabase } = await import('../lib/supabaseClient')
    const { data } = await supabase.rpc('search_teachers_for_onboarding', { p_query: teacherSearch.trim() })
    setSearchResults(data || [])
  }

  const sendRequest = async () => {
    if (!selectedTeacher) return
    setLoading(true)
    setError('')
    try {
      const { supabase } = await import('../lib/supabaseClient')
      // Update account_type
      await supabase.from('profiles').update({ account_type: 'assistant' }).eq('id', user.id)
      // Create request
      const { error: rErr } = await supabase.from('assistant_requests').insert({
        teacher_id: selectedTeacher.id,
        assistant_id: user.id,
        message: requestMessage.trim() || null,
        status: 'pending',
      })
      if (rErr) throw rErr
      setRequestSent(true)
    } catch (err) {
      console.error('Send request error:', err)
      setError(err.message || 'حدث خطأ. حاول مرة أخرى.')
    } finally {
      setLoading(false)
    }
  }

  // ─── Step: Choose role ───
  if (step === 'choose') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
        <div className="w-full max-w-md glass-card rounded-2xl p-8 shadow-2xl text-center">
          <img src="/nokhba-mark.svg" alt="النخبة" className="w-16 h-16 mx-auto mb-3" />
          <h1 className="text-2xl font-black text-fg mb-2">أهلاً بك في النخبة</h1>
          <p className="text-fg-subtle text-sm mb-8">إزاي هتستخدم النخبة؟</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleChoose('teacher')}
              className="glass-input hover:border-brand-gold border border-subtle rounded-xl p-6 transition-colors text-center group"
            >
              <div className="text-4xl mb-2">👨‍🏫</div>
              <p className="font-bold text-fg">مدرّس</p>
              <p className="text-fg-subtle text-[11px] mt-1">عندك طلاب وبتدرّس</p>
            </button>
            <button
              onClick={() => handleChoose('assistant')}
              className="glass-input hover:border-brand-gold border border-subtle rounded-xl p-6 transition-colors text-center group"
            >
              <div className="text-4xl mb-2">👨‍💼</div>
              <p className="font-bold text-fg">مساعد</p>
              <p className="text-fg-subtle text-[11px] mt-1">بتساعد مدرّس معيّن</p>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Step: Teacher onboarding ───
  if (step === 'teacher') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
        <div className="w-full max-w-md glass-card rounded-2xl p-8 shadow-2xl">
          <h1 className="text-xl font-black text-fg mb-1 text-center">إعداد مساحة العمل</h1>
          <p className="text-fg-subtle text-sm mb-6 text-center">تقدر تكمّل ده بعدين من الإعدادات</p>

          <div className="space-y-4">
            {/* Logo */}
            <div className="flex flex-col items-center">
              <div className="w-20 h-20 rounded-full bg-brand-navy border-2 border-brand-gold flex items-center justify-center overflow-hidden mb-2">
                {logoPreview ? (
                  <img src={logoPreview} alt="logo preview" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl">📷</span>
                )}
              </div>
              <label className="text-xs text-brand-gold-hover hover:text-brand-gold font-bold cursor-pointer">
                رفع شعار (اختياري)
                <input type="file" accept="image/png,image/jpeg,image/jpg,image/svg+xml" className="hidden" onChange={handleLogoChange} />
              </label>
              {logoPreview && (
                <button onClick={() => { setLogoFile(null); setLogoPreview('') }} className="text-rose-400 text-[11px] mt-1">إزالة</button>
              )}
            </div>

            {/* Display name */}
            <div>
              <label className="block text-sm text-fg-subtle mb-1">الاسم المعروض</label>
              <input
                type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                placeholder="مثال: مستر أحمد"
                className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold"
              />
            </div>

            {/* Center name */}
            <div>
              <label className="block text-sm text-fg-subtle mb-1">اسم المركز/المدرسة (اختياري)</label>
              <input
                type="text" value={centerName} onChange={(e) => setCenterName(e.target.value)}
                placeholder="مثال: أكاديمية النخبة"
                className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold"
              />
            </div>

            {/* Palette */}
            <div>
              <label className="block text-sm text-fg-subtle mb-2">اختر لوحة الألوان</label>
              <div className="grid grid-cols-5 gap-2">
                {PALETTES.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPaletteKey(p.key)}
                    title={p.name_ar}
                    className={`aspect-square rounded-lg border-2 transition-all ${paletteKey === p.key ? 'border-white scale-110' : 'border-transparent hover:scale-105'}`}
                    style={{ background: `linear-gradient(135deg, ${p.primary} 0%, ${p.accent} 100%)` }}
                  />
                ))}
              </div>
              <p className="text-fg-subtle text-[11px] mt-1">{PALETTES.find((p) => p.key === paletteKey)?.name_ar}</p>
            </div>

            {/* Language */}
            <div>
              <label className="block text-sm text-fg-subtle mb-1">اللغة</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLanguage('ar')}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${language === 'ar' ? 'bg-brand-gold text-brand-navy border-brand-gold' : 'glass-input border-subtle text-fg-subtle'}`}
                >عربي</button>
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${language === 'en' ? 'bg-brand-gold text-brand-navy border-brand-gold' : 'glass-input border-subtle text-fg-subtle'}`}
                >English</button>
              </div>
            </div>

            {error && <p className="text-rose-400 text-xs">{error}</p>}

            <button
              onClick={submitTeacher}
              disabled={loading || !displayName.trim()}
              className="w-full btn-glow disabled:opacity-50 font-bold py-3 rounded-xl text-sm"
            >
              {loading ? 'جاري الحفظ...' : 'بدء استخدام النخبة'}
            </button>
            <button onClick={() => setStep('choose')} className="w-full text-fg-subtle text-xs">رجوع</button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Step: Assistant onboarding ───
  if (step === 'assistant') {
    if (requestSent) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
          <div className="w-full max-w-md glass-card rounded-2xl p-8 shadow-2xl text-center">
            <div className="text-5xl mb-3">⏳</div>
            <h1 className="text-xl font-black text-fg mb-2">تم إرسال الطلب</h1>
            <p className="text-fg-subtle text-sm mb-6">
              تم إرسال طلبك إلى <span className="font-bold text-fg">{selectedTeacher?.full_name}</span>.
              هتوصلك إشعار لما المدرّس يوافق على طلبك.
            </p>
            <button onClick={onComplete} className="text-brand-gold-hover hover:text-brand-gold font-bold text-sm">
              تسجيل الخروج
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
        <div className="w-full max-w-md glass-card rounded-2xl p-8 shadow-2xl">
          <h1 className="text-xl font-black text-fg mb-1 text-center">اختر المدرّس</h1>
          <p className="text-fg-subtle text-sm mb-6 text-center">دوّر على المدرّس اللي بتشتغل معاه</p>

          <div className="space-y-4">
            <div className="flex gap-2">
              <input
                type="text" value={teacherSearch} onChange={(e) => setTeacherSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchTeachers()}
                placeholder="اسم المدرّس أو الإيميل"
                className="flex-1 glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold"
              />
              <button onClick={searchTeachers} className="bg-brand-gold/15 text-brand-gold-hover border border-brand-gold/40 px-4 rounded-lg text-sm font-bold">
                بحث
              </button>
            </div>

            {searchResults.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {searchResults.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTeacher(t)}
                    className={`w-full text-right glass-input border rounded-lg px-3 py-2 transition-colors ${selectedTeacher?.id === t.id ? 'border-brand-gold bg-brand-gold/10' : 'border-subtle hover:border-brand-gold/50'}`}
                  >
                    <p className="font-bold text-fg text-sm">{t.full_name}</p>
                    {t.center_name && <p className="text-fg-subtle text-[11px]">{t.center_name}</p>}
                    <p className="text-fg-subtle text-[11px]" dir="ltr">{t.email}</p>
                  </button>
                ))}
              </div>
            )}

            {selectedTeacher && (
              <div>
                <label className="block text-sm text-fg-subtle mb-1">رسالة للمدرّس (اختياري)</label>
                <textarea
                  value={requestMessage} onChange={(e) => setRequestMessage(e.target.value)}
                  rows={2} placeholder="أهلاً، أنا فلان وكنت عايز أشتغل معاك كمساعد..."
                  className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-brand-gold"
                />
              </div>
            )}

            {error && <p className="text-rose-400 text-xs">{error}</p>}

            <button
              onClick={sendRequest}
              disabled={loading || !selectedTeacher}
              className="w-full btn-glow disabled:opacity-50 font-bold py-3 rounded-xl text-sm"
            >
              {loading ? 'جاري الإرسال...' : 'إرسال طلب الانضمام'}
            </button>
            <button onClick={() => setStep('choose')} className="w-full text-fg-subtle text-xs">رجوع</button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Step: Done ───
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
      <div className="w-full max-w-md glass-card rounded-2xl p-8 shadow-2xl text-center">
        <div className="text-5xl mb-3">🎉</div>
        <h1 className="text-xl font-black text-fg mb-2">تم الإعداد!</h1>
        <p className="text-fg-subtle text-sm">جاري التحويل للوحة التحكم...</p>
      </div>
    </div>
  )
}
