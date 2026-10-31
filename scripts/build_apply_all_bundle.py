#!/usr/bin/env python3
"""Task 37 — build the ONE-PASTE apply-all SQL bundle.

Concatenates migrations 049 → 050 → 051 → 052 (all idempotent) into a single
file the user can paste into Supabase SQL Editor in ONE run, ending with a
self-verification block that prints the state of every created object.
"""
import pathlib

ROOT = pathlib.Path('/home/z/my-project/supabase')
OUT = ROOT / 'APPLY-ALL-049-050-051-052.sql'

PARTS = [
    ('049', 'migration_049_audit_rate_indexes.sql', 'سجل التدقيق + حدود المعدل + فهارس الأداء (audit trail + rate limits + perf indexes)'),
    ('050', 'migration_050_centers.sql', 'إل نوخبا سنترز — مخطط المراكز وعزل المستأجرين (centers schema + tenant RLS)'),
    ('051', 'migration_051_standalone_exams.sql', 'الامتحانات المنفصلة — جدولا الامتحانات والدرجات + RLS (standalone exams)'),
    ('052', 'migration_052_standalone_exams_portal.sql', 'بوابة الطالب — RPC نتائج الامتحانات المنفصلة (portal exam results RPC)'),
]

HEADER = """-- ═══════════════════════════════════════════════════════════════════════════
--  النخبة (Alnokhba) — حزمة التشغيل الشاملة: MIGRATIONS 049 + 050 + 051 + 052
--  ONE-PASTE BUNDLE — الصق الملف كامل في SQL Editor وشغّله مرة واحدة
-- ═══════════════════════════════════════════════════════════════════════════
--  • آمن 100%: لا يحذف أي بيانات ولا يغيّر أي جدول قائم إلا بالإضافة.
--  • idempotent: لو شغّلته أكتر من مرة أو كان جزء منه متطبق — يكمل عادي.
--  • الترتيب مهم: 049 ثم 050 ثم 051 ثم 052 (محفوظ تلقائيًا تحت).
--
--  ماذا يضيف هذا الملف؟
--   1) (049) سجل تدقيق للأدمن + حدود معدل للدوال السحابية + 9 فهارس أداء
--   2) (050) منتج EL NO5BA CENTERS كامل (إدارة مراكز — معزول بالمستأجر)
--   3) (051) الامتحانات المنفصلة: زر «إنشاء امتحان منفصل» يشتغل ببيانات حقيقية
--   4) (052) نتائج الامتحانات المنفصلة تظهر في بوابة الطالب/ولي الأمر
--
--  بعد التشغيل: افتح التطبيق وجرّب «إنشاء امتحان منفصل» — كل حاجة هتشتغل.
-- ═══════════════════════════════════════════════════════════════════════════

"""

FOOTER = """

-- ═══════════════════════════════════════════════════════════════════════════
-- فحص ذاتي نهائي — النتايج المتوقعة تحت (شوف سجل الرسائل Messages)
-- ═══════════════════════════════════════════════════════════════════════════
do $$
declare
  v_missing text := '';
begin
  -- الجداول الأربعة الأساسية
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'edge_rate_limits') then
    v_missing := v_missing || 'edge_rate_limits(m049) ';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'centers') then
    v_missing := v_missing || 'centers(m050) ';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'standalone_exams') then
    v_missing := v_missing || 'standalone_exams(m051) ';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'standalone_exam_scores') then
    v_missing := v_missing || 'standalone_exam_scores(m051) ';
  end if;
  -- الدوال
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'admin_log_audit') then
    v_missing := v_missing || 'admin_log_audit(m049) ';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'consume_rate_limit') then
    v_missing := v_missing || 'consume_rate_limit(m049) ';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'create_center') then
    v_missing := v_missing || 'create_center(m050) ';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'get_student_standalone_exams') then
    v_missing := v_missing || 'get_student_standalone_exams(m052) ';
  end if;

  if v_missing <> '' then
    raise exception 'فحص ذاتي فشل — ناقص: %', v_missing;
  end if;
  raise notice '════════════════════════════════════════════════';
  raise notice '  تم تطبيق كل المايجريشنز بنجاح (049 + 050 + 051 + 052)';
  raise notice '  كل الجداول والدوال المطلوبة موجودة — كله تمام ✓';
  raise notice '════════════════════════════════════════════════';
end $$;
"""


def main():
    chunks = [HEADER]
    for num, fname, label in PARTS:
        sql = (ROOT / fname).read_text(encoding='utf-8').strip()
        chunks.append(
            f"-- ═══════════════════════════════════════════════════════════════════════\n"
            f"--  MIGRATION {num} — {label}\n"
            f"-- ═══════════════════════════════════════════════════════════════════════\n\n"
            f"{sql}\n"
        )
    chunks.append(FOOTER)
    OUT.write_text('\n'.join(chunks), encoding='utf-8')
    lines = OUT.read_text(encoding='utf-8').count('\n')
    print(f'built {OUT.name}: {lines} lines, {OUT.stat().st_size} bytes')


if __name__ == '__main__':
    main()
