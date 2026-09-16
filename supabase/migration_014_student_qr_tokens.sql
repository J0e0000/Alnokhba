-- migration_014: Permanent student QR tokens
-- Run this in the Supabase SQL Editor.
--
-- Each student gets a unique, permanent, cryptographically random token.
-- The public page /qr/:token uses this to display the QR code.
-- Tokens can be revoked (revoked_at set) and regenerated.

-- 1) Create the table
create table if not exists public.student_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- 2) Unique token constraint
create unique index if not exists idx_student_qr_tokens_token
  on public.student_qr_tokens (token)
  where revoked_at is null;

-- 3) One active token per student (partial unique index)
create unique index if not exists idx_student_qr_tokens_one_active
  on public.student_qr_tokens (student_id)
  where revoked_at is null;

-- 4) Index for lookups by student_id
create index if not exists idx_student_qr_tokens_student
  on public.student_qr_tokens (student_id);

-- 5) RLS
alter table public.student_qr_tokens enable row level security;

-- 6) Public read — anyone with the token can validate it (needed for /qr/:token page)
create policy "qr_token_public_read" on public.student_qr_tokens
  for select using (true);

-- 7) Authenticated insert — teacher can create tokens for their students
create policy "qr_token_teacher_insert" on public.student_qr_tokens
  for insert with check (
    auth.uid() is not null
    and exists (
      select 1 from public.students
      where students.id = student_qr_tokens.student_id
        and students.teacher_id = auth.uid()
    )
  );

-- 8) Authenticated update — teacher can revoke/regenerate their students' tokens
create policy "qr_token_teacher_update" on public.student_qr_tokens
  for update using (
    auth.uid() is not null
    and exists (
      select 1 from public.students
      where students.id = student_qr_tokens.student_id
        and students.teacher_id = auth.uid()
    )
  );
