# Notification audit result

The live Supabase project is `pbsythpzncjoafpmijyd`.

## Verified live state

- The correct table is `public.push_subscriptions`; there is no `public.parent_push_subscriptions` table.
- `public.push_subscriptions` has 9 rows and includes `student_id`, `teacher_id`, `endpoint`, `p256dh`, and `auth`.
- `public.push_notification_jobs` has 15 rows. Recent attendance and exam jobs have `processed_at` timestamps, so the queue trigger and Edge Function are running.
- `send-push-notification` is ACTIVE at version 12.
- The live migrations `teacher_push_bridge_031`, `parent_push_subscriptions_032`, and `push_job_http_trigger_033` are already applied.
- The push subscription RLS policy is `push_subscriptions_owner`; the student registration path uses the existing `register_student_push_subscription` RPC.

## Code fix in this delivery

- The parent activation path no longer silently returns when the QR token is not ready.
- The notification button is explicitly a button and reports the missing-token state.
- The browser permission state `denied` is handled explicitly.
- The parent flow registers `/sw.js?v=5` on demand if no root service worker registration exists, then waits for readiness.
- The frontend uses `push_subscriptions`, matching the live schema.

## Remaining real-device requirement

The database and backend cannot create a browser permission prompt remotely. The parent device must open the deployed HTTPS Student Portal and click the activation button. If the browser permission for the domain is already denied, the user must reset it in the browser site settings before the prompt can appear again.
