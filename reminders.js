/**
 * WunWun reminders — ตัวช่วยฝั่ง main process (ไม่แตะ Electron จึงเทสต์ด้วย node ได้)
 *
 * ข้อมูลเตือนอยู่ใน HTML ของโน้ตเอง บน checklist item:
 *   <div class="check-item" data-id="…" data-remind-at="ISO" data-repeat="daily|weekdays|weekly|monthly">
 * จึงไม่มีตารางเตือนแยกที่ต้องคอยซิงก์ให้ตรงกับโน้ต ลบงาน = ลบการเตือนไปด้วย
 */

const ITEM_OPEN_RE = /<div\b[^>]*\bclass="[^"]*\bcheck-item\b[^"]*"[^>]*>/g;
const INBOX_HEAD =
  '<div class="inbox-head">Inbox · จดด่วน</div>' +
  '<div class="inbox-tip">กด Ctrl+Alt+Space ที่ไหนก็ได้เพื่อจดด่วน · พิมพ์ "พรุ่งนี้ 9 โมง" ท้ายงานแล้วกด Enter เพื่อตั้งเตือน</div>';

function decode(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
}

function textOf(fragment) {
  return decode(fragment.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

/** checklist item ทุกตัวที่มีเวลาเตือน */
function extractReminderItems(html) {
  const out = [];
  if (!html) return out;
  ITEM_OPEN_RE.lastIndex = 0;
  let m;
  while ((m = ITEM_OPEN_RE.exec(html))) {
    const tag = m[0];
    const id = attr(tag, 'data-id');
    const remindAt = attr(tag, 'data-remind-at');
    if (!id || !remindAt || Number.isNaN(Date.parse(remindAt))) continue;
    const after = html.slice(m.index + tag.length, m.index + tag.length + 4000);
    const t = after.match(/<div\b[^>]*class="check-text"[^>]*>([\s\S]*?)<\/div>/);
    out.push({
      id,
      at: remindAt,
      repeat: attr(tag, 'data-repeat') || null,
      checked: attr(tag, 'data-checked') === 'true',
      text: t ? textOf(t[1]) : ''
    });
  }
  return out;
}

/** การเตือนที่ถึงเวลาแล้วและยังไม่เคยเด้ง (fired[id] เก็บเวลาที่เด้งไปแล้ว) */
function dueReminders(notes, fired, now = new Date()) {
  const due = [];
  for (const note of notes || []) {
    for (const item of extractReminderItems(note.contentHtml)) {
      if (item.checked) continue;
      if (new Date(item.at) > now) continue;
      if (fired && fired[item.id] === item.at) continue;
      due.push({ ...item, noteId: note.id, noteTitle: note.title || '' });
    }
  }
  return due.sort((a, b) => new Date(a.at) - new Date(b.at));
}

/** เปลี่ยนเวลาเตือนของ item หนึ่งตัวใน HTML (ใช้กับงานซ้ำตอนโน้ตไม่ได้เปิดอยู่) */
function rescheduleInHtml(html, itemId, atIso, label) {
  ITEM_OPEN_RE.lastIndex = 0;
  let m;
  while ((m = ITEM_OPEN_RE.exec(html))) {
    if (attr(m[0], 'data-id') !== itemId) continue;
    const newTag = m[0].replace(/(\sdata-remind-at=")[^"]*(")/, `$1${atIso}$2`);
    const start = m.index;
    let rest = html.slice(start + m[0].length);
    if (label != null) {
      const nextItem = rest.search(/<div\b[^>]*\bclass="[^"]*\bcheck-item\b/);
      const scope = nextItem === -1 ? rest : rest.slice(0, nextItem);
      const patched = scope.replace(
        /(<span\b[^>]*class="when-chip[^"]*"[^>]*>)[\s\S]*?(<\/span>)/,
        `$1${escapeHtml(label)}$2`
      );
      rest = patched + (nextItem === -1 ? '' : rest.slice(nextItem));
    }
    return html.slice(0, start) + newTag + rest;
  }
  return html;
}

/** HTML ของ checklist item แบบเดียวกับที่ note.js สร้าง */
function buildItemHtml({ id, text, source, at, repeat, hasTime, label }) {
  const attrs = [
    'class="check-item"',
    'data-checked="false"',
    'data-depth="0"',
    'data-priority="medium"',
    'data-starred="false"',
    'draggable="true"',
    `data-id="${escapeHtml(id)}"`
  ];
  if (at) {
    attrs.push(`data-remind-at="${escapeHtml(at)}"`);
    attrs.push(`data-has-time="${hasTime ? 'true' : 'false'}"`);
    if (repeat) attrs.push(`data-repeat="${escapeHtml(repeat)}"`);
    // ข้อความเดิมก่อนตัดคำบอกเวลา: ลบการเตือนแล้วได้ข้อความคืน
    if (source) attrs.push(`data-when-source="${escapeHtml(source)}"`);
  }
  const chip = at ? `<span class="when-chip" contenteditable="false">${escapeHtml(label || '')}</span>` : '';
  return (
    `<div ${attrs.join(' ')} style="--depth: 0;">` +
    '<button type="button" class="star-btn">☆</button>' +
    '<span class="priority-dot"></span>' +
    '<input type="checkbox">' +
    `<div class="check-text" contenteditable="true">${escapeHtml(text)}</div>` +
    chip +
    '</div>'
  );
}

/** แทรกรายการใหม่ไว้บนสุดของ Inbox (ใต้หัวและคำแนะนำ) */
function insertAfterHead(html, itemHtml) {
  const src = html || INBOX_HEAD;
  for (const cls of ['inbox-tip', 'inbox-head']) {
    const re = new RegExp(`<div\\b[^>]*class="${cls}"[^>]*>[\\s\\S]*?</div>`);
    const m = src.match(re);
    if (m) {
      const end = m.index + m[0].length;
      return src.slice(0, end) + itemHtml + src.slice(end);
    }
  }
  return itemHtml + src;
}

module.exports = {
  INBOX_HEAD,
  escapeHtml,
  extractReminderItems,
  dueReminders,
  rescheduleInHtml,
  buildItemHtml,
  insertAfterHead
};
