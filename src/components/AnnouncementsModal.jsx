/**
 * AnnouncementsModal — لوحة الإعلانات (التبويب السادس في التقارير)
 *
 * مدرّس واحد يكتب إعلان واحد → كل طلابه يستقبلوه 3 طرق:
 *   1) قسم "الإعلانات" في بوابة الطالب (/qr/:token) — فورًا.
 *   2) قسم "التنبيهات" في البوابة + عدّاد غير المقروء (student_notifications).
 *   3) إشعار Push على الموبايل حتى لو المتصفح مقفول — مهمة broadcast واحدة
 *      تتبعتها دالة send-push-notification لكل أجهزة الطلاب المفعّلة.
 *
 * يحتاج: Migration 037 (send_announcement RPC) + النسخة المحدّثة من دالة
 * send-push-notification. اللوحة تفحص الحالتين وتعرض إرشادات واضحة لو
 * ناقص حاجة، والإعلان نفسه يظهر في البوابة حتى قبل نشر الدالة.
 */
import { useCallback, useEffect, useState } from 'react'
import Modal from './Modal'
import { supabase } from '../lib/supabaseClient'
import { pingPortalRefresh } from '../lib/portalRealtime'

const NOT_DEPLOYED_RE = /fetch|not found|404|Failed|NetworkError/i
const MISSING_RPC_RE = /Could not find|PGRST202|schema cache|does not exist/i

const TITLE_MAX = 80
const MESSAGE_MAX = 500

const EDGE_DEPLOY_CMD = 'supabase functions deploy send-push-notification --project-ref pbsythpzncjoafpmijyd'

async function checkEdgeFunctionState() {
  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', { body: { action: 'ping' } })
    if (data?.service === 'send-push-notification') return data?.broadcast ? 'ready' : 'legacy'
    // Request reached the function but it answered with an error (old version
    // without ping → "invalid job") → the function IS deployed, just outdated.
    if (error && NOT_DEPLOYED_RE.test(String(error.message || ''))) return 'missing'
    return 'legacy'
  } catch {
    return 'unknown'
  }
}

// فحص وجود دالة send_announcement: مناداة بقيم فاضية — لو الدالة موجودة
// هترجع خطأ التحقق العربي، ولو مش منشورة هترجع PGRST202 (Could not find).
async function checkRpcAvailable() {
  try {
    const { error } = await supabase.rpc('send_announcement', { p_title: '', p_message: '' })
    if (!error) return true
    if (MISSING_RPC_RE.test(String(error.message || ''))) return false
    return true
  } catch {
    return null
  }
}

const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return ''
  }
}

export default function AnnouncementsModal({ open, onClose, teacherId, studentCount = 0, showToast }) {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  // حالة قاعدة البيانات: null = جاري الفحص، true = Migration 037 مطبّق، false = ناقص
  const [dbReady, setDbReady] = useState(null)
  // حالة دالة الإشعارات: 'checking' | 'ready' | 'legacy' | 'missing' | 'unknown'
  const [edgeState, setEdgeState] = useState('checking')
  const [cliCopied, setCliCopied] = useState(false)
  const [lastResult, setLastResult] = useState(null)

  const loadHistory = useCallback(async () => {
    if (!teacherId) return
    setLoadingHistory(true)
    try {
      const { data, error } = await supabase
        .from('announcements')
        .select('id, title, message, student_id, created_at')
        .eq('teacher_id', teacherId)
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      setHistory(data || [])
    } catch (err) {
      console.error('[AnnouncementsModal] history load failed:', err?.message)
      setHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }, [teacherId])

  useEffect(() => {
    if (!open) return
    loadHistory()
    setDbReady(null)
    setEdgeState('checking')
    setCliCopied(false)
    setLastResult(null)
    ;(async () => {
      const [rpcOk, edge] = await Promise.all([checkRpcAvailable(), checkEdgeFunctionState()])
      setDbReady(rpcOk)
      setEdgeState(edge)
    })()
  }, [open, loadHistory])

  const copyDeployCmd = async () => {
    try {
      await navigator.clipboard.writeText(EDGE_DEPLOY_CMD)
      setCliCopied(true)
      setTimeout(() => setCliCopied(false), 2000)
    } catch {
      showToast?.('انسخ الأمر يدويًا: ' + EDGE_DEPLOY_CMD, 'error')
    }
  }

  const handleSend = async () => {
    if (!title.trim() || !message.trim() || sending) return
    setSending(true)
    try {
      const { data, error } = await supabase.rpc('send_announcement', {
        p_title: title.trim(),
        p_message: message.trim(),
        p_student_id: null,
      })
      if (error) {
        if (MISSING_RPC_RE.test(String(error.message || ''))) {
          setDbReady(false)
          showToast?.('لوحة الإعلانات محتاجة تشغيل Migration 037 الأول — شغّل ملف supabase/migrations/migration_037_announcement_board.sql في Supabase ثم أعد المحاولة', 'error')
        } else {
          showToast?.(String(error.message || 'حدث خطأ أثناء إرسال الإعلان'), 'error')
        }
        return
      }
      setDbReady(true)
      setLastResult({
        students_notified: Number(data?.students_notified ?? 0),
        push_targets: Number(data?.push_targets ?? 0),
      })
      setTitle('')
      setMessage('')
      showToast?.(`تم إرسال الإعلان لـ ${Number(data?.students_notified ?? 0)} طالب 📣`, 'success')
      // Round 7: push an instant refresh ping so every student portal that is
      // open RIGHT NOW shows the announcement within a second (the 10s poll
      // remains the fallback; push notifications cover closed browsers).
      try { pingPortalRefresh(teacherId, 'announcement') } catch { /* polling covers it */ }
      loadHistory()
    } catch (err) {
      console.error('[AnnouncementsModal] send failed:', err)
      showToast?.('حدث خطأ غير متوقع أثناء الإرسال — جرّب تاني', 'error')
    } finally {
      setSending(false)
    }
  }

  const handleDelete = async (id) => {
    if (deleteBusy) return
    if (deleteTarget !== id) { setDeleteTarget(id); return }
    setDeleteBusy(true)
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', id)
      if (error) throw error
      setHistory((prev) => prev.filter((a) => a.id !== id))
      setDeleteTarget(null)
      // Round 7: deleted announcement should also disappear from open portals.
      try { pingPortalRefresh(teacherId, 'announcement-deleted') } catch { /* polling covers it */ }
      showToast?.('تم حذف الإعلان من البوابة والتنبيهات ✅', 'success')
    } catch (err) {
      console.error('[AnnouncementsModal] delete failed:', err)
      showToast?.('حدث خطأ أثناء الحذف', 'error')
    } finally {
      setDeleteBusy(false)
    }
  }

  const edgePill = {
    ready: { text: '🟢 الإشعارات جاهزة', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
    legacy: { text: '🟡 نسخة قديمة من دالة الإشعارات', cls: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
    missing: { text: '⚪ دالة الإشعارات غير منشورة', cls: 'text-fg-subtle border-subtle bg-white/5' },
    checking: { text: '⏳ جاري فحص دالة الإشعارات', cls: 'text-fg-subtle border-subtle bg-white/5' },
    unknown: { text: '⚪ تعذر فحص دالة الإشعارات', cls: 'text-fg-subtle border-subtle bg-white/5' },
  }[edgeState]

  const dbPill = dbReady === null
    ? { text: '⏳ جاري فحص قاعدة البيانات', cls: 'text-fg-subtle border-subtle bg-white/5' }
    : dbReady
      ? { text: '🟢 قاعدة البيانات جاهزة', cls: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' }
      : { text: '⏳ في انتظار Migration 037', cls: 'text-amber-300 border-amber-500/30 bg-amber-500/10' }

  return (
    <Modal open={open} onClose={onClose} title="📣 لوحة الإعلانات">
      <div className="space-y-4">

        {/* ── حالة التشغيل ── */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${dbPill.cls}`}>{dbPill.text}</span>
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${edgePill.cls}`}>{edgePill.text}</span>
        </div>

        {dbReady === false && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-6 text-amber-200">
            <b>خطوة واحدة ناقصة:</b> شغّل ملف <b className="break-all">supabase/migrations/migration_037_announcement_board.sql</b> من Supabase ← SQL Editor ← Run، ثم افتح اللوحة تاني.
            الملف آمن وتراكمي ومش بيغير أي بيانات قائمة.
          </div>
        )}

        {edgeState !== 'ready' && edgeState !== 'checking' && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-6 text-amber-200">
            <b>عشان الإشعار يوصل الموبايل والسايت مقفول:</b> انشر النسخة المحدّثة من دالة <b>send-push-notification</b> (موجودة في مجلد <span className="break-all">supabase/functions/send-push-notification</span>) — الإعلان نفسه هيظهر في بوابة الطالب فورًا حتى من غير الخطوة دي.
            <div className="mt-2 flex items-center gap-2">
              <code className="text-[10px] break-all glass-input border border-subtle rounded px-2 py-1 flex-1 min-w-0">{EDGE_DEPLOY_CMD}</code>
              <button type="button" onClick={copyDeployCmd} className="btn-glow text-[11px] font-bold px-3 py-1.5 rounded-lg shrink-0">{cliCopied ? 'تم النسخ ✓' : 'نسخ'}</button>
            </div>
          </div>
        )}

        {/* ── نموذج الإرسال ── */}
        <div className="glass-card rounded-2xl p-4 border border-brand-gold/20 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-black">إعلان جديد</div>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-brand-gold/15 text-brand-gold-hover border border-brand-gold/40">📣 لكل الطلاب ({studentCount})</span>
          </div>

          <div>
            <label htmlFor="ann-title" className="block text-xs font-bold text-fg-subtle mb-1">عنوان الإعلان</label>
            <input
              id="ann-title"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              maxLength={TITLE_MAX}
              placeholder="مثال: موعد امتحان الشهر"
              className="glass-input border border-subtle rounded-lg px-3 py-2 text-sm w-full"
            />
            <div className="text-[10px] text-fg-subtle mt-1 text-left">{title.length}/{TITLE_MAX}</div>
          </div>

          <div>
            <label htmlFor="ann-message" className="block text-xs font-bold text-fg-subtle mb-1">نص الرسالة</label>
            <textarea
              id="ann-message"
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
              maxLength={MESSAGE_MAX}
              rows={4}
              placeholder="اكتب الرسالة اللي عايز توصل لكل الطلاب في بوابة الطالب وكإشعار على الموبايل..."
              className="glass-input border border-subtle rounded-lg px-3 py-2 text-sm w-full resize-y"
            />
            <div className="text-[10px] text-fg-subtle mt-1 text-left">{message.length}/{MESSAGE_MAX}</div>
          </div>

          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !title.trim() || !message.trim() || dbReady === false}
            className="btn-glow w-full rounded-xl px-4 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? 'جاري الإرسال...' : '📣 ابعت الإعلان للكل'}
          </button>

          {lastResult && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs leading-6 text-emerald-200">
              وصل الإعلان لـ <b>{lastResult.students_notified}</b> طالب في بوابة الطالب.
              {lastResult.push_targets > 0
                ? ` جاري إرسال إشعار موبايل لـ ${lastResult.push_targets} جهاز مفعّل${edgeState === 'ready' ? '' : ' (يحتاج نشر دالة الإشعارات المحدّثة)'}.`
                : ' مفيش أجهزة مفعّلة بعد — الطلاب بيفعّلوا الإشعارات من زر «تفعيل الإشعارات» في بوابة الطالب.'}
            </div>
          )}
        </div>

        {/* ── سجل الإعلانات ── */}
        <div>
          <div className="text-sm font-black mb-2">آخر الإعلانات</div>
          {loadingHistory ? (
            <div className="text-xs text-fg-subtle">جاري التحميل...</div>
          ) : history.length === 0 ? (
            <div className="glass-card rounded-xl p-4 text-xs text-fg-subtle text-center">مفيش إعلانات بعد — أول إعلان هيظهر هنا بعد الإرسال.</div>
          ) : (
            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {history.map((a) => (
                <div key={a.id} className="glass-card rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-fg truncate">{a.title}</p>
                      <p className="text-xs text-fg-muted mt-1 break-words whitespace-pre-wrap">{a.message}</p>
                      <p className="text-[10px] text-fg-subtle mt-1.5">{a.student_id ? 'لطالب واحد' : 'لكل الطلاب'} · {fmtDate(a.created_at)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(a.id)}
                      disabled={deleteBusy}
                      className={`text-[11px] font-bold px-2.5 py-1.5 rounded-lg border shrink-0 disabled:opacity-40 ${deleteTarget === a.id ? 'border-rose-500/50 bg-rose-500/20 text-rose-300' : 'border-subtle text-fg-subtle hover:text-rose-300 hover:border-rose-500/40'}`}
                    >
                      {deleteTarget === a.id ? 'تأكيد الحذف؟' : 'حذف'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── إزاي بيصل الإعلان ── */}
        <div className="glass-card rounded-xl p-3 text-[11px] leading-6 text-fg-subtle">
          <b className="text-fg-muted">إزاي بيوصله الإعلان؟</b>
          <ul className="list-disc pr-4 mt-1 space-y-0.5">
            <li>بيظهر فورًا في قسم «الإعلانات» + «التنبيهات» في بوابة الطالب.</li>
            <li>بيوصل كإشعار على الموبايل للطلاب اللي فعّلوا زر «تفعيل الإشعارات» من البوابة — حتى لو المتصفح مقفول.</li>
            <li>على الآيفون: الطالب لازم يضيف الموقع للشاشة الرئيسية (زر المشاركة ← إضافة إلى الشاشة الرئيسية) قبل تفعيل الإشعارات.</li>
          </ul>
        </div>
      </div>
    </Modal>
  )
}
