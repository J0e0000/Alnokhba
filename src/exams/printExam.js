// ═══════════════════════════════════════════════════════════════════════════
// Standalone exam report printing — branded A4 (RTL, Cairo, navy/gold).
// Same native-print technique as centers/printCenters.js: pages are rendered
// into a dedicated print-host div and printed with the browser engine via
// CSS @page → perfect Arabic shaping and exact A4 pagination. Own host id +
// EDU branding so exam sheets never carry the Centers footer.
// ═══════════════════════════════════════════════════════════════════════════

const BRAND = {
  navy: '#0E2954',
  navy2: '#142D62',
  gold: '#D4AF37',
  ink: '#1E293B',
  subtle: '#64748B',
  line: 'rgba(14,41,84,.14)',
  bgSoft: '#F8FAFC',
}

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function ensurePrintHost() {
  let host = document.getElementById('nk-exam-print-host')
  if (!host) {
    host = document.createElement('div')
    host.id = 'nk-exam-print-host'
    document.body.appendChild(host)
  }
  return host
}

const CSS = `
#nk-exam-print-host { display: none; }
@media print {
  @page { size: A4; margin: 12mm; }
  body > #root { display: none !important; }
  #nk-exam-print-host { display: block !important; }
}
@media screen {
  #nk-exam-print-host.nk-preview {
    display: block !important; position: fixed; inset: 0; z-index: 99999;
    background: rgba(10,16,32,.72); overflow: auto; padding: 18px;
  }
  #nk-exam-print-host.nk-preview .nk-page {
    width: 210mm; min-height: 297mm; margin: 0 auto 16px; background: #fff;
    box-shadow: 0 12px 48px rgba(0,0,0,.4); border-radius: 6px; padding: 14mm 12mm;
    box-sizing: border-box; direction: rtl;
  }
  #nk-exam-print-host .nk-preview-bar {
    position: sticky; top: 0; z-index: 2; max-width: 210mm; margin: 0 auto 12px;
    display: flex; gap: 8px; justify-content: flex-end;
  }
  #nk-exam-print-host .nk-preview-bar button {
    font-family: Cairo, Tahoma, sans-serif; font-weight: 800; font-size: 14px;
    padding: 10px 18px; border-radius: 10px; border: 0; cursor: pointer;
  }
  #nk-exam-print-host .nk-btn-print { background: ${BRAND.gold}; color: ${BRAND.navy}; }
  #nk-exam-print-host .nk-btn-close { background: #fff; color: ${BRAND.navy}; }
}
`

function tableHtml(headers, rows) {
  const head = headers.map((h) => `<th style="background:${BRAND.bgSoft};padding:7px 9px;border:1px solid ${BRAND.line};font-size:12px;color:${BRAND.navy};text-align:right;">${esc(h)}</th>`).join('')
  const body = rows.map((r) => `<tr>${r.map((c) => `<td style="padding:6px 9px;border:1px solid ${BRAND.line};font-size:12px;">${c}</td>`).join('')}</tr>`).join('')
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:14px;"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}" style="padding:12px;border:1px solid ${BRAND.line};font-size:12px;color:${BRAND.subtle};text-align:center;">—</td></tr>`}</tbody></table>`
}

function statRow(stats) {
  return `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">${stats.map(([label, value]) => `
    <div style="flex:1;min-width:120px;background:${BRAND.bgSoft};border:1px solid ${BRAND.line};border-radius:10px;padding:10px 12px;">
      <div style="font-size:11px;color:${BRAND.subtle};">${esc(label)}</div>
      <div style="font-size:20px;font-weight:800;color:${BRAND.navy};margin-top:2px;">${esc(value)}</div>
    </div>`).join('')}</div>`
}

/**
 * Print the standalone exam report.
 * exam   : { title, exam_date, group_name, max_score, grade_scale, status }
 * rows   : [{ name, code, score|null, grade }] — full roster, graded first
 * stats  : { total, gradedCount, avg, top }
 */
export function printExamReport({ exam, rows, stats, isArabic = true }) {
  if (!exam) return
  const graded = (rows || []).filter((r) => r.score != null)
  const scale = Array.isArray(exam.grade_scale) ? exam.grade_scale : []
  const today = new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const roster = (rows || []).map((r, i) => [
    String(i + 1),
    r.name || '—',
    r.code || '',
    r.score != null ? String(r.score) : '—',
    r.score != null ? `${r.score} / ${exam.max_score}` : '—',
    r.grade ? `<span style="font-weight:800;color:${BRAND.navy};">${esc(r.grade)}</span>` : '—',
  ])

  const scaleRows = scale.map((g) => [
    `<span style="font-weight:800;">${esc(g.name)}</span>`,
    `${g.min}%`,
    exam.max_score > 0 ? Math.round((Number(g.min) / 100) * exam.max_score) : 0,
  ])

  const dist = scale
    .map((g) => ({ name: g.name, n: graded.filter((r) => r.grade === g.name).length }))
    .filter((d) => d.n > 0)
    .map((d) => `${d.name}: ${d.n}`)
    .join(' · ')

  const body = `
    ${statRow([
      [isArabic ? 'الطلاب' : 'Students', String(stats.total)],
      [isArabic ? 'امتحنوا' : 'Took it', `${stats.gradedCount} / ${stats.total}`],
      [isArabic ? 'المتوسط' : 'Average', stats.avg != null ? String(stats.avg) : '—'],
      [isArabic ? 'أعلى درجة' : 'Highest', stats.top != null ? String(stats.top) : '—'],
    ])}
    ${tableHtml(
      [isArabic ? 'المادة' : 'Subject', isArabic ? 'القيمة' : 'Value'],
      [
        [isArabic ? 'العنوان' : 'Title', exam.title],
        [isArabic ? 'التاريخ' : 'Date', exam.exam_date || ''],
        [isArabic ? 'المجموعة' : 'Group', exam.group_name || (isArabic ? 'كل الطلاب' : 'All students')],
        [isArabic ? 'الدرجة النهائية' : 'Max score', String(exam.max_score)],
        [isArabic ? 'التوزيع' : 'Distribution', dist || '—'],
      ],
    )}
    ${scale.length ? tableHtml([isArabic ? 'التقدير' : 'Grade', isArabic ? 'الحد الأدنى' : 'Min %', isArabic ? 'من الدرجة' : 'Of max'], scaleRows) : ''}
    ${tableHtml(['#', isArabic ? 'الطالب' : 'Student', isArabic ? 'الكود' : 'Code', isArabic ? 'الدرجة' : 'Score', isArabic ? 'من' : 'Out of', isArabic ? 'التقدير' : 'Grade'], roster)}
  `

  const host = ensurePrintHost()
  host.className = 'nk-preview'
  host.innerHTML = `
    <style>${CSS}</style>
    <div class="nk-preview-bar">
      <button class="nk-btn-print" id="nk-exam-print-go">🖨️ طباعة</button>
      <button class="nk-btn-close" id="nk-exam-print-close">إغلاق</button>
    </div>
    <div class="nk-page" style="font-family:Cairo,Tahoma,sans-serif;color:${BRAND.ink};direction:rtl;">
      <div style="background:linear-gradient(135deg,${BRAND.navy},${BRAND.navy2});border-radius:12px;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
          <div style="font-size:22px;font-weight:800;color:#fff;">${esc(exam.title)}</div>
          <div style="font-size:13px;color:#CBD5E1;margin-top:3px;">${esc(exam.exam_date || '')}${exam.group_name ? ` · ${esc(exam.group_name)}` : ''} · ${isArabic ? 'النهائي' : 'Max'}: ${esc(exam.max_score)}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:24px;font-weight:800;color:${BRAND.gold};">النخبة</div>
          <div style="font-size:10px;color:#CBD5E1;">El No5ba — نتيجة امتحان</div>
        </div>
      </div>
      ${body}
      <div style="margin-top:18px;padding-top:10px;border-top:1px solid ${BRAND.line};display:flex;justify-content:space-between;font-size:10px;color:${BRAND.subtle};">
        <span>${esc(exam.title)} — ${esc(today)}</span>
        <span>El No5ba EDU — A4</span>
      </div>
    </div>
  `
  const close = () => { host.className = ''; host.innerHTML = '' }
  host.querySelector('#nk-exam-print-close').onclick = close
  host.querySelector('#nk-exam-print-go').onclick = () => window.print()
  host.onclick = (e) => { if (e.target === host) close() }
}
