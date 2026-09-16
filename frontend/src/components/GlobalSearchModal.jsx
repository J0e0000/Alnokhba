/**
 * GlobalSearchModal — بحث شامل
 * Searches across students, exams, payments in one unified interface.
 * Respects existing permissions (all queries are scoped by effectiveTeacherId via RLS).
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'

export default function GlobalSearchModal({ open, onClose, students, onOpenStudent, onOpenExamsList, onOpenAccounts, onOpenNotifications, paymentStatuses = [] }) {
  const { effectiveTeacherId } = useAuth()
  const { t, isArabic } = useLanguage()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ students: [], exams: [], payments: [] })
  const [searching, setSearching] = useState(false)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      setQuery('')
      setResults({ students: [], exams: [], payments: [] })
    }
  }, [open])

  const doSearch = useCallback(async (q) => {
    if (!q || q.length < 2 || !effectiveTeacherId) {
      setResults({ students: [], exams: [], payments: [] })
      return
    }
    setSearching(true)
    try {
      // Search students (client-side first for instant results)
      const localStudents = students.filter(
        (s) =>
          s.name?.includes(q) ||
          s.phone?.includes(q) ||
          s.code?.toLowerCase().includes(q.toLowerCase())
      )

      // Search exams (server-side)
      const { data: examData } = await supabase
        .from('exams')
        .select('id, title, created_at')
        .eq('teacher_id', effectiveTeacherId)
        .ilike('title', `%${q}%`)
        .order('created_at', { ascending: false })
        .limit(10)

      // Search payments (client-side)
      const qLower = q.toLowerCase()
      const localPayments = paymentStatuses.filter(
        (p) =>
          p.student?.name?.includes(q) ||
          p.status?.toLowerCase().includes(qLower) ||
          String(p.student_id)?.includes(q)
      ).slice(0, 10)

      setResults({
        students: localStudents.slice(0, 10),
        exams: examData || [],
        payments: localPayments,
      })
    } catch (e) {
      console.error('Search error:', e)
    }
    setSearching(false)
  }, [students, effectiveTeacherId, paymentStatuses])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(query), 200)
    return () => clearTimeout(debounceRef.current)
  }, [query, doSearch])

  const totalResults = results.students.length + results.exams.length + results.payments.length

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[15vh] p-4" onClick={onClose}>
      <div className="glass-card rounded-2xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()} dir={isArabic ? 'rtl' : 'ltr'}>
        <div className="flex items-center gap-3 p-4 border-b border-subtle">
          <span className="text-fg-subtle text-lg">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isArabic ? 'بحث بالاسم / الكود / الامتحان...' : 'Search by name / code / exam...'}
            className="flex-1 bg-transparent text-fg text-sm outline-none placeholder:text-fg-subtle/50"
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
          />
          <button onClick={onClose} className="text-fg-subtle hover:text-fg text-sm">✕</button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {query.length < 2 ? (
            <p className="text-fg-subtle text-sm text-center py-6">{isArabic ? 'اكتب 2 حروف على الأقل' : 'Type at least 2 characters'}</p>
          ) : searching ? (
            <p className="text-fg-subtle text-sm text-center py-6">{isArabic ? 'جاري البحث...' : 'Searching...'}</p>
          ) : totalResults === 0 ? (
            <p className="text-fg-subtle text-sm text-center py-6">{isArabic ? 'لا توجد نتائج' : 'No results found'}</p>
          ) : (
            <>
              {results.students.length > 0 && (
                <div className="mb-2">
                  <p className="text-fg-subtle text-[10px] font-bold px-3 py-1">👥 {isArabic ? 'الطلاب' : 'Students'}</p>
                  {results.students.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { onOpenStudent?.(s); onClose() }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors text-right"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-fg font-bold text-sm truncate">{s.name}</p>
                        <p className="text-fg-subtle text-xs">{s.group_name} · {s.stage} · <span className="font-mono">{s.code}</span></p>
                      </div>
                      <span className="text-fg-subtle text-xs">{s.points} pt</span>
                    </button>
                  ))}
                </div>
              )}
              {results.exams.length > 0 && (
                <div className="mb-2">
                  <p className="text-fg-subtle text-[10px] font-bold px-3 py-1">📝 {isArabic ? 'الامتحانات' : 'Exams'}</p>
                  {results.exams.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => { onOpenExamsList?.(); onClose() }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors text-right"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-fg font-bold text-sm truncate">{e.title}</p>
                        <p className="text-fg-subtle text-xs">{new Date(e.created_at).toLocaleDateString(isArabic ? 'ar-EG' : 'en')}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {results.payments.length > 0 && (
                <div className="mb-2">
                  <p className="text-fg-subtle text-[10px] font-bold px-3 py-1">💰 {isArabic ? 'المدفوعات' : 'Payments'}</p>
                  {results.payments.map((p) => (
                    <button
                      key={p.student_id}
                      onClick={() => { onOpenStudent?.(students.find(s => s.id === p.student_id)); onClose() }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors text-right"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-fg font-bold text-sm truncate">{p.student?.name || p.student_id}</p>
                        <p className="text-fg-subtle text-xs">{p.status === 'paid' ? '✓' : p.status === 'partial' ? '◐' : '⚠'} {p.remaining} {isArabic ? 'ج.م' : 'EGP'}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {query.length >= 1 && (
                <div className="mt-2 pt-2 border-t border-subtle">
                  <button
                    onClick={() => { onOpenNotifications?.(); onClose() }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors text-right"
                  >
                    <span className="text-fg-subtle">🔔</span>
                    <span className="text-fg-subtle text-sm">{isArabic ? 'مركز التنبيهات' : 'Notification Center'}</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
