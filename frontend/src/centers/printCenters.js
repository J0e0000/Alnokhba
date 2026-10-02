// ═══════════════════════════════════════════════════════════════════════════
// EL NO5BA CENTERS — printing (first-class action)
// Branded A4 pages (RTL, Cairo, navy/gold) rendered into a print overlay and
// printed with the browser's native print engine → perfect Arabic shaping and
// exact A4 pagination via CSS `@page`. No image rasterization needed.
// ═══════════════════════════════════════════════════════════════════════════
export const BRAND = {
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
  let host = document.getElementById('nk-centers-print-host')
  if (!host) {
    host = document.createElement('div')
    host.id = 'nk-centers-print-host'
    document.body.appendChild(host)
  }
  return host
}

const CSS = `
#nk-centers-print-host { display: none; }
@media print {
  @page { size: A4; margin: 12mm; }
  body > #root { display: none !important; }
  #nk-centers-print-host { display: block !important; }
  #nk-centers-print-host .nk-page { page-break-after: always; }
  #nk-centers-print-host .nk-page:last-child { page-break-after: auto; }
}
@media screen {
  #nk-centers-print-host.nk-preview {
    display: block !important; position: fixed; inset: 0; z-index: 99999;
    background: rgba(10,16,32,.72); overflow: auto; padding: 18px;
  }
  #nk-centers-print-host.nk-preview .nk-page {
    width: 210mm; min-height: 297mm; margin: 0 auto 16px; background: #fff;
    box-shadow: 0 12px 48px rgba(0,0,0,.4); border-radius: 6px; padding: 14mm 12mm;
    box-sizing: border-box; direction: rtl;
  }
  #nk-centers-print-host .nk-preview-bar {
    position: sticky; top: 0; z-index: 2; max-width: 210mm; margin: 0 auto 12px;
    display: flex; gap: 8px; justify-content: flex-end;
  }
  #nk-centers-print-host .nk-preview-bar button {
    font-family: Cairo, Tahoma, sans-serif; font-weight: 800; font-size: 14px;
    padding: 10px 18px; border-radius: 10px; border: 0; cursor: pointer;
  }
  #nk-centers-print-host .nk-btn-print { background: ${BRAND.gold}; color: ${BRAND.navy}; }
  #nk-centers-print-host .nk-btn-close { background: #fff; color: ${BRAND.navy}; }
}
`

function pageShell(title, subtitle, bodyHtml) {
  const today = new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  return `
  <div class="nk-page" style="font-family:Cairo,Tahoma,sans-serif;color:${BRAND.ink};direction:rtl;">
    <div style="background:linear-gradient(135deg,${BRAND.navy},${BRAND.navy2});border-radius:12px;padding:18px 20px;display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
      <div>
        <div style="font-size:22px;font-weight:800;color:#fff;">${esc(title)}</div>
        ${subtitle ? `<div style="font-size:13px;color:#CBD5E1;margin-top:3px;">${esc(subtitle)}</div>` : ''}
      </div>
      <div style="text-align:center;">
        <div style="font-size:24px;font-weight:800;color:${BRAND.gold};">النخبة</div>
        <div style="font-size:10px;color:#CBD5E1;">El No5ba Centers</div>
      </div>
    </div>
    ${bodyHtml}
    <div style="margin-top:18px;padding-top:10px;border-top:1px solid ${BRAND.line};display:flex;justify-content:space-between;font-size:10px;color:${BRAND.subtle};">
      <span>تم الإنشاء من نظام النخبة — ${esc(today)}</span>
      <span>El No5ba Centers — A4</span>
    </div>
  </div>`
}

function tableHtml(headers, rows) {
  const head = headers.map((h) => `<th style="background:${BRAND.bgSoft};padding:7px 9px;border:1px solid ${BRAND.line};font-size:12px;color:${BRAND.navy};text-align:right;">${esc(h)}</th>`).join('')
  const body = rows.map((r) => `<tr>${r.map((c) => `<td style="padding:6px 9px;border:1px solid ${BRAND.line};font-size:12px;">${esc(c)}</td>`).join('')}</tr>`).join('')
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:14px;"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}" style="padding:12px;border:1px solid ${BRAND.line};font-size:12px;color:${BRAND.subtle};text-align:center;">—</td></tr>`}</tbody></table>`
}

function statRow(stats) {
  return `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">${stats.map(([label, value]) => `
    <div style="flex:1;min-width:130px;background:${BRAND.bgSoft};border:1px solid ${BRAND.line};border-radius:10px;padding:10px 12px;">
      <div style="font-size:11px;color:${BRAND.subtle};">${esc(label)}</div>
      <div style="font-size:20px;font-weight:800;color:${BRAND.navy};margin-top:2px;">${esc(value)}</div>
    </div>`).join('')}</div>`
}

/**
 * Open the print preview for arbitrary pages.
 * pages = [{ title, subtitle, bodyHtml }] — bodyHtml must be pre-escaped via
 * the helpers below (they escape all dynamic values).
 */
export function printPages(pages, { auto = true } = {}) {
  if (!pages?.length) return
  const host = ensurePrintHost()
  host.className = 'nk-preview'
  host.innerHTML = `
    <style>${CSS}</style>
    <div class="nk-preview-bar">
      <button class="nk-btn-print" id="nk-print-go">🖨️ طباعة</button>
      <button class="nk-btn-close" id="nk-print-close">إغلاق</button>
    </div>
    ${pages.map((p) => pageShell(p.title, p.subtitle, p.bodyHtml)).join('')}
  `
  const close = () => { host.className = ''; host.innerHTML = '' }
  host.querySelector('#nk-print-close').onclick = close
  host.querySelector('#nk-print-go').onclick = () => window.print()
  host.onclick = (e) => { if (e.target === host) close() }
  if (auto) setTimeout(() => window.print(), 350)
}

export const printHelpers = { esc, tableHtml, statRow }

/** Session summary page (from Focus Mode / Today card / success bar) */
export function printSessionSummary({ centerName, session, group, teacher, room, students, attendanceRows }) {
  const attMap = new Map((attendanceRows || []).map((a) => [a.student_id, a.status]))
  const counts = { present: 0, late: 0, absent: 0, excused: 0 }
  students.forEach((s) => { const st = attMap.get(s.id) || 'absent'; counts[st] = (counts[st] || 0) + 1 })
  const rows = students.map((s, i) => [
    String(i + 1), s.name || '—', s.stage || '—',
    { present: 'حاضر ✅', late: 'متأخر 🕐', absent: 'غائب ❌', excused: 'إذن 📝' }[attMap.get(s.id) || 'absent'],
    '—',
  ])
  const body = `
    ${statRow([
      ['الحالة', { upcoming: 'لم تبدأ', live: 'جارية الآن', completed: 'تمت', cancelled: 'ملغاة' }[session.status] || session.status],
      ['الوقت', `${session.starts_at} – ${session.ends_at}`],
      ['الطلاب', String(students.length)],
      ['الحضور', `${counts.present + counts.late} / ${students.length}`],
    ])}
    ${tableHtml(['المدرس', 'القاعة', 'الموضوع'], [[teacher?.name || '—', room?.name || '—', session.topic || '—']])}
    ${tableHtml(['#', 'الطالب', 'المرحلة', 'الحالة', 'ملاحظة'], rows)}
    ${session.notes ? `<div style="background:${BRAND.bgSoft};border:1px solid ${BRAND.line};border-radius:10px;padding:12px;font-size:12px;white-space:pre-wrap;"><b style="color:${BRAND.navy};">ملاحظات الحصة:</b><br/>${esc(session.notes)}</div>` : ''}
  `
  printPages([{
    title: `ملخص الحصة — ${group?.name || ''}`,
    subtitle: `${centerName || ''} · ${session.session_date}`,
    bodyHtml: body,
  }])
}

/** Reports pages (Reports tab) */
export function printReport({ centerName, rangeLabel, stats, perGroup, perTeacher }) {
  const body = `
    ${statRow(stats)}
    ${tableHtml(['المجموعة', 'الحصص', 'الحضور %', 'الطلاب'], perGroup)}
    ${tableHtml(['المعلم', 'المادة', 'الحصص', 'متوسط الحضور %'], perTeacher)}
  `
  printPages([{ title: 'تقرير تشغيلي', subtitle: `${centerName || ''} · ${rangeLabel}`, bodyHtml: body }])
}
