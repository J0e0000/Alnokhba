import Modal from './Modal'
import { getStudentRank } from '../lib/helpers'

export default function LeaderboardModal({ open, onClose, students, ranks }) {
  const sorted = [...students].sort((a, b) => b.points - a.points).slice(0, 10)
  const medals = ['🥇', '🥈', '🥉']

  return (
    <Modal open={open} onClose={onClose} title="لوحة المتصدرين 🏆">
      {sorted.length === 0 || sorted[0].points === 0 ? (
        <p className="text-center text-fg-subtle py-4 text-sm">لا توجد نقاط مسجلة.</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((s, i) => (
            <div
              key={s.id}
              className={`flex justify-between items-center p-3 rounded-lg border ${
                i === 0 ? 'bg-amber-500/20 border-brand-gold/40' : 'glass-input border-subtle'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{medals[i] || '🏅'}</span>
                <div>
                  <p className="font-bold text-fg text-sm">{s.name}</p>
                  <p className="text-xs text-brand-gold-hover font-bold">🛡️ {getStudentRank(s.points, ranks)}</p>
                </div>
              </div>
              <div className="text-lg font-black text-brand-gold-hover">{s.points} pt</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
