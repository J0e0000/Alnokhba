// dismissible={false} — used by destructive-workflow modals (the WhatsApp
// send queue): a stray tap on the dark backdrop right after returning from
// WhatsApp must NOT silently kill the batch. Closing then happens ONLY
// through the explicit buttons (✕ / إيقاف) that call onClose.
export default function Modal({ open, onClose, title, children, wide, dismissible = true }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={dismissible ? onClose : undefined} role="dialog" aria-modal="true">
      <div
        className={`glass-card rounded-2xl shadow-2xl w-full ${wide ? 'max-w-4xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto overflow-x-hidden min-w-0`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-subtle sticky top-0 bg-[var(--surface)] backdrop-blur-xl z-10">
          <h3 className="font-black text-lg text-fg">{title}</h3>
          <button type="button" onClick={onClose} className="text-fg-subtle hover:text-fg text-xl leading-none">✕</button>
        </div>
        <div className="p-5 min-w-0 overflow-x-hidden">{children}</div>
      </div>
    </div>
  )
}
