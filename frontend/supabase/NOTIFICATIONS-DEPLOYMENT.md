# NOKHBA Web Push notifications

The frontend now registers browser subscriptions using the project public VAPID key, waits safely for the service worker, and stores teacher or student subscriptions in the existing `push_subscriptions` table. The service worker cache version was incremented so deployed browsers load the current worker.

The active Supabase project already contains migrations `teacher_push_bridge_031`, `parent_push_subscriptions_032`, and `push_job_http_trigger_033`. Do not create a new database or duplicate notification tables.

## Required Supabase Edge Function secrets

In the active Supabase project, open Edge Functions → `send-push-notification` → Secrets and verify:

```text
VAPID_SUBJECT=mailto:your-email@example.com
VAPID_PUBLIC_KEY=<the exact public key used by the frontend>
VAPID_PRIVATE_KEY=<the matching private key>
```

The private key must never be placed in Vercel, the frontend, `.env` committed to Git, or browser code. The frontend fallback public key is:

```text
BHs4HM9zxJ4kZ9mo5Jnja-CD7P-4nTneMzTvkJtS9yJFxju5BodrRdOA4ConevV7A6tfX48x5iYk1Etu0_Ecb_c
```

If the existing Supabase VAPID pair is different, set `VITE_VAPID_PUBLIC_KEY` in Vercel to that matching public key instead of using the fallback.

## Frontend deployment

```bat
npm install
npm run build
npx vercel --prod
```

The production site must use HTTPS. After deployment, open the teacher dashboard or the student portal, click the browser-notification enable button, and accept the browser permission prompt.

## Verification sequence

1. Open the student portal link in a second browser or device.
2. Enable browser notifications and confirm that the browser permission is `Allowed`.
3. Confirm the subscription row appears in `push_subscriptions`.
4. Record attendance for that student.
5. Confirm a row is created in `student_notifications`, then `teacher_notification_events`, then `push_notification_jobs`.
6. Confirm `processed_at` is populated and the external notification appears even when the portal tab is closed.

If the in-portal notification appears but the external notification does not, the remaining cause is almost always a VAPID key mismatch, a blocked browser permission, or an old browser subscription. Clear the site notification permission and enable it again after deployment.
