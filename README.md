# WunWun - Sticky Note To-Do

**วันวันทำอะไร? จดไว้ตรงหน้า ไม่มีลืม**

A lightweight, floating desktop sticky note with smart task tracking and local-first cloud sync.

Frameless Electron app · always-on-top · local-first · optional Supabase sync

**Download:** https://wunwun-download.vercel.app/

## Run (dev)

```bash
npm install
npm start
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
- Local JSON store (`wunwun_data.json` in app userData)
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
