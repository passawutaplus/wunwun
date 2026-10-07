# CLAUDE.md — WunWun

WunWun คือแอปโน้ตแปะ + to-do บนเดสก์ท็อป (Windows ก่อน) สำหรับคนพิมพ์ไทย:
กดคีย์เดียวจดด่วน, พิมพ์วันเวลาภาษาไทยแล้วเตือนเอง, ใช้ออฟไลน์ได้ครบ, ซิงก์หลายเครื่องเป็นของเสริม
Stack: **Electron + Vanilla JS (ESM) + SQLite ในเครื่อง + Supabase สำหรับซิงก์**

## อ่านก่อนทำงาน
- แผนทั้งหมด: `docs/plan/00-index.md` (ลำดับการอ่านอยู่ในนั้น)
- งานที่ต้องทำ: `docs/plan/11-roadmap.md` (อ้างอิงด้วยรหัส เช่น T1.5)
- เกณฑ์รับงาน: `docs/plan/04-features.md` (F-xx)
- ถ้าโค้ดกับเอกสารขัดกัน หรือเอกสารไม่ชัด: **ถามก่อน** อย่าเดา

## คำสั่ง
```bash
npm start            # รันแอป (dev)
npm test             # unit tests (node:test)
npm run typecheck    # tsc --noEmit ตรวจ JSDoc
npm run test:e2e     # Playwright _electron
npm run test:server  # migration + RLS ของ Supabase บน PGlite
npm run dist         # สร้างตัวติดตั้ง Windows
```
> ก่อน Phase 0 เสร็จ คำสั่งบางตัวยังไม่มี — สร้างตาม `docs/plan/10-quality.md §2`

## โครงย่อ
- `src/main/` เจ้าของข้อมูลคนเดียว: DB, ไฟล์, เน็ต, หน้าต่าง, คีย์ลัด, tray
- `src/preload/index.cjs` สะพานเดียว: `window.wunwun.call(channel, payload)`, `on(event, cb)`, `pathForFile(file)`
- `src/renderer/` หน้าจอ (sandbox, ไม่มี Node), โหลดผ่าน `app://wunwun/`
- `src/shared/` โค้ดที่ใช้ทั้งสองฝั่ง (when-parser, marks, format)
- รายละเอียด: `docs/plan/05-architecture.md`

## กติกา (ต้องทำตามเสมอ)
1. **Vanilla JS** — ห้ามเพิ่ม UI framework, bundler, ORM, state library; dependency ใหม่ต้องอยู่ในรายการ `05-architecture.md §10` หรือเขียน ADR ใน `docs/adr/` แล้วถามก่อน
2. **ความปลอดภัยของหน้าต่าง** — `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` ทุกหน้าต่าง (สร้างผ่าน `windows/registry.js` เท่านั้น); ห้ามโหลด `file://` หรือเนื้อหาจากเน็ตในหน้าต่างแอป
3. **IPC** — ทุก channel ผ่าน `ipc/router.js` + validator และเพิ่มในตาราง `05 §6.3`; ห้ามสร้าง channel ที่รับ path ไฟล์จาก renderer (ยกเว้น `media:importPath` จาก drop); path ที่จะเปิดต้องมาจาก DB
4. **ข้อมูล** — เขียน DB ผ่าน `db/repos/*` เท่านั้น ทุกการเขียน: tick HLC, อัปเดต `field_hlc`, `dirty = 1`, ส่ง event ผ่าน `bus`; ลบด้วย `deleted_at`; migration เพิ่มไฟล์ใหม่เท่านั้น ห้ามแก้ไฟล์เก่า
5. **ไม่มี HTML ดิบ** — ข้อความเก็บเป็น markdown-lite (`06-data-model.md §4`); renderer ใช้ `textContent`/`createElement`; ห้าม `innerHTML` กับข้อมูลผู้ใช้; ห้าม `execCommand`
6. **Local-first** — UI ห้ามรอเน็ต; renderer ไม่เรียกเน็ตเลย; ซิงก์ทำใน main เบื้องหลัง
7. **ของเฉพาะเครื่องไม่ซิงก์** — `window_state`, settings ที่ `scope = 'device'`, token, คีย์ AI
8. **ภาษาไทยมาก่อน** — ข้อความ UI อยู่ใน `src/renderer/shared/i18n/th.js` (+ `en.js`); จัดการ `event.isComposing` ก่อนตีความ Enter/Backspace; ทดสอบด้วยข้อความไทยที่มีสระบน/ล่าง
9. **ความลับ** — ห้าม commit service_role key หรือ token; token/คีย์ AI เก็บด้วย `safeStorage` ใน main เท่านั้น (anon/publishable key ของ Supabase เป็นค่าสาธารณะได้)
10. **Log** — ห้าม log เนื้อหาโน้ต อีเมล หรือ token
11. **เทสต์** — แตะ when-parser, marks, sync, migration, importer ต้องมีเทสต์; แก้บั๊กให้เริ่มจากเทสต์ที่ fail
12. **ห้ามทำข้อมูลผู้ใช้หาย** — ห้ามลบ/เขียนทับไฟล์ใน `legacy/`, `backups/`; การเปลี่ยนโครงข้อมูลต้องมีทางย้อนกลับ (สำรองก่อน migrate)

## สไตล์โค้ด
- ES modules, named exports, ฟังก์ชันเล็ก, JSDoc type บนฟังก์ชันที่ export, `// @ts-check` ในไฟล์ใหม่
- 2 spaces, single quotes, มี semicolon (ตามโค้ดเดิม)
- ชื่อไฟล์ kebab-case, คอลัมน์ DB snake_case, ตัวแปร JS camelCase
- คอมเมนต์อธิบาย "ทำไม" เป็นภาษาไทยได้

## Definition of Done
ดู `docs/plan/10-quality.md §6` — สรุป: AC ครบ, `npm test` + `typecheck` + `test:e2e` ผ่าน, ไม่มี console error,
i18n ครบ, IPC อยู่ในตาราง, ไม่เพิ่ม dependency นอกรายการ, อัปเดตเอกสาร/CHANGELOG ถ้าพฤติกรรมเปลี่ยน

## Commit
หนึ่ง commit ต่อหนึ่งงาน, ขึ้นต้นด้วยรหัสงาน: `T1.5: add block editor keymap`
