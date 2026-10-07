/**
 * WunWun when-parser
 * อ่านวันเวลาภาษาไทย/อังกฤษจากข้อความงาน แล้วคืนเวลาเตือน + ข้อความที่ตัดวันเวลาออกแล้ว
 *   parseWhen('ส่ง artwork ให้ลูกค้าวันศุกร์ 10 โมง')
 *   → { text: 'ส่ง artwork ให้ลูกค้า', at: '2026-10-09T03:00:00.000Z', hasTime: true, repeat: null }
 *
 * ทำงานในเครื่องล้วน ๆ ไม่ใช้ AI ไม่ใช้เน็ต
 * ใช้ได้ทั้ง main process (require) และหน้าต่าง (<script src="when-parser.js"> → window.WunWhen)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WunWhen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 864e5;
  const MARK = '\u0000';

  // ---------- คำศัพท์ ----------
  const NUM_WORDS = {
    หนึ่ง: 1, นึง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6,
    เจ็ด: 7, แปด: 8, เก้า: 9, สิบ: 10, สิบเอ็ด: 11, สิบสอง: 12
  };
  const NW = 'สิบเอ็ด|สิบสอง|สิบ|หนึ่ง|นึง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า';
  const NUM = `(\\d{1,2}|${NW})`;

  const TH_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const TH_DAY_RE = '(อาทิตย์|จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์)';
  // ชื่อที่เป็นคำทั่วไปด้วย (พระจันทร์, อาทิตย์ = ดวงอาทิตย์/สัปดาห์) ต้องมี "วัน" นำหน้า หรือ "นี้/หน้า" ตามหลัง
  const AMBIGUOUS_DAYS = new Set(['อาทิตย์', 'จันทร์', 'อังคาร']);

  const EN_DAYS = {
    sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2,
    wednesday: 3, wed: 3, thursday: 4, thurs: 4, thur: 4, thu: 4,
    friday: 5, fri: 5, saturday: 6, sat: 6
  };
  const EN_DAY_RE = '(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)';

  const TH_MONTHS = [
    ['มกราคม', 'มกรา', 'ม.ค.', 'มค'],
    ['กุมภาพันธ์', 'กุมภา', 'ก.พ.', 'กพ'],
    ['มีนาคม', 'มีนา', 'มี.ค.', 'มีค'],
    ['เมษายน', 'เมษา', 'เม.ย.', 'เมย'],
    ['พฤษภาคม', 'พฤษภา', 'พ.ค.', 'พค'],
    ['มิถุนายน', 'มิถุนา', 'มิ.ย.', 'มิย'],
    ['กรกฎาคม', 'กรกฎา', 'ก.ค.', 'กค'],
    ['สิงหาคม', 'สิงหา', 'ส.ค.', 'สค'],
    ['กันยายน', 'กันยา', 'ก.ย.', 'กย'],
    ['ตุลาคม', 'ตุลา', 'ต.ค.', 'ตค'],
    ['พฤศจิกายน', 'พฤศจิกา', 'พ.ย.', 'พย'],
    ['ธันวาคม', 'ธันวา', 'ธ.ค.', 'ธค']
  ];
  const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const MONTH_LOOKUP = new Map();
  TH_MONTHS.forEach((names, i) => names.forEach((n) => MONTH_LOOKUP.set(n, i)));
  EN_MONTHS.forEach((n, i) => MONTH_LOOKUP.set(n, i));
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const MONTH_RE = `(${[...MONTH_LOOKUP.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|')})`;

  const PERIODS = { เช้า: [9, 0], สาย: [10, 0], เที่ยง: [12, 0], บ่าย: [13, 0], เย็น: [18, 0], ค่ำ: [19, 0], คืน: [20, 0], ดึก: [22, 0] };
  const EN_PERIODS = { morning: [9, 0], afternoon: [13, 0], evening: [18, 0], tonight: [20, 0] };

  const TH_DOW_SHORT = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  const TH_MON_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  // ---------- วันที่ ----------
  const num = (s) => (s == null ? null : /^\d+$/.test(s) ? Number(s) : NUM_WORDS[s] ?? null);
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();

  function addMonthsClamped(d, n, dayOfMonth) {
    const x = new Date(d);
    const want = dayOfMonth || x.getDate();
    x.setDate(1);
    x.setMonth(x.getMonth() + n);
    x.setDate(Math.min(want, daysInMonth(x.getFullYear(), x.getMonth())));
    return x;
  }

  function nextMonday(base) {
    let diff = (8 - base.getDay()) % 7;
    if (diff === 0) diff = 7;
    return addDays(base, diff);
  }

  // วันในสัปดาห์ถัดไป (รวมวันนี้) หรือของสัปดาห์หน้า (สัปดาห์เริ่มวันจันทร์)
  function dayOfWeek(base, dow, nextWeek) {
    if (nextWeek) return addDays(nextMonday(base), (dow + 6) % 7);
    return addDays(base, (dow - base.getDay() + 7) % 7);
  }

  function normalizeYear(y) {
    if (y == null) return null;
    let n = Number(y);
    if (n < 100) n = n > 50 ? 2500 + n : 2000 + n; // 69 → 2569 (พ.ศ.), 27 → 2027
    if (n > 2400) n -= 543; // พ.ศ. → ค.ศ.
    return n;
  }

  /** เวลาครั้งถัดไปของงานซ้ำ ที่อยู่หลัง `after` */
  function nextOccurrence(at, repeat, after) {
    const limit = after ? new Date(after) : new Date();
    let d = new Date(at);
    const dom = d.getDate();
    for (let i = 0; i < 2000 && d <= limit; i++) {
      if (repeat === 'daily') d = addDays(d, 1);
      else if (repeat === 'weekly') d = addDays(d, 7);
      else if (repeat === 'monthly') d = addMonthsClamped(d, 1, dom);
      else if (repeat === 'weekdays') {
        d = addDays(d, 1);
        while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
      } else return null;
    }
    return d;
  }

  // ---------- ตัวอ่าน ----------
  function parseWhen(input, nowArg) {
    const now = nowArg ? new Date(nowArg) : new Date();
    const source = String(input || '');
    let text = ` ${source} `;
    const f = {
      repeat: null, dayOffset: null, date: null, yearGiven: false, monthDay: null,
      dow: null, nextWeek: false, time: null, period: null, deltaMs: null
    };

    // แทนที่ส่วนที่อ่านได้ด้วย MARK; ถ้า fn คืน false = ไม่นับ match นี้
    const take = (re, fn) => {
      let hit = false;
      text = text.replace(re, (...args) => {
        if (hit) return args[0];
        const ok = fn(...args);
        if (ok === false) return args[0];
        hit = true;
        return MARK;
      });
      return hit;
    };
    const setTime = (h, m) => {
      if (f.time || h == null || h > 23 || m > 59) return false;
      f.time = [h, m || 0];
      return true;
    };

    // 1) งานซ้ำ
    take(/ทุก\s*(?:วันทำงาน|วันธรรมดา)|(?:วัน)?จันทร์\s*(?:-|–|ถึง)\s*(?:วัน)?ศุกร์|every\s+weekday|weekdays/i, () => {
      f.repeat = 'weekdays';
    });
    if (!f.repeat) {
      take(new RegExp(`ทุก\\s*(วัน)?${TH_DAY_RE}`), (_m, wan, day) => {
        if (day === 'อาทิตย์' && !wan) return false; // "ทุกอาทิตย์" = ทุกสัปดาห์
        f.repeat = 'weekly';
        f.dow = TH_DAYS.indexOf(day === 'พฤหัส' ? 'พฤหัสบดี' : day);
      });
    }
    if (!f.repeat) {
      take(new RegExp(`\\bevery\\s+${EN_DAY_RE}\\b`, 'i'), (_m, day) => {
        f.repeat = 'weekly';
        f.dow = EN_DAYS[day.toLowerCase()];
      });
    }
    if (!f.repeat) {
      take(/ทุก\s*วันที่\s*(\d{1,2})(?!\d)/, (_m, d) => {
        const n = Number(d);
        if (n < 1 || n > 31) return false;
        f.repeat = 'monthly';
        f.monthDay = n;
      });
    }
    if (!f.repeat) {
      take(/ทุก\s*(เช้า|เย็น|ค่ำ|คืน)/, (_m, p) => {
        f.repeat = 'daily';
        f.period = PERIODS[p];
      });
    }
    if (!f.repeat) take(/ทุก\s*วัน(?!ที่)|\bevery\s*day\b|\bdaily\b/i, () => { f.repeat = 'daily'; });
    if (!f.repeat) take(/ทุก\s*(?:สัปดาห์|อาทิตย์)|\bevery\s*week\b|\bweekly\b/i, () => { f.repeat = 'weekly'; });
    if (!f.repeat) take(/ทุก\s*เดือน|\bevery\s*month\b|\bmonthly\b/i, () => { f.repeat = 'monthly'; });

    // 2) อีก X นาที/ชั่วโมง/วัน
    take(new RegExp(`(?:ใน)?อีก\\s*(\\d+|${NW}|ครึ่ง)\\s*(นาที|ชั่วโมง|ชม\\.?|วัน|สัปดาห์|อาทิตย์|เดือน)`), (_m, n, unit) => {
      const v = n === 'ครึ่ง' ? 0.5 : num(n);
      if (v == null) return false;
      if (unit === 'นาที') f.deltaMs = v * 6e4;
      else if (unit.startsWith('ชั่วโมง') || unit.startsWith('ชม')) f.deltaMs = v * 36e5;
      else if (unit === 'วัน') f.dayOffset = Math.round(v);
      else if (unit === 'เดือน') f.date = addMonthsClamped(startOfDay(now), Math.round(v));
      else f.dayOffset = Math.round(v * 7);
    });
    take(/\bin\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|h|days?|weeks?)\b/i, (_m, n, unit) => {
      const v = Number(n);
      const u = unit.toLowerCase();
      if (u.startsWith('m')) f.deltaMs = v * 6e4;
      else if (u.startsWith('h')) f.deltaMs = v * 36e5;
      else if (u.startsWith('d')) f.dayOffset = v;
      else f.dayOffset = v * 7;
    });

    // 3) วันที่แบบระบุ
    if (!f.date && f.dayOffset == null) {
      take(/(?<![\d:.\/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d\/])/, (_m, d, mo, y) => {
        const dd = Number(d), mm = Number(mo) - 1;
        if (dd < 1 || dd > 31 || mm < 0 || mm > 11) return false;
        const year = normalizeYear(y) ?? now.getFullYear();
        f.date = new Date(year, mm, Math.min(dd, daysInMonth(year, mm)));
        f.yearGiven = y != null;
      });
    }
    if (!f.date && f.dayOffset == null) {
      take(new RegExp(`(?:วันที่\\s*)?(\\d{1,2})\\s*${MONTH_RE}(?:\\s*(\\d{4}|\\d{2})(?![\\d:.]))?`, 'i'), (_m, d, mname, y) => {
        const mm = MONTH_LOOKUP.get(mname.toLowerCase());
        const dd = Number(d);
        if (mm == null || dd < 1 || dd > 31) return false;
        const year = normalizeYear(y) ?? now.getFullYear();
        f.date = new Date(year, mm, Math.min(dd, daysInMonth(year, mm)));
        f.yearGiven = y != null;
      });
    }
    if (!f.date && f.dayOffset == null && !f.monthDay) {
      take(/วันที่\s*(\d{1,2})(?![\d\/])/, (_m, d) => {
        const n = Number(d);
        if (n < 1 || n > 31) return false;
        f.monthDay = n;
      });
    }

    // 4) คำบอกวัน
    if (!f.date && f.dayOffset == null) {
      take(
        // "พรุ่งนี้บ่าย 2" → ปล่อย "บ่าย 2" ให้ตัวอ่านเวลา
        new RegExp(`(วันนี้|คืนนี้|เย็นนี้|เช้านี้|บ่ายนี้|พรุ่งนี้|มะรืน(?:นี้)?)(เช้า|สาย|เย็น|ค่ำ|คืน|บ่าย(?!\\s*(?:\\d|${NW}|โมง)))?`),
        (_m, word, period) => {
          const offsets = { วันนี้: 0, คืนนี้: 0, เย็นนี้: 0, เช้านี้: 0, บ่ายนี้: 0, พรุ่งนี้: 1 };
          f.dayOffset = word.startsWith('มะรืน') ? 2 : offsets[word];
          const implied = { คืนนี้: 'คืน', เย็นนี้: 'เย็น', เช้านี้: 'เช้า', บ่ายนี้: 'บ่าย' }[word];
          if (period || implied) f.period = PERIODS[period || implied];
        }
      );
    }
    if (!f.date && f.dayOffset == null) {
      take(/\b(today|tonight|tomorrow|tmrw|tmr)\b/i, (_m, w) => {
        const lw = w.toLowerCase();
        f.dayOffset = lw === 'today' || lw === 'tonight' ? 0 : 1;
        if (lw === 'tonight') f.period = EN_PERIODS.tonight;
      });
    }
    if (!f.date && f.dayOffset == null && f.dow == null) {
      // วันจันทร์หน้า / ศุกร์นี้ / วันพุธ
      take(new RegExp(`(วัน)?${TH_DAY_RE}(นี้|หน้า)?`), (_m, wan, day, suffix) => {
        if (!wan && !suffix && AMBIGUOUS_DAYS.has(day)) return false;
        if (!wan && day === 'อาทิตย์' && suffix === 'หน้า') return false; // "อาทิตย์หน้า" = สัปดาห์หน้า
        f.dow = TH_DAYS.indexOf(day === 'พฤหัส' ? 'พฤหัสบดี' : day);
        f.nextWeek = suffix === 'หน้า';
      });
    }
    if (!f.date && f.dayOffset == null && f.dow == null) {
      take(/(?<!วัน)(?:สัปดาห์|อาทิตย์)หน้า|\bnext\s+week\b/i, () => {
        f.date = nextMonday(startOfDay(now));
      });
    }
    if (!f.date && f.dayOffset == null && f.dow == null) {
      take(/เดือนหน้า|\bnext\s+month\b/i, () => {
        const d = startOfDay(now);
        d.setDate(1);
        d.setMonth(d.getMonth() + 1);
        f.date = d;
      });
    }
    if (!f.date && f.dayOffset == null && f.dow == null) {
      take(new RegExp(`\\b(next\\s+|this\\s+|on\\s+)?${EN_DAY_RE}\\b`, 'i'), (_m, pre, day) => {
        f.dow = EN_DAYS[day.toLowerCase()];
        f.nextWeek = /next/i.test(pre || '');
      });
    }

    // 5) เวลา
    take(/(?<![\d\/.])(\d{1,2})[:.](\d{2})(?![\d\/])\s*(?:น\.|นาฬิกา)?/, (_m, h, m) => setTime(Number(h), Number(m)));
    take(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i, (_m, h, m, ap) => {
      let hh = Number(h) % 12;
      if (ap.toLowerCase() === 'pm') hh += 12;
      return setTime(hh, Number(m || 0));
    });
    take(/เที่ยงคืน/, () => setTime(0, 0));
    take(/เที่ยง(?:วัน|ตรง)?(ครึ่ง)?/, (_m, half) => setTime(12, half ? 30 : 0));
    take(new RegExp(`ตี\\s*${NUM}(ครึ่ง)?`), (_m, n, half) => {
      const v = num(n);
      return v >= 1 && v <= 5 ? setTime(v, half ? 30 : 0) : false;
    });
    take(/ทุ่ม(?:นึง|หนึ่ง)(ครึ่ง)?/, (_m, half) => setTime(19, half ? 30 : 0));
    take(new RegExp(`${NUM}\\s*ทุ่ม(ครึ่ง)?`), (_m, n, half) => {
      const v = num(n);
      return v >= 1 && v <= 5 ? setTime(18 + v, half ? 30 : 0) : false;
    });
    take(new RegExp(`บ่าย\\s*(?:${NUM}\\s*(?:โมง)?|โมง)\\s*(ครึ่ง)?`), (_m, n, half) => {
      const v = n == null ? 1 : num(n);
      if (v == null || v > 11) return false;
      return setTime(v === 12 ? 12 : 12 + v, half ? 30 : 0);
    });
    take(new RegExp(`${NUM}\\s*โมง\\s*(ครึ่ง)?\\s*(เช้า|เย็น|ตรง)?\\s*(ครึ่ง)?`), (_m, n, half1, part, half2) => {
      const v = num(n);
      if (v == null || v < 1 || v > 12) return false;
      let h;
      if (part === 'เช้า') h = v >= 6 ? v : v + 6; // หนึ่งโมงเช้า = 07:00
      else if (part === 'เย็น') h = v <= 6 ? v + 12 : v;
      else h = v <= 6 ? v + 12 : v; // "4 โมง" = 16:00, "10 โมง" = 10:00
      return setTime(h === 24 ? 12 : h, half1 || half2 ? 30 : 0);
    });
    take(/โมงเช้า/, () => setTime(7, 0));

    // 6) ช่วงของวัน (ถ้ายังไม่มีเวลา)
    if (!f.time && !f.period) {
      take(/ตอน(เช้า|สาย|บ่าย|เย็น|ค่ำ|ดึก|กลางคืน)|(เช้า|เย็น|ค่ำ)นี้/, (_m, a, b) => {
        f.period = PERIODS[(a || b).replace('กลาง', '')];
      });
    }
    if (!f.time && !f.period) {
      take(/\b(?:this\s+|in\s+the\s+)?(morning|afternoon|evening)\b/i, (_m, p) => {
        f.period = EN_PERIODS[p.toLowerCase()];
      });
    }

    const found =
      f.repeat || f.dayOffset != null || f.date || f.monthDay || f.dow != null ||
      f.time || f.period || f.deltaMs != null;
    const cleanText = cleanup(text);
    if (!found) return { text: source.trim(), at: null, hasTime: false, repeat: null };

    // ---------- ประกอบเวลา ----------
    let at;
    const hasTime = !!(f.time || f.period || f.deltaMs != null);
    if (f.deltaMs != null && f.dayOffset == null && !f.date) {
      at = new Date(now.getTime() + f.deltaMs);
    } else {
      const base = startOfDay(now);
      let day;
      if (f.date) day = startOfDay(f.date);
      else if (f.dayOffset != null) day = addDays(base, f.dayOffset);
      else if (f.monthDay) {
        day = new Date(base.getFullYear(), base.getMonth(), Math.min(f.monthDay, daysInMonth(base.getFullYear(), base.getMonth())));
        if (day < base) day = addMonthsClamped(day, 1, f.monthDay);
      } else if (f.dow != null) day = dayOfWeek(base, f.dow, f.nextWeek);
      else if (f.repeat === 'weekdays') {
        day = base;
        while (day.getDay() === 0 || day.getDay() === 6) day = addDays(day, 1);
      } else day = base;

      const [h, m] = f.time || f.period || [9, 0];
      at = new Date(day);
      at.setHours(h, m, 0, 0);

      const explicitDay = f.date || f.dayOffset != null || f.monthDay || f.dow != null;
      if (at <= now) {
        if (f.repeat) at = nextOccurrence(at, f.repeat, now);
        else if (!explicitDay) at = addDays(at, 1); // "10 โมง" ที่เลยไปแล้ว = พรุ่งนี้
        else if (f.dow != null && !f.nextWeek && sameDay(at, now)) at = addDays(at, 7);
        else if (f.date && !f.yearGiven && at < base) at.setFullYear(at.getFullYear() + 1);
      }
    }

    return {
      text: cleanText || source.trim(),
      at: at.toISOString(),
      hasTime,
      repeat: f.repeat
    };
  }

  function cleanup(text) {
    return text
      // คำเชื่อมที่ติดกับวันเวลา: "ส่งงานก่อนวันศุกร์" → "ส่งงาน"
      .replace(new RegExp(`(?:ตอน|เวลา|ภายใน|ก่อน|ช่วง|ใน|by|at|on|before)\\s*${MARK}`, 'gi'), MARK)
      .replace(new RegExp(MARK, 'g'), ' ')
      .replace(/\s*[,،]\s*(?=\s|$)/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,\-–:]+|[\s,\-–:]+$/g, '')
      .trim();
  }

  // ---------- แสดงผล ----------
  const pad = (n) => String(n).padStart(2, '0');

  function formatWhen(at, repeat, nowArg) {
    if (!at) return '';
    const d = new Date(at);
    const now = nowArg ? new Date(nowArg) : new Date();
    const days = Math.round((startOfDay(d) - startOfDay(now)) / DAY_MS);
    let day;
    if (repeat === 'daily') day = 'ทุกวัน';
    else if (repeat === 'weekdays') day = 'ทุกวันทำงาน';
    else if (repeat === 'weekly') day = `ทุกวัน${TH_DAYS[d.getDay()]}`;
    else if (repeat === 'monthly') day = `ทุกวันที่ ${d.getDate()}`;
    else if (days === 0) day = 'วันนี้';
    else if (days === 1) day = 'พรุ่งนี้';
    else if (days === -1) day = 'เมื่อวาน';
    else {
      day = `${TH_DOW_SHORT[d.getDay()]} ${d.getDate()} ${TH_MON_SHORT[d.getMonth()]}`;
      if (d.getFullYear() !== now.getFullYear()) day += ` ${String(d.getFullYear() + 543).slice(2)}`;
    }
    return `${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ---------- เดาประเภทของสิ่งที่จดด่วน ----------
  const URL_ONLY_RE = /^(https?:\/\/|www\.)\S+$/i;
  const TASK_START_RE = /^(ต้อง|ควร|อย่าลืม|ทำ|ส่ง|โทร|นัด|ซื้อ|แก้|ตรวจ|เช็ก|เช็ค|จ่าย|โอน|ตอบ|อ่าน|เขียน|ติดต่อ|ถาม|จอง|เตรียม|ไป|รับ|คืน|todo|fix|send|call|buy|check|pay|email|reply)/i;
  const IDEA_RE = /(ไอเดีย|idea|reference|อ้างอิง|เก็บไว้|เอาไว้|เผื่อ|น่าสนใจ|สวยดี|สวย|inspiration|note:)/i;

  /** 'task' | 'idea' | 'link' | 'empty' — เดาแบบเบา ๆ ผู้ใช้แก้ทีหลังได้ */
  function classify(input, parsed) {
    const t = String(input || '').trim();
    if (!t) return 'empty';
    if (/^[-*•]\s|^\[\s?\]/.test(t)) return 'task';
    if (/^[?~]/.test(t)) return 'idea';
    if (URL_ONLY_RE.test(t)) return 'link';
    if (parsed && (parsed.at || parsed.repeat)) return 'task';
    if (TASK_START_RE.test(t)) return 'task';
    if (IDEA_RE.test(t)) return 'idea';
    return 'task';
  }

  return { parseWhen, formatWhen, nextOccurrence, classify };
});
