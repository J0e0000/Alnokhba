#!/usr/bin/env python3
"""Task 64 — ONE-TIME broadcast: announce multi-group enrollment to EVERY
teacher account on the platform (teacher_notification_events; the DB trigger
auto-queues web push for subscribed devices). Students are NOT notified —
the request was teachers only. Idempotent: per-teacher guard on the title,
so re-running never duplicates ("one time").

Needs /home/z/my-project/.secrets/supabase-access-token (wiped in the
2026-11-25 sandbox rebuild — re-provide it to run this).
Run AFTER scripts/task64_apply_multi_group.py so the feature is live when
teachers read the announcement.
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
        body = e.read().decode(errors='replace')[:500]
        raise RuntimeError(f'HTTP {e.code}: {body}') from e

TEACHER_TITLE = '✨ تحديث جديد — نفس الطالب في أكثر من مجموعة'
TEACHER_BODY = (
    'ميزة جديدة وصلت:\n'
    '• من شاشة الطلاب افتح تعديل أي طالب (أو إضافة طالب جديد) وستجد قسم '
    '«مجموعات إضافية» — اختر أي مجموعة أخرى وسيظهر الطالب في الحصص والواجبات '
    'والامتحانات والتقارير لكل مجموعاته معًا.\n'
    '• المجموعة الأساسية تبقى هي المرجع لمرحلة الطالب، والمجموعات الإضافية '
    'توسّع ظهوره فقط.\n'
    '• الحضور والنقاط تُسجَّل لكل مجموعة حسب حصتها كما هي.\n'
    '• إعادة تسمية أو حذف أي مجموعة تتحدث تلقائيًا عند كل الطلاب المضافين لها.\n'
    'كذلك عند رصد رسالة أو واجب أو امتحان على مجموعة معينة سيشمله الطالب '
    'المضاف لها كمجموعة إضافية.'
)

def esc(s):
    return s.replace("'", "''")

def main():
    t_exist = q(f"select count(*) n from teacher_notification_events where title = '{esc(TEACHER_TITLE)}'")
    before_p = q('select count(*) n from profiles')
    print(f"profiles={before_p[0]['n']} | existing rows with this title={t_exist[0]['n']}", flush=True)

    if t_exist[0]['n'] < before_p[0]['n']:
        r1 = q(
            "insert into teacher_notification_events (teacher_id, event_type, title, body, category) "
            f"select id, 'other', '{esc(TEACHER_TITLE)}', '{esc(TEACHER_BODY)}', 'announcement' from profiles "
            "where id not in (select teacher_id from teacher_notification_events where title = '" + esc(TEACHER_TITLE) + "') "
            "returning id"
        )
        print('teacher_notification_events inserted:', len(r1), flush=True)
    else:
        print('teacher events already complete — skip (one-time guard)', flush=True)

    t_final = q(f"select count(*) n from teacher_notification_events where title = '{esc(TEACHER_TITLE)}'")
    print(f"FINAL teacher rows with title: {t_final[0]['n']}/{before_p[0]['n']}", flush=True)
    if t_final[0]['n'] >= before_p[0]['n']:
        print('BROADCAST OK', flush=True)

if __name__ == '__main__':
    main()
