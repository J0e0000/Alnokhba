import { supabase } from './supabaseClient'

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

const DEFAULT_VAPID_PUBLIC_KEY = 'BHs4HM9zxJ4kZ9mo5Jnja-CD7P-4nTneMzTvkJtS9yJFxju5BodrRdOA4ConevV7A6tfX48x5iYk1Etu0_Ecb_c'

function getVapidPublicKey() {
  const value = String(import.meta.env.VITE_VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY).trim()
  if (!value) return { value: '', reason: 'missing_vapid_key' }
  try {
    const bytes = urlBase64ToUint8Array(value)
    if (bytes.length !== 65 || bytes[0] !== 4) return { value: '', reason: 'invalid_vapid_key' }
    return { value, bytes }
  } catch {
    return { value: '', reason: 'invalid_vapid_key' }
  }
}

async function getReadyPushServiceWorker() {
  let registration = await navigator.serviceWorker.getRegistration('/')
  if (!registration) {
    registration = await navigator.serviceWorker.register('/sw.js?v=6', { updateViaCache: 'none' })
  }
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('service_worker_timeout')), 10000)),
  ])
}

export async function registerTeacherPush(teacherId) {
  if (!teacherId || !window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, reason: window.isSecureContext ? 'unsupported' : 'insecure_context' }
  }
  const vapid = getVapidPublicKey()
  if (!vapid.value) return { ok: false, reason: vapid.reason }
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: permission }
  const registration = await getReadyPushServiceWorker()
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapid.bytes })
  const json = subscription.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({
    teacher_id: teacherId,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
    user_agent: navigator.userAgent,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'teacher_id,endpoint' })
  if (error) throw error
  return { ok: true, subscription, endpoint: json.endpoint }
}

export async function registerStudentPush(token) {
  if (!token) return { ok: false, reason: 'missing_token' }
  if (!window.isSecureContext) return { ok: false, reason: 'insecure_context' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, reason: 'unsupported' }
  const vapid = getVapidPublicKey()
  if (!vapid.value) return { ok: false, reason: vapid.reason }
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: permission }
  const registration = await getReadyPushServiceWorker()
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapid.bytes })
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return { ok: false, reason: 'invalid_subscription' }
  const { data, error } = await supabase.rpc('register_student_push_subscription', {
    p_token: token,
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent,
  })
  if (error) throw new Error(`subscription_rpc_failed: ${error.message || error.code || 'unknown'}`)
  return { ok: data === true, reason: data === true ? 'enabled' : 'invalid_token', subscription }
}

export async function hasTeacherPushSubscription(teacherId) {
  if (!teacherId || !('serviceWorker' in navigator) || !('PushManager' in window)) return false
  const registration = await navigator.serviceWorker.ready
  const browserSubscription = await registration.pushManager.getSubscription()
  if (!browserSubscription) return false
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('teacher_id', teacherId)
    .eq('endpoint', browserSubscription.endpoint)
    .limit(1)
  if (error) throw error
  return Array.isArray(data) && data.length > 0
}

export async function unregisterTeacherPush(teacherId) {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return
  await supabase.from('push_subscriptions').delete().eq('teacher_id', teacherId).eq('endpoint', subscription.endpoint)
  await subscription.unsubscribe()
}
