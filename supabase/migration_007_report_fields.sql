-- ============================================================================
-- نظام النخبة — Migration 007: تخصيص محتوى التقرير
-- ============================================================================
alter table teacher_settings add column if not exists report_fields text[]
  not null default array['rank','position','points','warnings','attendance','homework','session','logs'];
