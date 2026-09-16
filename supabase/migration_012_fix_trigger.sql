-- ============================================================================
-- Fix: إضافة عمود is_verified و phone لجدول profiles
-- ============================================================================
-- هاتين العمودين مستخدمين في الكود لكن مفصولوش في قاعدة البيانات أصلاً

alter table profiles add column if not exists is_verified boolean not null default false;
alter table profiles add column if not exists phone text;

-- السماح للأدمن بتحديث الحقول الجديدة (السياسة الحالية profiles_admin_update
-- بتشمل كل الأعمدة، فمش محتاجين سياسة جديدة)