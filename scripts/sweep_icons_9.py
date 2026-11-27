#!/usr/bin/env python3
"""Note #9-1 sweep: replace emoji-style UI icons with the shared Icon set.
Per-file explicit replacements; JSX-text emoji -> <Icon/>, string-literal
emoji prefixes stripped (toasts/titles keep clean text)."""
import re

IC = "size={15} style={{ marginInlineEnd: 6, verticalAlign: '-0.2em' }}"

def icon(name, extra=''):
    style = f"size={{{15}}} style={{ marginInlineEnd: 6, verticalAlign: '-0.2em'{extra} }}"
    return f'<Icon name="{name}" {style} />'

FILES = {
 'src/areas/StudentsArea.jsx': [
   ('✆ {isArabic', f'{icon("phone")}{{isArabic'),
 ],
 'src/areas/ReportsArea.jsx': [
   ("ws.showToast?.(isArabic ? 'اتحفظ في مركز التنبيهات 🔔' : 'Saved to notifications 🔔', 'success')",
    "ws.showToast?.(isArabic ? 'اتحفظ في مركز التنبيهات' : 'Saved to notifications', 'success')"),
   ('↗ {isArabic', f'{icon("arrow-up-right")}{{isArabic'),
   ('✆ {isArabic ? \'رسالة ترحيب جماعية\'', f'{icon("phone")}{{isArabic ? \'رسالة ترحيب جماعية\''),
   ('✆ {isArabic ? \'رسالة لمحددين…\'', f'{icon("phone")}{{isArabic ? \'رسالة لمحددين…\''),
   ('`📄 ${isArabic', '`${isArabic'),
   ('✎ {isArabic', f'{icon("pencil")}{{isArabic'),
   ('✉ {isArabic', f'{icon("send")}{{isArabic'),
 ],
 'src/areas/HistoryArea.jsx': [
   ('✆ WhatsApp', f'{icon("phone")}WhatsApp'),
   ('`📄 ${isArabic', '`${isArabic'),
   ('✎ {isArabic', f'{icon("pencil")}{{isArabic'),
 ],
 'src/areas/SettingsArea.jsx': [
   ("{ icon: '✎', label", "{ icon: 'pencil', label"),
   ("{ icon: '⇄', label", "{ icon: 'refresh', label"),
   ("icon: '🗑',", "icon: 'trash',"),
   ("['insights', `✦ ${isArabic ? 'فريق التحليل' : 'Insights Team'}`]",
    "['insights', isArabic ? 'فريق التحليل' : 'Insights Team']"),
   ('            ✦\n', '            <Icon name="sparkles" size={18} />\n'),
   ('↺ {isArabic', f'{icon("rotate-ccw")}{{isArabic'),
   ('⧖ {isArabic', f'{icon("hourglass")}{{isArabic'),
   ('>✎</button>', '><Icon name="pencil" size={14} /></button>'),
   ('>⇄</button>', '><Icon name="refresh" size={14} /></button>'),
   ('>🗑</button>', '><Icon name="trash" size={14} /></button>'),
   ('✉ {isArabic', f'{icon("send")}{{isArabic'),
 ],
 'src/pages/AdminDashboard.jsx': [
   ("['renewals', '🔄 سجل التجديدات'],", "['renewals', 'سجل التجديدات'],"),
   ("['teams', '👥 الفرق'],", "['teams', 'الفرق'],"),
   ("['backups', '💾 النسخ الاحتياطي'],", "['backups', 'النسخ الاحتياطي'],"),
   ("['audit', '🛡️ سجل التدقيق'],", "['audit', 'سجل التدقيق'],"),
   ("['log', '📜 سجل النشاط'],", "['log', 'سجل النشاط'],"),
   ("['broadcast', '📢 رسالة بث'],", "['broadcast', 'رسالة بث'],"),
   ('🔔 تنبيهات تشغيلية', 'تنبيهات تشغيلية'),
   ('👥 {stats.student_count ?? 0} طالب', '<Icon name="users" size={14} style={{ marginInlineEnd: 4, verticalAlign: \'-0.2em\' }} />{stats.student_count ?? 0} طالب'),
   ('⚙️ إعدادات البريد', 'إعدادات البريد'),
   ('<span>📅 تجديد في', '<span><Icon name="calendar" size={13} style={{ marginInlineEnd: 4, verticalAlign: \'-0.2em\' }} />تجديد في'),
   ('✆ وصل واتساب', f'{icon("phone")}وصل واتساب'),
 ],
 'src/pages/LandingPage.jsx': [
   ("['◔', 'الصورة الكاملة غايبة'", "['clock', 'الصورة الكاملة غايبة'"),
   ('<div className="flex items-center gap-2 font-bold text-nk-200">✦ فريق التحليل</div>',
    '<div className="flex items-center gap-2 font-bold text-nk-200"><Icon name="sparkles" size={18} /> فريق التحليل</div>'),
 ],
 'src/pages/PublicQRPage.jsx': [
   (">🔔</div>", '><Icon name="bell" size={26} /></div>'),
   ("'🔔 تفعيل الإشعارات'", "'تفعيل الإشعارات'"),
   ('<b style={pushBannerTitle}>🔔 فعّل الإشعارات</b>',
    '<b style={pushBannerTitle}><Icon name="bell" size={15} style={{ marginInlineEnd: 6, verticalAlign: \'-0.2em\' }} />فعّل الإشعارات</b>'),
   ('<p style={rankText}>🛡️ {rank || \'—\'}</p>', '<p style={rankText}><Icon name="shield" size={15} style={{ marginInlineEnd: 6, verticalAlign: \'-0.2em\' }} />{rank || \'—\'}</p>'),
   ("'🔔 تفعيل إشعارات ولي الأمر على هذا الجهاز'", "'تفعيل إشعارات ولي الأمر على هذا الجهاز'"),
   ("'📄 تحميل تقرير الشهر'", "'تحميل تقرير الشهر'"),
 ],
 'src/exams/PublicQRPage.jsx': [
   ('<p style={rankText}>🛡️ {rank || \'—\'}</p>', '<p style={rankText}><Icon name="shield" size={15} style={{ marginInlineEnd: 6, verticalAlign: \'-0.2em\' }} />{rank || \'—\'}</p>'),
   ("'🔔 تفعيل إشعارات ولي الأمر على هذا الجهاز'", "'تفعيل إشعارات ولي الأمر على هذا الجهاز'"),
   ("'📄 تحميل تقرير الشهر'", "'تحميل تقرير الشهر'"),
 ],
 'src/pages/PrivacyPage.jsx': [
   ('✆ تواصل على واتساب', f'{icon("phone")}تواصل على واتساب'),
 ],
 'src/components/MessageQueueModal.jsx': [
   ('✎ عدّل الرسالة قبل الإرسال', f'{icon("pencil")}عدّل الرسالة قبل الإرسال'),
 ],
 'src/components/DayTimeline.jsx': [
   ("{isArabic ? 'اليوم ↺' : 'Today ↺'}", "{isArabic ? 'اليوم' : 'Today'} <Icon name=\"rotate-ccw\" size={13} style={{ verticalAlign: '-0.2em' }} />"),
 ],
 'src/components/InsightsReport.jsx': [
   ("stable: { icon: '✓',", "stable: { icon: 'check',"),
   ("watch: { icon: '◐',", "watch: { icon: 'clock',"),
   ("attention: { icon: '✗',", "attention: { icon: 'x',"),
   ('<span aria-hidden="true">{icon}</span>{label}', '<span aria-hidden="true">{hasIcon(icon) ? <Icon name={icon} size={15} /> : icon}</span>{label}'),
   ('<span aria-hidden="true">{verdict.icon}</span> {verdict.label}', '<span aria-hidden="true">{hasIcon(verdict.icon) ? <Icon name={verdict.icon} size={16} /> : verdict.icon}</span> {verdict.label}'),
   ('<StatTile icon="◔"', '<StatTile icon="clock"'),
   ('<StatTile icon="✎"', '<StatTile icon="pencil"'),
   ('<StatTile icon="▤"', '<StatTile icon="clipboard-list"'),
 ],
 'src/components/EmailConfigModal.jsx': [
   ('title="⚙️ إعدادات إرسال الإيميل (Resend)"', 'title="إعدادات إرسال الإيميل (Resend)"'),
   ("'✉️ إرسال إيميل تجريبي'", "'إرسال إيميل تجريبي'"),
 ],
 'src/components/TeacherNotificationCenter.jsx': [
   ("student_submission: '📤',", "student_submission: 'send',"),
   ("exam_completion: '📝',", "exam_completion: 'file-text',"),
   ("payment_recorded: '💰',", "payment_recorded: 'wallet',"),
   ("assistant_request: '👤',", "assistant_request: 'user',"),
   ("student_insight: '💡',", "student_insight: 'lightbulb',"),
   ("other: '📌',", "other: 'bell',"),
   ('🔔 {isArabic ? \'تفعيل إشعارات المتصفح\'', f'{icon("bell")}{{isArabic ? \'تفعيل إشعارات المتصفح\''),
   ("['payment', isArabic ? '💰 مدفوعات' : '💰 Payment'],", "['payment', isArabic ? 'مدفوعات' : 'Payment'],"),
   ("['attendance', isArabic ? '📋 حضور' : '📋 Attendance'],", "['attendance', isArabic ? 'حضور' : 'Attendance'],"),
 ],
 'src/exams/ExamWorkspace.jsx': [
   ('>🖨 {isArabic', f'><Icon name="printer" {IC} />{{isArabic'),
   ('↗ {isArabic', f'{icon("arrow-up-right")}{{isArabic'),
   ('>✎ {isArabic', f'><Icon name="pencil" {IC} />{{isArabic'),
   ('>🗑</button>', '><Icon name="trash" size={14} /></button>'),
   ('`✎ ${isArabic', '`${isArabic'),
 ],
 'src/exams/OnlineExamWorkspace.jsx': [
   ('>🗑</button>', '><Icon name="trash" size={14} /></button>'),
   ('↺ {isArabic', f'{icon("rotate-ccw")}{{isArabic'),
 ],
 'src/home/HomePage.jsx': [
   ('✎ {ar ? \'إنشاء امتحان منفصل\'', f'{icon("pencil")}{{ar ? \'إنشاء امتحان منفصل\''),
   ('<div className="text-3xl mb-2" aria-hidden="true">▦</div>', '<div className="mb-2" aria-hidden="true"><Icon name="layout-dashboard" size={30} /></div>'),
   ('📅 {ar ? \'مواعيد\'', f'{icon("calendar")}{{ar ? \'مواعيد\''),
   ('<span className="nk-session-icon" aria-hidden="true">✎</span>', '<span className="nk-session-icon" aria-hidden="true"><Icon name="pencil" size={16} /></span>'),
 ],
 'src/shell/AppShell.jsx': [
   ('اضغط ⇄ جنب أي مجموعة في الإعدادات', 'اضغط زر الدمج جنب أي مجموعة في الإعدادات'),
   ('Press ⇄ next to any group in Settings', 'Press the merge button next to any group in Settings'),
 ],
 'src/marketing/MarketingLayout.jsx': [
   ("{open ? '✕' : '☰'}", '{open ? <Icon name="x" size={20} /> : <Icon name="menu" size={20} />}'),
 ],
 'src/marketing/pages/CorePages.jsx': [
   ("icon: '↗',", "icon: 'arrow-up-right',"),
   ("icon: '✎',", "icon: 'pencil',"),
 ],
}

# files that need the Icon import added
NEED_IMPORT = list(FILES.keys())
for p, repls in FILES.items():
    s = open(p).read()
    orig = s
    for old, new in repls:
        if old not in s:
            print(f'MISS [{p}]: {old[:60]}')
        s = s.replace(old, new)
    if s != orig and "from '../components/icons'" not in s and "from './icons'" not in s and 'components/icons' not in s:
        # add import after the first react import line
        m = re.search(r"^import .*'react'.*$", s, re.M)
        if m:
            rel = '../components/icons' if ('/pages/' in p or '/areas/' in p or '/shell/' in p or '/exams/' in p or '/home/' in p) else './icons'
            s = s[:m.start()] + f"import Icon, {{ hasIcon }} from '{rel}'\n" + s[m.start():]
        else:
            print(f'NO-IMPORT-POINT [{p}]')
    open(p, 'w').write(s)
    print(f'ok {p}')

# PreviewDashboard makeIcon -> real Icon components
p = 'src/pages/PreviewDashboard.jsx'
s = open(p).read()
s = s.replace("import { useState } from 'react'",
              "import { useState } from 'react'\nimport Icon from '../components/icons'")
s = s.replace("""const makeIcon = (symbol) => function LocalIcon({ className = '' }) {
  return <span aria-hidden="true" className={`inline-flex items-center justify-center leading-none ${className}`}>{symbol}</span>
}""",
"""const ICON_NAME = { '←': 'arrow-left', '→': 'arrow-right', '◉': 'bell', '▤': 'clipboard-list', '◷': 'calendar', '✓': 'check', '‹': 'chevron-left', '⌁': 'zap', '▦': 'layout-dashboard', '↗': 'arrow-up-right', '✦': 'sparkles', '★': 'star', '♧': 'trophy', '×': 'x' }
const makeIcon = (symbol) => function LocalIcon({ className = '' }) {
  const n = ICON_NAME[symbol]
  return n
    ? <span aria-hidden="true" className={`inline-flex items-center justify-center leading-none ${className}`}><Icon name={n} size={16} /></span>
    : <span aria-hidden="true" className={`inline-flex items-center justify-center leading-none ${className}`}>{symbol}</span>
}""")
# zap icon needed
p2 = 'src/components/icons.jsx'
s2 = open(p2).read()
if "zap:" not in s2:
    s2 = s2.replace("  sun: {", "  zap: { paths: ['M13 2 3 14h9l-1 8 10-12h-9l1-8Z'] },\n  sun: {")
    open(p2, 'w').write(s2)
open(p, 'w').write(s)
print('ok PreviewDashboard')
