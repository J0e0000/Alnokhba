import { useEffect } from 'react'

// ═══════════════════════════════════════════════════════════════════════════
// WORKFLOW BAR — the persistent bottom action area of the Session Workspace.
// UX contract (restructure round):
// - ONE primary action per state, always visible without scrolling (sticky).
// - Secondary/meta actions look secondary (ghost buttons + muted meta).
// - Never contains account/navigation actions (no logout, no area switching).
// - Content is fully contextual — the caller decides what the current state
//   needs (mark → next → review), the bar only renders it consistently.
// - The bar is rendered at the WORKSPACE ROOT (SessionWorkspace), because a
//   sticky element can never rise above the top edge of its containing
//   block; tabs publish serializable specs via usePublishBar below.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Publish a bar spec to the workspace root. Republishes ONLY when the
 * serializable data actually changes (prevents re-render loops), and clears
 * the bar on unmount so a stale action never survives a tab switch.
 * @param {Function|null} onBar   publisher from SessionWorkspace
 * @param {object|null} data      { ariaLabel, primary:[{key,label,disabled,kind}], secondary:[...], meta }
 * @param {object} handlers       { key: fn }
 */
export function usePublishBar(onBar, data, handlers) {
  const json = JSON.stringify(data || null)
  useEffect(() => {
    if (!onBar) return
    if (json === 'null') { onBar(null); return undefined }
    onBar({ data: JSON.parse(json), handlers })
    return () => onBar(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, onBar])
}

/**
 * @param {Array<{key, label, onClick, disabled?, kind?}>} primary
 *   kind: 'present' | 'absent' | undefined (default navy/gold via className)
 * @param {Array<{key, label, onClick, disabled?, title?}>} secondary
 * @param {ReactNode} meta  progress / save-state text node
 * @param {string} ariaLabel
 */
export default function WorkflowBar({ primary = [], secondary = [], meta = null, ariaLabel }) {
  if (!primary.length && !secondary.length && !meta) return null
  return (
    <div className="nk-workflow-bar" role="group" aria-label={ariaLabel}>
      {primary.length > 0 && (
        <div className="nk-workflow-bar__primary">
          {primary.map((b) => (
            <button
              key={b.key}
              type="button"
              disabled={b.disabled}
              onClick={b.onClick}
              className={
                b.kind === 'present' ? 'nk-mark-present'
                : b.kind === 'absent' ? 'nk-mark-absent'
                : b.kind === 'gold' ? 'btn-gold'
                : b.kind === 'ok' ? ''
                : b.kind === 'ghost' ? 'btn-ghost'
                : 'btn-navy'
              }
              style={b.kind === 'ok' ? { background: 'var(--ok)', color: '#fff' } : undefined}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      {(secondary.length > 0 || meta) && (
        <div className="nk-workflow-bar__row">
          {secondary.map((b) => (
            <button
              key={b.key}
              type="button"
              className="nk-wf-ghost"
              disabled={b.disabled}
              onClick={b.onClick}
              title={b.title}
            >
              {b.label}
            </button>
          ))}
          {meta && <span className="nk-workflow-bar__meta ms-auto">{meta}</span>}
        </div>
      )}
    </div>
  )
}
