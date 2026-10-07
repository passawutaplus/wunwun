const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../reminders');

const past = '2026-10-07T02:00:00.000Z';
const future = '2026-10-09T02:00:00.000Z';
const NOW = new Date('2026-10-07T03:00:00.000Z');

const item = (id, at, extra = {}) =>
  R.buildItemHtml({ id, text: extra.text || `งาน ${id}`, at, repeat: extra.repeat, hasTime: true, label: 'วันนี้ 09:00' });

test('ดึงการเตือนจาก HTML ของโน้ต', () => {
  const html = R.INBOX_HEAD + item('a', past) + item('b', future, { repeat: 'daily' }) + item('c', null);
  const items = R.extractReminderItems(html);
  assert.deepEqual(
    items.map((i) => [i.id, i.at, i.repeat, i.text]),
    [
      ['a', past, null, 'งาน a'],
      ['b', future, 'daily', 'งาน b']
    ]
  );
});

test('เด้งเฉพาะงานที่ถึงเวลา ยังไม่ติ๊ก และยังไม่เคยเด้ง', () => {
  const done = item('d', past).replace('data-checked="false"', 'data-checked="true"');
  const notes = [{ id: 'n1', title: 'Inbox', contentHtml: item('a', past) + item('b', future) + done + item('e', past) }];
  const due = R.dueReminders(notes, { e: past }, NOW);
  assert.deepEqual(due.map((d) => d.id), ['a']);
  assert.equal(due[0].noteId, 'n1');
});

test('เลื่อนงานซ้ำโดยแก้เฉพาะ item ตัวนั้น', () => {
  const html = item('a', past, { repeat: 'daily' }) + item('b', past);
  const next = '2026-10-08T02:00:00.000Z';
  const out = R.rescheduleInHtml(html, 'a', next, 'พรุ่งนี้ 09:00');
  const items = R.extractReminderItems(out);
  assert.equal(items.find((i) => i.id === 'a').at, next);
  assert.equal(items.find((i) => i.id === 'b').at, past);
  assert.match(out, /พรุ่งนี้ 09:00<\/span>/);
  assert.equal((out.match(/พรุ่งนี้ 09:00/g) || []).length, 1);
});

test('ข้อความที่จดถูก escape และแทรกไว้ใต้หัว Inbox', () => {
  const out = R.insertAfterHead(R.INBOX_HEAD, R.buildItemHtml({ id: 'x', text: '<b>ซื้อ</b> & "ส่ง"', at: null }));
  assert.ok(out.indexOf('inbox-tip') < out.indexOf('data-id="x"'));
  assert.match(out, /&lt;b&gt;ซื้อ&lt;\/b&gt; &amp; &quot;ส่ง&quot;/);
  assert.equal(R.extractReminderItems(out).length, 0);
});
