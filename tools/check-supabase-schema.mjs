import { readFile } from "node:fs/promises";

const schema = await readFile("supabase/schema.sql", "utf8");
const required = [
  "create table if not exists public.app_states",
  "create table if not exists public.attachments",
  "alter table public.app_states enable row level security",
  "alter table public.attachments enable row level security",
  "values ('todo-attachments', 'todo-attachments', false)",
  "on storage.objects for select",
  "on storage.objects for insert",
  "using (auth.uid() = user_id)",
  "with check (auth.uid() = user_id)",
  "auth.uid()::text = (storage.foldername(name))[1]"
];

for (const text of required) {
  if (!schema.includes(text)) throw new Error(`Supabase schema is missing: ${text}`);
}

console.log("supabase schema checks passed");
