import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ConfirmDialog from './ConfirmDialog'
import Modal from './Modal'

const STATUS_LABEL = { PENDING: 'في الانتظار', RUNNING: 'قيد التنفيذ', SUCCESS: 'ناجحة', FAILED: 'فاشلة', PARTIAL: 'جزئية' }
const STATUS_STYLE = {
  PENDING: 'bg-surface-container-high text-fg',
  RUNNING: 'bg-[var(--warn-bg)] text-[var(--warn-strong)] animate-pulse',
  SUCCESS: 'bg-[var(--ok-bg)] text-[var(--ok-strong)]',
  FAILED: 'bg-[var(--danger-bg)] text-[var(--danger-strong)]',
  PARTIAL: 'bg-[var(--warn-bg)] text-[var(--warn-strong)]',
}
const TYPE_LABEL = { manual: 'يدوية', weekly: 'أسبوعية' }
const DAY_LABEL = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

const STAGE_LABEL = {
  collecting: 'جاري تجميع البيانات...',
  generating: 'جاري إنشاء ملف الإكسل...',
  uploading: 'جاري رفع النسخة للتخزين الآمن...',
  verifying: 'جاري التحقق من النسخة...',
  completing: 'جاري إتمام التسجيل...',
  done: 'اكتملت',
  retry_2: 'إعادة محاولة (2)...',
  retry_3: 'إعادة محاولة (3)...',
}

function fmtSize(bytes) {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function fmtDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtDuration(ms) {
  if (!ms || ms <= 0) return '—'
  if (ms < 60000) return `${Math.round(ms / 1000)} ثانية`
  return `${Math.round(ms / 60000)} دقيقة`
}

/** استدعاء Edge Function مع رسائل عربية واضحة + كشف حالة "لم تُنشر بعد" */
const NOT_DEPLOYED_RE = /fetch|not found|404|Failed/i

async function invokeBackupAction(body) {
  try {
    const { data, error } = await supabase.functions.invoke('admin-backup', { body })
    if (data?.error) return { error: data.error === 'Admin access required' ? 'صلاحيات الأدمن مطلوبة' : (data.message || data.error) }
    if (error) {
      const msg = String(error.message || '')
      if (NOT_DEPLOYED_RE.test(msg)) {
        return { error: 'Edge Function (admin-backup) غير منشورة بعد — انشرها من مجلد supabase/functions/admin-backup ثم أعد المحاولة', notDeployed: true }
      }
      return { error: msg }
    }
    return { data }
  } catch (err) {
    return { error: String(err?.message || err) }
  }
}

/** فحص استباقي: هل دالة admin-backup منشورة أصلًا؟ (يظهر إرشاد التجهيز بدل انتظار فشل الزر) */
async function checkEdgeFunctionDeployed() {
  try {
    const { data, error } = await supabase.functions.invoke('admin-backup', { body: { action: 'ping' } })
    if (data?.ok && data?.service === 'admin-backup') return 'ready'
    // وصل للدالة لكن ردّت خطأ (نسخة قديمة بلا ping) → الدالة موجودة فعلًا
    if (error && NOT_DEPLOYED_RE.test(String(error.message || ''))) return 'missing'
    return 'ready'
  } catch {
    return 'unknown'
  }
}

export default function AdminBackupsPanel({ showToast }) {
  const [backups, setBackups] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [setupMissing, setSetupMissing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [activeBackupId, setActiveBackupId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [viewTarget, setViewTarget] = useState(null)
  const pollRef = useRef(null)
  // حالة دالة النسخ: 'checking' | 'ready' | 'missing' | 'unknown'
  const [edgeState, setEdgeState] = useState('checking')
  const [cliCopied, setCliCopied] = useState(false)

  // ── Restore wizard state ──
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [restoreStep, setRestoreStep] = useState('select') // select | teacher | conflicts | result
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restorePreview, setRestorePreview] = useState(null)
  const [restoreTeacherId, setRestoreTeacherId] = useState('')
  const [restoreBlocks, setRestoreBlocks] = useState([])
  const [restoreStrategy, setRestoreStrategy] = useState('skip')
  const [restoreResult, setRestoreResult] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: rows, error }, { data: cfg }] = await Promise.all([
      supabase.from('backups').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('backup_settings').select('*').eq('id', 1).maybeSingle(),
    ])
    if (error) {
      setSetupMissing(true) // migration 036 لم تُطبَّق بعد
      setBackups([])
    } else {
      setSetupMissing(false)
      setBackups(rows ?? [])
    }
    setSettings(cfg ?? null)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // فحص فوري عند فتح التاب — يكشف "الدالة غير منشورة" قبل أول ضغطة زر
  const recheckEdge = useCallback(async () => {
    setEdgeState('checking')
    setEdgeState(await checkEdgeFunctionDeployed())
  }, [])
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    recheckEdge()
  }, [recheckEdge])

  // إيقاف أي poll عند الخروج
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const pollBackup = useCallback((backupId) => {
    if (pollRef.current) clearInterval(pollRef.current)
    setActiveBackupId(backupId)
    pollRef.current = setInterval(async () => {
      const { data: row } = await supabase.from('backups').select('*').eq('id', backupId).maybeSingle()
      if (!row) return
      setBackups((prev) => {
        const next = prev.filter((b) => b.id !== backupId)
        return [row, ...next].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      })
      if (row.status !== 'RUNNING' && row.status !== 'PENDING') {
        clearInterval(pollRef.current)
        pollRef.current = null
        setActiveBackupId(null)
        if (row.status === 'SUCCESS' || row.status === 'PARTIAL') {
          showToast?.(`اكتملت النسخة الاحتياطية ${row.status === 'PARTIAL' ? '(جزئية)' : 'بنجاح'} ✅`, 'success')
        } else if (row.status === 'FAILED') {
          showToast?.('فشلت النسخة الاحتياطية — راجع التفاصيل بالأسفل', 'error')
        }
      }
    }, 2500)
  }, [showToast])

  const createNow = async () => {
    setCreating(true)
    const { data, error, notDeployed } = await invokeBackupAction({ action: 'create' })
    if (error) {
      showToast?.(error, 'error')
      if (notDeployed) recheckEdge() // يعرض إرشاد التجهيز الدائم فورًا
      setCreating(false)
      return
    }
    showToast?.('بدأت عملية النسخة الاحتياطية — بتجري في الخلفية', 'info')
    pollBackup(data?.backupId)
    await load()
    setCreating(false)
  }

  const download = async (backup) => {
    const { data, error } = await invokeBackupAction({ action: 'download-url', backupId: backup.id })
    if (error) { showToast?.(error, 'error'); return }
    try { window.open(data.url, '_blank') } catch { showToast?.('تعذر فتح الرابط — جرّب تاني', 'error') }
  }

  const retryNow = async (backup) => {
    setCreating(true)
    const { data, error } = await invokeBackupAction({ action: 'retry', backupId: backup.id })
    if (error) { showToast?.(error, 'error'); setCreating(false); return }
    showToast?.('بدأت إعادة المحاولة', 'info')
    pollBackup(data?.backupId || backup.id)
    await load()
    setCreating(false)
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    const { error } = await supabase.rpc('admin_delete_backup', { p_backup_id: deleteTarget.id })
    setDeleteBusy(false)
    if (error) { showToast?.(error.message || 'تعذر حذف النسخة', 'error'); return }
    showToast?.('تم حذف النسخة (مسجّل في سجل التدقيق)', 'success')
    setDeleteTarget(null)
    load()
  }

  // ── Schedule settings ──
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [scheduleDraft, setScheduleDraft] = useState(null)
  useEffect(() => {
    if (settings && !scheduleDraft) {
      setScheduleDraft({ enabled: settings.schedule_enabled, day: settings.backup_day_of_week, hour: settings.backup_hour, retention: settings.retention_count })
    }
  }, [settings, scheduleDraft])

  const saveSchedule = async () => {
    setSavingSchedule(true)
    const { data, error } = await supabase.rpc('admin_set_backup_schedule', {
      p_enabled: scheduleDraft.enabled,
      p_day_of_week: Number(scheduleDraft.day),
      p_hour: Number(scheduleDraft.hour),
      p_retention_count: Math.max(1, Number(scheduleDraft.retention) || 12),
    })
    setSavingSchedule(false)
    if (error) { showToast?.(error.message || 'تعذر حفظ الإعدادات', 'error'); return }
    setSettings((prev) => ({ ...(prev ?? {}), ...data }))
    showToast?.('تم حفظ إعدادات النسخ الاحتياطي', 'success')
  }

  const nextRunText = useMemo(() => {
    if (!settings?.schedule_enabled) return 'الجدولة متوقفة'
    const day = settings.backup_day_of_week ?? 5
    const hour = settings.backup_hour ?? 22
    const now = new Date()
    const cairoNow = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }))
    let diffDays = (day - cairoNow.getDay() + 7) % 7
    if (diffDays === 0 && cairoNow.getHours() >= hour) diffDays = 7
    const next = new Date(cairoNow)
    next.setDate(next.getDate() + diffDays)
    next.setHours(hour, 0, 0, 0)
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    return `${days[day]} ${String(hour).padStart(2, '0')}:00 بتوقيت القاهرة — القادمة: ${next.toLocaleDateString('ar-EG')}`
  }, [settings])

  const latest = backups.find((b) => b.status === 'SUCCESS' || b.status === 'PARTIAL')
  const latestFailed = backups.find((b) => b.status === 'FAILED')
  const activeRunning = backups.find((b) => b.status === 'RUNNING')

  // ── Restore wizard actions ──
  const openRestore = async (backup) => {
    setRestoreOpen(true)
    setRestoreStep('select')
    setRestoreTeacherId('')
    setRestoreBlocks([])
    setRestorePreview(null)
    setRestoreResult(null)
    setRestoreBusy(true)
    const { data, error } = await invokeBackupAction({ action: 'restore-preview', backupId: backup.id })
    setRestoreBusy(false)
    if (error) { showToast?.(error, 'error'); setRestoreOpen(false); return }
    setRestorePreview(data)
    if (data?.teachers?.length === 1) {
      setRestoreTeacherId(data.teachers[0].id)
      setRestoreBlocks((data.teachers[0].blocks || []).map((b) => b.table))
    }
  }

  const loadTeacherConflicts = async () => {
    if (!restorePreview || !restoreTeacherId) return
    setRestoreBusy(true)
    const { data, error } = await invokeBackupAction({ action: 'restore-preview', backupId: restorePreview.backup.id, teacherId: restoreTeacherId })
    setRestoreBusy(false)
    if (error) { showToast?.(error, 'error'); return }
    setRestorePreview((prev) => ({ ...prev, conflicts: data.conflicts }))
    setRestoreStep('conflicts')
  }

  const applyRestore = async () => {
    setRestoreBusy(true)
    const { data, error } = await invokeBackupAction({
      action: 'restore',
      backupId: restorePreview.backup.id,
      teacherId: restoreTeacherId,
      blocks: restoreBlocks,
      strategy: restoreStrategy,
    })
    setRestoreBusy(false)
    if (error) { showToast?.(error, 'error'); return }
    setRestoreResult(data?.result ?? {})
    setRestoreStep('result')
    showToast?.('تمت الاستعادة — العملية مسجّلة في سجل التدقيق', 'success')
  }

  if (loading) {
    return <div className="bg-surface border border-outline rounded-xl p-6 text-center text-fg-muted">جاري تحميل النسخ الاحتياطية...</div>
  }

  if (setupMissing) {
    return (
      <div className="bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded-xl p-5 text-sm text-[var(--warn-strong)] leading-relaxed">
        <p className="font-black mb-2">⚙️ خطوة إعداد مطلوبة (مرة واحدة)</p>
        <p className="mb-2">نظام النسخ الاحتياطي محتاج تشغيل <span className="font-bold font-mono">migration_036_admin_backup_teams_support.sql</span> في Supabase SQL Editor، ونشر <span className="font-bold font-mono">Edge Function: admin-backup</span> من مجلد supabase/functions.</p>
        <p className="text-xs text-[var(--warn-strong)]">بعد التشغيل، ارجع لهذا التاب — كل حاجة هتشتغل تلقائيًا (الجدولة الأسبوعية الجمعة 22:00 بتوقيت القاهرة).</p>
      </div>
    )
  }

  const selectedTeacher = restorePreview?.teachers?.find((t) => t.id === restoreTeacherId)
  const copyCli = async () => {
    const cmd = 'supabase functions deploy admin-backup --no-verify-jwt'
    try {
      await navigator.clipboard.writeText(cmd)
      setCliCopied(true)
      setTimeout(() => setCliCopied(false), 2000)
    } catch {
      showToast?.('انسخ الأمر يدويًا: ' + cmd, 'info')
    }
  }

  return (
    <div className="space-y-4">
      {/* ── الدالة غير منشورة: إرشاد تجهيز دائم (بدل انتظار الخطأ بعد الضغط) ── */}
      {edgeState === 'missing' && (
        <div className="bg-[var(--warn-bg)] border-2 border-[var(--warn-border)] rounded-xl p-4">
          <p className="font-black text-[var(--warn-strong)] text-sm mb-1">⚙️ خطوة أخيرة لتفعيل النسخ الاحتياطي — نشر الدالة (Edge Function)</p>
          <p className="text-xs text-[var(--warn-strong)] leading-relaxed mb-3">
            قاعدة البيانات والإعدادات جاهزة ✅ — المتبقّي نشر دالة <span className="font-mono font-bold">admin-backup</span> فقط، وبدونها لن تعمل الأزرار أعلاه.
          </p>
          <ol className="text-xs text-[var(--warn-strong)] space-y-1.5 list-decimal list-inside mb-3">
            <li>افتح مشروعك في supabase.com ← <span className="font-bold">Edge Functions ← Create a new function</span></li>
            <li>الاسم: <span className="font-mono font-bold" dir="ltr">admin-backup</span> ← والصق محتوى ملف <span className="font-mono" dir="ltr">functions/admin-backup/index.ts</span> كاملًا</li>
            <li>تأكد أن <span className="font-bold">Verify JWT = OFF</span> (الدالة تتحقق من صلاحيات الأدمن بنفسها) ← ثم <span className="font-bold">Deploy</span></li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={copyCli} className="bg-amber-700 hover:bg-amber-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs" dir="ltr">{cliCopied ? '✓ Copied' : '⧉ نسخ أمر CLI البديل'}</button>
            <button onClick={recheckEdge} className="bg-surface border border-[var(--warn-border)] text-[var(--warn-strong)] hover:bg-[var(--warn-bg)] font-bold px-3 py-1.5 rounded-lg text-xs">↻ إعادة الفحص بعد النشر</button>
            <span className="text-[11px] text-[var(--warn-strong)]">لن تظهر هذه الرسالة بعد نشر الدالة (انظر DEPLOY-STEPS.md)</span>
          </div>
        </div>
      )}

      {/* ── فشل النسخة: تنبيه حرج ── */}
      {latestFailed && !activeRunning && (
        <div className="bg-[var(--danger-bg)] border border-[var(--danger-border)] rounded-xl p-4">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div className="min-w-0">
              <p className="font-black text-[var(--danger-strong)] text-sm">⚠️ فشلت النسخة الاحتياطية</p>
              <p className="text-xs text-[var(--danger-strong)] mt-1">
                {fmtDate(latestFailed.created_at)} · المحاولات: {latestFailed.retry_count}
                {latestFailed.error_message && <span className="block truncate mt-0.5" title={latestFailed.error_message}>السبب: {latestFailed.error_message}</span>}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => retryNow(latestFailed)} disabled={creating} className="bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold px-3 py-2 rounded-lg text-xs">↻ إعادة المحاولة الآن</button>
              <button onClick={() => setViewTarget(latestFailed)} className="bg-surface border border-[var(--danger-border)] text-[var(--danger-strong)] font-bold px-3 py-2 rounded-lg text-xs">عرض الخطأ</button>
            </div>
          </div>
        </div>
      )}

      {/* ── بطاقة آخر نسخة + الأزرار الرئيسية ── */}
      <div className="bg-surface border border-outline rounded-xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-black text-fg">النسخ الاحتياطي والاستعادة</h2>
            <p className="text-fg-muted text-xs mt-1">
              نسخة أسبوعية تلقائية {nextRunText} · الاحتفاظ بآخر {settings?.retention_count ?? 12} نسخة · تخزين خاص غير عام
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${settings?.schedule_enabled ? 'bg-[var(--ok-bg)] text-[var(--ok-strong)]' : 'bg-surface-container-high text-fg-muted'}`}>
              {settings?.schedule_enabled ? '🟢 الجدولة مفعّلة' : '⚪ الجدولة متوقفة'}
            </span>
            {edgeState !== 'missing' && (
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${edgeState === 'ready' ? 'bg-[var(--ok-bg)] text-[var(--ok-strong)]' : 'bg-surface-container-high text-fg-muted'}`}>
                {edgeState === 'ready' ? '🟢 دالة النسخ منشورة' : edgeState === 'checking' ? '⏳ جاري فحص دالة النسخ...' : '⚪ تعذّر فحص دالة النسخ'}
              </span>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-4 gap-2 mb-4">
          <InfoCell label="آخر نسخة" value={latest ? fmtDate(latest.completed_at) : 'لا يوجد بعد'} />
          <InfoCell label="الحالة" value={latest ? STATUS_LABEL[latest.status] : '—'} tone={latest?.status} />
          <InfoCell label="عدد المستخدمين" value={latest ? latest.users_count ?? '—' : '—'} />
          <InfoCell label="حجم الملف" value={latest ? fmtSize(latest.file_size) : '—'} />
        </div>

        {/* تقدم النسخة الجارية */}
        {activeRunning && (
          <div className="bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded-lg p-3 mb-4 text-sm text-[var(--warn-strong)]">
            <span className="font-black">⏳ النسخة قيد التنفيذ: </span>
            {STAGE_LABEL[activeRunning.metadata?.stage] || 'جاري التنفيذ...'}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={createNow} disabled={creating || !!activeRunning} className="bg-brand-gold hover:bg-brand-gold-hover disabled:opacity-50 text-brand-navy font-black px-4 py-2 rounded-lg text-sm">
            {creating ? 'جاري البدء...' : '⚡ إنشاء نسخة الآن'}
          </button>
          <button onClick={() => latest && download(latest)} disabled={!latest} className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-lg text-sm">
            ⬇ تنزيل آخر نسخة
          </button>
          <button onClick={() => latest && openRestore(latest)} disabled={!latest} className="bg-[var(--info-bg)] border border-[var(--info-border)] text-[var(--info-strong)] hover:opacity-90 disabled:opacity-40 font-bold px-4 py-2 rounded-lg text-sm">
            ♻ استعادة / استرداد
          </button>
        </div>
      </div>

      {/* ── سجل النسخ ── */}
      <div className="bg-surface border border-outline rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-outline flex items-center justify-between">
          <h3 className="font-black text-fg text-sm">سجل النسخ ({backups.length})</h3>
          <button onClick={load} className="text-fg-muted hover:text-brand-gold-hover text-xs font-bold">↻ تحديث</button>
        </div>
        {backups.length === 0 ? (
          <p className="text-fg-muted text-sm text-center py-8">لا توجد نسخ بعد — اضغط "إنشاء نسخة الآن" أو انتظر الجدولة الأسبوعية.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-fg-muted text-xs border-b border-outline">
                  <th className="text-right px-4 py-2 font-bold">التاريخ</th>
                  <th className="text-right px-4 py-2 font-bold">النوع</th>
                  <th className="text-right px-4 py-2 font-bold">الحالة</th>
                  <th className="text-right px-4 py-2 font-bold">المستخدمون</th>
                  <th className="text-right px-4 py-2 font-bold">الحجم</th>
                  <th className="text-right px-4 py-2 font-bold">المدة</th>
                  <th className="text-right px-4 py-2 font-bold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id} className="border-b border-outline hover:bg-surface-container">
                    <td className="px-4 py-2.5 whitespace-nowrap text-fg">{fmtDate(b.created_at)}</td>
                    <td className="px-4 py-2.5 text-fg-muted">{TYPE_LABEL[b.backup_type] || b.backup_type}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_STYLE[b.status] || 'bg-surface-container-high text-fg'}`}>
                        {b.status === 'FAILED' && b.retry_count > 0 ? `${STATUS_LABEL[b.status]} (${b.retry_count}↻)` : STATUS_LABEL[b.status] || b.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-fg">{b.users_count ?? '—'}</td>
                    <td className="px-4 py-2.5 text-fg-muted whitespace-nowrap">{fmtSize(b.file_size)}</td>
                    <td className="px-4 py-2.5 text-fg-muted whitespace-nowrap">{fmtDuration(b.duration_ms)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        <button onClick={() => setViewTarget(b)} className="text-fg-muted hover:text-brand-gold-hover text-xs font-bold">عرض</button>
                        {(b.status === 'SUCCESS' || b.status === 'PARTIAL') && (
                          <button onClick={() => download(b)} className="text-[var(--ok-strong)] hover:opacity-75 text-xs font-bold">تنزيل</button>
                        )}
                        {(b.status === 'SUCCESS' || b.status === 'PARTIAL') && (
                          <button onClick={() => openRestore(b)} className="text-[var(--info-strong)] hover:opacity-75 text-xs font-bold">استعادة</button>
                        )}
                        {b.status === 'FAILED' && (
                          <button onClick={() => retryNow(b)} disabled={creating} className="text-[var(--danger-strong)] hover:opacity-75 text-xs font-bold">↻ إعادة محاولة</button>
                        )}
                        <button onClick={() => setDeleteTarget(b)} className="text-[var(--danger)] hover:text-[var(--danger-strong)] text-xs font-bold">حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── إعدادات الجدولة والاحتفاظ ── */}
      {scheduleDraft && (
        <div className="bg-surface border border-outline rounded-xl p-4">
          <h3 className="font-black text-fg text-sm mb-3">⚙️ إعدادات الجدولة والاحتفاظ</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <label className="text-xs font-bold text-fg-muted">
              تشغيل الجدولة الأسبوعية
              <select value={scheduleDraft.enabled ? '1' : '0'} onChange={(e) => setScheduleDraft({ ...scheduleDraft, enabled: e.target.value === '1' })} className="mt-1 w-full bg-surface-container border border-outline rounded-lg px-2 py-2 text-sm text-fg">
                <option value="1">مفعّلة</option>
                <option value="0">متوقفة</option>
              </select>
            </label>
            <label className="text-xs font-bold text-fg-muted">
              اليوم (بتوقيت القاهرة)
              <select value={scheduleDraft.day} onChange={(e) => setScheduleDraft({ ...scheduleDraft, day: Number(e.target.value) })} className="mt-1 w-full bg-surface-container border border-outline rounded-lg px-2 py-2 text-sm text-fg">
                {DAY_LABEL.map((d, i) => <option key={i} value={i}>{d}</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-fg-muted">
              الساعة
              <select value={scheduleDraft.hour} onChange={(e) => setScheduleDraft({ ...scheduleDraft, hour: Number(e.target.value) })} className="mt-1 w-full bg-surface-container border border-outline rounded-lg px-2 py-2 text-sm text-fg">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <label className="text-xs font-bold text-fg-muted">
              الاحتفاظ بآخر (نسخة)
              <input type="number" min={1} max={200} value={scheduleDraft.retention} onChange={(e) => setScheduleDraft({ ...scheduleDraft, retention: e.target.value })} className="mt-1 w-full bg-surface-container border border-outline rounded-lg px-2 py-2 text-sm text-fg" dir="ltr" />
            </label>
            <button onClick={saveSchedule} disabled={savingSchedule} className="bg-brand-navy hover:bg-brand-navy-light disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-sm">
              {savingSchedule ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
            </button>
          </div>
          <p className="text-[11px] text-fg-muted mt-2 leading-relaxed">
            الحماية المدمجة: لا يُحذف آخر نسخة ناجحة أبدًا تلقائيًا، ولا تُحذف النسخة الوحيدة المتبقية، وكل حذف (يدوي أو تلقائي) يُسجَّل في سجل التدقيق.
          </p>
        </div>
      )}

      {/* ── نافذة تفاصيل نسخة ── */}
      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title="تفاصيل النسخة الاحتياطية">
        {viewTarget && (
          <div className="space-y-2 text-sm">
            <DetailRow label="المعرّف" value={viewTarget.id} mono />
            <DetailRow label="الملف" value={viewTarget.file_name || '—'} mono />
            <DetailRow label="الحالة" value={STATUS_LABEL[viewTarget.status] || viewTarget.status} />
            <DetailRow label="النوع" value={TYPE_LABEL[viewTarget.backup_type] || viewTarget.backup_type} />
            <DetailRow label="بدأت" value={fmtDate(viewTarget.started_at)} />
            <DetailRow label="اكتملت" value={fmtDate(viewTarget.completed_at)} />
            <DetailRow label="المدة" value={fmtDuration(viewTarget.duration_ms)} />
            <DetailRow label="المستخدمون / الفرق / الطلاب" value={`${viewTarget.users_count ?? '—'} / ${viewTarget.teams_count ?? '—'} / ${viewTarget.students_count ?? '—'}`} />
            <DetailRow label="إجمالي السجلات" value={viewTarget.records_count ?? '—'} />
            <DetailRow label="أوراق الملف" value={viewTarget.sheet_count ?? '—'} />
            <DetailRow label="الحجم" value={fmtSize(viewTarget.file_size)} />
            <DetailRow label="Checksum (SHA-256)" value={viewTarget.checksum ? String(viewTarget.checksum).slice(0, 24) + '…' : '—'} mono />
            <DetailRow label="المحاولات" value={String(viewTarget.retry_count ?? 0)} />
            {viewTarget.error_message && <DetailRow label="آخر خطأ" value={viewTarget.error_message} />}
            <div className="flex gap-2 pt-2">
              {(viewTarget.status === 'SUCCESS' || viewTarget.status === 'PARTIAL') && (
                <button onClick={() => download(viewTarget)} className="flex-1 bg-emerald-700 hover:bg-emerald-600 text-white font-bold py-2 rounded-lg text-sm">⬇ تنزيل</button>
              )}
              <button onClick={() => setViewTarget(null)} className="flex-1 bg-surface-container-high text-fg font-bold py-2 rounded-lg text-sm">إغلاق</button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── معالج الاستعادة ── */}
      <Modal open={restoreOpen} onClose={() => setRestoreOpen(false)} title="♻ استعادة بيانات من نسخة احتياطية">
        <div className="space-y-4">
          {restoreBusy && <div className="text-sm text-fg-muted bg-surface-container border border-outline rounded-lg p-3">⏳ جاري تحليل النسخة ومقارنة البيانات...</div>}

          {!restoreBusy && restorePreview && restoreStep !== 'result' && (
            <>
              <div className="bg-surface-container border border-outline rounded-lg p-3 text-xs text-fg-muted space-y-1">
                <p><span className="font-bold text-fg">النسخة:</span> {restorePreview.backup.file_name} · {fmtDate(restorePreview.backup.created_at)}</p>
                <p><span className="font-bold text-fg">المستخدمون داخلها:</span> {restorePreview.teachers?.length ?? 0} · <span className="font-bold text-fg">الحالة:</span> {STATUS_LABEL[restorePreview.backup.status]}</p>
              </div>

              {restoreStep === 'select' && (
                <div>
                  <p className="text-sm font-bold text-fg mb-2">١) اختار المستخدم اللي عايز تستعيد بياناته:</p>
                  <select value={restoreTeacherId} onChange={(e) => {
                    setRestoreTeacherId(e.target.value)
                    const t = restorePreview.teachers?.find((x) => x.id === e.target.value)
                    setRestoreBlocks((t?.blocks || []).map((b) => b.table))
                  }} className="w-full bg-surface-container border border-outline rounded-lg px-3 py-2 text-sm text-fg">
                    <option value="">— اختار مستخدم —</option>
                    {(restorePreview.teachers || []).map((t) => (
                      <option key={t.id} value={t.id}>{t.sheet} — {t.name || 'بدون اسم'}</option>
                    ))}
                  </select>
                </div>
              )}

              {restoreStep === 'teacher' && selectedTeacher && (
                <div>
                  <p className="text-sm font-bold text-fg mb-2">٢) اختار أنواع البيانات اللي هتُستعاد لـ <span className="text-brand-gold-hover">{selectedTeacher.name || selectedTeacher.sheet}</span>:</p>
                  <div className="grid sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto">
                    {(selectedTeacher.blocks || []).map((b) => (
                      <label key={b.table} className="flex items-center gap-2 bg-surface-container border border-outline rounded-lg px-3 py-2 text-sm cursor-pointer">
                        <input type="checkbox" checked={restoreBlocks.includes(b.table)} onChange={() => setRestoreBlocks((prev) => prev.includes(b.table) ? prev.filter((x) => x !== b.table) : [...prev, b.table])} />
                        <span className="font-mono text-xs">{b.table}</span>
                        <span className="text-fg-muted text-xs">({b.rowCount} صف)</span>
                      </label>
                    ))}
                  </div>
                  <button onClick={() => setRestoreStep('select')} className="text-xs text-fg-muted hover:text-brand-gold-hover font-bold mt-2">← تغيير المستخدم</button>
                </div>
              )}

              {restoreStep === 'conflicts' && (
                <div>
                  <p className="text-sm font-bold text-fg mb-2">٣) مراجعة التعارضات والتأكيد:</p>
                  <div className="max-h-56 overflow-y-auto space-y-1.5">
                    {restoreBlocks.map((table) => {
                      const c = restorePreview.conflicts?.[table]
                      return (
                        <div key={table} className="bg-surface-container border border-outline rounded-lg px-3 py-2 text-xs">
                          <span className="font-mono font-bold text-fg">{table}</span>
                          {c ? (
                            <span className="text-fg-muted"> · {c.backupRows} صف بالنسخة · <span className="text-[var(--ok-strong)] font-bold">{c.new} جديد</span> · <span className="text-fg-muted">{c.same} مطابق</span> · <span className="text-[var(--warn-strong)] font-bold">{c.changed} متعارض</span></span>
                          ) : <span className="text-fg-muted"> · لا توجد بيانات</span>}
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-bold text-fg-muted">استراتيجية الصفوف الموجودة بالفعل:</p>
                    <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" checked={restoreStrategy === 'skip'} onChange={() => setRestoreStrategy('skip')} /><span>تخطّي الموجود (آمن — يضيف الجديد فقط)</span></label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" checked={restoreStrategy === 'overwrite'} onChange={() => setRestoreStrategy('overwrite')} /><span className="text-[var(--warn-strong)] font-bold">استبدال المتعارض ببيانات النسخة</span></label>
                  </div>
                  <p className="text-[11px] text-fg-muted mt-2 leading-relaxed">🔒 الاستعادة لا تحذف أي بيانات نهائيًا ولا تلمس بيانات مستخدمين آخرين، وكل صف بمعرّف موجود بيتسجل إما "تخطي" أو "تحديث" — أبدًا لا حذف.</p>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                {restoreStep === 'select' && (
                  <button disabled={!restoreTeacherId || restoreBusy} onClick={() => setRestoreStep('teacher')} className="flex-1 bg-brand-gold hover:bg-brand-gold-hover disabled:opacity-40 text-brand-navy font-black py-2.5 rounded-lg text-sm">التالي ←</button>
                )}
                {restoreStep === 'teacher' && (
                  <button disabled={!restoreBlocks.length || restoreBusy} onClick={loadTeacherConflicts} className="flex-1 bg-brand-gold hover:bg-brand-gold-hover disabled:opacity-40 text-brand-navy font-black py-2.5 rounded-lg text-sm">مقارنة وعرض التعارضات ←</button>
                )}
                {restoreStep === 'conflicts' && (
                  <>
                    <button onClick={() => setRestoreStep('teacher')} className="flex-1 bg-surface-container-high text-fg font-bold py-2.5 rounded-lg text-sm">رجوع</button>
                    <button disabled={!restoreBlocks.length || restoreBusy} onClick={applyRestore} className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-black py-2.5 rounded-lg text-sm">
                      {restoreStrategy === 'overwrite' ? '⚠ تأكيد الاستعادة (مع الاستبدال)' : 'تأكيد الاستعادة الآمنة'}
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          {!restoreBusy && restoreStep === 'result' && (
            <div className="space-y-3">
              <p className="text-sm font-black text-[var(--ok-strong)]">✅ تمت الاستعادة بنجاح — ملخص العملية:</p>
              <div className="max-h-64 overflow-y-auto space-y-1.5 text-xs">
                {Object.entries(restoreResult || {}).map(([table, r]) => (
                  <div key={table} className="bg-surface-container border border-outline rounded-lg px-3 py-2">
                    <span className="font-mono font-bold text-fg">{table}</span>
                    <span className="text-fg-muted"> · أُضيف {r.inserted} · حُدّث {r.updated} · تُخطّي {r.skipped_existing} · مرفوض {r.rejected}{r.errors ? <span className="text-[var(--danger-strong)] font-bold"> · أخطاء {r.errors}</span> : null}</span>
                    {(r.error_messages || []).slice(0, 2).map((m, i) => <span key={i} className="block text-[var(--danger)] truncate">— {m}</span>)}
                  </div>
                ))}
              </div>
              <button onClick={() => setRestoreOpen(false)} className="w-full bg-brand-navy hover:bg-brand-navy-light text-white font-bold py-2.5 rounded-lg text-sm">إغلاق</button>
            </div>
          )}
        </div>
      </Modal>

      {/* ── تأكيد الحذف ── */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="حذف نسخة احتياطية"
        danger
        confirmLabel="حذف نهائي"
        message={`هتحذف النسخة "${deleteTarget?.file_name || deleteTarget?.id}" نهائيًا من التخزين والسجل. ده مش بيرجع. (آخر نسخة ناجحة والنسخة الوحيدة المتبقية محميتان من الحذف.)`}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function InfoCell({ label, value, tone }) {
  return (
    <div className={`rounded-lg p-2.5 border ${tone === 'SUCCESS' ? 'bg-[var(--ok-bg)] border-[var(--ok-border)]' : 'bg-surface-container border-outline'}`}>
      <p className="text-[11px] text-fg-muted font-bold">{label}</p>
      <p className="text-sm font-black text-fg mt-0.5 truncate">{String(value ?? '—')}</p>
    </div>
  )
}

function DetailRow({ label, value, mono }) {
  return (
    <div className="flex justify-between gap-3 border-b border-outline pb-1.5">
      <span className="text-fg-muted text-xs shrink-0">{label}</span>
      <span className={`text-fg text-xs text-left ${mono ? 'font-mono break-all' : ''}`} dir={mono ? 'ltr' : 'rtl'}>{value}</span>
    </div>
  )
}
