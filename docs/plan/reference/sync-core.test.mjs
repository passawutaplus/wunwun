// รัน: node --test "docs/plan/reference/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClock, parseHlc, mergeRecord, applyLocalPatch, canonicalInbox } from './sync-core.mjs';

// เซิร์ฟเวอร์จำลอง: เก็บ record และ merge แบบเดียวกับ RPC push_records
function fakeServer() {
  const rows = new Map();
  let seq = 0;
  return {
    push(records) {
      for (const r of records) {
        const merged = mergeRecord(rows.get(r.id) || null, r);
        if (merged.changed) rows.set(r.id, { id: r.id, data: merged.data, fieldHlc: merged.fieldHlc, seq: ++seq });
      }
    },
    pull(since) {
      return [...rows.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
    },
    get: (id) => rows.get(id)
  };
}

function device(name, server, startMs) {
  let t = startMs;
  const clock = createClock(name.padEnd(8, '0'), () => t);
  const rows = new Map();
  let cursor = 0;
  return {
    setTime: (ms) => { t = ms; },
    write(id, patch) {
      const next = applyLocalPatch(rows.get(id) || { id, data: {}, fieldHlc: {} }, patch, clock);
      rows.set(id, { ...next, id });
    },
    push() {
      const dirty = [...rows.values()].filter((r) => r.dirty);
      server.push(dirty);
      for (const r of dirty) r.dirty = false;
    },
    pull() {
      for (const remote of server.pull(cursor)) {
        cursor = remote.seq;
        for (const h of Object.values(remote.fieldHlc)) clock.receive(h);
        const merged = mergeRecord(rows.get(remote.id) || null, remote);
        rows.set(remote.id, { id: remote.id, data: merged.data, fieldHlc: merged.fieldHlc, dirty: merged.localAhead });
      }
    },
    get: (id) => rows.get(id)
  };
}

test('HLC เดินหน้าเสมอ แม้นาฬิกาเครื่องย้อน', () => {
  let t = 1_000_000;
  const clock = createClock('aaaaaaaa', () => t);
  const a = clock.tick();
  t = 999_000; // นาฬิกาถูกตั้งย้อน
  const b = clock.tick();
  assert.ok(b > a);
  assert.equal(parseHlc(b).ms, 1_000_000);
  assert.equal(parseHlc(b).c, 1);
});

test('รับ HLC จากเครื่องที่นาฬิกาเร็วกว่า → เขียนครั้งต่อไปใหม่กว่า', () => {
  const clock = createClock('aaaaaaaa', () => 1_000);
  const remote = '0000000005000-0002-bbbbbbbb';
  clock.receive(remote);
  assert.ok(clock.tick() > remote);
});

test('ไม่ตามนาฬิกาเครื่องอื่นที่เร็วเกิน 1 วัน', () => {
  const day = 86_400_000;
  const clock = createClock('aaaaaaaa', () => 10 * day);
  clock.receive(`${String(13 * day).padStart(13, '0')}-0000-bbbbbbbb`);
  assert.ok(parseHlc(clock.current()).ms <= 11 * day);
});

test('แก้คนละ field บนคนละเครื่องตอนออฟไลน์ → เก็บได้ทั้งคู่', () => {
  const server = fakeServer();
  const laptop = device('a1a1a1a1', server, 1_000);
  const desktop = device('b2b2b2b2', server, 1_000);

  laptop.write('item-1', { text: 'ส่ง artwork', due_at: '2026-10-08T02:00:00.000Z', fired_at: null });
  laptop.push();
  desktop.pull();

  laptop.setTime(5_000);
  laptop.write('item-1', { text: 'ส่ง artwork ให้ลูกค้า' });       // ผู้ใช้แก้ข้อความบนโน้ตบุ๊ก (ออฟไลน์)
  desktop.setTime(9_000);
  desktop.write('item-1', { fired_at: '2026-10-08T02:00:00.000Z' }); // เดสก์ท็อปเด้งเตือน (ทีหลัง)

  desktop.push();
  laptop.push();
  laptop.pull();
  desktop.pull();

  for (const d of [laptop, desktop]) {
    assert.equal(d.get('item-1').data.text, 'ส่ง artwork ให้ลูกค้า');
    assert.equal(d.get('item-1').data.fired_at, '2026-10-08T02:00:00.000Z');
  }
  assert.deepEqual(laptop.get('item-1').data, desktop.get('item-1').data);
  assert.deepEqual(server.get('item-1').data, laptop.get('item-1').data);
});

test('แก้ field เดียวกันสองเครื่อง → ใครแก้ทีหลังชนะ ทุกเครื่องได้ค่าเดียวกัน', () => {
  const server = fakeServer();
  const a = device('a1a1a1a1', server, 1_000);
  const b = device('b2b2b2b2', server, 1_000);
  a.write('item-2', { checked_at: null, text: 'โทรหา supplier' });
  a.push(); b.pull();

  a.setTime(3_000); a.write('item-2', { checked_at: '2026-10-07T03:00:00.000Z' });
  b.setTime(3_500); b.write('item-2', { checked_at: null });
  a.push(); b.push(); a.pull(); b.pull();

  assert.equal(a.get('item-2').data.checked_at, null);
  assert.deepEqual(a.get('item-2').data, b.get('item-2').data);
});

test('ลบแล้วอีกเครื่องแก้ข้อความ → ยังถูกลบ (ไม่ฟื้นเอง)', () => {
  const server = fakeServer();
  const a = device('a1a1a1a1', server, 1_000);
  const b = device('b2b2b2b2', server, 1_000);
  a.write('item-3', { text: 'ซื้อนม', deleted_at: null });
  a.push(); b.pull();
  a.setTime(2_000); a.write('item-3', { deleted_at: '2026-10-07T03:00:00.000Z' });
  b.setTime(3_000); b.write('item-3', { text: 'ซื้อนม 2 ขวด' });
  a.push(); b.push(); a.pull(); b.pull();
  assert.equal(a.get('item-3').data.deleted_at, '2026-10-07T03:00:00.000Z');
  assert.equal(a.get('item-3').data.text, 'ซื้อนม 2 ขวด');
  assert.deepEqual(a.get('item-3').data, b.get('item-3').data);
});

test('เลือก Inbox หลักเหมือนกันทุกเครื่อง', () => {
  const x = { id: 'b', data: { created_at: '2026-10-01T00:00:00.000Z' } };
  const y = { id: 'a', data: { created_at: '2026-10-02T00:00:00.000Z' } };
  const z = { id: 'c', data: { created_at: '2026-10-01T00:00:00.000Z' } };
  assert.equal(canonicalInbox([x, y, z]).id, 'b');
  assert.equal(canonicalInbox([z, y, x]).id, 'b');
});
