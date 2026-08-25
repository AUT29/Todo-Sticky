-- Todo Sticky Supabase v1 schema
-- Run this after creating a Supabase project.

create table if not exists public.app_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  device_id text,
  updated_at timestamptz not null default now()
);

create table if not exists public.attachments (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  file_name text not null,
  mime_type text,
  storage_path text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.app_states enable row level security;
alter table public.attachments enable row level security;

drop policy if exists "users read own app state" on public.app_states;
create policy "users read own app state"
  on public.app_states for select
  using (auth.uid() = user_id);

drop policy if exists "users insert own app state" on public.app_states;
create policy "users insert own app state"
  on public.app_states for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update own app state" on public.app_states;
create policy "users update own app state"
  on public.app_states for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users read own attachments" on public.attachments;
create policy "users read own attachments"
  on public.attachments for select
  using (auth.uid() = user_id);

drop policy if exists "users insert own attachments" on public.attachments;
create policy "users insert own attachments"
  on public.attachments for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update own attachments" on public.attachments;
create policy "users update own attachments"
  on public.attachments for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users delete own attachments" on public.attachments;
create policy "users delete own attachments"
  on public.attachments for delete
  using (auth.uid() = user_id);
-- Attachment file storage. Files should be uploaded under: {user_id}/{attachment_id}/{file_name}
insert into storage.buckets (id, name, public)
values ('todo-attachments', 'todo-attachments', false)
on conflict (id) do nothing;

drop policy if exists "users read own attachment files" on storage.objects;
create policy "users read own attachment files"
  on storage.objects for select
  using (bucket_id = 'todo-attachments' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "users insert own attachment files" on storage.objects;
create policy "users insert own attachment files"
  on storage.objects for insert
  with check (bucket_id = 'todo-attachments' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "users update own attachment files" on storage.objects;
create policy "users update own attachment files"
  on storage.objects for update
  using (bucket_id = 'todo-attachments' and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id = 'todo-attachments' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "users delete own attachment files" on storage.objects;
create policy "users delete own attachment files"
  on storage.objects for delete
  using (bucket_id = 'todo-attachments' and auth.uid()::text = (storage.foldername(name))[1]);