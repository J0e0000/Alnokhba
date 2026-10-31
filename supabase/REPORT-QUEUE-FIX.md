# Reports Queue Fix

## Root cause

The reports queue existed only in React memory. During WhatsApp handoff, some browsers could treat the navigation as a page navigation or refresh the SPA. Once the dashboard was unloaded, the queue and its current position disappeared. The queue action buttons were also missing explicit `type="button"` attributes, which made them vulnerable to implicit form submission if rendered inside a form on a browser or future layout.

## Changes applied

- Queue state is now persisted in `sessionStorage` using a teacher-scoped key: `nokhba_message_queue_<teacher-id>`.
- A successful send now advances immediately after the WhatsApp popup is opened; it no longer waits for a focus-sensitive delay that could make the first click appear to do nothing.
- Send has a synchronous duplicate-click guard, while failed popup opens reset the guard so **إعادة المحاولة** works normally.
- Queue builders skip blank or malformed Egyptian phone numbers and show a count instead of creating queue items that can never send.
- The queue is restored automatically when the dashboard reloads in the same browser tab.
- Every queue start path uses the persistent updater: selected students, daily reports, bulk messages, and QR portal links.
- Advancing a message stores the next index. Completing or stopping the queue clears the saved queue.
- Send, Skip, Stop, and the shared modal close button now explicitly use `type="button"`.
- WhatsApp report handoff now opens or navigates only the named `nokhba_whatsapp` popup. It never assigns the dashboard location.
- Batch boundaries still pause after each 100 valid queue items; the pause timer is cleaned up if the modal is stopped or closed.

The queue intentionally remains manual: the teacher presses **Send WhatsApp**, confirms or sends the pre-filled message in WhatsApp, then the queue advances. WhatsApp does not provide a safe browser-side confirmation that a message was actually delivered.

## Windows verification

From Command Prompt inside the extracted `frontend` folder:

```bat
npm install
npm run build
npm run dev -- --host 127.0.0.1 --port 4173
```

Open `http://localhost:4173/`, sign in, open Reports, and start a small queue. Press **Send WhatsApp** once and confirm that the queue immediately moves to the next student while WhatsApp uses its separate named window. Confirm that a second rapid click is ignored rather than sending the same item twice. Refresh the dashboard tab while the queue is open; the same queue position should return. Test **Skip**, **Stop**, and a blocked-popup **إعادة المحاولة**. Press **Stop** to intentionally clear it.

If the browser blocks the WhatsApp window, allow popups for the site and press **إعادة المحاولة**. This is a browser permission issue, not a dashboard reload.

## Build result

`npm run build` completed successfully after the fix. Existing Vite warnings about bundle size and ineffective dynamic imports remain warnings only; they do not block deployment.

## Deployment

After replacing the project files, run:

```bat
npx vercel --prod
```

Do not run new Supabase migrations for this queue fix.
