import { useMemo } from 'react'
import { addDaysISO, todayLocalISO, weekdayName } from '../lib/dateUtils'

// ═══════════════════════════════════════════════════════════════════════════
// DAY TIMELINE (brief §2) — compact horizontal day strip near the top of the
// teacher experience. Selecting a day drives which sessions Home displays.
// Pure UI: switching days costs ZERO network requests (sessions already live
// in the store), so it feels instant. Today gets a dot indicator; the selected
// chip is filled. ‹ › move one day at a time; «اليوم» jumps back.
// ═══════════════════════════════════════════════════════════════════════════
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
          const wd = weekdayName(new Date(iso + 'T00:00:00').getDay(), isArabic, true)
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
