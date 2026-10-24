self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { title: 'النخبة', body: event.data?.text() || 'لديك تنبيه جديد' } }
  const title = data.title || 'النخبة'
  const options = {
    body: data.body || 'لديك تنبيه جديد',
    icon: data.icon || '/nokhba-mark.svg',
    badge: data.badge || '/nokhba-mark.svg',
    tag: data.tag || 'nokhba-notification',
    renotify: true,
    dir: 'rtl',
    lang: 'ar',
    data: { url: data.url || '/', event_id: data.event_id || null },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/'
  // ضغطة على إشعار النظام = التنبيه بيبقى مقروء: نبعث event_id للتاب
  // المفتوح فيعلّمه مقروء فورًا (migration 059 RPC جوه التطبيق).
  const eventId = event.notification.data?.event_id || null
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => 'focus' in client)
    if (existing) {
      if (eventId) { try { existing.postMessage({ type: 'nokhba-mark-read', eventId }) } catch {} }
      existing.navigate(target)
      return existing.focus()
    }
    return clients.openWindow(target)
  }))
})
