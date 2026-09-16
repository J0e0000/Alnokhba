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
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/'
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => 'focus' in client)
    if (existing) { existing.navigate(target); return existing.focus() }
    return clients.openWindow(target)
  }))
})
