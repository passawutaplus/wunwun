# 10 · คุณภาพ: เทสต์ CI/CD และการปล่อยเวอร์ชัน

## 1. ระดับการทดสอบ

| ระดับ | เครื่องมือ | ครอบอะไร | รันเมื่อ |
| --- | --- | --- | --- |
| Unit | `node:test` | when-parser, marks, fractional index, HLC/merge, repos (SQLite in-memory), legacy import (fixtures), reminders scheduler (นาฬิกาปลอม) | ทุก commit |
| Server | PGlite (`docs/plan/reference/supabase-check.mjs` → ย้ายไป `tests/server/`) | migration, RLS, `push_records`, `pull_records`, `ai_consume` | PR ที่แตะ `supabase/` |
| E2E | Playwright `_electron` (experimental แต่ใช้งานได้) | flow ของผู้ใช้จริงในแอปที่รันจริง | ทุก PR (Windows runner) |
| Perf | `scripts/perf.mjs` (Playwright + `app.getAppMetrics()`) | งบใน `05-architecture.md §12` | ก่อน release |
| ด้วยมือ | checklist §5 | สิ่งที่อัตโนมัติไม่ได้ (tray, toast, รีบูต, หลายจอ) | ก่อน release |

### 1.1 ต้องมีเทสต์ (ไม่มี = ไม่ merge)
- ทุกการเปลี่ยน `when-parser`, `marks`, sync, migration, legacy import
- ทุกบั๊กที่แก้: เขียนเทสต์ที่ fail ก่อนแก้

### 1.2 ช่องทางสำหรับ e2e (เปิดเฉพาะ `!app.isPackaged && WUNWUN_E2E === '1'`)
- `WUNWUN_USER_DATA=<tmp>` — แยกข้อมูลแต่ละเทสต์
- `globalThis.__wunwunTest = { showCapture, toggleNotes, tickReminders, now }` — เรียกจาก `electronApp.evaluate` แทนการกดคีย์ลัดจริง
- `WUNWUN_REMINDER_TICK_MS=500` — scheduler เร็วขึ้นในเทสต์

### 1.3 สถานการณ์ e2e ขั้นต่ำ
1. เปิดครั้งแรก → Hub แท็บ Inbox มี 3 รายการสอนใช้
2. จดด่วน "ส่ง artwork วันศุกร์ 10 โมง" → Inbox มีงานพร้อมป้าย `ศ. … 10:00`
3. Editor: Enter, Tab/Shift+Tab, Backspace รวมบรรทัด, Ctrl+Enter, Alt+↑↓, วางข้อความ 5 บรรทัด → 5 รายการ
4. พิมพ์ไทยยาว 500 ตัวอักษร + สระ/วรรณยุกต์ซ้อน → ข้อความใน DB ตรงทุกตัว
5. ตั้งเตือนอีก 2 วินาที → popup ขึ้น → กด "10 นาที" → `snoozed_until` ถูกต้อง
6. ปิดแอปแล้วเปิดใหม่ (userData เดิม) → โน้ตที่เปิดกลับมาตำแหน่งเดิม
7. นำเข้า fixtures v1.0/v1.1 → จำนวนโน้ต/รายการ/รูป/เตือนตรง
8. ทำ DB เสีย → เปิดแอป → กู้จากสำรอง + แจ้ง
9. ค้น "ค่าไฟ" → เจอ "จ่ายค่าไฟเดือนนี้"
10. ย่อโน้ต → แถวใน dock + จำนวนงาน → คลิก → โน้ตกลับมา
11. ส่ง IPC ผิดรูปแบบจาก renderer → ถูกปฏิเสธ (เทสต์ความปลอดภัย)

## 2. คำสั่ง (package.json)

```json
{
  "scripts": {
    "start": "electron .",
    "test": "node --test \"tests/unit/**/*.test.js\"",
    "test:server": "node tests/server/supabase-check.mjs supabase/migrations",
    "test:e2e": "playwright test",
    "typecheck": "tsc -p jsconfig.json",
    "perf": "node scripts/perf.mjs",
    "dist": "electron-builder --win",
    "release": "electron-builder --win --publish always"
  }
}
```

```json
// jsconfig.json — ตรวจ JSDoc ไม่สร้างไฟล์
{
  "compilerOptions": {
    "checkJs": true, "allowJs": true, "noEmit": true, "strict": false, "noImplicitAny": false,
    "module": "nodenext", "moduleResolution": "nodenext", "target": "es2023",
    "lib": ["es2023", "dom"], "types": ["node"]
  },
  "include": ["src/**/*.js", "src/**/*.cjs", "tests/**/*.js"]
}
```

## 3. CI (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: ci
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  app:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4        # ปักด้วย commit SHA ตอนสร้างไฟล์จริง
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run test:e2e
      - run: npm audit --omit=dev --audit-level=high
  server:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run test:server
```

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm test
      - run: npm run release            # สร้าง draft release พร้อม exe + latest.yml + blockmap
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      # ขั้นเซ็นโค้ด: ใส่ตามผู้ให้บริการที่ได้ (SignPath / cloud HSM) ก่อน publish — ดู 09-security.md §5
```

## 4. ปล่อยเวอร์ชัน

1. เปลี่ยนเวอร์ชันตาม semver (`npm version minor`) และเขียน `CHANGELOG.md` (ภาษาไทย ผู้ใช้อ่านเข้าใจ)
2. push tag `vX.Y.Z` → CI สร้าง **draft** release
3. ดาวน์โหลดตัวติดตั้งจาก draft → ทดสอบบน Windows VM สะอาด (checklist §5)
4. publish release → electron-updater ของผู้ใช้เห็นภายใน 6 ชม.
5. อัปเดตหน้า changelog บนเว็บ
6. บั๊ก `data-loss` หลังปล่อย → hotfix ภายใน 48 ชม. และหยุด release ถัดไปจนแก้เสร็จ

ช่อง beta: tag `vX.Y.Z-beta.N` → prerelease; ผู้ใช้ที่เปิด "รับเวอร์ชันทดลอง" ใน Settings เท่านั้นที่ได้

## 5. Checklist ด้วยมือบน Windows (ก่อน release)

**ติดตั้ง/อัปเกรด**
- [ ] ติดตั้งใหม่บน Windows 11 และ 10 (VM สะอาด); ไอคอน Start menu ถูกต้อง
- [ ] อัปเกรดจาก v1.1.0 พร้อมข้อมูลจริง → ข้อมูลครบ, `legacy/` มีไฟล์เดิม
- [ ] ถอนการติดตั้ง → ข้อมูลใน `%APPDATA%\WunWun` ยังอยู่ (ติดตั้งใหม่แล้วได้คืน)

**ระบบ**
- [ ] ไอคอน tray คมที่ scale 100/125/150%
- [ ] การแจ้งเตือน Windows ขึ้นชื่อ "WunWun" + ไอคอน, คลิกแล้วเปิดโน้ต
- [ ] รีบูต → แอปเปิดเองแบบซ่อน, โน้ตกลับมา, เตือนทำงาน
- [ ] sleep 10 นาทีข้ามเวลาเตือน → ตื่นแล้วเด้งภายใน 30 วินาที
- [ ] แอปอื่นจองคีย์ `Ctrl+Alt+Space` ไว้ก่อน → WunWun แจ้งและให้เลือกคีย์ใหม่
- [ ] 2 จอ scale ต่างกัน; ถอดจอที่มีโน้ต → โน้ตย้ายมาจอหลัก
- [ ] portable exe จาก USB → ข้อมูลอยู่ใน `WunWunData\` ข้าง exe

**ภาษาไทย**
- [ ] พิมพ์ไทยแป้นเกษมณีในแถบจดด่วนและโน้ต, สลับภาษาด้วยปุ่ม ~ ระหว่างพิมพ์
- [ ] ข้อความไทยยาว ตัดบรรทัดถูก ไม่มีสระลอยหลุดกรอบ
- [ ] ป้ายเวลา/วันที่แสดงแบบไทย

**ออฟไลน์/ซิงก์ (เมื่อมี Phase 3)**
- [ ] ปิดเน็ตใช้งานครบทุกฟีเจอร์
- [ ] 2 เครื่อง: แก้พร้อมกันตอนออฟไลน์ → เปิดเน็ต → ตรงกันทั้งสองเครื่อง
- [ ] ออกจากระบบแบบเก็บข้อมูล / ลบข้อมูล ทำงานตามที่เลือก

**การเข้าถึง**
- [ ] ใช้ทั้งแอปด้วยคีย์บอร์ดอย่างเดียวได้
- [ ] Narrator อ่านชื่อปุ่มหลักเป็นภาษาไทย

## 6. Definition of Done (ทุกงาน)

- [ ] ทำตามเกณฑ์รับงาน (AC) ใน `04-features.md` ครบ
- [ ] เทสต์เพิ่ม/แก้แล้ว และ `npm test`, `npm run typecheck`, `npm run test:e2e` ผ่าน
- [ ] ไม่มี error ใน console ของ main และ renderer ระหว่าง e2e
- [ ] ข้อความ UI อยู่ใน `i18n/th.js` (+ `en.js`)
- [ ] IPC ใหม่ผ่าน router + validator และอยู่ในตาราง `05-architecture.md §6.3`
- [ ] ไม่เพิ่ม dependency นอกรายการที่อนุญาต
- [ ] ถ้าพฤติกรรมเปลี่ยน: อัปเดตเอกสารใน `docs/plan/` และ `CHANGELOG.md`
- [ ] งบประสิทธิภาพไม่แย่ลง (สำหรับงานที่แตะ startup, editor, search)

## 7. ป้ายบน GitHub issues

`data-loss` (เร่งด่วนที่สุด) · `crash` · `sync` · `reminder` · `editor` · `thai-input` · `ui` · `security` (แจ้งแบบส่วนตัวผ่าน GitHub Security Advisories)
