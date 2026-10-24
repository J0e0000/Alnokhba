#!/usr/bin/env python3
"""Task 44g — broadcast the update message to ALL accounts on PROD:
  • every profile → teacher_notification_events (trigger auto-queues web push)
  • every active student → student_notifications (visible in the QR portal)
Idempotent: per-table guard on title.
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

TEACHER_TITLE = '🎉 تحديث جديد — الامتحانات والواجبات ما بتعادش من الأول'
STUDENT_TITLE = '🎉 تحديث جديد — امتحانك وواجبك بيكملوا معاك'

TEACHER_BODY = (
    'نزّلنا تحديث جديد:\n'
    '• الامتحان الأونلاين: الطالب لو قفل الصفحة أو عمل ريفرش، بيرجع لنفس السؤال '
    'وإجاباته محفوظة والوقت ماشي على السيرفر — من غير ما يبدأ من الأول.\n'
    '• الواجب: الطالب لو خرج ورجع يلاقي إجاباته زي ما هي لحد ما يسلّم.\n'
    '• زر «📨 ابعت اللينك» في الامتحان الأونلاين: يبعت لكل الطلاب المستهدفين '
    'إشعار بلينك يفتح الامتحان على طول (اللي عنده محاولة شغالة يستكمل فورًا).\n'
    '• الواجب الجديد بيبعت إشعار «في واجب نزل» تلقائي للطلاب أول ما تنشره '
    '(تقدر توقفها من علامة 📨 وقت النشر، وفيه زر إشعار في صفحة الواجب نفسها).\n'
    '• إصلاحات تباين النص في صفحة الواجبات (العنوان كان شبه مخفي في الهيدر).'
)
STUDENT_BODY = (
    'أخبار حلوة! دلوقتي:\n'
    '• لو قفلت الامتحان الأونلاين أو عملت ريفرش — افتح البوابة تاني وهتلاقي '
    'امتحانك مستنيك من نفس السؤال، وإجاباتك محفوظة والوقت بيكمل على السيرفر.\n'
    '• لو خرجت من الواجب ورجعت، إجاباتك اللي اختارتها بتفضل زي ما هي.\n'
    '• أول ما المستر ينزل واجب أو امتحان هيوصلك إشعار بلينك يوصلك للمكان على طول. '
    'فعّل الإشعارات من البوابة عشان مايفوتكش حاجة.'
)

def esc(s):
    return s.replace("'", "''")

def main():
    t_exist = q(f"select count(*) n from teacher_notification_events where title = '{esc(TEACHER_TITLE)}'")
    s_exist = q(f"select count(*) n from student_notifications where title = '{esc(STUDENT_TITLE)}'")
    before_p = q('select count(*) n from profiles')
    before_s = q('select count(*) n from students where archived_at is null')
    print(f'profiles={before_p[0]["n"]} active_students={before_s[0]["n"]} | '
          f'existing teacher={t_exist[0]["n"]} student={s_exist[0]["n"]}', flush=True)

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
        print('student notifs already complete — skip', flush=True)

    t_final = q(f"select count(*) n from teacher_notification_events where title = '{esc(TEACHER_TITLE)}'")
    s_final = q(f"select count(*) n from student_notifications where title = '{esc(STUDENT_TITLE)}'")
    print(f'FINAL teacher={t_final[0]["n"]}/{before_p[0]["n"]} student={s_final[0]["n"]}/{before_s[0]["n"]}', flush=True)
    if t_final[0]['n'] >= before_p[0]['n'] and s_final[0]['n'] >= before_s[0]['n']:
        print('BROADCAST OK', flush=True)

if __name__ == '__main__':
    main()
