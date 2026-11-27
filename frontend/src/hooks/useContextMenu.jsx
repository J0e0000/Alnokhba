import Icon, { hasIcon } from '../components/icons'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// useContextMenu — قائمة سياقية واحدة لأي عنصر (Task 65).
// PC: right-click (onContextMenu). موبايل: ضغط مطوّل 520ms — الشاشة الشفافة
// بتلتقط الـ tap اللي بعد فتح القائمة، فـ onClick بتاع العنصر نفسه ما بيشتغلش
// بعد الضغط المطوّل. القائمة بتنقلب عشان تفضل جوه الشاشة، وبتتقفل عند الاختيار
// أو Escape أو scroll أو resize.
// usage:
//   const { triggerProps, contextMenu } = useContextMenu()
//   <div {...triggerProps(() => items, 'header')}>...</div>
//   ...{contextMenu}
// items: [{ icon, label, sub, danger, disabled, onClick }] أو 'sep' كفاصل.
// ═══════════════════════════════════════════════════════════════════════════
export default function useContextMenu() {
  const [menu, setMenu] = useState(null)
  const timerRef = useRef(null)

  const close = useCallback(() => setMenu(null), [])
  const openAt = useCallback((x, y, items, header) => {
    if (!Array.isArray(items) || !items.length) return
    setMenu({ x, y, items, header })
  }, [])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const triggerProps = useCallback((getItems, header) => ({
    onContextMenu: (e) => {
      e.preventDefault()
      e.stopPropagation()
      openAt(e.clientX, e.clientY, typeof getItems === 'function' ? getItems() : [], header)
    },
    onTouchStart: (e) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      const x = t.clientX
      const y = t.clientY
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        try { navigator.vibrate?.(25) } catch { /* vibration unsupported */ }
        openAt(x, y, typeof getItems === 'function' ? getItems() : [], header)
      }, 520)
    },
    onTouchMove: () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } },
    onTouchEnd: () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } },
    onTouchCancel: () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } },
  }), [openAt])

  // القائمة مفتوحة؟ أي scroll/resize/Escape تقفلها — الموضع بيبقى صحيح دايمًا.
  useEffect(() => {
    if (!menu) return undefined
    const onKey = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu, close])

  const contextMenu = menu ? <ContextMenuSheet menu={menu} onClose={close} /> : null
  return { triggerProps, contextMenu }
}

function ContextMenuSheet({ menu, onClose }) {
  const ref = useRef(null)
  // مرتين مرسومة: الأولى مخفية لقياس الحجم، والتانية بالموضع المقلوب الصحيح —
  // فلا وميض خارج حدود الشاشة ولا قفزة واضحة.
  const [pos, setPos] = useState({ left: menu.x, top: menu.y, ready: false })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const pad = 8
    const left = Math.max(pad, Math.min(menu.x, window.innerWidth - rect.width - pad))
    const top = Math.max(pad, Math.min(menu.y, window.innerHeight - rect.height - pad))
    setPos({ left, top, ready: true })
  }, [menu])
  return (
    <>
      <div
        className="fixed inset-0 z-[92] bg-transparent"
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose() }}
        aria-hidden="true"
      />
      <div
        ref={ref}
        role="menu"
        className="nk-ctxmenu"
        style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
      >
        {menu.header && <div className="nk-ctxmenu__title">{menu.header}</div>}
        {menu.items.map((it, i) => (
          it === 'sep' ? <div key={`sep-${i}`} className="nk-ctxmenu__sep" role="separator" /> : (
            <button
              key={`${it.label}-${i}`}
              role="menuitem"
              disabled={it.disabled}
              className={it.danger ? 'nk-ctxmenu-danger' : ''}
              onClick={(e) => { e.stopPropagation(); onClose(); it.onClick?.() }}
            >
              <span className="nk-ctxmenu__icon" aria-hidden="true">{hasIcon(it.icon) ? <Icon name={it.icon} size={16} /> : (it.icon || '•')}</span>
              <span className="min-w-0">
                {it.label}
                {it.sub && <small className="block font-semibold text-fg-muted">{it.sub}</small>}
              </span>
            </button>
          )
        ))}
      </div>
    </>
  )
}
