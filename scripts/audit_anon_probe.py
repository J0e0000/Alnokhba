#!/usr/bin/env python3
"""Anonymous access probe — real attack-surface test.
Uses the PUBLIC anon key (as any site visitor has) to try reading each table.
200 + rows   => anon-readable (expected only for truly public tables)
200 + []     => readable but RLS filtered all rows (OK)
401/403/404  => protected (PGRST codes)
"""
import json
import urllib.request
import urllib.error

KEY = open("/tmp/anonkey.txt").read().strip()
BASE = "https://pbsythpzncjoafpmijyd.supabase.co/rest/v1"

TABLES = """
profiles groups students lesson_sessions attendance_records behavior_logs
teacher_settings session_logs group_schedule workspace_members admin_activity_log
broadcast_messages feature_unlocks login_attempts student_qr_tokens announcements
homework_tasks homework_task_status homework_submissions qb_exams qb_questions qb_tags
qb_templates qb_versions qb_version_items qb_exam_items qb_exam_sections
qb_import_staging qb_question_tags workspace_branding assistant_requests expenses
report_templates student_notifications student_payments teacher_notification_events
push_notification_jobs push_subscriptions backup_settings backups admin_audit_logs
admin_support_sessions exam_score_audit_logs attendance_records_archive
grade_import_logs whatsapp_send_log analytics_insights analytics_reports analytics_runs
subscription_renewals edge_rate_limits centers center_members center_groups
center_students center_rooms center_sessions center_attendance center_audit_logs
center_teachers standalone_exams standalone_exam_scores standalone_exam_audit_logs
online_exams online_exam_attempts admin_email_config exams exam_scores
""".split()

def probe(table):
    url = f"{BASE}/{table}?select=*&limit=1"
    req = urllib.request.Request(url)
    req.add_header("apikey", KEY)
    req.add_header("Authorization", f"Bearer {KEY}")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = json.loads(r.read().decode())
            count = r.headers.get("content-range", "n/a")
            return r.status, (f"{len(body)} rows, range={count}" if isinstance(body, list) else str(body)[:80])
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:90]
    except Exception as e:
        return -1, str(e)[:90]

readable_with_rows = []
print(f"{'TABLE':<34} {'STATUS':<7} RESULT")
for t in TABLES:
    st, msg = probe(t)
    flag = ""
    if st == 200 and "0 rows" not in msg:
        flag = "  ⚠️ ANON CAN READ"
        readable_with_rows.append(t)
    print(f"{t:<34} {st:<7} {msg}{flag}")

print("\n" + "=" * 60)
print("TABLES ANON CAN READ WITH REAL DATA:", readable_with_rows or "none")
