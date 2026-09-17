import { useEffect, useMemo, useRef, useState } from 'react'
import { useUI } from '../shell/UIContext'
import { useWorkspace, normalizeArabicSearch } from '../store/WorkspaceStore'
import { useLanguage } from '../context/LanguageContext'
import { FAQS, FAQ_CATS } from '../data/faqData'
import ScrollProgress from '../components/ScrollFloat'

// ═══════════════════════════════════════════════════════════════════════════
// HELP AREA (brief §22–§25) — searchable FAQ / Help Center.
// Categorized, expandable questions, deep links that navigate straight to the
// relevant surface, and a troubleshooting category. Opened via sidebar /
// bottom nav / floating help button / search results / FAQ deep links.
// ═══════════════════════════════════════════════════════════════════════════
export default function HelpArea() {
  const ws = useWorkspace()
  const ui = useUI()
  const { isArabic } = useLanguage()
  const ar = isArabic
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('all')
  const [openId, setOpenId] = useState(ui.helpTopicId)
  const listRef = useRef(null)

  // Deep-linked topic (from search / other FAQ entries): expand + scroll.
  useEffect(() => {
    if (ui.helpTopicId) {
      setOpenId(ui.helpTopicId)
      ui.setHelpTopicId(null)
    }
  }, [ui])

  useEffect(() => {
    if (openId && listRef.current) {
      const el = listRef.current.querySelector(`[data-faq="${openId}"]`)
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [openId])

  const runAct = async (act) => {
    if (!act) return
    if (act.type === 'area') { ui.setArea(act.area); return }
    if (act.type === 'day') { ui.setArea('home'); return }
    if (act.type === 'search') { ui.openSearch(); return }
    if (act.type === 'tour') { window.dispatchEvent(new CustomEvent('nk:start-tour')); return }
    if (act.type === 'workspace' || act.type === 'workspaceTab') {
      const tab = act.tab || 'attendance'
      const active = ws.activeLesson
      if (active && active.status === 'open') { ui.openSession({ groupId: active.group_name, tab }); return }
      const openToday = ws.lessonSessions.find((l) => l.status === 'open')
      if (openToday) { ui.openSession({ groupId: openToday.group_name, tab }); return }
      ui.setArea('home')
      ws.showToast(ar ? 'افتح حصة من الرئيسية أولًا — لا توجد حصة جارية الآن.' : 'Open a session from Home first — none is running now.', 'info')
    }
  }

  const results = useMemo(() => {
    const q = normalizeArabicSearch(query)
    return FAQS.filter((f) => {
      if (cat !== 'all' && f.cat !== cat) return false
      if (!q) return true
      return normalizeArabicSearch(`${f.q} ${f.a}`).includes(q)
    })
  }, [query, cat])

  const grouped = useMemo(() => {
    const byCat = new Map()
    results.forEach((f) => {
      if (!byCat.has(f.cat)) byCat.set(f.cat, [])
      byCat.get(f.cat).push(f)
    })
    return FAQ_CATS.filter((c) => byCat.has(c.key)).map((c) => ({ cat: c, items: byCat.get(c.key) }))
  }, [results])

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <div className="eyebrow font-black tracking-widest text-[.66rem]" style={{ color: 'var(--brand-gold)' }}>
            {ar ? 'مساعدة' : 'HELP CENTER'}
          </div>
          <h1 className="text-[1.35rem] font-black mt-1.5 mb-1">{ar ? 'مركز المساعدة والأسئلة الشائعة' : 'Help & FAQ'}</h1>
          <p className="text-[.78rem] text-fg-muted m-0">{ar ? 'ابحث، تصفّح حسب الموضوع، أو أعد الجولة التفاعلية.' : 'Search, browse by topic, or restart the tour.'}</p>
        </div>
        <button className="btn-gold rounded-xl px-4 py-2.5 text-[.76rem] font-extrabold" onClick={() => window.dispatchEvent(new CustomEvent('nk:start-tour'))}>
          ▶ {ar ? 'أعد الجولة التفاعلية' : 'Restart the tour'}
        </button>
      </div>

      <input
        className="glass-input rounded-xl px-4 py-3 text-sm w-full mb-3"
        placeholder={ar ? '🔍 ابحث في المساعدة... (مثال: تغيير درجة)' : 'Search help... (e.g. change a grade)'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={ar ? 'بحث في المساعدة' : 'Search help'}
      />

      <div className="flex flex-wrap gap-1.5 mb-5" role="tablist" aria-label={ar ? 'تصنيفات المساعدة' : 'Help categories'}>
        <button
          className={`nk-faq-cat ${cat === 'all' ? 'nk-faq-cat--on' : ''}`}
          onClick={() => setCat('all')}
          aria-pressed={cat === 'all'}
        >
          {ar ? 'الكل' : 'All'}
        </button>
        {FAQ_CATS.map((c) => (
          <button
            key={c.key}
            className={`nk-faq-cat ${cat === c.key ? 'nk-faq-cat--on' : ''}`}
            onClick={() => setCat(c.key)}
            aria-pressed={cat === c.key}
          >
            <span aria-hidden="true">{c.icon}</span> {ar ? c.ar : c.en}
          </button>
        ))}
      </div>

      <ScrollProgress />

      <div ref={listRef} className="grid gap-5">
        {grouped.map(({ cat: c, items }) => (
          <section key={c.key}>
            <h2 className="text-[.92rem] font-extrabold mb-2 flex items-center gap-2">
              <span aria-hidden="true" style={{ color: 'var(--brand-gold)' }}>{c.icon}</span>
              {ar ? c.ar : c.en}
            </h2>
            <div className="grid gap-2">
              {items.map((f) => {
                const open = openId === f.id
                return (
                  <div key={f.id} data-faq={f.id} className={`nk-faq ${open ? 'nk-faq--open' : ''}`}>
                    <button
                      className="nk-faq__q"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : f.id)}
                    >
                      <span>{f.q}</span>
                      <span aria-hidden="true" className="nk-faq__chev">{open ? '−' : '+'}</span>
                    </button>
                    {open && (
                      <div className="nk-faq__a">
                        <p className="m-0 mb-2">{f.a}</p>
                        {f.links && f.links.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {f.links.map((l, i) => (
                              <button key={i} className="btn-gold rounded-xl px-3.5 py-2 text-[.72rem] font-extrabold" onClick={() => runAct(l.act)}>
                                {ar ? l.label.ar : l.label.en} ←
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        ))}
        {grouped.length === 0 && (
          <div className="nk-content text-center py-8">
            <p className="font-extrabold mb-1">{ar ? 'لا نتائج مطابقة' : 'No matching questions'}</p>
            <p className="text-[.76rem] text-fg-muted m-0">{ar ? 'جرّب كلمات أخرى، أو تصفّح تصنيفًا.' : 'Try different words or browse a category.'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
