# 12 · Prompt สำหรับ Claude Code (คัดลอกไปวางได้เลย)

วิธีใช้: เปิด Claude Code ในโฟลเดอร์ repo (ที่มี `CLAUDE.md` และ `docs/plan/`) แล้ววาง prompt ทีละอัน
ให้ทำทีละ phase และตรวจผลก่อนไปอันถัดไป

> เคล็ดลับ: ให้ Claude Code **วางแผนก่อนลงมือ** ทุกครั้ง แล้วอ่านแผนว่าตรงกับ `docs/plan/` หรือไม่ก่อนตอบ "ไป"

---

## 0. เริ่มต้น (ครั้งเดียว)

```text
อ่าน CLAUDE.md และ docs/plan/00-index.md แล้วไล่อ่านไฟล์ใน docs/plan/ ตามลำดับที่ index บอก
ยังไม่ต้องแก้โค้ด
สรุปให้ฉันเป็นข้อ ๆ ว่า: (1) โค้ดตอนนี้อยู่ใน branch ไหน เวอร์ชันอะไร (2) Phase 0 มีงานอะไรบ้าง
(3) มีจุดไหนในเอกสารที่ขัดกันเองหรือไม่ชัด ถ้ามี ให้ถามฉันก่อน
```

## Phase 0

```text
ทำ T0.1 จาก docs/plan/11-roadmap.md: อัปเกรด Electron จาก 33 เป็น 44
- อ่าน breaking changes ของ Electron ตั้งแต่ 34 ถึง 44 แล้วลิสต์ API ที่โค้ดเราใช้และได้รับผล
- วางแผนให้ฉันดูก่อน แล้วค่อยแก้
- ห้ามเปลี่ยนพฤติกรรมแอป
- จบงานเมื่อ: npm start ไม่มี error/deprecation warning, npm test ผ่าน (39 ข้อ)
  และบอกฉันว่าต้องทดสอบมืออะไรบ้าง (จดด่วน, เตือน, แคปจอ, ลากไฟล์)
commit ด้วยข้อความ "T0.1: upgrade Electron to 44"
```

```text
ทำ T0.2–T0.4 จาก docs/plan/11-roadmap.md ตามโครงใน docs/plan/05-architecture.md §2–§7
- ย้ายเป็น ESM และโครง src/ (main/app, main/windows, main/ipc, preload/index.cjs, renderer/*, shared/)
- ยังใช้ JSON store เดิมชั่วคราว (src/main/legacy-store.js) ห้ามเปลี่ยนรูปแบบข้อมูลใน phase นี้
- custom protocol app:// + wunwun-media://, CSP เป็น header, sandbox: true
- IPC router + validator ตามตัวอย่างใน 05 §6 ย้าย handler เดิมทั้งหมด และเลิกใช้ open-path ที่รับ path ใดก็ได้
- ทำทีละ T แล้ว commit แยก
- จบงานเมื่อ: ทุกอย่างที่ v1.1.0 ทำได้ยังทำได้, ไม่มีหน้าไหนโหลดจาก file://, เทสต์เดิมผ่าน
สรุปไฟล์ที่ย้าย/เปลี่ยน และสิ่งที่ต้องทดสอบมือ
```

```text
ทำ T0.5–T0.6: electron-builder.yml + fuses (docs/plan/09-security.md §4.2), jsconfig + typecheck,
Playwright e2e พร้อม test hooks ตาม docs/plan/10-quality.md §1.2 และ e2e ข้อ 2, 5, 6 จาก §1.3,
และ .github/workflows/ci.yml ตาม 10-quality.md §3
จบงานเมื่อ: npm run typecheck, npm test, npm run test:e2e ผ่านบนเครื่อง และ npm run dist ได้ exe ที่ใช้งานได้
```

## Phase 1

```text
ทำ T1.1 (spike) จาก docs/plan/11-roadmap.md:
ทดสอบ node:sqlite ใน Electron 44 main process — WAL, STRICT tables, FTS5 tokenize='trigram' กับข้อความไทย,
insert 10,000 แถว, query งานวันนี้ตาม docs/plan/06-data-model.md §5
ใช้ schema จาก docs/plan/reference/0001_init.sql
เขียนผลเป็น docs/adr/001-sqlite-driver.md (ตัวเลขที่วัดได้ + ตัดสินใจใช้ node:sqlite หรือ better-sqlite3)
ห้ามแตะโค้ดแอปนอกจากสคริปต์ทดลองใน scripts/spikes/
```

```text
ทำ T1.2–T1.3 ตาม docs/plan/06-data-model.md และ 07-sync.md §5:
db/ (driver ตาม ADR-001, migration runner, quick_check + กู้คืน, VACUUM INTO รายวัน),
util/ids.js (uuidv7), util/fractional-index.js, services/sync/hlc.js (พอร์ตจาก docs/plan/reference/sync-core.mjs พร้อมเทสต์),
repos ทุกตาราง — ทุกการเขียนต้อง tick HLC, อัปเดต field_hlc, ตั้ง dirty=1 และส่ง event ผ่าน bus
และ shared/marks.js + เทสต์ round-trip/ภาษาไทย/javascript: link
ยังไม่ต้องต่อกับ UI
```

```text
ทำ T1.4: นำเข้าข้อมูล v1.x ตามตาราง docs/plan/06-data-model.md §9 ทุกบรรทัด
ใช้หน้าต่างซ่อนที่มี DOMParser แปลง HTML, เขียนทั้งหมดใน transaction เดียว, รันซ้ำไม่ซ้ำ
สร้าง fixtures ใน tests/fixtures/legacy/ ตามรายการท้าย §9 (รวมไฟล์จริงจาก v1.1.0 ที่ฉันจะให้ ถ้าต้องการ)
จบงานเมื่อ: เทสต์นำเข้าทุก fixture ผ่าน และไฟล์เดิมอยู่ใน legacy/
```

```text
ทำ T1.5: block editor ของหน้าต่างโน้ต ตาม docs/plan/03-ux-ui.md §4 (โครง, ชนิด block, คีย์บอร์ด §4.3,
when-chip §4.4, เสร็จแล้ว §4.5, วาง/ลาก §4.6) และ 05-architecture.md §8
ห้ามใช้ execCommand และห้าม innerHTML กับข้อมูลผู้ใช้ จัดการ isComposing สำหรับภาษาไทย/IME
ทำเป็นขั้น: (1) แสดง+แก้ข้อความ (2) Enter/Backspace/Tab (3) ติ๊ก/เสร็จแล้ว (4) วาง (5) ลาก (6) undo
แต่ละขั้น commit แยกพร้อม e2e ที่เกี่ยวข้อง
```

```text
ทำ T1.6–T1.8: scheduler เตือนบน SQLite (query ใน 06 §5), งานซ้ำ every:Nd และ weekly:1,3,5 (เพิ่มใน when-parser พร้อมเทสต์),
powerMonitor resume, สรุปเตือนที่พลาด; window_state + คืนตำแหน่ง + หลายจอ; จดด่วนเขียนลง items ของ Inbox;
แล้วลบโค้ด JSON store/HTML blob ทั้งหมด (เหลือแค่ importer)
จบงานเมื่อ: grep "contentHtml" ใน src/ เจอแค่ importer และ e2e ทั้งหมดผ่าน
```

## Phase 2

```text
ทำ T2.1–T2.4 ตาม docs/plan/03-ux-ui.md §5–§8 และเกณฑ์ใน 04-features.md (F-17, F-21, F-23, F-30, F-41, F-42):
Hub 4 แท็บ + ค้นหา Ctrl+K, popup เตือน + เลื่อนเวลา + ห้ามรบกวน, หน้าต่าง Settings (ยกเว้นบัญชีและ AI), dock รวม
ทำทีละ T, commit แยก, เพิ่ม e2e ข้อ 1, 5, 9, 10
```

```text
ทำ T2.5–T2.8: ไฟล์แนบ + การ์ดไฟล์ + เปิดไฟล์อย่างปลอดภัย (09-security.md §4.1) + วางรูป + แคปจอเข้าแถบจดด่วน,
ส่งออก/นำเข้าทั้งหมด, tokens + ธีมสว่าง + ไอคอน SVG ชุดเดียว (03 §11), ครั้งแรกที่เปิด (03 §9)
เพิ่มสคริปต์ตรวจ contrast ของ tokens ให้ทุกคู่ ≥ 4.5:1
```

```text
ทำ T2.9–T2.10: electron-updater + .github/workflows/release.yml (10-quality.md §3–§4) + portable mode
และอัปเดต web/ ให้ปุ่มดาวน์โหลดชี้ releases/latest พร้อมหน้า /help และ /changelog
ยังไม่ต้องทำขั้นเซ็นโค้ด ให้เว้นจุดไว้พร้อมคอมเมนต์ว่าใส่ตรงไหน
```

## Phase 3

```text
ทำ T3.1–T3.2 ตาม docs/plan/07-sync.md §4 และ 08-backend.md §1:
supabase/ (migration จาก docs/plan/reference/supabase_20261101000000_init.sql), tests/server/ จาก supabase-check.mjs
ปรับให้อ่านทุกไฟล์ใน supabase/migrations ตามลำดับ, secrets.js ด้วย safeStorage, supabase client ใน main เท่านั้น,
เข้าสู่ระบบด้วยรหัสอีเมลใน Settings, upsert devices
ห้ามให้ token หรือ supabase-js ไปถึง renderer (เขียนเทสต์ยืนยัน)
```

```text
ทำ T3.3–T3.4: sync engine ตาม docs/plan/07-sync.md §5–§11 ทุกข้อ (push, pull ด้วย cursor (tx,id), merge ทีละ field,
localAhead, Inbox หลัก, guest→บัญชี, backoff, สถานะ, realtime สะกิด, ตัวกระตุ้น)
เขียนเทสต์สองเครื่องจำลองกับเซิร์ฟเวอร์ปลอมในหน่วยความจำให้ครอบทุกกรณีใน §14 และ invariants 4 ข้อ ก่อนต่อกับ Supabase จริง
```

```text
ทำ T3.5–T3.8: ซิงก์ไฟล์แนบ, UI สถานะ/บัญชี/อุปกรณ์/ออกจากระบบ, Edge Function delete-account (08-backend.md §1.5),
e2e สอง instance กับ supabase start
แล้วสรุป checklist ทดสอบมือสองเครื่องให้ฉันทำ
```

---

## Prompt ทั่วไป

**แก้บั๊ก**
```text
บั๊ก: <อธิบายสิ่งที่เกิด / ขั้นตอนทำให้เกิด / สิ่งที่ควรเป็น>
1) หาสาเหตุและอธิบายก่อน ยังไม่แก้
2) เขียนเทสต์ที่ fail ด้วยบั๊กนี้
3) แก้ให้เทสต์ผ่าน โดยไม่ขัดกับ docs/plan/ (ถ้าขัด บอกฉันก่อน)
4) ถ้าเป็นบั๊กข้อมูลหาย ตรวจด้วยว่าผู้ใช้ที่เจอไปแล้วกู้ข้อมูลคืนได้ไหม
```

**ทบทวนก่อน merge**
```text
ทบทวน diff ของ branch นี้กับ main เทียบกับ CLAUDE.md, docs/plan/09-security.md §7 และ 10-quality.md §6
รายงานเฉพาะปัญหาจริง เรียงตามความรุนแรง พร้อมไฟล์และบรรทัด ไม่ต้องชม
```

**เพิ่มฟีเจอร์นอกแผน**
```text
ฉันอยากได้: <ฟีเจอร์>
ประเมินกับหลัก 7 ข้อใน docs/plan/02-product.md ก่อน แล้วเสนอ: ทำ/ไม่ทำ/ทำแบบเล็กกว่า
ถ้าทำ ให้เขียนเป็น F-xx พร้อม AC ใน 04-features.md และงานใน 11-roadmap.md ก่อนเขียนโค้ด
```
