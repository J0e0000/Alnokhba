import { useEffect, useRef, useState } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// LINE TEMPLATE EDITOR — قالب كأسطر مستقلة (owner spec: "نقدر نعدل أسطر عليه")
//
// WHY LINES: the owner edits reports line by line — one big textarea yanked
// the caret to the end while typing mid-text (the classic controlled-
// textarea + parent-rerender bug) and made restructuring awkward. Here every
// line is its OWN controlled input keyed by a stable id, so:
//   • typing inside line 3 can never move the caret of line 3 (its value
//     always equals what was just typed), and
//   • deleting / reordering / inserting lines is a first-class action.
//
// The template value handed to the parent stays ONE STRING ('\\n'-joined) —
// fully compatible with the existing send-time interpolation
// (interpolateTemplate / buildAttendanceMessage) and with previously saved
// single-string templates (they just split into lines on open).
// ═══════════════════════════════════════════════════════════════════════════

let LINE_SEQ = 0
const fromText = (text) => String(text || '').split('\n').map((t) => ({ id: ++LINE_SEQ, text: t }))
const toText = (lines) => lines.map((l) => l.text).join('\n')

export default function LineTemplateEditor({ value, onChange, bricks = [], readyTemplate, hint, minLines = 1 }) {
  // Seed ONCE on mount — the parent re-mounts us per open (studio renders us
  // only while open), so settings identity churn can never re-seed mid-edit.
  const [lines, setLines] = useState(() => fromText(value))
  const [armed, setArmed] = useState(false)
  const refsRef = useRef(new Map()) // line id → <textarea>
  const caretRef = useRef({ id: null, pos: 0 })

  const setRef = (id) => (el) => {
    if (el) refsRef.current.set(id, el)
    else refsRef.current.delete(id)
  }

  const commit = (next) => {
    setLines(next)
    onChange?.(toText(next))
  }

  const autosize = (el) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(() => {
    refsRef.current.forEach(autosize)
  }, [lines])

  const focusLine = (id, pos) => {
    requestAnimationFrame(() => {
      const el = refsRef.current.get(id)
      if (!el) return
      el.focus()
      try { el.setSelectionRange(pos, pos) } catch { /* detached */ }
    })
  }

  const updateLine = (id, text) => {
    commit(lines.map((l) => (l.id === id ? { ...l, text } : l)))
  }

  const insertLineAfter = (id, text = '') => {
    const idx = lines.findIndex((l) => l.id === id)
    const newline = { id: ++LINE_SEQ, text }
    const next = [...lines.slice(0, idx + 1), newline, ...lines.slice(idx + 1)]
    commit(next)
    focusLine(newline.id, 0)
  }

  const removeLine = (id) => {
    if (lines.length <= minLines) return
    const idx = lines.findIndex((l) => l.id === id)
    const next = lines.filter((l) => l.id !== id)
    commit(next)
    const prev = next[Math.max(0, idx - 1)]
    if (prev) focusLine(prev.id, (prev.text || '').length)
  }

  const moveLine = (id, delta) => {
    const idx = lines.findIndex((l) => l.id === id)
    const to = idx + delta
    if (idx < 0 || to < 0 || to >= lines.length) return
    const next = [...lines]
    const [row] = next.splice(idx, 1)
    next.splice(to, 0, row)
    commit(next)
    focusLine(id, caretRef.current.pos || 0)
  }

  const onKeyDown = (e, line, idx) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Enter splits the line at the caret — the natural "new line" gesture.
      const el = refsRef.current.get(line.id)
      const pos = el && typeof el.selectionStart === 'number' ? el.selectionStart : (line.text || '').length
      const before = (line.text || '').slice(0, pos)
      const after = (line.text || '').slice(pos)
      const newline = { id: ++LINE_SEQ, text: after }
      const next = [...lines.slice(0, idx), { ...line, text: before }, newline, ...lines.slice(idx + 1)]
      commit(next)
      focusLine(newline.id, 0)
    } else if (e.key === 'Backspace' && !(line.text || '').length && lines.length > minLines) {
      e.preventDefault()
      removeLine(line.id)
    } else if (e.key === 'ArrowUp' && (e.altKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      moveLine(line.id, -1)
    } else if (e.key === 'ArrowDown' && (e.altKey || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      moveLine(line.id, 1)
    }
  }

  // Bricks insert at the caret of the focused line; with no focus they go to
  // a fresh last line (never silently appended to a visible line's tail).
  const addBrick = (brick) => {
    const targetId = caretRef.current.id
    const target = lines.find((l) => l.id === targetId)
    if (!target) {
      const newline = { id: ++LINE_SEQ, text: brick }
      commit([...lines, newline])
      focusLine(newline.id, brick.length)
      return
    }
    const el = refsRef.current.get(target.id)
    let start = caretRef.current.pos ?? (target.text || '').length
    let end = start
    if (el && typeof el.selectionStart === 'number') {
      start = el.selectionStart
      end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start
    }
    const cur = target.text || ''
    const pos = start + brick.length
    updateLine(target.id, `${cur.slice(0, start)}${brick}${cur.slice(end)}`)
    focusLine(target.id, pos)
  }

  const applyReady = () => {
    if (!armed && (value || '').trim()) {
      setArmed(true)
      return
    }
    setArmed(false)
    const next = fromText(readyTemplate || '')
    commit(next)
    if (next[0]) focusLine(next[0].id, (next[0].text || '').length)
  }

  const iconBtn = 'w-6 h-6 rounded-md text-[11px] leading-none flex items-center justify-center text-fg-subtle hover:text-fg hover:bg-white/10 transition-colors disabled:opacity-30'

  return (
    <div>
      {bricks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2" aria-label="لبنات القالب">
          {bricks.map(([name, brick]) => (
            <button key={brick} type="button" onClick={() => addBrick(brick)} className="rounded-full border border-brand-gold/30 bg-brand-gold/10 px-2 py-1 text-[11px] text-brand-gold-hover hover:bg-brand-gold/20">
              + {name}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        {lines.map((line, idx) => (
          <div key={line.id} className="group flex items-start gap-1.5">
            <span className="text-[10px] w-4 pt-2.5 text-fg-subtle/70 text-center shrink-0 select-none" aria-hidden="true">{idx + 1}</span>
            <textarea
              ref={setRef(line.id)}
              rows={1}
              dir="auto"
              value={line.text}
              placeholder="سطر فاضي هيختفي من الرسالة"
              onFocus={(e) => { caretRef.current = { id: line.id, pos: e.target.selectionStart || 0 } }}
              onInput={(e) => autosize(e.target)}
              onClick={(e) => { caretRef.current = { id: line.id, pos: e.target.selectionStart || 0 } }}
              onKeyUp={(e) => { caretRef.current = { id: line.id, pos: e.target.selectionStart || 0 } }}
              onChange={(e) => updateLine(line.id, e.target.value)}
              onKeyDown={(e) => onKeyDown(e, line, idx)}
              className="flex-1 glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold resize-none overflow-hidden min-h-[2.4rem]"
              aria-label={`سطر ${idx + 1}`}
            />
            <div className="flex flex-col gap-0.5 pt-0.5 opacity-60 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              <button type="button" className={iconBtn} title="لأعلى (Alt+↑)" disabled={idx === 0} onClick={() => moveLine(line.id, -1)}>↑</button>
              <button type="button" className={iconBtn} title="لأسفل (Alt+↓)" disabled={idx === lines.length - 1} onClick={() => moveLine(line.id, 1)}>↓</button>
              <button type="button" className={`${iconBtn} hover:!text-rose-400`} title="حذف السطر" disabled={lines.length <= minLines} onClick={() => removeLine(line.id)}>✕</button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 mt-2">
        <button type="button" onClick={() => insertLineAfter(lines[lines.length - 1]?.id, '')} className="text-[11px] font-extrabold underline" style={{ color: 'var(--accent-blue)' }}>
          ＋ سطر جديد
        </button>
        {readyTemplate && (
          <button
            type="button"
            onClick={applyReady}
            onBlur={() => setArmed(false)}
            aria-pressed={armed}
            title="يكتب القالب الجاهز كأسطر — الاستبدال بيتأكد بضغطة تانية"
            className={armed
              ? 'rounded-full px-2.5 py-1 text-[11px] font-extrabold bg-brand-gold text-nk-navy border border-brand-gold'
              : 'rounded-full border border-brand-gold/40 bg-brand-gold/10 px-2.5 py-1 text-[11px] font-extrabold text-brand-gold-hover hover:bg-brand-gold/20'}
          >
            {armed ? 'متأكد؟ اضغط تاني للاستبدال' : '✨ قالب جاهز'}
          </button>
        )}
      </div>
      {hint && <p className="text-[11px] text-fg-muted mt-1.5 mb-0">{hint}</p>}
    </div>
  )
}
