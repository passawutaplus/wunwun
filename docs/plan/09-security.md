# 09 · ความปลอดภัยและความเป็นส่วนตัว

## 1. สิ่งที่ต้องปกป้อง

| ทรัพย์สิน | อยู่ที่ |
| --- | --- |
| โน้ต รายการ ไฟล์แนบ | `wunwun.db`, `attachments/` ในเครื่อง; `sync_records`, Storage บนเซิร์ฟเวอร์ |
| session / refresh token | `secrets.bin` (เข้ารหัสด้วย `safeStorage` = DPAPI บน Windows) |
| คีย์ AI ของผู้ใช้ (ถ้าใส่) | `secrets.bin` |
| อีเมลผู้ใช้ | Supabase Auth |
| ความน่าเชื่อถือของตัวติดตั้ง/อัปเดต | GitHub Releases + ลายเซ็นโค้ด |

## 2. ภัยคุกคามและการป้องกัน

| # | ภัย | ทางเข้า | ป้องกัน |
| --- | --- | --- | --- |
| T1 | สคริปต์อันตรายในเนื้อหา (XSS) | วาง HTML จากเว็บ/Word, ข้อมูลที่ซิงก์มา | ไม่เก็บ/ไม่ render HTML ดิบ (markdown-lite), สร้าง DOM ด้วย `textContent`, CSP เข้ม, renderer `sandbox` |
| T2 | ลิงก์อันตราย | `[x](javascript:…)`, `file://` | อนุญาตเฉพาะ `http:`, `https:`, `mailto:`; เปิดผ่าน `shell.openExternal` เมื่อผู้ใช้กด Ctrl+คลิกเท่านั้น |
| T3 | ไฟล์อันตรายที่ลากเข้ามา | `.exe`, `.lnk`, `.ps1` ฯลฯ | เก็บได้แต่ **ไม่เปิดอัตโนมัติ**; กดเปิดไฟล์ชนิดโปรแกรม → main แสดง dialog ยืนยันก่อน `shell.openPath` |
| T4 | renderer ถูกเจาะ (บั๊ก Chromium) แล้วสั่ง main | IPC | ตรวจ `senderFrame.url` ขึ้นต้น `app://wunwun/`, validator ทุก channel, ไม่มี channel "อ่าน/เขียนไฟล์ตาม path ที่ส่งมา", path มาจาก DB เท่านั้น |
| T5 | เปิดหน้าเว็บภายนอกในแอป | `window.open`, ลากลิงก์ใส่หน้าต่าง | `setWindowOpenHandler` → deny (+ เปิดในเบราว์เซอร์), `will-navigate` → preventDefault, permission request → ปฏิเสธทั้งหมด |
| T6 | คนอื่นอ่านข้อมูลบนเซิร์ฟเวอร์ | API ของ Supabase | RLS ทุกตาราง (`user_id = auth.uid()`), function เป็น `security invoker`, ไม่มี service key ในแอป, เทสต์ RLS ใน CI (`supabase-check.mjs` ทดสอบว่าผู้ใช้ B อ่าน/เขียนแถวของ A ไม่ได้) |
| T7 | ขโมย token จากเครื่อง | อ่านไฟล์ใน userData | เข้ารหัสด้วย `safeStorage`; ถ้าระบบไม่รองรับ → ไม่บันทึก session (ล็อกอินใหม่ทุกครั้ง) แทนการเก็บเป็นข้อความเปล่า |
| T8 | ยึดบัญชี | อีเมลถูกขโมย | OTP หมดอายุ 10 นาที, "ออกจากระบบทุกเครื่อง", ลบบัญชีต้องยืนยันรหัสใหม่ภายใน 10 นาที |
| T9 | แก้ไขแอปที่ติดตั้งแล้ว / ใช้เป็นตัวรัน Node | แก้ `app.asar`, `ELECTRON_RUN_AS_NODE` | Electron Fuses (§4), asar integrity |
| T10 | อัปเดตปลอม | ปลอม `latest.yml` / ไฟล์ | ดาวน์โหลดจาก GitHub ผ่าน HTTPS, ตรวจ sha512 ใน `latest.yml`, เมื่อเซ็นโค้ดแล้วตั้ง `publisherName` ให้ updater ตรวจลายเซ็น; GitHub เปิด 2FA, release ผ่าน CI เท่านั้น |
| T11 | ไลบรารีถูกฝังโค้ด (supply chain) | npm | dependency น้อยที่สุด (`05-architecture.md §10`), `npm ci` + lockfile, `npm audit --omit=dev` ใน CI, Dependabot, GitHub Actions ปักด้วย commit SHA |
| T12 | ข้อมูลรั่วไป AI | ฟีเจอร์ AI | ปิดเป็นค่าเริ่มต้น (ใช้กฎในเครื่อง), ส่งเฉพาะข้อความที่ผู้ใช้เลือก, ฝั่งเซิร์ฟเวอร์ไม่ log เนื้อหา |
| T13 | ใช้ระบบหลังบ้านในทางที่ผิด | สมัครสแปม, ยิง RPC | rate limit ของ Auth, CAPTCHA เมื่อจำเป็น, `push_records` ≤ 500 แถว/ครั้ง และ ≤ 200 KB/แถว, โควตา AI ต่อวัน, ไฟล์ ≤ 25 MB |
| T14 | log หลุดข้อมูลส่วนตัว | แนบ log ใน issue | log เฉพาะ id/จำนวน/เวลา/รหัส error ไม่มีข้อความโน้ต อีเมล หรือ token |

## 3. Electron security checklist

อ้างอิง [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security) (20 ข้อ)

| ข้อ | สถานะ v1.1.0 | เป้าหมาย v2 |
| --- | --- | --- |
| 1 โหลดเฉพาะเนื้อหาที่ปลอดภัย | ✅ ไฟล์ในแอป | ✅ `app://` |
| 2 ไม่เปิด Node ให้เนื้อหาภายนอก | ✅ | ✅ |
| 3 Context Isolation | ✅ | ✅ |
| 4 Process sandboxing | ❌ `sandbox: false` | ✅ `sandbox: true` (preload ไฟล์เดียวไม่ require ไฟล์อื่น) |
| 5 จัดการคำขอ permission | ❌ ไม่ได้ตั้ง | ✅ ปฏิเสธทั้งหมด |
| 6 ไม่ปิด `webSecurity` | ✅ | ✅ |
| 7 CSP | 🔶 meta tag บางหน้า | ✅ header จาก protocol ทุกหน้า |
| 8–12 insecure content / experimental / blink / webview | ✅ ไม่ใช้ | ✅ |
| 13 จำกัดการ navigate | ✅ (v1.1) | ✅ |
| 14 จำกัดการเปิดหน้าต่างใหม่ | ✅ (v1.1) | ✅ |
| 15 `shell.openExternal` กับข้อมูลไม่น่าไว้ใจ | 🔶 | ✅ allowlist scheme + เฉพาะการกดของผู้ใช้ |
| 16 ใช้ Electron เวอร์ชันปัจจุบัน | ❌ 33 (หมดซัพพอร์ต) | ✅ 44 และอัปเกรดตามรอบ (รุ่นใหม่ทุก 8 สัปดาห์, ซัพพอร์ต 3 รุ่นล่าสุด) |
| 17 ตรวจผู้ส่ง IPC | ❌ | ✅ router |
| 18 ใช้ custom protocol แทน `file://` | ❌ | ✅ |
| 19 Fuses | ❌ | ✅ |
| 20 ไม่ให้เนื้อหาภายนอกเรียก API ของ Electron | ✅ | ✅ |

## 4. ตัวอย่างโค้ดที่ต้องมี

### 4.1 เปิดไฟล์แบบปลอดภัย
```js
// src/main/services/media.js
import { shell, dialog } from 'electron';
const PROGRAM_EXT = /\.(exe|msi|bat|cmd|com|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|scr|lnk|hta|cpl|reg|jar)$/i;

export async function openAttachment(db, attachmentId, parentWin) {
  const att = getAttachment(db, attachmentId);                 // มาจาก DB เท่านั้น
  if (!att || !att.local_file) return { ok: false, code: 'E_NOT_FOUND' };
  const file = safeJoin(paths.attachmentsDir, att.local_file);
  if (PROGRAM_EXT.test(att.filename)) {
    const { response } = await dialog.showMessageBox(parentWin, {
      type: 'warning', buttons: ['ยกเลิก', 'เปิด'], defaultId: 0, cancelId: 0,
      message: `"${att.filename}" เป็นไฟล์โปรแกรม`, detail: 'เปิดเฉพาะไฟล์ที่คุณเชื่อถือเท่านั้น'
    });
    if (response !== 1) return { ok: false, code: 'E_CANCELLED' };
  }
  const err = await shell.openPath(file);
  return err ? { ok: false, code: 'E_OPEN', message: err } : { ok: true };
}

export function openExternalSafe(url) {
  const u = new URL(url);
  if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return false;
  shell.openExternal(u.toString());
  return true;
}
```

### 4.2 Fuses
electron-builder รุ่นใหม่มีตัวเลือก fuses ในคอนฟิก; ถ้ารุ่นที่ใช้ไม่มี ให้ทำใน `afterPack`:
```js
// scripts/after-pack.cjs
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
exports.default = async (ctx) => {
  if (ctx.electronPlatformName !== 'win32') return;
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
  });
};
```
> ทดสอบตัวติดตั้งที่ flip fuses แล้วทุกครั้ง (เปิดแอป, จดด่วน, แคปจอ, อัปเดต) — ถ้าข้อใดทำให้ฟีเจอร์พัง ให้บันทึกเหตุผลใน ADR ก่อนเปิดกลับ

### 4.3 CSP (ส่งเป็น header จาก protocol handler)
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' wunwun-media: data: blob:; media-src 'self' wunwun-media: blob:;
connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```
renderer ไม่ต่อเน็ตเลย (`connect-src 'self'`) — ทุกการเรียกเน็ตอยู่ใน main

## 5. ลายเซ็นโค้ดบน Windows

ไม่เซ็น = ผู้ใช้เห็นหน้าจอ SmartScreen "Windows protected your PC" ทำให้คนไม่กล้าติดตั้ง

| ทางเลือก | เหมาะกับ WunWun? |
| --- | --- |
| Azure Artifact Signing (เดิม Trusted Signing) ~$9.99/เดือน | **ใช้ไม่ได้ตอนนี้**: บุคคลสมัครได้เฉพาะ US/Canada, EU/UK เฉพาะนิติบุคคล ([DevClass](https://www.devclass.com/security/2026/01/14/code-signing-windows-apps-may-be-easier-and-more-secure-with-new-azure-artifact-service/4079554)) |
| SignPath Foundation (ฟรีสำหรับโปรเจกต์ open source) | **ลองสมัครก่อน**: repo เป็น MIT และ build บน CI อยู่แล้ว; ตรวจเงื่อนไขล่าสุดที่ [signpath.org](https://signpath.org/) |
| ใบรับรอง OV สำหรับบุคคลจาก CA | ทางสำรอง: กุญแจต้องอยู่ใน token/HSM → ใช้บริการเซ็นบนคลาวด์ของ CA เพื่อเซ็นใน CI |
| ไม่เซ็น | ช่วง beta เท่านั้น + หน้า `/help` อธิบายวิธีกด "More info → Run anyway" และให้ SHA-256 ของไฟล์ |

## 6. ความเป็นส่วนตัว

- ไม่เก็บ telemetry โดยค่าเริ่มต้น; crash report เป็น opt-in และไม่มีเนื้อหาโน้ต
- ไม่อ่านคลิปบอร์ดเอง (อ่านเฉพาะตอนผู้ใช้กดวาง)
- ไม่ดึงหน้าเว็บของลิงก์ (ไม่มี link preview)
- ส่งออกข้อมูลทั้งหมดได้ทุกเมื่อ (`export:all`), ลบบัญชีได้เองในแอป
- นโยบายความเป็นส่วนตัวบนเว็บก่อนเปิดซิงก์ (`08-backend.md §3`)

## 7. ทดสอบความปลอดภัย (ทุก release)

- [ ] เทสต์ IPC: ส่ง channel ที่ไม่มี / payload ผิดชนิด / key เกิน → ถูกปฏิเสธ
- [ ] เทสต์ marks: `[x](javascript:alert(1))`, `<img onerror>` ที่วางมา → เป็นข้อความธรรมดา
- [ ] ลากลิงก์/ไฟล์ไปวางนอก editor → หน้าต่างไม่เปลี่ยนหน้า
- [ ] `supabase-check.mjs` ผ่าน (RLS กันข้ามผู้ใช้)
- [ ] Supabase advisors ไม่มีข้อ security ระดับ error
- [ ] `npm audit --omit=dev` ไม่มี high/critical
- [ ] ตัวติดตั้ง: fuses ถูก flip (`npx @electron/fuses read --app <exe>`), เซ็นแล้ว (เมื่อมีใบรับรอง)
- [ ] log ตัวอย่างไม่มีข้อความโน้ต/อีเมล
