-- WunWun notes sync schema (optional)
-- Run in Supabase SQL editor when enabling cloud sync

create table if not exists public.wunwun_notes (
  id text primary key,
  user_id uuid references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.wunwun_notes enable row level security;

create policy "Users manage own notes"
  on public.wunwun_notes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
