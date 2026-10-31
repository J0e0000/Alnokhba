import { useMemo, useState } from 'react'
import { getStudentRank } from '../lib/helpers'

// ═══════════════════════════════════════════════════════════════════════════
// LEADERBOARD PANEL (لائحة المتصدرين) — lives at the top of the Students
// area. Ranks students by their points balance (the same points that the
// session pipeline awards and the student portal displays) and reuses the
// configurable rank titles from Settings (getStudentRank).
//
//  • COMPETITION RANKING: equal points share a position (1, 1, 3…) — a tie
//    never demotes a student behind someone with the same balance. Name
//    (Arabic collation) breaks the sort order deterministically.
//  • PODIUM for the top 3 (gold/silver/bronze by POSITION, not index — two
//    tied leaders both get 🥇), compact rows beyond, expandable to full list.
//  • Tap a row → opens that student's history (same as tapping a name in
//    the table) — the leaderboard is also a shortcut into student profiles.
//  • The parent passes an already-filtered pool: stage + group filters apply
//    (so "المتصدرون" is contextual), but search/status deliberately do NOT
//    — typing in the search box must never empty the leaderboard.
// ═══════════════════════════════════════════════════════════════════════════
const COLLAPSED_COUNT = 10
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' }

export default function LeaderboardPanel({ students, ranks, isArabic, onOpenStudent }) {
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState(false)

  const ranked = useMemo(() => {
    const sorted = [...(students || [])].sort((a, b) =>
      (b.points || 0) - (a.points || 0) ||
      String(a.name || '').localeCompare(String(b.name || ''), 'ar'))
    let pos = 0
    return sorted.map((s, i) => {
      if (i === 0 || (s.points || 0) !== (sorted[i - 1].points || 0)) pos = i + 1
      return { student: s, position: pos }
    })
  }, [students])

  if (!students || students.length === 0) return null

  const anyPoints = ranked.some((r) => (r.student.points || 0) > 0)
  const visible = expanded ? ranked : ranked.slice(0, COLLAPSED_COUNT)
  // Classic podium arrangement: 2nd — 1st — 3rd (winner centered).
  const podium = [visible[1], visible[0], visible[2]].filter(Boolean)
  const rest = visible.slice(3)

  const t = {
    title: isArabic ? 'لائحة المتصدرين' : 'Leaderboard',
    by: isArabic ? 'حسب النقاط' : 'by points',
    showAll: (n) => isArabic ? `عرض الكل (${n})` : `Show all (${n})`,
    showLess: isArabic ? 'عرض أقل' : 'Show less',
    noPoints: isArabic
      ? 'لم تُمنح نقاط بعد — النقاط تُسجَّل تلقائيًا من داخل الحصة (الحضور، التفاعل…).'
      : 'No points awarded yet — points are recorded inside sessions (attendance, participation…).',
    openProfile: isArabic ? 'فتح سجل الطالب' : 'Open student history',
  }

  const pointsPill = (p) => (
    <span className="nk-pill nk-pill-gold shrink-0">{p}</span>
  )

  return (
    <section className="glass-card p-4 mb-4" aria-label={t.title}>
      <button
        className="flex items-center justify-between gap-2 w-full bg-transparent border-0 p-0 m-0 cursor-pointer font-[inherit] text-start"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className="text-lg leading-none">🏆</span>
          <b className="text-[.9rem] font-black" style={{ color: 'var(--fg)' }}>{t.title}</b>
          <span className="nk-pill nk-pill-neutral">{t.by}</span>
          <span className="nk-pill nk-pill-gold">{students.length}</span>
        </span>
        <span aria-hidden="true" className="text-fg-muted text-xs font-black">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="mt-3">
          {!anyPoints ? (
            <p className="text-[.74rem] text-fg-muted m-0">{t.noPoints}</p>
          ) : (
            <>
              {/* Podium — top 3 by position (ties share medals) */}
              <div className="nk-lb-podium">
                {podium.map(({ student: s, position }) => (
                  <button
                    key={s.id}
                    className={`nk-lb-pod nk-lb-pod--${position <= 3 ? position : 3}`}
                    onClick={() => onOpenStudent?.(s.id)}
                    title={t.openProfile}
                  >
                    <span className="nk-lb-medal" aria-hidden="true">{MEDALS[position] || `${position}.`}</span>
                    <span className="nk-lb-pod-name">{s.name}</span>
                    {s.group_name && <span className="nk-lb-pod-sub">{s.group_name}</span>}
                    {pointsPill(s.points || 0)}
                    <span className="nk-lb-pod-sub">{getStudentRank(s.points || 0, ranks)}</span>
                  </button>
                ))}
              </div>

              {/* Positions beyond the podium */}
              {rest.length > 0 && (
                <div className="grid gap-1.5 mt-2">
                  {rest.map(({ student: s, position }) => (
                    <button
                      key={s.id}
                      className="nk-lb-row"
                      onClick={() => onOpenStudent?.(s.id)}
                      title={t.openProfile}
                    >
                      <span className="nk-lb-pos">{position}</span>
                      <span className="min-w-0 flex-1 text-start">
                        <span className="nk-lb-row-name">{s.name}</span>
                        {s.group_name && <span className="nk-lb-row-sub">{s.group_name}</span>}
                      </span>
                      <span className="nk-lb-row-rank shrink-0">{getStudentRank(s.points || 0, ranks)}</span>
                      {pointsPill(s.points || 0)}
                    </button>
                  ))}
                </div>
              )}

              {ranked.length > COLLAPSED_COUNT && (
                <button
                  className="nk-att-chip mt-3 mx-auto"
                  onClick={() => setExpanded((e) => !e)}
                  aria-expanded={expanded}
                >
                  {expanded ? t.showLess : t.showAll(ranked.length)}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
