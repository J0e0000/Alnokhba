import { useEffect, useState } from 'react'
import Modal from '../Modal'
import { useToast } from '../../context/ToastContext'
import { useLanguage } from '../../context/LanguageContext'
import { listVersions, createVersion, getVersionItems } from '../../lib/qbStore'
import { L, humanizeError } from '../../lib/qbLabels'

export default function ExamVersionsModal({ open, onClose, supabase, examId, onPreviewVersion }) {
  const { showToast } = useToast()
  const { isArabic } = useLanguage()
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newLabel, setNewLabel] = useState('A')
  const [shuffleQ, setShuffleQ] = useState(true)
  const [shuffleC, setShuffleC] = useState(false)

  const load = async () => {
    if (!examId) return
    setLoading(true)
    try {
      const data = await listVersions(supabase, examId)
      setVersions(data)
      const usedLabels = new Set(data.map((v) => v.version_label))
      const next = ['A', 'B', 'C', 'D', 'E'].find((l) => !usedLabels.has(l)) || 'F'
      setNewLabel(next)
    } catch (err) {
      showToast(humanizeError(err, isArabic), 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (open && examId) load() }, [open, examId])

  const handleCreate = async () => {
    if (!newLabel.trim()) return
    setCreating(true)
    try {
      await createVersion(supabase, examId, newLabel.trim().toUpperCase(), {
        shuffle_questions: shuffleQ,
        shuffle_choices: shuffleC,
      })
      showToast(`${L('version_created', isArabic)} ${newLabel}`, 'success')
      load()
    } catch (err) {
      showToast(humanizeError(err, isArabic), 'error')
    } finally {
      setCreating(false)
    }
  }

  const handlePreview = async (ver) => {
    try {
      const items = await getVersionItems(supabase, ver.id)
      onPreviewVersion?.({ ...ver, items })
    } catch (err) {
      showToast(humanizeError(err, isArabic), 'error')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`🔤 ${L('exam_versions', isArabic)}`} wide>
      <div className='space-y-3'>
        {/* Create new version */}
        <div className='glass-input border border-subtle rounded-lg p-3 space-y-2'>
          <p className='text-xs font-bold text-fg-subtle'>{L('create_new_version', isArabic)}</p>
          <div className='flex items-center gap-2 flex-wrap'>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value.toUpperCase())} maxLength={3} dir='ltr'
              className='w-16 text-center glass-input border border-subtle rounded-lg px-2 py-1.5 text-sm font-bold outline-none focus:border-brand-gold' />
            <label className='flex items-center gap-1 text-xs text-fg-muted cursor-pointer'>
              <input type='checkbox' checked={shuffleQ} onChange={(e) => setShuffleQ(e.target.checked)}
                className='w-4 h-4 accent-amber-500' />
              {L('shuffle_questions', isArabic)}
            </label>
            <label className='flex items-center gap-1 text-xs text-fg-muted cursor-pointer'>
              <input type='checkbox' checked={shuffleC} onChange={(e) => setShuffleC(e.target.checked)}
                className='w-4 h-4 accent-amber-500' />
              {L('shuffle_choices', isArabic)}
            </label>
            <button onClick={handleCreate} disabled={creating}
              className='ml-auto text-xs btn-glow font-bold px-3 py-1.5 rounded-lg disabled:opacity-40'>
              {creating ? '⏳' : '+'} {L('create_btn', isArabic)}
            </button>
          </div>
          <p className='text-[10px] text-fg-subtle'>{L('version_preserved_note', isArabic)}</p>
        </div>

        {/* List */}
        {loading ? (
          <p className='text-center text-fg-subtle text-sm py-4'>⏳</p>
        ) : versions.length === 0 ? (
          <div className='text-center py-8'>
            <div className='text-3xl mb-2'>🔤</div>
            <p className='text-fg-subtle text-sm'>{L('no_versions_yet', isArabic)}</p>
          </div>
        ) : (
          <div className='space-y-2'>
            {versions.map((v) => (
              <div key={v.id} className='glass-input border border-subtle rounded-lg p-3 flex items-center gap-3'>
                <div className='w-12 h-12 rounded-full bg-brand-gold/15 text-brand-gold-hover border-2 border-brand-gold/40 flex items-center justify-center text-xl font-black'>
                  {v.version_label}
                </div>
                <div className='flex-1 min-w-0'>
                  <p className='text-sm font-bold text-fg'>{L('version_label', isArabic)} {v.version_label}</p>
                  <p className='text-[11px] text-fg-subtle'>
                    {new Date(v.created_at).toLocaleString(isArabic ? 'ar-EG' : 'en')}
                    {v.shuffle_questions && ` · ${L('shuffle_questions', isArabic)}`}
                    {v.shuffle_choices && ` · ${L('shuffle_choices', isArabic)}`}
                  </p>
                </div>
                <button onClick={() => handlePreview(v)}
                  className='text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-3 py-1.5 rounded-lg font-bold hover:bg-emerald-500/20'>
                  👁️ PDF
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
