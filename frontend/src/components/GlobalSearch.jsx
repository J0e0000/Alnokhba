import { useEffect, useMemo, useRef, useState } from 'react'
import { useUI } from '../shell/UIContext'
import { useWorkspace, normalizeArabicSearch } from '../store/WorkspaceStore'
import { useLanguage } from '../context/LanguageContext'
import { FAQS } from '../data/faqData'
import { todayLocalISO } from '../lib/dateUtils'

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL SEARCH (brief §16 + §26) — Ctrl/⌘+K site-wide search over entities
// ALREADY loaded in the store (zero network): students, sessions, exams,
// pages, and FAQ entries. Every result shows its entity type and navigates
// directly. Permission-safe by construction: the store only ever holds data
// the signed-in teacher is authorized to see. Input is debounced (120ms).
// ═══════════════════════════════════════════════════════════════════════════

const TYPE_BADGE = {
  student: { ar: 'طالب', en: 'Student' },
  session: { ar: 'حصة', en: 'Session' },
  exam: { ar: 'امتحان', en: 'Exam' },
  faq: { ar: 'مساعدة', en: 'FAQ' },
  page: { ar: 'صفحة', en: 'Feature' },
}

export default function GlobalSearch() {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = useLanguage()
  const ar = isArabic
  const [raw, setRaw] = useState('')
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  // Debounce: 120ms — avoids recomputing on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(raw.trim()), 120)
    return () => window.clearTimeout(t)
  }, [raw])

  useEffect(() => {
    if (ui.searchOpen) {
      setRaw(''); setQuery(''); setCursor(0)
      window.setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [ui.searchOpen])

  const pages = useMemo(() => ([
    { key: 'home', ar: 'نظرة عامة', en: 'Overview' },
    { key: 'students', ar: 'الطلاب', en: 'Students' },
    { key: 'history', ar: 'سجل الطالب', en: 'Student History' },
    { key: 'reports', ar: 'التقارير', en: 'Reports' },
    { key: 'analytics', ar: 'التحليلات', en: 'Analytics' },
    { key: 'settings', ar: 'الإعدادات', en: 'Settings' },
    { key: 'help', ar: 'المساعدة والأسئلة', en: 'Help & FAQ' },
  ]), [])

  const index = useMemo(() => {
    const items = []
    ws.students.forEach((s) => items.push({
      type: 'student', id: s.id, title: s.name,
      sub: [s.code ? `كود ${s.code}` : '', s.group_name, s.phone].filter(Boolean).join(' · '),
      hay: normalizeArabicSearch([s.name, s.code, s.phone, s.group_name].filter(Boolean).join(' ')),
      go: () => ui.goToStudent(s.id),
    }))
    // Sessions: one entry per saved lesson (most recent 60 for focus)
    ws.lessonSessions.slice(0, 60).forEach((l) => items.push({
      type: 'session', id: l.id, title: `${l.group_name} — ${l.lesson_topic || (l.status === 'completed' ? 'حصة منتهية' : 'حصة جارية')}`,
      sub: l.session_date,
      hay: normalizeArabicSearch(`${l.group_name} ${l.lesson_topic || ''} ${l.session_date} ${l.homework_text || ''}`),
      go: () => ui.openSession(l.session_date === todayLocalISO() ? { groupId: l.group_name } : { groupId: l.group_name, date: l.session_date }),
    }))
    ws.examsList.slice(0, 60).forEach((e) => {
      const lesson = ws.lessonSessions.find((l) => l.id === e.lesson_session_id)
      items.push({
        type: 'exam', id: e.id, title: e.title,
        sub: lesson ? `${lesson.group_name} · ${lesson.session_date}` : '',
        hay: normalizeArabicSearch(`${e.title || ''} ${lesson ? `${lesson.group_name} ${lesson.session_date}` : ''}`),
        go: () => { if (lesson) ui.openSession(lesson.session_date === todayLocalISO() ? { groupId: lesson.group_name } : { groupId: lesson.group_name, date: lesson.session_date, tab: 'exams' }); else ui.setArea('students') },
      })
    })
    FAQS.forEach((f) => items.push({
      type: 'faq', id: f.id, title: f.q, sub: f.a.slice(0, 70) + '…',
      hay: normalizeArabicSearch(`${f.q} ${f.a}`),
      go: () => ui.openHelp(f.id),
    }))
    pages.forEach((p) => items.push({
      type: 'page', id: p.key, title: ar ? p.ar : p.en, sub: '',
      hay: normalizeArabicSearch(`${p.ar} ${p.en} ${p.key}`),
      go: () => ui.setArea(p.key),
    }))
    return items
  }, [ws.students, ws.lessonSessions, ws.examsList, ui, pages, ar])

  const results = useMemo(() => {
    const q = normalizeArabicSearch(query)
    if (!q) return []
    return index.filter((it) => it.hay.includes(q)).slice(0, 14)
  }, [index, query])

  useEffect(() => { setCursor(0) }, [query])

  if (!ui.searchOpen) return null

  const choose = (it) => {
    ui.closeSearch()
    if (it) it.go()
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { ui.closeSearch(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return }
    if (e.key === 'Enter') { e.preventDefault(); choose(results[cursor]) }
  }

  return (
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center pt-[10vh] px-4"
      style={{ background: 'rgba(4,10,22,.55)' }}
      role="dialog"
      aria-modal="true"
      aria-label={ar ? 'البحث الشامل' : 'Global search'}
      onClick={ui.closeSearch}
    >
      <div className="glass-card w-full max-w-xl p-0 overflow-hidden animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--surface-border)' }}>
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-0 outline-none text-sm"
            placeholder={ar ? 'ابحث عن طالب، حصة، امتحان، صفحة، أو مساعدة...' : 'Search students, sessions, exams, pages, help...'}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label={ar ? 'نص البحث' : 'Search query'}
          />
          <button className="nk-pill nk-pill-neutral cursor-pointer border-0" onClick={ui.closeSearch} aria-label={ar ? 'إغلاق' : 'Close'}>Esc</button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto" ref={listRef}>
          {query && results.length === 0 && (
            <p className="text-center py-8 text-sm text-fg-muted m-0">{ar ? 'لا نتائج — جرّب كلمات أخرى' : 'No results — try other words'}</p>
          )}
          {!query && (
            <p className="text-center py-8 text-sm text-fg-muted m-0">
              {ar ? 'اكتب للبحث في كل النظام — النتائج تنقلك مباشرة إلى الهدف.' : 'Type to search the whole system — results take you straight there.'}
            </p>
          )}
          <ul className="list-none m-0 p-2 grid gap-1">
            {results.map((it, i) => {
              const badge = TYPE_BADGE[it.type]
              return (
                <li key={`${it.type}-${it.id}`}>
                  <button
                    className={`nk-search-row ${i === cursor ? 'nk-search-row--on' : ''}`}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => choose(it)}
                  >
                    <span className="nk-pill nk-pill-gold !text-[.6rem] !py-0.5 shrink-0">{ar ? badge.ar : badge.en}</span>
                    <span className="min-w-0 flex-1 text-right">
                      <b className="block text-[.82rem] truncate">{it.title}</b>
                      {it.sub && <small className="block text-[.68rem] text-fg-muted truncate">{it.sub}</small>}
                    </span>
                    <span aria-hidden="true" className="text-fg-muted">←</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
