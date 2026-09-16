-- 1) Create bucket
insert into storage.buckets (id, name, public)
values ('student-qr', 'student-qr', true)
on conflict (id) do nothing;

-- 2) Public read policy
create policy "student_qr_public_read" on storage.objects
  for select using (bucket_id = 'student-qr');

-- 3) Teacher upload policy
create policy "student_qr_teacher_upload" on storage.objects
  for insert with check (bucket_id = 'student-qr' and is_admin_user());

-- 4) Delete policy (admin only)
create policy "student_qr_delete" on storage.objects
  for delete using (bucket_id = 'student-qr' and is_admin_user());