#!/usr/bin/env python3
"""Task 44e — broadcast the update message to ALL accounts on PROD:
  • every profile (teacher/assistant accounts) → teacher_notification_events
    (trigger teacher_notification_push_job auto-queues web push)
  • every active student → student_notifications (visible in the QR portal)
Idempotent: skips if a notification with the same title already exists.
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

TEACHER_TITLE = '🎉 تحديث النخبة الجديد — واجبات وامتحانات أذكى'
STUDENT_TITLE = '🎉 تحديث جديد — الواجبات بقت أسهل'

TEACHER_BODY = (
    'نزّلنا تحديث كبير لشغل يومك:\n'
    '• واجبات اختيار الإجابة ببناء سريع: توليد عدد أسئلة بضغطة واحدة، وكتابة '
    'الاختيارات بـ Enter بينقلك للاختيار اللي بعده وللسؤال اللي بعده، ومفتاح '
    'إجابات جماعي («أ ب ج د» أو «1-أ 2-ج 3-ب» أو «صح غلط»).\n'
    '• صفحة واجبات مخصصة للطلاب: الطالب يحل من موبايله، التصحيح فوري على '
    'السيرفر، التسليم مرة واحدة، والدرجة تتسجل لوحدها في الحصة الجاية.\n'
    '• فيديو الشرح مايتفتحش للطالب غير بعد ما يسلّم + تحليل لأكتر الأسئلة فيها غلط.\n'
    '• امتحانات أونلاين بمؤقت حقيقي يحسبه السيرفر + بنك أسئلة + ترتيب عشوائي.\n'
    'جرّبها من «الواجبات التفاعلية» و«الامتحانات الأونلاين».'
)
STUDENT_BODY = (
    'أهلًا! دلوقتي تقدر تحل واجبات الاختيارات من صفحة الواجبات الخاصة — التصحيح '
    'فوري ودرجتك بتظهر على طول، والتسليم مرة واحدة بس. ولو المدرس بعت فيديو '
    'شرح هيفتح لك بعد ما تسلّم. فعّل الإشعارات من البوابة عشان يوصلك تنبيه بأي '
    'واجب جديد.'
)

def esc(s):
    return s.replace("'", "''")

def main():
    # idempotency check — per table
    t_exist = q(f"select count(*) n from teacher_notification_events where title = '{esc(TEACHER_TITLE)}'")
    s_exist = q(f"select count(*) n from student_notifications where title = '{esc(STUDENT_TITLE)}'")
    print('existing teacher events:', t_exist, '| existing student notifs:', s_exist, flush=True)

    before_p = q('select count(*) n from profiles')
    before_s = q('select count(*) n from students where archived_at is null')
    print(f'profiles={before_p[0]["n"]} active_students={before_s[0]["n"]}', flush=True)

    if t_exist[0]['n'] < before_p[0]['n']:
        r1 = q(
            "insert into teacher_notification_events (teacher_id, event_type, title, body, category) "
            f"select id, 'other', '{esc(TEACHER_TITLE)}', '{esc(TEACHER_BODY)}', 'announcement' from profiles "
            "where id not in (select teacher_id from teacher_notification_events where title = '" + esc(TEACHER_TITLE) + "') "
            "returning id"
        )
        print('teacher_notification_events inserted:', len(r1), flush=True)
    else:
        print('teacher events already complete — skip', flush=True)
        # unify legacy category if earlier run used 'updates'
        u1 = q("update teacher_notification_events set category = 'announcement' where title = '" + esc(TEACHER_TITLE) + "' and category <> 'announcement' returning id")
        print('teacher category unified:', len(u1), flush=True)

    if s_exist[0]['n'] < before_s[0]['n']:
        r2 = q(
            "insert into student_notifications (teacher_id, student_id, title, body, category, deep_link) "
            f"select teacher_id, id, '{esc(STUDENT_TITLE)}', '{esc(STUDENT_BODY)}', 'announcement', '/' "
            "from students where archived_at is null "
            "and id not in (select student_id from student_notifications where title = '" + esc(STUDENT_TITLE) + "') "
            "returning id"
        )
        print('student_notifications inserted:', len(r2), flush=True)
    else:
        print('student notifications already complete — skip', flush=True)

    v1 = q(f"select count(*) n from teacher_notification_events where title = '{esc(TEACHER_TITLE)}'")
    v2 = q(f"select count(*) n from student_notifications where title = '{esc(STUDENT_TITLE)}'")
    print(f"VERIFY teacher={v1[0]['n']} student={v2[0]['n']}", flush=True)
    print('BROADCAST OK' if v1[0]['n'] >= before_p[0]['n'] and v2[0]['n'] >= before_s[0]['n'] else 'BROADCAST MISMATCH', flush=True)

if __name__ == '__main__':
    main()
