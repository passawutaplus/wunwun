# WunWun v2 · แผนพัฒนาเต็มรูปแบบ

> **วันวันทำอะไรบ้าง? จดไว้ตรงนี้ ไม่มีลืม**
> ชุดเอกสารนี้เขียนให้ส่งต่อ Claude Code ได้ทันที — เริ่มจาก `CLAUDE.md` ที่ root ของ repo แล้วไฟล์นี้

## คำตัดสินหลัก (สรุป 1 นาที)

1. **ปรับจากของเดิม แต่รื้อแกนข้างใน** — ไม่เขียนใหม่ ไม่เปลี่ยน stack (Electron + Vanilla JS) แต่เปลี่ยนที่เก็บข้อมูล, ตัวแก้ไขโน้ต และ IPC (`01`)
2. **ข้อมูลทีละรายการใน SQLite** แทน HTML ทั้งก้อนใน JSON — ทำให้มีมุมมองวันนี้ ค้นหาไทย และซิงก์ได้ (`06`)
3. **ซิงก์แบบ local-first**: Supabase ตารางเดียว + merge ทีละ field ด้วย HLC — แก้ออฟไลน์สองเครื่องไม่หาย (`07`)
4. **ความปลอดภัยตาม checklist ของ Electron ครบ 20 ข้อ**: sandbox, custom protocol, IPC router, fuses (`09`)
5. **ลำดับ**: ฐานรากใหม่ → แกนข้อมูล → ใช้งานประจำวัน (ปล่อย v2.0) → ซิงก์ (v2.1) → AI/แพลตฟอร์มอื่น (`11`)

## ลำดับการอ่าน

| # | ไฟล์ | อ่านเพื่อ |
| --- | --- | --- |
| 01 | [เขียนใหม่หรือปรับของเดิม](01-decision-rewrite-or-evolve.md) | ทำไมเลือกแนวทางนี้ และอะไรเก็บ/ทิ้ง |
| 02 | [Product](02-product.md) | วิสัยทัศน์ หลัก 7 ข้อ ผู้ใช้ ขอบเขต ต้นทุน |
| 03 | [UX/UI](03-ux-ui.md) | ทุกหน้าจอ คีย์ลัด design tokens การเข้าถึง |
| 04 | [ฟีเจอร์](04-features.md) | รายการ F-xx พร้อมเกณฑ์รับงาน |
| 05 | [สถาปัตยกรรม](05-architecture.md) | โครงโฟลเดอร์ process IPC protocol ไลบรารีที่อนุญาต |
| 06 | [Data model](06-data-model.md) | ตาราง SQLite markdown-lite การย้ายข้อมูล v1 |
| 07 | [ซิงก์](07-sync.md) | HLC merge push/pull auth ไฟล์แนบ การทดสอบ |
| 08 | [หลังบ้าน](08-backend.md) | Supabase Edge Functions GitHub Releases เว็บไซต์ ต้นทุน |
| 09 | [ความปลอดภัย](09-security.md) | ภัยคุกคาม checklist โค้ดตัวอย่าง เซ็นโค้ด ความเป็นส่วนตัว |
| 10 | [คุณภาพ](10-quality.md) | เทสต์ CI/CD ปล่อยเวอร์ชัน checklist Windows DoD |
| 11 | [Roadmap](11-roadmap.md) | phase, gate และงาน T-xx ทีละข้อ |
| 12 | [Prompt สำหรับ Claude Code](12-claude-code-prompts.md) | คัดลอกไปวางทีละ phase |

## โค้ดอ้างอิงที่ทดสอบแล้ว (`reference/`)

| ไฟล์ | คืออะไร | ตรวจแล้วอย่างไร |
| --- | --- | --- |
| `0001_init.sql` | schema SQLite ในเครื่อง | รันบน SQLite 3.45: STRICT, FK, CHECK, Inbox ใบเดียว, ค้นไทยกลางคำด้วย FTS5 trigram, index งานครบกำหนด |
| `sync-core.mjs` + `sync-core.test.mjs` | HLC + merge ทีละ field + เลือก Inbox หลัก | 7 เทสต์ผ่าน (`node --test "docs/plan/reference/*.test.mjs"`) รวมกรณีแก้ออฟไลน์สองเครื่อง |
| `supabase_20261101000000_init.sql` | ตาราง/RLS/RPC/Storage ฝั่งเซิร์ฟเวอร์ | ผ่าน parser ของ Postgres และรันบน Postgres จริง (PGlite) |
| `supabase-check.mjs` | สคริปต์ทดสอบ migration ข้างบน | merge ทีละ field, ค่าเก่าไม่ทับ, cursor, ผู้ใช้ B อ่าน/เขียนข้อมูล A ไม่ได้, โควตา AI |

## คำศัพท์

| คำ | ความหมาย |
| --- | --- |
| **Inbox** | โน้ตพิเศษที่รับทุกอย่างจากแถบจดด่วน มีได้ใบเดียว |
| **รายการ / item / block** | 1 แถวในโน้ต: งาน ข้อความ หัวข้อ ไอเดีย ลิงก์ รูป ไฟล์ โฟลเดอร์ |
| **Dock** | หน้าต่างเล็กมุมจอที่รวมโน้ตที่ย่อไว้ |
| **markdown-lite** | รูปแบบข้อความที่เก็บใน DB: `**หนา**` `_เอียง_` `~~ขีด~~` `++เส้นใต้++` `[ลิงก์](url)` |
| **HLC** | Hybrid Logical Clock — เวลาที่ใช้ตัดสินว่าการแก้ไขไหนใหม่กว่า แม้นาฬิกาเครื่องเพี้ยน |
| **field_hlc** | HLC ของแต่ละ field ในแถว ทำให้ merge ทีละ field ได้ |
| **dirty** | แถวที่แก้ในเครื่องแล้วยังไม่ได้ส่งขึ้นเซิร์ฟเวอร์ |
| **tombstone** | การลบด้วย `deleted_at` แทนลบจริง เพื่อให้เครื่องอื่นรู้ว่าถูกลบ |
| **fractional index** | สตริงลำดับที่แทรกระหว่างกันได้ไม่จำกัด (`a0`, `a0V`, `a1`) |
| **RLS** | Row Level Security ของ Postgres — ผู้ใช้เห็นเฉพาะแถวของตัวเอง |
| **Gate (G0–G3)** | เงื่อนไขที่ต้องผ่านก่อนเริ่ม phase ถัดไป |
| **F-xx / T-xx** | รหัสฟีเจอร์ (04) / รหัสงาน (11) |

## สถานะเริ่มต้นของโค้ด

- repo: `github.com/passawutaplus/wunwun`
- v1.1.0 อยู่ใน branch `sprint1-capture-remind` (patch `0001`): จดด่วน + Inbox, เตือนจากวันเวลาไทย, tray/คีย์ลัด/เปิดพร้อมเครื่อง, จำโน้ตที่เปิด, บันทึกข้อมูลแบบไม่หาย, แก้บั๊กลากไฟล์และ Enter ซ้อนงาน
- ข้อมูลยังเป็น JSON + HTML; Electron 33 (หมดซัพพอร์ต) → งานแรกคือ Phase 0

ข้อมูลภายนอกที่ใช้ตัดสินใจ (ตรวจเมื่อ ต.ค. 2026): Electron 44 เป็นรุ่นล่าสุด (Node 24) และรุ่นใหม่ออกทุก 8 สัปดาห์ ([endoflife.date](https://endoflife.date/electron)); `node:sqlite` ใช้ใน Electron ได้ตั้งแต่ 36 ([electron#47755](https://github.com/electron/electron/pull/47755)); ราคา Supabase ([pricing](https://supabase.com/pricing)); เงื่อนไข Azure Artifact Signing ([DevClass](https://www.devclass.com/security/2026/01/14/code-signing-windows-apps-may-be-easier-and-more-secure-with-new-azure-artifact-service/4079554)); Playwright รองรับ Electron แบบ experimental ([docs](https://playwright.dev/docs/api/class-electron))
