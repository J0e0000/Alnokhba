import { supabase } from './supabaseClient'

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

export async function registerTeacherPush(teacherId) {
  if (!teacherId || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, reason: 'unsupported' }
  }
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY || 'BHs4HM9zxJ4kZ9mo5Jnja-CD7P-4nTneMzTvkJtS9yJFxju5BodrRdOA4ConevV7A6tfX48x5iYk1Etu0_Ecb_c'
  if (!vapidKey) return { ok: false, reason: 'missing_vapid_key' }
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, reason: permission }
  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) })
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
  return { ok: true, subscription }
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
