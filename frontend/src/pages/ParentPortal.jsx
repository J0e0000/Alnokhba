/**
 * ⚠️ DEPRECATED — DO NOT USE
 * ============================================================================
 * This file is dead code — it is NOT imported by App.jsx or any other file.
 * It is left here as a placeholder so that anyone who finds references to
 * "ParentPortal" in old documentation or git history understands what
 * happened to it.
 *
 * WHY IT WAS DEPRECATED (migration_019):
 *   - It read directly from students / attendance_records / exam_scores
 *     using the student_id as the URL "token". This relied on the old
 *     *_public_read RLS policies that migration_019 dropped (because they
 *     broke cross-tenant data isolation).
 *   - The student_id is a UUID, NOT a rotatable secret — once leaked it
 *     cannot be revoked. Real portal tokens live in student_qr_tokens
 *     and CAN be revoked.
 *   - The actual public portal is PublicQRPage.jsx (route: /qr/:token),
 *     which uses the new get_student_portal_data RPC.
 *
 * IF you ever need to bring this back:
 *   - Replace the studentToken param with a real token from
 *     student_qr_tokens
 *   - Use supabase.rpc('get_student_portal_data', { p_token: token })
 *     instead of direct table reads
 *   - See PublicQRPage.jsx for a working reference implementation
 * ============================================================================
 */
import { useEffect, useState } from 'react'

export default function ParentPortal() {
  const [warning] = useState(
    'هذه الصفحة deprecated ولا تعمل بعد تحديثات الأمان. ' +
    'استخدم رابط /qr/:token بدلاً منها.'
  )
  useEffect(() => {
    console.error('[ParentPortal] This page is deprecated. Use /qr/:token instead.')
  }, [])
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-bg p-4" dir="rtl">
      <div className="max-w-md text-center bg-white border border-rose-200 rounded-2xl p-8 shadow-sm">
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="text-xl font-black text-rose-600 mb-2">صفحة مهجورة</h1>
        <p className="text-outline text-sm">{warning}</p>
      </div>
    </div>
  )
}
