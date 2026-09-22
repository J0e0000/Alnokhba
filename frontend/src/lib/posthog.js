// ═══════════════════════════════════════════════════════════════════════════
// POSTHOG PRODUCT ANALYTICS (owner request — "link the webapp with posthog")
//
// Wired manually instead of via `@posthog/wizard` because the wizard is an
// interactive CLI that needs a browser login to posthog.com. This module is
// the single integration point: env-driven, lazy-loaded (see main.jsx — it
// loads AFTER first paint so the boot path is never delayed) and a clean
// no-op when VITE_POSTHOG_KEY is absent, so deploys without the key are
// completely unaffected.
//
// Privacy-first defaults for a school product (student names are PII):
//   • autocapture stays on for interaction stats, but `$el_text` is stripped
//     from every autocapture event — element text often contains names.
//   • session recording is disabled client-side; if it is ever enabled
//     server-side, all inputs are masked.
//   • exceptions are captured — production crashes become debuggable.
// ═══════════════════════════════════════════════════════════════════════════
import posthog from 'posthog-js'

let ready = false

export function initPostHog() {
  const key = import.meta.env.VITE_POSTHOG_KEY
  const host = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'
  if (!key || ready) return
  ready = true
  try {
    posthog.init(key, {
      api_host: host,
      // SPA mode: posthog-js hooks history pushState/replaceState/popstate
      // so every in-app area change is a pageview without extra wiring.
      capture_pageview: 'history_change',
      autocapture: true,
      capture_exceptions: true,
      disable_session_recording: true,
      session_recording: { maskAllInputs: true },
      sanitize_properties: (props, event) => {
        if (String(event).startsWith('$autocapture')) delete props.$el_text
        return props
      },
    })
    track('app_opened')
  } catch { /* analytics must never break the app */ }
}

/** Fire-and-forget named event — safe to call before init resolves. */
export function track(name, props) {
  if (!ready) return
  try { posthog.capture(name, props) } catch { /* never throw */ }
}
