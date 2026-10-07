-- WunWun · Supabase migration: ระบบซิงก์
-- วางที่ supabase/migrations/20261101000000_init.sql แล้ว `supabase db push`
-- แทนที่ supabase/schema.sql เดิม (ตาราง wunwun_notes ไม่ใช้แล้ว)
--
-- ออกแบบ: ตารางเดียว sync_records เก็บทุกอย่างที่ซิงก์ (โน้ต รายการ ไฟล์แนบ การตั้งค่า)
--   - data       = ค่าของแต่ละ field (ชื่อ field เหมือนคอลัมน์ใน SQLite ของแอป)
--   - field_hlc  = นาฬิกาของแต่ละ field → merge ทีละ field (ดู docs/plan/07-sync.md)
--   - tx         = transaction id ที่เขียนล่าสุด → ใช้เป็น cursor ตอนดึงข้อมูลโดยไม่พลาดแถว

-- ---------------------------------------------------------------------------
-- 1. ตารางข้อมูลซิงก์
-- ---------------------------------------------------------------------------
create table public.sync_records (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('note', 'item', 'attachment', 'settings')),
  data       jsonb not null default '{}'::jsonb check (octet_length(data::text) < 200000),
  field_hlc  jsonb not null default '{}'::jsonb,
  hlc        text collate "C" not null check (hlc ~ '^\d{13}-\d{4}-[0-9a-z]{8}$'),
  tx         xid8 not null default pg_current_xact_id(),
  updated_at timestamptz not null default now()
);

create index sync_records_pull_idx on public.sync_records (user_id, tx, id);

alter table public.sync_records enable row level security;

create policy "sync_records: select own" on public.sync_records
  for select to authenticated using (user_id = (select auth.uid()));
create policy "sync_records: insert own" on public.sync_records
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "sync_records: update own" on public.sync_records
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- ไม่มี policy delete: แอปไม่ลบจริง (ใช้ deleted_at) การล้างทำโดย job ฝั่งเซิร์ฟเวอร์

-- ---------------------------------------------------------------------------
-- 2. ส่งข้อมูลขึ้น: merge ทีละ field แบบ last-writer-wins
-- ---------------------------------------------------------------------------
create or replace function public.push_records(p_records jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rec         jsonb;
  existing    public.sync_records%rowtype;
  merged_data jsonb;
  merged_fh   jsonb;
  field       text;
  incoming_h  text;
  applied     integer := 0;
begin
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 500 then
    raise exception 'push_records: expected an array of at most 500 records';
  end if;

  for rec in select value from jsonb_array_elements(p_records) loop
    if rec->>'kind' not in ('note', 'item', 'attachment', 'settings')
       or jsonb_typeof(rec->'data') <> 'object'
       or jsonb_typeof(rec->'field_hlc') <> 'object' then
      raise exception 'push_records: bad record %', rec->>'id';
    end if;

    select * into existing from public.sync_records where id = (rec->>'id')::uuid for update;

    if not found then
      insert into public.sync_records (id, user_id, kind, data, field_hlc, hlc)
      values ((rec->>'id')::uuid, (select auth.uid()), rec->>'kind', rec->'data', rec->'field_hlc', rec->>'hlc');
      applied := applied + 1;
    else
      merged_data := existing.data;
      merged_fh := existing.field_hlc;
      for field, incoming_h in select key, value #>> '{}' from jsonb_each(rec->'field_hlc') loop
        if merged_fh->>field is null or incoming_h collate "C" > (merged_fh->>field) collate "C" then
          merged_data := jsonb_set(merged_data, array[field], coalesce(rec->'data'->field, 'null'::jsonb), true);
          merged_fh := jsonb_set(merged_fh, array[field], to_jsonb(incoming_h), true);
        end if;
      end loop;

      if merged_fh is distinct from existing.field_hlc then
        update public.sync_records
           set data = merged_data,
               field_hlc = merged_fh,
               hlc = greatest(existing.hlc, (rec->>'hlc') collate "C"),
               tx = pg_current_xact_id(),
               updated_at = now()
         where id = existing.id;
        applied := applied + 1;
      end if;
    end if;
  end loop;

  return applied;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. ดึงข้อมูลลง: cursor = (tx, id) และส่งเฉพาะแถวของ transaction ที่จบแล้วเท่านั้น
--    (tx < xmin ของ snapshot ปัจจุบัน) → ไม่พลาดแถวที่ commit ช้า
-- ---------------------------------------------------------------------------
create or replace function public.pull_records(
  p_after_tx text default null,
  p_after_id uuid default null,
  p_limit integer default 1000
)
returns table (id uuid, kind text, data jsonb, field_hlc jsonb, hlc text, tx text)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.kind, r.data, r.field_hlc, r.hlc::text, r.tx::text
  from public.sync_records r
  where r.user_id = (select auth.uid())
    and r.tx < pg_snapshot_xmin(pg_current_snapshot())
    and (p_after_tx is null
         or (r.tx, r.id) > (p_after_tx::xid8, coalesce(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  order by r.tx, r.id
  limit least(greatest(p_limit, 1), 1000);
$$;

revoke all on function public.push_records(jsonb) from public, anon;
revoke all on function public.pull_records(text, uuid, integer) from public, anon;
grant execute on function public.push_records(jsonb) to authenticated;
grant execute on function public.pull_records(text, uuid, integer) to authenticated;

-- ให้แอป "ถูกสะกิด" เมื่อมีข้อมูลใหม่ (แอปแค่เรียก pull ต่อ ไม่ใช้ payload)
alter publication supabase_realtime add table public.sync_records;

-- ---------------------------------------------------------------------------
-- 4. อุปกรณ์
-- ---------------------------------------------------------------------------
create table public.devices (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 100),
  platform     text not null check (platform in ('win32', 'darwin', 'linux', 'web')),
  app_version  text not null check (char_length(app_version) <= 40),
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

alter table public.devices enable row level security;
create policy "devices: select own" on public.devices
  for select to authenticated using (user_id = (select auth.uid()));
create policy "devices: insert own" on public.devices
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "devices: update own" on public.devices
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "devices: delete own" on public.devices
  for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. โควตา AI (เขียนโดย Edge Function ด้วย service role เท่านั้น)
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  count   integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
create policy "ai_usage: select own" on public.ai_usage
  for select to authenticated using (user_id = (select auth.uid()));

-- ใช้โควตา 1 ครั้งแบบ atomic: คืน true ถ้ายังไม่เกิน p_limit, NULL ถ้าเกิน
create or replace function public.ai_consume(p_user uuid, p_day date, p_limit integer)
returns boolean
language sql
security definer
set search_path = ''
as $$
  insert into public.ai_usage (user_id, day, count) values (p_user, p_day, 1)
  on conflict (user_id, day) do update set count = public.ai_usage.count + 1
    where public.ai_usage.count < p_limit
  returning true;
$$;
revoke all on function public.ai_consume(uuid, date, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. ไฟล์แนบ: bucket ส่วนตัว, path = <user_id>/<attachment_id>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 26214400)  -- 25 MB
on conflict (id) do nothing;

create policy "attachments: read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "attachments: upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "attachments: update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "attachments: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- 7. (ไม่บังคับ) ล้าง tombstone เกิน 180 วัน — ต้องเปิด extension pg_cron ก่อน
-- ---------------------------------------------------------------------------
-- select cron.schedule('wunwun-purge-tombstones', '0 3 * * *', $purge$
--   delete from public.sync_records
--   where data ? 'deleted_at' and data->>'deleted_at' is not null
--     and (data->>'deleted_at')::timestamptz < now() - interval '180 days'
-- $purge$);
