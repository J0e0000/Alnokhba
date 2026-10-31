// Regression test (owner report): scanning a student who is ALREADY present
// earlier today must still mark them present in the CURRENT session — the
// old early-return left the open session's list without them.
import { describe, it, expect, mock } from 'bun:test'

const rpcCalls = []
let rpcResponse = { data: { ok: true, student: { id: 's1', name: 'أحمد' }, today_status: 'حاضر', already_present_today: true }, error: null }

mock.module('../src/lib/supabaseClient', () => ({
  supabase: {
    rpc: (name, args) => { rpcCalls.push({ name, args }); return Promise.resolve(rpcResponse) },
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
  },
  IS_DEMO: true,
}))

const { handleScannedPayload } = await import('../src/lib/qrAttendance')

describe('handleScannedPayload — already present today', () => {
  it('STILL marks present in the current session (no early return)', async () => {
    const marked = []
    const result = await handleScannedPayload('https://al-nokhbba.vercel.app/qr/abcdefghijklmnopqrst', {
      students: [],
      paymentStatuses: [],
      activeLessonId: 'lesson-1',
      isArabic: true,
      markPresent: async (id) => { marked.push(id); return true },
      confirmPayment: null,
    })
    expect(result.type).toBe('success')
    expect(marked).toEqual(['s1'])
    expect(rpcCalls.length).toBe(1)
    expect(rpcCalls[0].name).toBe('resolve_student_by_qr')
  })

  it('reports success wording when the student was present earlier today', async () => {
    const result = await handleScannedPayload('abcdefghijklmnopqrst', {
      students: [],
      paymentStatuses: [],
      activeLessonId: 'lesson-1',
      isArabic: true,
      markPresent: async () => true,
      confirmPayment: null,
    })
    expect(result.text).toContain('أحمد')
    expect(result.text).toContain('✅')
  })

  it('still blocks blocked students (warnings gate) even when present earlier', async () => {
    rpcResponse = { data: { ok: true, student: { id: 's2', name: 'سعيد', warnings: 5 }, today_status: 'حاضر', already_present_today: true }, error: null }
    const marked = []
    const result = await handleScannedPayload('abcdefghijklmnopqrst', {
      students: [],
      paymentStatuses: [{ student_id: 's2', status: 'paid', max_warnings: 3 }],
      activeLessonId: 'lesson-1',
      isArabic: true,
      markPresent: async (id) => { marked.push(id); return true },
      confirmPayment: null,
    })
    expect(result.type).toBe('error')
    expect(marked).toEqual([])
  })
})
