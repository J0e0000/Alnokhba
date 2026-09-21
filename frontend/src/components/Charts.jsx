import { useEffect, useRef } from 'react'
import Chart from 'chart.js/auto'

Chart.defaults.color = '#94A3B8'
Chart.defaults.font.family = "'Cairo', sans-serif"
Chart.defaults.animation = { duration: 700, easing: 'easeOutQuart' }
Chart.defaults.plugins.tooltip = {
  backgroundColor: '#142D62',
  titleColor: '#D4A373',
  bodyColor: '#ffffff',
  padding: 10,
  cornerRadius: 8,
  displayColors: false,
  titleFont: { family: "'Cairo', sans-serif", weight: 'bold' },
  bodyFont: { family: "'Cairo', sans-serif" },
}

const GRID = { color: 'rgba(255,255,255,0.08)', drawBorder: false }

export default function Charts({ present, absent, unrecorded, examDatesMap, variant = 'both' }) {
  const attCanvasRef = useRef(null)
  const scoreCanvasRef = useRef(null)
  const attChartRef = useRef(null)
  const scoreChartRef = useRef(null)
  const showAtt = variant === 'both' || variant === 'attendance'
  const showScores = variant === 'both' || variant === 'scores'
  const hasAttData = present + absent + unrecorded > 0
  const hasScoreData = Object.keys(examDatesMap).length > 0

  useEffect(() => {
    if (!showAtt || !hasAttData || !attCanvasRef.current) return
    if (attChartRef.current) attChartRef.current.destroy()
    attChartRef.current = new Chart(attCanvasRef.current, {
      type: 'doughnut',
      data: {
        labels: ['حاضر', 'غائب', 'لم يرصد'],
        datasets: [{ data: [present, absent, unrecorded], backgroundColor: ['#22C55E', '#EF4444', 'rgba(255,255,255,0.12)'], borderWidth: 0, borderRadius: 4 }],
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, padding: 12 } } } },
    })
    return () => attChartRef.current?.destroy()
  }, [present, absent, unrecorded, showAtt])

  useEffect(() => {
    if (!showScores || !hasScoreData || !scoreCanvasRef.current) return
    const dates = Object.keys(examDatesMap).sort()
    const avgs = dates.map((d) => Math.round((examDatesMap[d].earned / Math.max(1, examDatesMap[d].max)) * 100))
    if (scoreChartRef.current) scoreChartRef.current.destroy()
    scoreChartRef.current = new Chart(scoreCanvasRef.current, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{
          label: 'متوسط %', data: avgs, borderColor: '#D4A373', backgroundColor: 'rgba(212,163,115,0.12)',
          tension: 0.4, fill: true, pointBackgroundColor: '#D4A373', pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { min: 0, max: 100, grid: GRID }, x: { grid: { display: false } } },
        plugins: { legend: { display: false } },
      },
    })
    return () => scoreChartRef.current?.destroy()
  }, [examDatesMap, showScores])

  return (
    <div className={`grid gap-4 ${variant === 'both' ? 'sm:grid-cols-2' : ''}`}>
      {showAtt && (
        <div className="glass-card rounded-xl p-3 h-52 shadow-lg shadow-black/20">
          {hasAttData ? <canvas ref={attCanvasRef} /> : <EmptyChart text="لسه مفيش بيانات حضور" />}
        </div>
      )}
      {showScores && (
        <div className="glass-card rounded-xl p-3 h-52 shadow-lg shadow-black/20">
          {hasScoreData ? <canvas ref={scoreCanvasRef} /> : <EmptyChart text="لسه مفيش امتحانات مرصودة" />}
        </div>
      )}
    </div>
  )
}

export function EmptyChart({ text }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-fg-subtle">
      <span className="text-2xl">📊</span>
      <p className="text-xs">{text}</p>
    </div>
  )
}
