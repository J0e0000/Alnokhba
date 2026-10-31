import html2canvas from 'html2canvas-pro'

/**
 * captureElementSafely — html2canvas hardened for iOS / WebKit.
 * ----------------------------------------------------------------------------
 * WHY THIS EXISTS (Round 10 — iPhone stability):
 *  1. Retina memory ceiling — WebKit caps total canvas memory on iPhones
 *     (A-series devices). Rendering a full-width card at 3x devicePixelRatio
 *     allocates >16M-pixel canvases and Safari silently returns a blank
 *     canvas or kills the tab. Android Chrome tolerates the same allocation,
 *     which is why exports "only break on iPhone".
 *     → scale is capped at 2x here, always.
 *  2. Tainted canvases — cross-origin images without CORS headers make
 *     canvas.toDataURL() throw SecurityError on WebKit.
 *     → useCORS: true + allowTaint: false so bad images are skipped instead
 *       of poisoning the whole export.
 *  3. backdrop-filter — html2canvas cannot paint it, and cloned documents
 *     full of backdrop-filter force WebKit into an expensive style pass that
 *     can freeze Mobile Safari.
 *     → a <style> override is injected into the cloned document to strip
 *       backdrop-filter / -webkit-backdrop-filter before rasterizing.
 *  4. Never crash the caller — on failure this returns null (and logs to the
 *     console) instead of throwing, so a failed image export can never blank
 *     a page or break a WhatsApp send flow.
 *
 * Callers MUST handle the null return (skip the image / fall back to text).
 */
export async function captureElementSafely(element, options = {}) {
  if (!element) return null
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1
  // Requested scale (callers may pass their own), but never above 2x and
  // never above what the screen can actually use.
  const requested = options.scale != null ? Number(options.scale) : 2
  const scale = Math.min(2, Math.max(1, Math.min(requested || 2, Math.max(dpr, 1))))

  const config = {
    useCORS: true,
    allowTaint: false,
    logging: false,
    imageTimeout: options.imageTimeout != null ? options.imageTimeout : 15000,
    backgroundColor: options.backgroundColor,
    width: options.width,
    height: options.height,
    windowWidth: options.windowWidth,
    windowHeight: options.windowHeight,
    scale,
    // Hint for WebKit to keep the 2D context CPU-readable (avoids GPU
    // readback stalls when html2canvas calls getImageData). Unknown options
    // are ignored by older html2canvas builds — safe to pass.
    willReadFrequently: true,
    onclone: (clonedDoc) => {
      try {
        // Strip backdrop-filter from the CLONE only (the live DOM keeps it).
        const style = clonedDoc.createElement('style')
        style.textContent = '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}'
        clonedDoc.documentElement.appendChild(style)
      } catch (err) { /* cosmetic only — never fail the export for this */ }
      if (typeof options.onclone === 'function') {
        try { options.onclone(clonedDoc) } catch (err) { /* caller hook is best-effort */ }
      }
    },
  }

  try {
    return await html2canvas(element, config)
  } catch (err) {
    // WebKit canvas export failure (SecurityError / canvas memory / etc).
    // Degrade gracefully — the caller decides what a missing image means.
    console.error('[WebKit Canvas Export Failed]:', err)
    return null
  }
}

export default captureElementSafely
