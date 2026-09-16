import Modal from './Modal'

export default function ConfirmDialog({ open, title, message, danger, confirmLabel, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <Modal open={open} onClose={onCancel} title={title || 'تأكيد'}>
      <p className="text-fg-muted text-sm leading-relaxed mb-5">{message}</p>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 glass-input hover:bg-white/10 border border-subtle text-fg-muted font-bold py-2.5 rounded-lg text-sm">
          إلغاء
        </button>
        <button
          onClick={onConfirm}
          className={`flex-1 font-bold py-2.5 rounded-lg text-sm text-fg ${danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-brand-navy hover:bg-brand-navy-light'}`}
        >
          {confirmLabel || 'تأكيد'}
        </button>
      </div>
    </Modal>
  )
}
