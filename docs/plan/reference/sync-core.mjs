// WunWun · แกนของการซิงก์ (อ้างอิงสำหรับ src/main/services/sync/{hlc,merge}.js)
// - Hybrid Logical Clock: เรียงเหตุการณ์ข้ามเครื่องได้แม้นาฬิกาเครื่องเพี้ยนเล็กน้อย
// - mergeRecord: last-writer-wins ทีละ field (ไม่ใช่ทั้งแถว) → แก้คนละ field บนคนละเครื่องไม่ทับกัน

const MAX_COUNTER = 9999;
const MAX_FORWARD_DRIFT_MS = 24 * 60 * 60 * 1000; // ไม่เชื่อนาฬิกาเครื่องอื่นที่เร็วกว่าเกิน 1 วัน

/** @typedef {{ ms: number, c: number, dev: string }} HlcParts */

export function formatHlc({ ms, c, dev }) {
  return `${String(ms).padStart(13, '0')}-${String(c).padStart(4, '0')}-${dev}`;
}

export function parseHlc(hlc) {
  const m = /^(\d{13})-(\d{4})-([0-9a-z]{8})$/.exec(hlc || '');
  if (!m) throw new Error(`bad hlc: ${hlc}`);
  return { ms: Number(m[1]), c: Number(m[2]), dev: m[3] };
}

/** สตริง HLC เปรียบเทียบตรง ๆ ได้ (ความยาวคงที่) — ฝั่ง Postgres ต้องใช้ COLLATE "C" */
export const compareHlc = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
export const maxHlc = (list) => list.reduce((m, h) => (h && (!m || h > m) ? h : m), null);

/**
 * @param {string} deviceId  uuid ของเครื่อง (ใช้ 8 ตัวแรกที่เป็น hex)
 * @param {() => number} now
 * @param {string|null} lastSaved  ค่า hlc ล่าสุดที่เก็บใน meta.hlc_last (กันย้อนเวลาหลังรีสตาร์ต)
 */
export function createClock(deviceId, now = () => Date.now(), lastSaved = null) {
  const dev = deviceId.replace(/[^0-9a-z]/gi, '').slice(0, 8).toLowerCase().padEnd(8, '0');
  let last = lastSaved ? parseHlc(lastSaved) : { ms: 0, c: 0, dev };
  last = { ...last, dev };

  function bump(ms, c) {
    if (c > MAX_COUNTER) { ms += 1; c = 0; } // เกิน counter: ขยับมิลลิวินาทีแทน
    last = { ms, c, dev };
    return formatHlc(last);
  }

  return {
    /** เรียกทุกครั้งที่เครื่องนี้เขียนข้อมูล */
    tick() {
      const t = now();
      return t > last.ms ? bump(t, 0) : bump(last.ms, last.c + 1);
    },
    /** เรียกเมื่อได้ข้อมูลจากเครื่องอื่น เพื่อให้การเขียนครั้งถัดไปใหม่กว่าเสมอ */
    receive(remoteHlc) {
      const r = parseHlc(remoteHlc);
      const t = now();
      const rms = Math.min(r.ms, t + MAX_FORWARD_DRIFT_MS);
      const ms = Math.max(t, last.ms, rms);
      let c;
      if (ms === last.ms && ms === rms) c = Math.max(last.c, r.c) + 1;
      else if (ms === last.ms) c = last.c + 1;
      else if (ms === rms) c = r.c + 1;
      else c = 0;
      return bump(ms, c);
    },
    current: () => formatHlc(last)
  };
}

/**
 * รวมแถวจากเครื่องอื่นเข้ากับแถวในเครื่อง ทีละ field
 * @param {{id:string, data:Record<string,any>, fieldHlc:Record<string,string>}|null} local
 * @param {{id:string, data:Record<string,any>, fieldHlc:Record<string,string>}} remote
 * @returns {{id:string, data:Record<string,any>, fieldHlc:Record<string,string>, hlc:string, changed:boolean, localAhead:boolean}}
 *   changed = มีอะไรจาก remote ถูกนำมาใช้; localAhead = ยังมี field ในเครื่องที่ใหม่กว่า (ต้อง push ต่อ)
 */
export function mergeRecord(local, remote) {
  if (!local) {
    return { id: remote.id, data: { ...remote.data }, fieldHlc: { ...remote.fieldHlc },
      hlc: maxHlc(Object.values(remote.fieldHlc)), changed: true, localAhead: false };
  }
  const data = { ...local.data };
  const fieldHlc = { ...local.fieldHlc };
  let changed = false;
  for (const [field, h] of Object.entries(remote.fieldHlc)) {
    if (!fieldHlc[field] || compareHlc(h, fieldHlc[field]) > 0) {
      data[field] = remote.data[field] ?? null;
      fieldHlc[field] = h;
      changed = true;
    }
  }
  const localAhead = Object.entries(fieldHlc).some(([f, h]) => !remote.fieldHlc[f] || compareHlc(h, remote.fieldHlc[f]) > 0);
  return { id: local.id, data, fieldHlc, hlc: maxHlc(Object.values(fieldHlc)), changed, localAhead };
}

/** เขียนแถวในเครื่อง: ทุก field ที่เปลี่ยนได้ hlc ใหม่ */
export function applyLocalPatch(record, patch, clock) {
  const h = clock.tick();
  const data = { ...(record?.data || {}), ...patch };
  const fieldHlc = { ...(record?.fieldHlc || {}) };
  for (const k of Object.keys(patch)) fieldHlc[k] = h;
  return { id: record?.id, data, fieldHlc, hlc: h, dirty: true };
}

/** Inbox หลักต้องเลือกเหมือนกันทุกเครื่อง: สร้างก่อนสุด, เสมอกันใช้ id น้อยกว่า */
export function canonicalInbox(inboxes) {
  return [...inboxes].sort((a, b) =>
    a.data.created_at === b.data.created_at ? (a.id < b.id ? -1 : 1) : a.data.created_at < b.data.created_at ? -1 : 1
  )[0];
}
