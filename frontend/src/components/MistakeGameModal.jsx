import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { shuffledDeck } from '../lib/mistakeGameData'

const START_MS = 7000
const MIN_MS = 3000
const STEP_MS = 250
const MAX_LIVES = 3
const MAX_GAME_MS = 10 * 60 * 1000

export default function MistakeGameModal({ open, onClose, students, preselectedStudentId, onAwardPoints }) {
  const [phase, setPhase] = useState('pick') // pick | confirm | playing | done
  const [studentId, setStudentId] = useState(preselectedStudentId || '')
  const [deck, setDeck] = useState([])
  const [deckIndex, setDeckIndex] = useState(0)
  const [round, setRound] = useState(null)
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(MAX_LIVES)
  const [roundMs, setRoundMs] = useState(START_MS)
  const [timeLeft, setTimeLeft] = useState(START_MS)
  const [feedback, setFeedback] = useState(null) // { correct: bool, text }
  const tickRef = useRef(null)
  const gameStartRef = useRef(0)

  useEffect(() => {
    if (open) { setStudentId(preselectedStudentId || ''); setPhase(preselectedStudentId ? 'confirm' : 'pick') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselectedStudentId])

  const nextRound = (deckArg, idxArg, msArg) => {
    let idx = idxArg
    let d = deckArg
    if (idx >= d.length) { d = shuffledDeck(); idx = 0; setDeck(d) }
    setDeckIndex(idx + 1)
    setRound(d[idx])
    setTimeLeft(msArg)
    setFeedback(null)
  }

  const startGame = () => {
    const d = shuffledDeck()
    setDeck(d)
    setScore(0)
    setLives(MAX_LIVES)
    setRoundMs(START_MS)
    gameStartRef.current = Date.now()
    setPhase('playing')
    nextRound(d, 0, START_MS)
  }

  // عداد الوقت
  useEffect(() => {
    if (phase !== 'playing' || feedback) return
    tickRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 100) {
          clearInterval(tickRef.current)
          handleMiss('انتهى الوقت!')
          return 0
        }
        return t - 100
      })
    }, 100)
    return () => clearInterval(tickRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round, feedback])

  const endGame = () => { clearInterval(tickRef.current); setPhase('done') }

  const handleMiss = (msg) => {
    clearInterval(tickRef.current)
    setFeedback({ correct: false, text: msg })
    setLives((l) => {
      const next = l - 1
      setTimeout(() => {
        if (next <= 0) endGame()
        else if (Date.now() - gameStartRef.current >= MAX_GAME_MS) endGame()
        else nextRound(deck, deckIndex, roundMs)
      }, 1100)
      return next
    })
  }

  const handleTap = (index) => {
    if (!round || feedback) return
    clearInterval(tickRef.current)
    if (index === round.wrongIndex) {
      setScore((s) => s + 1)
      setFeedback({ correct: true, text: `✅ صح! الصواب: ${round.correctWord}` })
      const nextMs = Math.max(MIN_MS, roundMs - STEP_MS)
      setRoundMs(nextMs)
      setTimeout(() => {
        if (Date.now() - gameStartRef.current >= MAX_GAME_MS) endGame()
        else nextRound(deck, deckIndex, nextMs)
      }, 900)
    } else {
      handleMiss(`❌ غلط! الكلمة الغلط كانت: ${round.words[round.wrongIndex]}`)
    }
  }

  const selectedStudent = students.find((s) => s.id === studentId)
  const pointsToAward = Math.min(score, 20)

  const handleAward = () => {
    if (selectedStudent) onAwardPoints(selectedStudent.id, pointsToAward)
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="🎮 امسك الغلط" wide>
      {phase === 'pick' && (
        <div className="space-y-3">
          <p className="text-fg-subtle text-sm">اختار الطالب اللي هيلعب:</p>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)}
            className="w-full glass-input border border-subtle rounded-lg px-3 py-2 text-sm outline-none focus:border-brand-gold">
            <option value="">اختار طالب</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button disabled={!studentId} onClick={() => setPhase('confirm')}
            className="w-full bg-brand-navy disabled:glass-input disabled:text-fg-subtle text-white font-bold py-2.5 rounded-lg text-sm">
            التالي
          </button>
        </div>
      )}

      {phase === 'confirm' && (
        <div className="space-y-4 text-center py-4">
          <p className="text-fg font-bold">هيلعب: {selectedStudent?.name}</p>
          <div className="glass-input rounded-lg p-4 text-sm text-fg-subtle text-right leading-relaxed">
            هتظهر جملة فيها كلمة غلط — دوس عليها قبل ما العداد يخلص. كل إجابة صح بتسرّع اللعبة شوية. عندك {MAX_LIVES} محاولات غلط بس.
          </div>
          <button onClick={startGame} className="w-full bg-emerald-600 hover:bg-emerald-500 text-fg font-bold py-3 rounded-lg text-sm">
            ابدأ اللعبة 🚀
          </button>
        </div>
      )}

      {phase === 'playing' && round && (
        <div className="space-y-5">
          <div className="flex justify-between items-center text-sm">
            <span className="text-brand-gold-hover font-bold">⭐ {score}</span>
            <span className="text-rose-400 font-bold">{'❤️'.repeat(lives)}{'🖤'.repeat(MAX_LIVES - lives)}</span>
          </div>

          <div className="h-2 glass-input rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-100 ${timeLeft < roundMs * 0.3 ? 'bg-rose-500' : 'bg-blue-500'}`}
              style={{ width: `${(timeLeft / roundMs) * 100}%` }}
            />
          </div>

          <div className="flex flex-wrap justify-center gap-2 py-6" dir="rtl">
            {round.words.map((w, i) => (
              <button
                key={i} onClick={() => handleTap(i)} disabled={!!feedback}
                className="glass-input hover:bg-white/10 border border-subtle rounded-lg px-4 py-2 text-lg font-bold text-fg disabled:opacity-70"
              >
                {w}
              </button>
            ))}
          </div>

          {feedback && (
            <p className={`text-center font-bold text-sm ${feedback.correct ? 'text-emerald-400' : 'text-rose-400'}`}>
              {feedback.text}
            </p>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className="text-center py-6 space-y-4">
          <p className="text-2xl font-black text-brand-gold-hover">النتيجة النهائية: {score} ✅</p>
          <p className="text-fg-subtle text-sm">هيتضاف {pointsToAward} نقطة لـ {selectedStudent?.name}</p>
          <div className="flex gap-2">
            <button onClick={handleAward} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-fg font-bold py-2.5 rounded-lg text-sm">
              أضف النقاط وإغلاق
            </button>
            <button onClick={onClose} className="flex-1 glass-input hover:bg-white/10 text-fg-subtle font-bold py-2.5 rounded-lg text-sm">
              إغلاق من غير نقاط
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
