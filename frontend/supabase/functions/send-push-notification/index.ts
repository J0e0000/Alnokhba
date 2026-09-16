import webpush from 'npm:web-push'
import { createClient } from 'npm:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  },
})

// Return per-subscription click URL: the student's own portal when known,
// otherwise the job's URL (legacy behavior).
function clickUrlFor(job: { url?: string }, subscription: { portal_url?: string | null }): string {
  return subscription.portal_url || job.url || '/'
}

Deno.serve(async (req) => {
  // CORS preflight: the browser sends OPTIONS before a POST with an
  // Authorization header. Answer it explicitly (the old deployed version
  // crashed on empty bodies here, which made browser-side health checks
  // impossible).
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
        'access-control-allow-methods': 'POST, OPTIONS',
      },
    })
  }

  try {
    const subject = Deno.env.get('VAPID_SUBJECT') || ''
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') || ''
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') || ''

    const payload = await req.json().catch(() => ({}))

    // Health-check used by the frontend to verify this function is deployed
    // and is the broadcast-capable version. Exposes no secrets.
    if (payload?.action === 'ping') {
      return json({ ok: true, service: 'send-push-notification', broadcast: true, vapid: Boolean(subject && publicKey && privateKey) })
    }

    if (!subject || !publicKey || !privateKey) return json({ ok: false, error: 'VAPID secrets are missing' }, 500)

    try {
      webpush.setVapidDetails(subject, publicKey, privateKey)
    } catch {
      return json({ ok: false, error: 'VAPID keys are invalid or do not match' }, 500)
    }

    const job = payload?.record || payload
    if (!job?.id || !job?.teacher_id) return json({ ok: false, error: 'invalid job' }, 400)

    let subscriptions: Array<{ id: string; endpoint: string; p256dh: string; auth: string; portal_url?: string | null }> = []
    let perSubscriptionUrl = false

    if (job.broadcast === true) {
      // ── Broadcast (Announcement Board): every STUDENT device of this teacher
      // in one job. The teacher's own device (student_id null) is excluded.
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth, portal_url')
        .eq('teacher_id', job.teacher_id)
        .not('student_id', 'is', null)
      if (error) throw error
      subscriptions = data || []
      perSubscriptionUrl = true
    } else if (job.student_id) {
      // ── Student-scoped: devices subscribed for that one student.
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth, portal_url')
        .eq('teacher_id', job.teacher_id)
        .eq('student_id', job.student_id)
      if (error) throw error
      subscriptions = data || []
      perSubscriptionUrl = true
    } else {
      // ── Teacher's own devices (legacy behavior).
      const { data, error } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('teacher_id', job.teacher_id)
        .is('student_id', null)
      if (error) throw error
      subscriptions = data || []
    }

    const buildMessage = (subscription: { portal_url?: string | null }) => JSON.stringify({
      title: job.title || 'النخبة',
      body: job.body || 'لديك تنبيه جديد',
      url: perSubscriptionUrl ? clickUrlFor(job, subscription) : (job.url || '/'),
    })

    let sent = 0
    let failed = 0
    const stale: string[] = []

    // Send in parallel batches to keep broadcast latency low.
    const CHUNK = 20
    for (let i = 0; i < subscriptions.length; i += CHUNK) {
      const batch = subscriptions.slice(i, i + CHUNK)
      await Promise.all(batch.map(async (subscription) => {
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }, buildMessage(subscription))
          sent += 1
        } catch (error) {
          failed += 1
          const statusCode = (error as { statusCode?: number })?.statusCode
          if (statusCode === 404 || statusCode === 410) stale.push(subscription.id)
        }
      }))
    }

    for (const id of stale) {
      await supabase.from('push_subscriptions').delete().eq('id', id)
    }

    await supabase
      .from('push_notification_jobs')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', job.id)

    return json({ ok: true, sent, failed })
  } catch (error) {
    console.error(error)
    return json({ ok: false, error: String((error as { message?: string })?.message || error) }, 500)
  }
})
