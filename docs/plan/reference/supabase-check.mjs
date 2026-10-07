// ทดสอบ migration ของ Supabase บน Postgres จริง (PGlite) โดยไม่ต้องมีโปรเจกต์ Supabase
// ติดตั้ง: npm i -D @electric-sql/pglite   รัน: node docs/plan/reference/supabase-check.mjs docs/plan/reference/supabase_20261101000000_init.sql
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const migration = readFileSync(process.argv[2], 'utf8');
const db = new PGlite();

// โครงจำลองของ Supabase (auth, storage, roles, publication)
await db.exec(`
  create role authenticated; create role anon;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
  create function storage.foldername(name text) returns text[] language sql immutable
    as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  create publication supabase_realtime;
`);
await db.exec(migration);
await db.exec(`
  grant usage on schema public, auth, storage to authenticated;
  grant execute on function auth.uid() to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
`);

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
await db.exec(`insert into auth.users values ('${A}'), ('${B}')`);

async function as(user, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
const push = (recs) => db.query('select public.push_records($1::jsonb) as n', [JSON.stringify(recs)]).then((r) => r.rows[0].n);
const pull = (tx = null, id = null) => db.query('select * from public.pull_records($1, $2::uuid, 1000)', [tx, id]).then((r) => r.rows);
const h = (ms, c = 0, dev = 'aaaaaaaa') => `${String(ms).padStart(13, '0')}-${String(c).padStart(4, '0')}-${dev}`;
const item1 = '01928f7e-8c3a-7b2e-9f10-2c4d5e6f7a8b';
const note1 = '01928f7e-8c3a-7b2e-9f10-2c4d5e6f7a80';

let cursor;
await as(A, async () => {
  const n = await push([
    { id: note1, kind: 'note', data: { title: 'งานลูกค้า', is_inbox: 0 }, field_hlc: { title: h(1000), is_inbox: h(1000) }, hlc: h(1000) },
    { id: item1, kind: 'item', data: { text: 'ส่ง artwork', fired_at: null }, field_hlc: { text: h(1000), fired_at: h(1000) }, hlc: h(1000) }
  ]);
  assert.equal(n, 2);
  const rows = await pull();
  assert.equal(rows.length, 2);
  cursor = rows.at(-1);
  console.log('A: push 2, pull 2 ✓');

  // เครื่องที่ 1 แก้ text (เวลา 5000), เครื่องที่ 2 เด้งเตือน (เวลา 9000) — ส่งสลับลำดับกัน
  assert.equal(await push([{ id: item1, kind: 'item', data: { fired_at: '2026-10-08T02:00:00.000Z' }, field_hlc: { fired_at: h(9000, 0, 'bbbbbbbb') }, hlc: h(9000, 0, 'bbbbbbbb') }]), 1);
  assert.equal(await push([{ id: item1, kind: 'item', data: { text: 'ส่ง artwork ให้ลูกค้า' }, field_hlc: { text: h(5000) }, hlc: h(5000) }]), 1);
  // ค่าเก่ากว่าต้องไม่ทับ
  assert.equal(await push([{ id: item1, kind: 'item', data: { text: 'ค่าเก่า' }, field_hlc: { text: h(4000) }, hlc: h(4000) }]), 0);

  const after = await pull(cursor.tx, cursor.id);
  assert.equal(after.length, 1);
  assert.equal(after[0].data.text, 'ส่ง artwork ให้ลูกค้า');
  assert.equal(after[0].data.fired_at, '2026-10-08T02:00:00.000Z');
  assert.equal(after[0].hlc, h(9000, 0, 'bbbbbbbb'));
  console.log('A: per-field merge ✓ (text from 5000 kept, fired_at from 9000 kept, stale 4000 ignored)');
  const again = await pull(after[0].tx, after[0].id);
  assert.equal(again.length, 0);
  console.log('A: cursor returns nothing new ✓');

  await assert.rejects(push([{ id: item1, kind: 'virus', data: {}, field_hlc: {}, hlc: h(1) }]));
  await assert.rejects(push([{ id: '01928f7e-8c3a-7b2e-9f10-2c4d5e6f7a99', kind: 'item', data: {}, field_hlc: {}, hlc: 'not-a-clock' }]));
  console.log('A: bad kind / bad hlc rejected ✓');
});

await as(B, async () => {
  assert.equal((await pull()).length, 0);
  console.log('B: cannot see A\'s rows ✓');
  await assert.rejects(push([{ id: item1, kind: 'item', data: { text: 'ของ B' }, field_hlc: { text: h(99999) }, hlc: h(99999) }]));
  const ins = await db.query(`insert into public.devices (id, name, platform, app_version) values (gen_random_uuid(), 'PC ของ B', 'win32', '2.1.0') returning user_id`);
  assert.equal(ins.rows[0].user_id, B);
  console.log('B: cannot overwrite A\'s row ✓, device row owned by B ✓');
});

await as(A, async () => {
  const rows = await pull();
  assert.equal(rows.find((r) => r.id === item1).data.text, 'ส่ง artwork ให้ลูกค้า');
  assert.equal((await db.query('select * from public.devices')).rows.length, 0);
  console.log('A: data intact, cannot see B\'s device ✓');
});
console.log('ALL OK');
