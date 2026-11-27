import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { ensureUpdateNotifications } from '../lib/platformUpdates'

/**
 * usePlatformUpdates(refreshKey) — seeds the platform-update rows for the
 * signed-in teacher and returns the UNREAD count. Shared by the ◔ launcher
 * and the 🔔 broadcast bell so both badges reflect «تحديثات النخبة» without
 * opening the center (review round 2, note b). Seeding itself is idempotent
 * and silent; visibility never depends on the server write succeeding.
 */
export function usePlatformUpdates(refreshKey) {
  const { effectiveTeacherId } = useAuth()
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    let alive = true
    if (!effectiveTeacherId) { setUnread(0); return }
    ensureUpdateNotifications(effectiveTeacherId)
      .then((rows) => { if (alive) setUnread(rows.filter((r) => !r.is_read).length) })
      .catch(() => { if (alive) setUnread(0) })
    return () => { alive = false }
  }, [effectiveTeacherId, refreshKey])
  return unread
}
