import { useMemo } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// DAY TIMELINE — the horizontal day strip on the Overview (restored by owner
// request: "return the timeline in the overview menu"). Selecting a day drives
// which sessions the Overview displays. Pure UI: switching days costs ZERO
// network requests (sessions/attendance already live in the store), so it
// feels instant. Today gets a dot indicator; the selected chip is filled.
// ‹ › move one day at a time; «اليوم» jumps back.
// ═══════════════════════════════════════════════════════════════════════════

const AR_WD = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']
const EN_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function todayLocalISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function DayTimeline({ value, onChange, isArabic }) {
  const days = useMemo(() => {
    const center = value
    return [-3, -2, -1, 0, 1, 2, 3].map((n) => addDaysISO(center, n))
  }, [value])

  const today = todayLocalISO()
  const todayNum = new Date().getDate()

  const dayNum = (iso) => Number(iso.slice(8, 10))

  return (
    <div className="nk-dayline" role="group" aria-label={isArabic ? 'اختيار اليوم' : 'Day selection'}>
      <button
        type="button"
        className="nk-dayline__nav"
        onClick={() => onChange(addDaysISO(value, -1))}
        aria-label={isArabic ? 'اليوم السابق' : 'Previous day'}
      >
        ‹
      </button>

      <div className="nk-dayline__strip" role="listbox" aria-label={isArabic ? 'أيام الأسبوع' : 'Days'}>
        {days.map((iso) => {
          const selected = iso === value
          const isT = iso === today
          const wd = (isArabic ? AR_WD : EN_WD)[new Date(`${iso}T00:00:00`).getDay()]
          return (
            <button
              key={iso}
              type="button"
              role="option"
              aria-selected={selected}
              className={`nk-dayline__day ${selected ? 'nk-dayline__day--sel' : ''} ${isT ? 'nk-dayline__day--today' : ''}`}
              onClick={() => onChange(iso)}
            >
              <small>{isT ? (isArabic ? 'اليوم' : 'Today') : wd}</small>
              <b>{isT ? todayNum : dayNum(iso)}</b>
            </button>
          )
        })}
      </div>

      <button
        type="button"
        className="nk-dayline__nav"
        onClick={() => onChange(addDaysISO(value, 1))}
        aria-label={isArabic ? 'اليوم التالي' : 'Next day'}
      >
        ›
      </button>

      {value !== today && (
        <button
          type="button"
          className="nk-dayline__today-btn"
          onClick={() => onChange(today)}
        >
          {isArabic ? 'اليوم ↺' : 'Today ↺'}
        </button>
      )}
    </div>
  )
}
