import { useEffect, useState } from 'react'
import Modal from './Modal'
import MistakeGameModal from './MistakeGameModal'

const GAMES = [
  { key: 'catch_mistake', title: 'امسك الغلط', emoji: '🎯', desc: 'جملة فيها كلمة غلط — دوسها قبل ما الوقت يخلص. السرعة بتزيد كل ما تصح.' },
  // ألعاب جديدة تتضاف هنا في نفس المكان مستقبلًا
]

export default function GamesHubModal({ open, onClose, students, isGamesUnlocked, onAwardPoints, initialGame, initialStudentId }) {
  const [activeGame, setActiveGame] = useState(null)
  const [gameStudentId, setGameStudentId] = useState(null)

  useEffect(() => {
    if (open && initialGame && isGamesUnlocked) { setActiveGame(initialGame); setGameStudentId(initialStudentId || null) }
  }, [open, initialGame, initialStudentId, isGamesUnlocked])

  const openGame = (key) => { setActiveGame(key); setGameStudentId(null) }
  const closeGame = () => { setActiveGame(null); if (initialGame && isGamesUnlocked) onClose() }

  const showCatalog = !initialGame || !isGamesUnlocked

  return (
    <>
      {showCatalog && (
        <Modal open={open} onClose={onClose} title="🎮 ساحة الألعاب" wide>
          {!isGamesUnlocked ? (
            <div className="text-center py-8 space-y-3">
              <div className="text-4xl">🔒</div>
              <p className="text-fg font-bold">ساحة الألعاب ميزة إضافية منفصلة</p>
              <p className="text-fg-subtle text-sm max-w-sm mx-auto">
                مش جزء من الاشتراك الأساسي — تواصل معانا لتفعيلها على حسابك.
              </p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {GAMES.map((g) => (
                <button
                  key={g.key} onClick={() => openGame(g.key)}
                  className="text-right glass-input hover:bg-white/10 border border-subtle hover:border-brand-gold/40 rounded-xl p-4 transition-all"
                >
                  <div className="text-3xl mb-2">{g.emoji}</div>
                  <p className="font-bold text-fg">{g.title}</p>
                  <p className="text-fg-subtle text-xs mt-1">{g.desc}</p>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}

      <MistakeGameModal
        open={activeGame === 'catch_mistake'}
        onClose={closeGame}
        students={students}
        preselectedStudentId={gameStudentId}
        onAwardPoints={onAwardPoints}
      />
    </>
  )
}
