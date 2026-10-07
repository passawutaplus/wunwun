# WunWun - Sticky Note To-Do

**วันวันทำอะไรบ้าง? จดไว้ตรงนี้ ไม่มีลืม**

A lightweight, floating desktop sticky note with smart task tracking and local-first cloud sync.

Frameless Electron app · always-on-top · local-first · optional Supabase sync

**Download:** https://wunwun-download.vercel.app/

## ใช้งานเร็ว

| ทำอะไร | ยังไง |
| --- | --- |
| จดด่วนจากที่ไหนก็ได้ | `Ctrl+Alt+Space` พิมพ์แล้ว Enter → ลง Inbox |
| แสดง/ซ่อนโน้ตทั้งหมด | `Ctrl+Alt+W` |
| ตั้งเตือน | พิมพ์เวลาในงานแล้ว Enter เช่น `ส่ง artwork วันศุกร์ 10 โมง`, `พรุ่งนี้บ่าย 2`, `ทุกวันทำงาน 8 โมงครึ่ง`, `อีก 30 นาที` |
| จดเป็นไอเดีย ไม่ใช่งาน | ขึ้นต้นด้วย `?` |
| ลบการเตือน | คลิกป้ายเวลาท้ายงาน |
| เปิดลิงก์ในโน้ต | `Ctrl+คลิก` |
| ออกจากแอป | คลิกขวาไอคอนใน tray → ออกจาก WunWun (ปิดหน้าต่างแล้วแอปยังทำงานเพื่อให้เตือนได้) |

เปลี่ยนคีย์ลัดได้ที่ `settings.hotkeys` ใน `wunwun_data.json` (หน้า Settings จะตามมา)

## Run (dev)

```bash
npm install
npm start
npm test   # ตัวอ่านวันเวลา + ระบบเตือน
```

## Build Windows `.exe`

```bash
npm run dist
```

Outputs in `dist/`:
- `WunWun Setup x.x.x.exe` (NSIS installer)
- Portable build (if enabled)

## Stack

- Electron + HTML/CSS/Vanilla JS
- Local JSON store (`wunwun_data.json` in app userData) — เขียนแบบ atomic, เก็บ `.bak` ของครั้งก่อน, สำรองรายวัน 7 วันใน `backups/`; ถ้าไฟล์เสียจะกู้จากสำรองเอง
- `when-parser.js` — อ่านวันเวลาภาษาไทย/อังกฤษในเครื่อง ไม่ใช้ AI ไม่ใช้เน็ต
- `reminders.js` — การเตือนเก็บอยู่ใน checklist item (`data-remind-at`, `data-repeat`) main process เช็กทุก 20 วินาที
- `sync-service.js` — Supabase-ready stub (Guest works offline)

## Supabase

Project URL (optional sync):

```
https://rvnzjiskqliexysicfmh.supabase.co
```

Copy `.env.example` → `.env` and set:

```
WUNWUN_SUPABASE_URL=https://rvnzjiskqliexysicfmh.supabase.co
WUNWUN_SUPABASE_ANON_KEY=your_anon_key
```

Never commit service role keys.

## Website

Landing page lives in `/web` (Vercel).
