// ═══════════════════════════════════════════════════════════════════════════
// CSV EXPORT — tiny helper for teacher-facing exports (rule: deterministic,
// no external deps). Writes UTF-8 with BOM so Excel opens Arabic correctly.
// ═══════════════════════════════════════════════════════════════════════════

function escapeCell(value) {
  const s = String(value ?? '')
  return /[",\n\r;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

/**
 * downloadCSV('file.csv', ['الاسم', 'النقاط'], [['أحمد', 51], ...])
 * Rows are arrays of cells, same length as headers (not enforced).
 */
export function downloadCSV(filename, headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(','))
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Local date as YYYY-MM-DD (for filenames / date comparisons). */
export function localDateStr(d = new Date()) {
  const x = new Date(d)
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${x.getFullYear()}-${m}-${day}`
}
