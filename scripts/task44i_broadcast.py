#!/usr/bin/env python3
"""Task 44i — broadcast the notification-update message to ALL teacher accounts.
Teachers only (the update is teacher-notification-facing; students already got
today's 44g message). Idempotent: per-teacher guard on title.
"""
import json, urllib.request

TOK = open('/home/z/my-project/.secrets/supabase-access-token').read().strip()
REF = 'pbsythpzncjoafpmijyd'

def q(sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': sql}).encode(),
        headers={'Authorization': f'Bearer {TOK}', 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read().decode(errors="replace")[:500]}') from e

TITLE = '🔔 تحديث التنبيهات — دوسة واحدة والتنبيه يبقى مقروء'

BODY = (
    'نزّلنا تحديث مركز التنبيهات:\n'
    '• دوس على أي تنبيه → يبقى مقروء على طول، وحالة القراءة بتتحفظ على السيرفر '
    'دلوقتي (كانت بتضيع بعد أي ريفرش — اتحصلت).\n'
    '• مبيظهرش غير الرسايل اللي وصلت بعد ما فتحت الموقع في الجلسة دي — القديمة '
    'خلف زر «عرض الكل»، ولو فيها غير مقروء هيظهرلك عدّاد فوق القايمة.\n'
    '• أعضاء فريق الورك سبيس مش هيشوفوا تنبيهات قبل ما سجلوا.\n'
    '• نضفنا التكرار: رسايل الواجبات والنتايج والإعلانات اللي بتبعتها للطلاب '
    'مبقتش بترجعلك نسخة لكل طالب في تنبيهاتك.\n'
    '• الضغط على إشعار الموبايل/المتصفح نفسه بيكفي — يفتح الموقع ويعلّم التنبيه مقروء.\n'
    'وشكرًا على ملاحظاتك المستمرة — دي اللي بتحسّن المنصة.'
)

def esc(s):
    return s.replace("'", "''")

def main():
    total = q('select count(*) n from profiles')[0]['n']
    existing = q(f"select count(*) n from teacher_notification_events where title = '{esc(TITLE)}'")[0]['n']
    print(f'profiles={total} existing={existing}', flush=True)
    if existing < total:
        r = q(
            "insert into teacher_notification_events (teacher_id, event_type, title, body, category) "
            f"select id, 'other', '{esc(TITLE)}', '{esc(BODY)}', 'announcement' from profiles "
            "where id not in (select teacher_id from teacher_notification_events where title = '" + esc(TITLE) + "') "
            "returning id"
        )
        print('inserted:', len(r), flush=True)
    else:
        print('already complete — skip', flush=True)
    final = q(f"select count(*) n from teacher_notification_events where title = '{esc(TITLE)}'")[0]['n']
    print(f'FINAL {final}/{total}', flush=True)
    print('BROADCAST OK' if final >= total else 'BROADCAST INCOMPLETE', flush=True)

if __name__ == '__main__':
    main()
