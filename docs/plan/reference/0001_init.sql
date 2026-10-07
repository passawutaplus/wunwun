-- WunWun · ฐานข้อมูลในเครื่อง (SQLite) · migration 0001
-- วางที่ src/main/db/migrations/0001_init.sql
-- เวลาทั้งหมดเป็น ISO-8601 UTC (เช่น 2026-10-07T03:00:00.000Z)
-- id ทั้งหมดเป็น UUID v7 (ข้อความ 36 ตัว)
-- แถวที่ซิงก์ได้มี: created_at, updated_at, deleted_at (tombstone), hlc, field_hlc, dirty

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
-- keys: schema_version, device_id, device_name, hlc_last, sync_cursor, user_id, legacy_imported_at

CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  title_auto  INTEGER NOT NULL DEFAULT 1 CHECK (title_auto IN (0, 1)),   -- 1 = ชื่อมาจากรายการแรก
  color       TEXT NOT NULL DEFAULT 'yellow'
              CHECK (color IN ('yellow', 'red', 'blue', 'green', 'purple', 'orange')),
  kind        TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'text')), -- ชนิดรายการเริ่มต้นของโน้ต
  is_inbox    INTEGER NOT NULL DEFAULT 0 CHECK (is_inbox IN (0, 1)),
  position    TEXT NOT NULL,                                               -- fractional index ใน Hub
  archived_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  hlc         TEXT NOT NULL,                                               -- ค่ามากสุดของ field_hlc
  field_hlc   TEXT NOT NULL DEFAULT '{}',                                  -- JSON {field: hlc} สำหรับ merge ทีละ field
  dirty       INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0, 1))
) STRICT;

-- Inbox มีได้ใบเดียว (sync engine ต้องรวม Inbox จากเครื่องอื่นก่อน insert ดู 07-sync.md §7)
CREATE UNIQUE INDEX notes_one_inbox ON notes (is_inbox) WHERE is_inbox = 1 AND deleted_at IS NULL;
CREATE INDEX notes_dirty ON notes (dirty) WHERE dirty = 1;

CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('image', 'video', 'file')),
  filename     TEXT NOT NULL,                  -- ชื่อที่แสดง
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL CHECK (size >= 0),
  sha256       TEXT NOT NULL,
  width        INTEGER,
  height       INTEGER,
  local_file   TEXT,                           -- ชื่อไฟล์ใน <data>/attachments/ (NULL = ยังไม่ดาวน์โหลด)
  thumb_file   TEXT,                           -- thumbnail ≤ 480 px สำหรับรูป
  remote_key   TEXT,                           -- <user_id>/<attachment_id> ใน Supabase Storage
  upload_state TEXT NOT NULL DEFAULT 'local'
               CHECK (upload_state IN ('local', 'queued', 'uploading', 'synced', 'failed')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  hlc          TEXT NOT NULL,
  field_hlc    TEXT NOT NULL DEFAULT '{}',
  dirty        INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0, 1))
) STRICT;
CREATE INDEX attachments_sha ON attachments (sha256);
CREATE INDEX attachments_dirty ON attachments (dirty) WHERE dirty = 1;

CREATE TABLE items (
  id               TEXT PRIMARY KEY,
  note_id          TEXT NOT NULL REFERENCES notes (id),
  position         TEXT NOT NULL,              -- fractional index ภายในโน้ต
  indent           INTEGER NOT NULL DEFAULT 0 CHECK (indent BETWEEN 0 AND 3),
  type             TEXT NOT NULL
                   CHECK (type IN ('task', 'text', 'heading', 'idea', 'link', 'image', 'video', 'file', 'folder')),
  text             TEXT NOT NULL DEFAULT '',   -- markdown-lite: **หนา** _เอียง_ ~~ขีดฆ่า~~ ++ขีดเส้นใต้++ [ลิงก์](https://…)
  checked_at       TEXT,                       -- NULL = ยังไม่เสร็จ
  priority         INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1, 2, 3)),  -- 1 สูง 2 กลาง 3 ต่ำ
  starred          INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  due_at           TEXT,                       -- วันเวลาของงาน (= เวลาเตือน)
  has_time         INTEGER NOT NULL DEFAULT 0 CHECK (has_time IN (0, 1)),
  remind           INTEGER NOT NULL DEFAULT 1 CHECK (remind IN (0, 1)),
  repeat           TEXT,                       -- daily | weekdays | weekly | monthly | every:<n>d | weekly:<0-6,...>
  when_source      TEXT,                       -- ข้อความเดิมก่อนตัดคำบอกเวลา (คืนได้เมื่อลบเตือน)
  fired_at         TEXT,                       -- เวลาเตือนจริง (snoozed_until หรือ due_at) ของรอบที่เด้งแล้ว
  snoozed_until    TEXT,
  url              TEXT,                       -- type = link
  attachment_id    TEXT REFERENCES attachments (id),  -- type = image | video | file
  folder_path      TEXT,                       -- type = folder (path ใช้ได้เฉพาะเครื่องที่สร้าง)
  folder_device_id TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT,
  hlc              TEXT NOT NULL,
  field_hlc        TEXT NOT NULL DEFAULT '{}',
  dirty            INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0, 1))
) STRICT;

CREATE INDEX items_by_note ON items (note_id, position) WHERE deleted_at IS NULL;
CREATE INDEX items_due ON items (due_at)
  WHERE deleted_at IS NULL AND checked_at IS NULL AND due_at IS NOT NULL;
CREATE INDEX items_done ON items (checked_at) WHERE deleted_at IS NULL AND checked_at IS NOT NULL;
CREATE INDEX items_dirty ON items (dirty) WHERE dirty = 1;

-- ค้นหาไทยกลางคำ: trigram (คำค้นสั้นกว่า 3 ตัวอักษรให้ใช้ LIKE แทน)
CREATE VIRTUAL TABLE items_fts USING fts5 (text, content = 'items', content_rowid = 'rowid', tokenize = 'trigram');

CREATE TRIGGER items_fts_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts (rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER items_fts_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts (items_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE TRIGGER items_fts_au AFTER UPDATE OF text ON items BEGIN
  INSERT INTO items_fts (items_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO items_fts (rowid, text) VALUES (new.rowid, new.text);
END;

-- การตั้งค่า: scope 'device' ไม่ซิงก์ (คีย์ลัด, เปิดพร้อมเครื่อง), 'user' ซิงก์ (ธีม, ภาษา, รูปแบบเตือน)
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                    -- JSON
  scope      TEXT NOT NULL CHECK (scope IN ('device', 'user')),
  updated_at TEXT NOT NULL,
  hlc        TEXT,
  dirty      INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1))
) STRICT;

-- สถานะหน้าต่าง: เฉพาะเครื่องนี้ ไม่ซิงก์เด็ดขาด
CREATE TABLE window_state (
  note_id    TEXT PRIMARY KEY REFERENCES notes (id) ON DELETE CASCADE,
  is_open    INTEGER NOT NULL DEFAULT 0 CHECK (is_open IN (0, 1)),
  collapsed  INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  pinned     INTEGER NOT NULL DEFAULT 1 CHECK (pinned IN (0, 1)),
  opacity    REAL NOT NULL DEFAULT 1.0 CHECK (opacity BETWEEN 0.6 AND 1.0),
  display_id TEXT,
  x          INTEGER,
  y          INTEGER,
  width      INTEGER,
  height     INTEGER,
  dock_order TEXT,
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO meta (key, value) VALUES ('schema_version', '1');
