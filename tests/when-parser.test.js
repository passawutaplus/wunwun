// รัน: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWhen, formatWhen, nextOccurrence, classify } = require('../when-parser');

// "ตอนนี้" ในเทสต์ = พุธ 7 ต.ค. 2026 10:00 (เวลาเครื่อง)
const NOW = new Date(2026, 9, 7, 10, 0);
const at = (y, mo, d, h = 9, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();

const cases = [
  // [ข้อความ, ข้อความที่เหลือ, เวลาเตือน, งานซ้ำ]
  ['ส่ง artwork ให้ลูกค้าวันศุกร์', 'ส่ง artwork ให้ลูกค้า', at(2026, 10, 9), null],
  ['ส่ง artwork ให้ลูกค้าวันศุกร์ 10 โมง', 'ส่ง artwork ให้ลูกค้า', at(2026, 10, 9, 10), null],
  ['ทุกวัน 9 โมงเช้าเช็ก order', 'เช็ก order', at(2026, 10, 8, 9), 'daily'],
  ['พรุ่งนี้ 10:00 โทรหา supplier', 'โทรหา supplier', at(2026, 10, 8, 10), null],
  ['บ่ายสองประชุมทีม', 'ประชุมทีม', at(2026, 10, 7, 14), null],
  ['ประชุม บ่าย 3 โมงครึ่ง', 'ประชุม', at(2026, 10, 7, 15, 30), null],
  ['พรุ่งนี้บ่าย 2 นัดหมอ', 'นัดหมอ', at(2026, 10, 8, 14), null],
  ['พรุ่งนี้เช้าไปธนาคาร', 'ไปธนาคาร', at(2026, 10, 8, 9), null],
  ['พรุ่งนี้เช้า 10 โมง ไปธนาคาร', 'ไปธนาคาร', at(2026, 10, 8, 10), null],
  ['2 ทุ่ม ดูบอล', 'ดูบอล', at(2026, 10, 7, 20), null],
  ['ตี 5 ตื่นไปวิ่ง', 'ตื่นไปวิ่ง', at(2026, 10, 8, 5), null],
  ['4 โมงเย็นรับลูก', 'รับลูก', at(2026, 10, 7, 16), null],
  ['สิบเอ็ดโมงโทรหาแม่', 'โทรหาแม่', at(2026, 10, 7, 11), null],
  ['คืนนี้ทำสไลด์', 'ทำสไลด์', at(2026, 10, 7, 20), null],
  ['เที่ยงคืนส่งงาน', 'ส่งงาน', at(2026, 10, 8, 0), null],
  ['จ่ายค่าเน็ต 12/10', 'จ่ายค่าเน็ต', at(2026, 10, 12), null],
  ['ต่อภาษีรถ 15 ม.ค.', 'ต่อภาษีรถ', at(2027, 1, 15), null],
  ['ส่งรายงาน 25 ตุลาคม 2569', 'ส่งรายงาน', at(2026, 10, 25), null],
  ['อีก 3 วันส่งของ', 'ส่งของ', at(2026, 10, 10), null],
  ['ประชุมวันจันทร์หน้า', 'ประชุม', at(2026, 10, 12), null],
  ['ส่งแบบศุกร์หน้า', 'ส่งแบบ', at(2026, 10, 16), null],
  ['ส่งแบบศุกร์นี้', 'ส่งแบบ', at(2026, 10, 9), null],
  ['อาทิตย์หน้าเริ่มคอร์ส', 'เริ่มคอร์ส', at(2026, 10, 12), null],
  ['ไปเที่ยววันอาทิตย์หน้า', 'ไปเที่ยว', at(2026, 10, 18), null],
  ['ส่งงานก่อนวันศุกร์', 'ส่งงาน', at(2026, 10, 9), null],
  ['ทุกวันจันทร์ 9 โมง ประชุม', 'ประชุม', at(2026, 10, 12, 9), 'weekly'],
  ['ทุกวันทำงาน 8 โมงครึ่ง เช็กอีเมล', 'เช็กอีเมล', at(2026, 10, 8, 8, 30), 'weekdays'],
  ['ทุกวันที่ 5 จ่ายค่าห้อง', 'จ่ายค่าห้อง', at(2026, 11, 5), 'monthly'],
  ['tomorrow 5pm call mom', 'call mom', at(2026, 10, 8, 17), null],
  ['send invoice next friday at 14:30', 'send invoice', at(2026, 10, 16, 14, 30), null]
];

for (const [input, text, when, repeat] of cases) {
  test(input, () => {
    const r = parseWhen(input, NOW);
    assert.equal(r.text, text);
    assert.equal(r.at, when);
    assert.equal(r.repeat, repeat);
  });
}

test('อีก 30 นาที นับจากตอนนี้', () => {
  const r = parseWhen('อีก 30 นาที โทรกลับ', NOW);
  assert.equal(r.text, 'โทรกลับ');
  assert.equal(r.at, new Date(NOW.getTime() + 30 * 60e3).toISOString());
});

test('ไม่มีวันเวลา = ไม่ตั้งเตือน', () => {
  for (const s of ['ซื้อ filament เพิ่ม', 'ดูพระจันทร์', 'สีนี้สวย เอาไว้เป็น reference งาน WP', 'ไปห้างกับเพื่อน']) {
    assert.equal(parseWhen(s, NOW).at, null, s);
  }
});

test('เดาประเภทสิ่งที่จด', () => {
  assert.equal(classify('ซื้อ filament เพิ่ม'), 'task');
  assert.equal(classify('สีนี้สวย เอาไว้เป็น reference งาน WP'), 'idea');
  assert.equal(classify('https://example.com'), 'link');
  assert.equal(classify('ไอเดียสินค้าใหม่'), 'idea');
  assert.equal(classify('ส่ง reference ให้ลูกค้า'), 'task');
  const p = parseWhen('ประชุมพรุ่งนี้', NOW);
  assert.equal(classify('ประชุมพรุ่งนี้', p), 'task');
});

test('งานซ้ำครั้งถัดไป', () => {
  assert.equal(nextOccurrence(at(2026, 10, 7, 9), 'daily', NOW).toISOString(), at(2026, 10, 8, 9));
  // ศุกร์ 9 ต.ค. → จันทร์ 12 ต.ค. (ข้ามเสาร์อาทิตย์)
  assert.equal(nextOccurrence(at(2026, 10, 9, 9), 'weekdays', new Date(2026, 9, 9, 10)).toISOString(), at(2026, 10, 12, 9));
  // 31 ม.ค. ทุกเดือน → 28 ก.พ.
  assert.equal(nextOccurrence(at(2027, 1, 31, 9), 'monthly', new Date(2027, 0, 31, 10)).toISOString(), at(2027, 2, 28, 9));
});

test('ป้ายเวลาภาษาไทย', () => {
  assert.equal(formatWhen(at(2026, 10, 7, 14), null, NOW), 'วันนี้ 14:00');
  assert.equal(formatWhen(at(2026, 10, 8, 9), null, NOW), 'พรุ่งนี้ 09:00');
  assert.equal(formatWhen(at(2026, 10, 9, 10), null, NOW), 'ศ. 9 ต.ค. 10:00');
  assert.equal(formatWhen(at(2026, 10, 12, 9), 'weekly', NOW), 'ทุกวันจันทร์ 09:00');
  assert.equal(formatWhen(at(2027, 1, 15), null, NOW), 'ศ. 15 ม.ค. 70 09:00');
});
