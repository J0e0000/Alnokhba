# Report PDF and Web Push verification

## Report PDF

1. Deploy the latest frontend.
2. Open the teacher dashboard and open the student portal/report area.
3. Choose one student and click the explicit PDF download button.
4. Confirm that the report keeps its full width and that a long report continues on a second A4 page instead of shrinking into a small or half-width image.
5. Do not expect a PDF to download just by opening a student profile; download remains an explicit action.

The generator now keeps the full report width and slices long canvases vertically across A4 pages while preserving the aspect ratio.

## Web Push test

Use two separate browsers or devices.

### Parent device

1. Open `https://al-nokhbba.vercel.app/qr/<student-token>` over HTTPS.
2. Click the notification activation control from a user gesture.
3. Choose **Allow** in the browser permission prompt.
4. Keep the Student Portal tab open for the first test. Then repeat later with the tab closed for the background test.
5. If there is no prompt, open the browser site settings, reset Notifications for the domain, reload, and activate again.

### Teacher device

1. Sign in to the teacher dashboard.
2. Use the student attached to the parent portal device.
3. Record attendance or perform another action that creates a notification event.
4. On the parent device, verify the foreground notification first.
5. Close the Student Portal tab completely and repeat the attendance action for the background notification test.
6. Click the external notification and verify that it opens the student portal.

### If no notification arrives

Check the following in order: the parent browser permission is `Allow`; the site is HTTPS; the public VAPID key in the deployed frontend matches the public VAPID secret in Supabase; `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, and `VAPID_PRIVATE_KEY` exist in the Edge Function secrets; and the browser has not blocked notifications globally. Do not rerun migrations that are already applied.

The test requires a real browser permission and a real subscribed device. A source build alone cannot prove delivery to a closed browser.
