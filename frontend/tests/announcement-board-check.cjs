// Round 6 check — Announcement Board (لوحة الإعلانات, 6th tab in التقارير).
// Verifies the full feature wiring end to end at the source level:
//   1. Dashboard: 6th ReportCard + AnnouncementsModal import + mount.
//   2. AnnouncementsModal: uses the send_announcement RPC, handles the
//      missing-migration case with Arabic guidance, checks edge deployment
//      state (ping), enforces input limits, loads + deletes history.
//   3. Translations: ar + en keys for the new card.
//   4. Service worker: RTL notifications + version bump so devices refresh.
//   5. PWA: manifest exists and is linked from index.html (iOS home-screen
//      install → web push works on iPhone).
//   6. Portal: iOS-specific push enablement guidance.
//   7. Backend deliverables exist: migration 037 + broadcast-capable edge
//      function + deploy.json/apply.json.
const fs = require('fs')
const path = require('path')

const read = (f) => fs.readFileSync(f, 'utf8')
const exists = (f) => fs.existsSync(f)
let failures = 0
const check = (name, cond) => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${name}`)
  if (!cond) failures += 1
}

console.log('Announcement Board (Round 6) checks:')

// ── 1. Dashboard wiring ──
const dash = read('src/pages/Dashboard.jsx')
check('Dashboard imports AnnouncementsModal', dash.includes("import AnnouncementsModal from '../components/AnnouncementsModal'"))
check('Dashboard declares announcementsOpen state', /const \[announcementsOpen, setAnnouncementsOpen\] = useState\(false\)/.test(dash))
check('Dashboard renders the 6th ReportCard (لوحة الإعلانات)', dash.includes("icon=\"📣\" title={t('announcements_board')}"))
check('6th card opens the announcement board modal', /setAnnouncementsOpen\(true\)/.test(dash))
check('Dashboard mounts AnnouncementsModal with teacher + students', /<AnnouncementsModal[\s\S]{0,220}teacherId=\{effectiveTeacherId\}[\s\S]{0,80}studentCount=\{students\.length\}/.test(dash))
const reportCardCount = (dash.match(/<ReportCard /g) || []).length
check(`reports grid now has 6 cards (found ${reportCardCount})`, reportCardCount === 6)

// ── 2. Modal behavior ──
const modal = read('src/components/AnnouncementsModal.jsx')
check('modal calls the send_announcement RPC', modal.includes("supabase.rpc('send_announcement'"))
check('modal passes all three RPC params', /p_title:\s*title\.trim\(\),[\s\S]{0,60}p_message:\s*message\.trim\(\),[\s\S]{0,60}p_student_id:\s*null/.test(modal))
check('modal detects missing migration (PGRST202) and guides in Arabic', modal.includes('MISSING_RPC_RE') && modal.includes('Migration 037'))
check('modal probes edge deployment with ping', modal.includes("supabase.functions.invoke('send-push-notification'") && modal.includes("action: 'ping'"))
check('modal distinguishes legacy/missing/ready edge states', modal.includes("'ready'") && modal.includes("'legacy'") && modal.includes("'missing'"))
check('modal shows the copyable deploy command', modal.includes('EDGE_DEPLOY_CMD') && modal.includes('supabase functions deploy send-push-notification'))
check('modal enforces title/message length limits', modal.includes('TITLE_MAX') && modal.includes('MESSAGE_MAX'))
check('modal displays delivery stats (students + devices)', modal.includes('students_notified') && modal.includes('push_targets'))
check('modal loads history from announcements table', modal.includes("from('announcements')"))
check('modal history delete uses two-step confirm', modal.includes('deleteTarget') && modal.includes('تأكيد الحذف؟'))
check('modal shows iOS add-to-home-screen hint', modal.includes('إضافة إلى الشاشة الرئيسية'))
check('modal keeps hooks order safe (no early return before hooks)', !/return\s*\(\s*<\/Modal|if \(!open\) return null/.test(modal))

// ── 3. Translations ──
const tr = read('src/lib/translations.js')
check('ar: announcements_board keys present', tr.includes("announcements_board: 'لوحة الإعلانات'") && tr.includes("open_announcements_board: 'افتح لوحة الإعلانات'"))
check('en: announcements_board keys present', tr.includes("announcements_board: 'Announcement Board'") && tr.includes("open_announcements_board: 'Open Announcement Board'"))

// ── 4. Service worker + registration ──
const sw = read('public/sw.js')
check('sw.js renders RTL Arabic notifications', sw.includes("dir: 'rtl'") && sw.includes("lang: 'ar'"))
check('sw.js opens the notification url on click', sw.includes('notificationclick') && sw.includes("event.notification.data?.url"))
const main = read('src/main.jsx')
const pushLib = read('src/lib/pushNotifications.js')
check('SW registration version bumped in main.jsx', main.includes('/sw.js?v=6'))
check('SW registration version bumped in pushNotifications.js', pushLib.includes('/sw.js?v=6'))
check('student push registration preserved (registerStudentPush)', pushLib.includes('export async function registerStudentPush'))

// ── 5. PWA manifest (iOS install → push on iPhone) ──
check('manifest.webmanifest exists', exists('public/manifest.webmanifest'))
const manifest = exists('public/manifest.webmanifest') ? read('public/manifest.webmanifest') : ''
const html = read('index.html')
check('manifest is standalone + rtl + ar', /"display":\s*"standalone"/.test(manifest) && /"dir":\s*"rtl"/.test(manifest) && /"lang":\s*"ar"/.test(manifest))
check('manifest has 192 + 512 icons', /logo-192\.png/.test(manifest) && /logo-512\.png/.test(manifest))
check('index.html links the manifest', html.includes('<link rel="manifest" href="/manifest.webmanifest"'))
check('index.html has iOS web-app meta', html.includes('apple-mobile-web-app-capable') && html.includes('apple-mobile-web-app-title'))

// ── 6. Portal iOS guidance ──
const portal = read('src/pages/PublicQRPage.jsx')
check('portal detects iOS browsers for push advice', portal.includes('isIOSBrowser'))
check('portal iOS message explains Add to Home Screen', portal.includes('إضافة إلى الشاشة الرئيسية'))

// ── 7. Backend deliverables ──
const mig = exists('supabase/migrations/migration_037_announcement_board.sql') ? read('supabase/migrations/migration_037_announcement_board.sql') : ''
check('migration 037 exists', mig.length > 0)
check('migration adds broadcast column', mig.includes('add column if not exists broadcast'))
check('migration adds portal_url + backfill', mig.includes('add column if not exists portal_url') && mig.includes('update public.push_subscriptions'))
check('migration scopes the bridge to skip announcements', /if new\.category = 'announcement'[\s\S]{0,120}return new/.test(mig))
check('migration creates send_announcement RPC', mig.includes('create or replace function public.send_announcement'))
check('migration links notifications to announcements (cascade)', mig.includes('announcement_id uuid') && mig.includes('on delete cascade'))
check('migration adds announcements_teacher_read policy', mig.includes('announcements_teacher_read'))
check('apply.json generated', exists('supabase/migrations/migration_037_apply.json'))
const edge = read('supabase/functions/send-push-notification/index.ts')
check('edge function ping action', edge.includes("action === 'ping'"))
check('edge function broadcast branch', edge.includes('broadcast === true'))
check('edge function keeps legacy teacher path', edge.includes("is('student_id', null)"))
check('edge function cleans stale subscriptions', edge.includes('410'))
check('deploy.json generated', exists('supabase/functions/send-push-notification/deploy.json'))

console.log('')
if (failures) {
  console.log(`${failures} FAILURES`)
  process.exit(1)
}
console.log('All announcement board checks passed ✓')
