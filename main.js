const {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  screen,
  dialog,
  desktopCapturer,
  protocol,
  net,
  nativeImage,
  shell,
  Tray,
  Menu,
  globalShortcut
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { SyncService } = require('./sync-service');
const When = require('./when-parser');
const Reminders = require('./reminders');

const STATE_PATH = path.join(app.getPath('userData'), 'window-state.json');
const DATA_PATH = path.join(app.getPath('userData'), 'wunwun_data.json');
const LEGACY_DATA_PATH = path.join(app.getPath('userData'), 'notes-data.json');
const MEDIA_DIR = path.join(app.getPath('userData'), 'media');
const BACKUP_DIR = path.join(app.getPath('userData'), 'backups');
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON_PATH = path.join(__dirname, 'assets', 'tray.png');
const START_HIDDEN = process.argv.includes('--hidden');
const REMINDER_TICK_MS = 20 * 1000;
const MISSED_GRACE_MS = 12 * 60 * 60 * 1000; // เตือนที่พลาดเกิน 12 ชม. รวมเป็นแจ้งเตือนเดียว

let hubWindow = null;
const noteWindows = new Map();
let snipWindow = null;
let captureWindow = null;
let tray = null;
let isQuitting = false;
const liveNotifications = new Set(); // กัน Notification ถูก GC จนคลิกแล้วไม่ทำงาน

const DEFAULT_HOTKEYS = { capture: 'Control+Alt+Space', toggleNotes: 'Control+Alt+W' };

function defaultStore() {
  return {
    notes: [],
    defaultColor: '#f1c40f',
    activeTab: 'all',
    selectedNoteId: null,
    inboxNoteId: null,
    openNoteIds: [],
    reminderFired: {},
    settings: {
      hotkeys: { ...DEFAULT_HOTKEYS },
      autoStart: null, // null = ยังไม่ได้เลือก → เปิดให้อัตโนมัติเมื่อเป็นแอปที่ติดตั้งแล้ว
      trayHintShown: false
    }
  };
}

let store = defaultStore();

// เปิดได้ทีละตัว: เปิดซ้ำ = เรียก Hub ของตัวที่เปิดอยู่
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();
app.on('second-instance', () => showHub());

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureMediaDir() {
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

function mergeStore(raw) {
  const base = defaultStore();
  const settings = raw.settings || {};
  return {
    ...base,
    ...raw,
    notes: Array.isArray(raw.notes) ? raw.notes : [],
    openNoteIds: Array.isArray(raw.openNoteIds) ? raw.openNoteIds : [],
    reminderFired: raw.reminderFired && typeof raw.reminderFired === 'object' ? raw.reminderFired : {},
    settings: {
      ...base.settings,
      ...settings,
      hotkeys: { ...DEFAULT_HOTKEYS, ...(settings.hotkeys || {}) }
    }
  };
}

function latestBackup() {
  try {
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^wunwun_data-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    return files.length ? path.join(BACKUP_DIR, files[files.length - 1]) : null;
  } catch (_) {
    return null;
  }
}

const PREV_DATA_PATH = `${DATA_PATH}.bak`; // ข้อมูลก่อนบันทึกครั้งล่าสุด

function readStoreFile(file) {
  return mergeStore(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function loadStore() {
  if (!fs.existsSync(DATA_PATH) && !fs.existsSync(PREV_DATA_PATH) && fs.existsSync(LEGACY_DATA_PATH)) {
    try {
      store = readStoreFile(LEGACY_DATA_PATH);
      saveStore();
      return;
    } catch (_) {}
  }
  if (fs.existsSync(DATA_PATH)) {
    try {
      store = readStoreFile(DATA_PATH);
      return;
    } catch (_) {
      // ไฟล์เสีย: อย่าเริ่มว่างแล้วเขียนทับ เก็บไฟล์เสียไว้ดูทีหลัง แล้วกู้จากสำรอง
      try {
        fs.renameSync(DATA_PATH, `${DATA_PATH}.corrupt-${Date.now()}`);
      } catch (_) {}
    }
  } else if (!fs.existsSync(PREV_DATA_PATH) && !latestBackup()) {
    store = defaultStore(); // ติดตั้งใหม่
    return;
  }
  // กู้: บันทึกก่อนหน้า → สำรองรายวันล่าสุด
  for (const candidate of [PREV_DATA_PATH, latestBackup()]) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    try {
      store = readStoreFile(candidate);
      saveStore();
      app.whenReady().then(() => notify('กู้ข้อมูลแล้ว', `ไฟล์ข้อมูลเสีย ใช้ข้อมูลสำรอง ${path.basename(candidate)}`));
      return;
    } catch (_) {}
  }
  store = defaultStore();
  app.whenReady().then(() => notify('ไฟล์ข้อมูลเสีย', 'ไม่พบข้อมูลสำรองที่อ่านได้ ไฟล์เดิมเก็บไว้เป็น .corrupt'));
}

function writeFileAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  try {
    if (fs.existsSync(file)) fs.renameSync(file, `${file}.bak`);
    fs.renameSync(tmp, file);
  } catch (_) {
    // OneDrive/แอนตี้ไวรัสล็อกไฟล์อยู่: เขียนตรงแทน
    fs.writeFileSync(file, data);
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
  }
}

let lastBackupDay = null;
function backupDaily(data) {
  const day = new Date().toISOString().slice(0, 10);
  if (day === lastBackupDay) return;
  lastBackupDay = day;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const target = path.join(BACKUP_DIR, `wunwun_data-${day}.json`);
    if (!fs.existsSync(target)) fs.writeFileSync(target, data);
    const old = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => /^wunwun_data-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .slice(0, -7);
    old.forEach((f) => fs.unlinkSync(path.join(BACKUP_DIR, f)));
  } catch (_) {}
}

function saveStore() {
  try {
    const data = JSON.stringify(store, null, 2);
    writeFileAtomic(DATA_PATH, data);
    backupDaily(data);
  } catch (_) {}
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return null;
  const n = new Notification({ title, body, icon: ICON_PATH, silent: false });
  liveNotifications.add(n);
  const drop = () => liveNotifications.delete(n);
  n.on('click', () => {
    drop();
    if (onClick) onClick();
  });
  n.on('close', drop);
  setTimeout(drop, 30 * 60 * 1000);
  n.show();
  return n;
}

function broadcastStore(exceptWebContentsId = null) {
  if (hubWindow && !hubWindow.isDestroyed()) {
    if (hubWindow.webContents.id !== exceptWebContentsId) {
      hubWindow.webContents.send('store-changed', store);
    }
  }
  for (const win of noteWindows.values()) {
    if (!win.isDestroyed() && win.webContents.id !== exceptWebContentsId) {
      win.webContents.send('store-changed', store);
    }
  }
}

function loadHubState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    }
  } catch (_) {}
  return { width: 400, height: 680, x: undefined, y: undefined, alwaysOnTop: true };
}

function saveHubState() {
  if (!hubWindow || hubWindow.isDestroyed()) return;
  const bounds = hubWindow.getBounds();
  try {
    fs.writeFileSync(
      STATE_PATH,
      JSON.stringify({ ...bounds, alwaysOnTop: hubWindow.isAlwaysOnTop() }, null, 2)
    );
  } catch (_) {}
}

function getNote(id) {
  return store.notes.find((n) => n.id === id) || null;
}

function upsertNote(note) {
  const idx = store.notes.findIndex((n) => n.id === note.id);
  if (idx >= 0) store.notes[idx] = note;
  else store.notes.unshift(note);
  saveStore();
}

function findNoteIdByWebContents(wc) {
  for (const [id, win] of noteWindows.entries()) {
    if (!win.isDestroyed() && win.webContents.id === wc.id) return id;
  }
  return null;
}

function dockBounds(display, index = 0) {
  const w = 200;
  const h = 40;
  const gap = 8;
  return {
    width: w,
    height: h,
    x: display.x + display.width - w - 16,
    y: display.y + display.height - h - 16 - index * (h + gap)
  };
}

function createHubWindow() {
  const state = loadHubState();
  const display = screen.getPrimaryDisplay().workArea;
  const width = state.width || 400;
  const height = state.height || 680;
  let x = state.x;
  let y = state.y;
  if (typeof x !== 'number' || typeof y !== 'number') {
    x = display.x + 40;
    y = display.y + 40;
  }

  hubWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 340,
    minHeight: 480,
    frame: false,
    backgroundColor: '#1e1e1e',
    alwaysOnTop: state.alwaysOnTop !== false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  hubWindow.loadFile('index.html');
  hubWindow.once('ready-to-show', () => hubWindow.show());
  hubWindow.on('moved', saveHubState);
  hubWindow.on('resized', saveHubState);
  hubWindow.on('close', saveHubState);
  hubWindow.on('closed', () => {
    hubWindow = null;
    if (!isQuitting && !store.settings.trayHintShown) {
      store.settings.trayHintShown = true;
      saveStore();
      notify(
        'WunWun ยังทำงานอยู่',
        `อยู่ที่ไอคอนมุมขวาล่าง · กด ${hotkeyLabel(store.settings.hotkeys.capture)} เพื่อจดด่วน`,
        showHub
      );
    }
  });
}

function applyCollapsedState(win, note) {
  if (!win || win.isDestroyed() || !note) return;
  const display = screen.getPrimaryDisplay().workArea;
  if (note.collapsed) {
    if (!note.expandedBounds) note.expandedBounds = win.getBounds();
    const idx = [...noteWindows.keys()].indexOf(note.id);
    const dock = dockBounds(display, Math.max(0, idx));
    win.setMinimumSize(140, 36);
    win.setResizable(false);
    win.setBounds(dock);
    win.webContents.send('collapse-state', true);
  } else {
    const b = note.expandedBounds || note.windowBounds || { width: 320, height: 360 };
    win.setResizable(true);
    win.setMinimumSize(260, 220);
    win.setBounds({
      width: b.width || 320,
      height: b.height || 360,
      x: typeof b.x === 'number' ? b.x : display.x + display.width - 340,
      y: typeof b.y === 'number' ? b.y : display.y + 48
    });
    win.webContents.send('collapse-state', false);
  }
}

function createNoteWindow(noteId) {
  if (noteWindows.has(noteId)) {
    const existing = noteWindows.get(noteId);
    if (!existing.isDestroyed()) {
      existing.focus();
      return existing;
    }
    noteWindows.delete(noteId);
  }

  const note = getNote(noteId);
  if (!note) return null;

  const display = screen.getPrimaryDisplay().workArea;
  const bounds = note.collapsed
    ? dockBounds(display, noteWindows.size)
    : note.windowBounds || note.expandedBounds || {};
  const width = bounds.width || 340;
  const height = bounds.height || 400;
  let x = bounds.x;
  let y = bounds.y;
  if (typeof x !== 'number' || typeof y !== 'number') {
    const offset = (noteWindows.size % 8) * 28;
    x = display.x + display.width - width - 32 - offset;
    y = display.y + 48 + offset;
  }

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: note.collapsed ? 140 : 260,
    minHeight: note.collapsed ? 36 : 220,
    frame: false,
    backgroundColor: '#2b2b2b',
    alwaysOnTop: note.alwaysOnTop !== false,
    resizable: !note.collapsed,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile('note.html', { query: { id: noteId } });
  win.once('ready-to-show', () => {
    win.show();
    if (note.collapsed) win.webContents.send('collapse-state', true);
  });

  const persistBounds = () => {
    if (win.isDestroyed()) return;
    const n = getNote(noteId);
    if (!n) return;
    const b = win.getBounds();
    if (n.collapsed) {
      // keep expandedBounds
    } else {
      n.windowBounds = b;
      n.expandedBounds = b;
    }
    n.alwaysOnTop = win.isAlwaysOnTop();
    n.updatedAt = new Date().toISOString();
    upsertNote(n);
  };

  win.on('moved', persistBounds);
  win.on('resized', persistBounds);
  win.on('close', persistBounds);
  win.on('closed', () => {
    noteWindows.delete(noteId);
    // ปิดเอง = ไม่ต้องเปิดคืนตอนเริ่มแอป; ปิดเพราะออกจากแอป = เปิดคืน
    if (!isQuitting) setNoteOpen(noteId, false);
  });

  noteWindows.set(noteId, win);
  setNoteOpen(noteId, true);
  return win;
}

function setNoteOpen(noteId, open) {
  const ids = new Set(store.openNoteIds || []);
  const had = ids.has(noteId);
  if (open) ids.add(noteId);
  else ids.delete(noteId);
  if (had === open) return;
  store.openNoteIds = [...ids];
  saveStore();
}

function restoreOpenNotes() {
  const ids = (store.openNoteIds || []).filter((id) => getNote(id));
  store.openNoteIds = ids;
  ids.forEach((id) => createNoteWindow(id));
}

function createBlankNote(color) {
  const now = new Date().toISOString();
  const note = {
    id: uid(),
    color: color || store.defaultColor || '#f1c40f',
    title: '',
    contentHtml: '<div><br></div>',
    completedHtml: '',
    kind: 'note',
    reminderAt: null,
    reminderFired: false,
    alwaysOnTop: true,
    collapsed: false,
    expandedBounds: null,
    windowBounds: null,
    createdAt: now,
    updatedAt: now
  };
  store.notes.unshift(note);
  store.selectedNoteId = note.id;
  saveStore();
  broadcastStore();
  return note;
}

// ---------- Hub / แสดงซ่อนโน้ต ----------

function showHub() {
  if (!gotSingleInstanceLock) return;
  if (hubWindow && !hubWindow.isDestroyed()) {
    if (hubWindow.isMinimized()) hubWindow.restore();
    hubWindow.show();
    hubWindow.focus();
    return;
  }
  createHubWindow();
}

function openNoteFocused(noteId) {
  const win = createNoteWindow(noteId);
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
}

function toggleNotes() {
  const wins = [...noteWindows.values()].filter((w) => !w.isDestroyed());
  if (wins.some((w) => w.isVisible())) {
    wins.forEach((w) => w.hide());
    return;
  }
  if (wins.length) wins.forEach((w) => w.showInactive());
  else restoreOpenNotes();
  if (!noteWindows.size) showHub();
}

// ---------- Inbox + จดด่วน ----------

function ensureInbox() {
  let inbox = store.inboxNoteId ? getNote(store.inboxNoteId) : null;
  if (inbox) return inbox;
  const now = new Date().toISOString();
  inbox = {
    id: uid(),
    color: '#3498db',
    title: 'Inbox · จดด่วน',
    contentHtml: Reminders.INBOX_HEAD,
    completedHtml: '',
    kind: 'task',
    isInbox: true,
    reminderAt: null,
    reminderFired: false,
    alwaysOnTop: true,
    collapsed: false,
    expandedBounds: null,
    windowBounds: null,
    createdAt: now,
    updatedAt: now
  };
  store.notes.unshift(inbox);
  store.inboxNoteId = inbox.id;
  saveStore();
  broadcastStore();
  return inbox;
}

function appendToInbox(html) {
  const inbox = ensureInbox();
  const win = noteWindows.get(inbox.id);
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    // โน้ตเปิดอยู่: ให้หน้าต่างแทรกเองแล้วบันทึก จะได้ไม่ทับสิ่งที่กำลังพิมพ์
    win.webContents.send('inbox-append', html);
    return inbox;
  }
  inbox.contentHtml = Reminders.insertAfterHead(inbox.contentHtml, html);
  inbox.kind = detectKind(inbox.contentHtml + (inbox.completedHtml || ''));
  inbox.updatedAt = new Date().toISOString();
  upsertNote(inbox);
  broadcastStore();
  return inbox;
}

function processCapture(raw) {
  const input = String(raw || '').trim().slice(0, 2000);
  if (!input) return { ok: false };
  const parsed = When.parseWhen(input);
  const kind = When.classify(input, parsed);
  const esc = Reminders.escapeHtml;
  let html;
  let label = null;
  if (kind === 'link') {
    const href = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    html = `<div class="capture-link"><a href="${esc(href)}" target="_blank">${esc(input)}</a></div>`;
  } else if (kind === 'idea') {
    html = `<div class="capture-idea">💡 ${esc(input.replace(/^[?~]\s*/, ''))}</div>`;
  } else {
    const text = (parsed.at ? parsed.text : input).replace(/^([-*•]|\[\s?\])\s*/, '');
    label = parsed.at ? When.formatWhen(parsed.at, parsed.repeat) : null;
    html = Reminders.buildItemHtml({
      id: uid(),
      text,
      source: parsed.at ? input : null,
      at: parsed.at,
      repeat: parsed.repeat,
      hasTime: parsed.hasTime,
      label
    });
  }
  appendToInbox(html);
  return { ok: true, kind, label };
}

function createCaptureWindow() {
  captureWindow = new BrowserWindow({
    width: 560,
    height: 108,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  captureWindow.setAlwaysOnTop(true, 'pop-up-menu');
  captureWindow.loadFile('capture.html');
  captureWindow.on('blur', hideCapture);
  captureWindow.on('closed', () => {
    captureWindow = null;
  });
}

function showCapture() {
  if (!captureWindow || captureWindow.isDestroyed()) createCaptureWindow();
  const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const [w] = captureWindow.getSize();
  captureWindow.setPosition(Math.round(wa.x + (wa.width - w) / 2), Math.round(wa.y + wa.height * 0.26));
  const reveal = () => {
    captureWindow.show();
    captureWindow.focus();
    captureWindow.webContents.send('capture-show');
  };
  if (captureWindow.webContents.isLoading()) captureWindow.webContents.once('did-finish-load', reveal);
  else reveal();
}

function hideCapture() {
  if (captureWindow && !captureWindow.isDestroyed() && captureWindow.isVisible()) captureWindow.hide();
}

// ---------- เตือนความจำ ----------

function rescheduleRepeat(r, now) {
  const next = When.nextOccurrence(r.at, r.repeat, now);
  if (!next) return;
  const atIso = next.toISOString();
  const win = noteWindows.get(r.noteId);
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    win.webContents.send('reminder-reschedule', { itemId: r.id, at: atIso });
    return;
  }
  const note = getNote(r.noteId);
  if (!note) return;
  note.contentHtml = Reminders.rescheduleInHtml(note.contentHtml, r.id, atIso, When.formatWhen(atIso, r.repeat));
  note.updatedAt = new Date().toISOString();
  upsertNote(note);
  broadcastStore();
}

function pruneFired() {
  const keys = Object.keys(store.reminderFired || {});
  if (keys.length < 200) return;
  const alive = new Set();
  store.notes.forEach((n) => Reminders.extractReminderItems(n.contentHtml).forEach((i) => alive.add(i.id)));
  keys.forEach((k) => {
    if (!alive.has(k)) delete store.reminderFired[k];
  });
}

function checkReminders() {
  const now = new Date();
  const due = Reminders.dueReminders(store.notes, store.reminderFired, now);
  if (!due.length) return;
  const fresh = [];
  let missed = 0;
  for (const r of due) {
    store.reminderFired[r.id] = r.at;
    if (now - new Date(r.at) > MISSED_GRACE_MS) missed++;
    else fresh.push(r);
    if (r.repeat) rescheduleRepeat(r, now);
  }
  pruneFired();
  saveStore();

  fresh.slice(0, 3).forEach((r) => {
    const body = r.noteTitle && !r.noteTitle.startsWith(r.text) ? `${r.text}\n${r.noteTitle}` : r.text;
    notify('WunWun · ถึงเวลาแล้ว', body || 'มีงานถึงเวลา', () => openNoteFocused(r.noteId));
  });
  const extra = Math.max(0, fresh.length - 3);
  if (extra || missed) {
    const parts = [];
    if (extra) parts.push(`อีก ${extra} งานถึงเวลา`);
    if (missed) parts.push(`พลาดการเตือน ${missed} งานระหว่างปิดเครื่อง`);
    notify('WunWun', parts.join(' · '), showHub);
  }
}

// ---------- Tray, คีย์ลัด, เปิดพร้อมเครื่อง ----------

const hotkeyLabel = (acc) => (acc ? acc.replace(/Control/g, 'Ctrl').replace(/CommandOrControl/g, 'Ctrl') : '');

function buildTrayMenu() {
  const hk = store.settings.hotkeys;
  return Menu.buildFromTemplate([
    { label: `จดด่วน\t${hotkeyLabel(hk.capture)}`, click: showCapture },
    { label: 'เปิด Inbox', click: () => openNoteFocused(ensureInbox().id) },
    { label: 'เปิด Hub', click: showHub },
    { label: `แสดง/ซ่อนโน้ต\t${hotkeyLabel(hk.toggleNotes)}`, click: toggleNotes },
    { type: 'separator' },
    {
      label: 'เปิดพร้อมเครื่อง',
      type: 'checkbox',
      checked: !!store.settings.autoStart,
      enabled: app.isPackaged,
      click: (item) => setAutoStart(item.checked)
    },
    { type: 'separator' },
    {
      label: 'ออกจาก WunWun',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function createTray() {
  const img = nativeImage.createFromPath(TRAY_ICON_PATH);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('WunWun — วันวันทำอะไรบ้าง?');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showHub);
}

function refreshTrayMenu() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(buildTrayMenu());
}

function applyAutoStart() {
  // ตอน dev (npm start) จะลงทะเบียน electron.exe เปล่า ๆ ซึ่งเปิดแอปไม่ได้ จึงทำเฉพาะแอปที่ build แล้ว
  if (!app.isPackaged || process.platform === 'linux') return;
  const opts = { openAtLogin: !!store.settings.autoStart, args: ['--hidden'] };
  // portable exe แตกไฟล์ไปโฟลเดอร์ชั่วคราว ต้องชี้ไปที่ exe ตัวจริง
  if (process.env.PORTABLE_EXECUTABLE_FILE) opts.path = process.env.PORTABLE_EXECUTABLE_FILE;
  try {
    app.setLoginItemSettings(opts);
  } catch (_) {}
}

function setAutoStart(on) {
  store.settings.autoStart = !!on;
  saveStore();
  applyAutoStart();
  refreshTrayMenu();
}

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const hk = store.settings.hotkeys;
  const failed = [];
  const bind = (acc, fn) => {
    if (!acc) return;
    try {
      if (!globalShortcut.register(acc, fn)) failed.push(acc);
    } catch (_) {
      failed.push(acc);
    }
  };
  bind(hk.capture, showCapture);
  bind(hk.toggleNotes, toggleNotes);
  if (failed.length) {
    notify(
      'คีย์ลัดใช้ไม่ได้',
      `${failed.map(hotkeyLabel).join(', ')} ถูกแอปอื่นใช้อยู่ · ยังจดด่วนได้จากไอคอน WunWun ใน tray`
    );
  }
}

function copyMediaIntoLibrary(srcPath) {
  ensureMediaDir();
  const ext = path.extname(srcPath) || '';
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
  const dest = path.join(MEDIA_DIR, name);
  fs.copyFileSync(srcPath, dest);
  return { filePath: dest, name, url: `sticky-media://media/${name}` };
}

function mediaKindFromPath(filePath, mime = '') {
  const ext = path.extname(filePath).toLowerCase();
  if (mime.startsWith('video/') || ['.mp4', '.webm', '.mov', '.mkv'].includes(ext)) return 'video';
  if (
    mime.startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)
  ) {
    return 'image';
  }
  return 'file';
}

function fileToDataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp'
  };
  const mime = map[ext] || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detectKind(html) {
  if (/data-starred="true"/i.test(html)) return 'task';
  if (/check-item|data-checked/i.test(html)) return 'task';
  if (/project/i.test(html)) return 'project';
  return 'note';
}

function localAiAssist(action, text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (action === 'summarize') {
    if (!lines.length) return { text: 'โน้ตว่าง — ยังไม่มีอะไรให้สรุป' };
    const head = lines.slice(0, 3);
    const rest = lines.slice(3);
    let out = 'สรุปโน้ต:\n' + head.map((l) => `• ${l}`).join('\n');
    if (rest.length) out += `\n\n(+ อีก ${rest.length} บรรทัด)`;
    const checks = lines.filter((l) => /^(\[x\]|\[ \]|[-*]|\d+\.)/i.test(l));
    if (checks.length) out += `\n\nรายการที่พบ: ${checks.length} ข้อ`;
    return { text: out };
  }

  if (action === 'checklist') {
    if (!lines.length) return { html: '' };
    const items = lines
      .map((l) => l.replace(/^(\[x\]|\[ \]|[-*•]|\d+\.)\s*/i, '').trim())
      .filter(Boolean)
      .map(
        (t) =>
          `<div class="check-item" data-checked="false"><input type="checkbox"><div class="check-text">${escapeHtml(
            t
          )}</div></div>`
      )
      .join('');
    return { html: items, text: 'แปลงเป็น checklist แล้ว' };
  }

  if (action === 'actions') {
    const actionish = lines.filter((l) =>
      /(ต้อง|ควร|ทำ|ส่ง|โทร|นัด|ซื้อ|แก้|ตรวจ|follow|todo|@\d{1,2}:\d{2})/i.test(l)
    );
    const pick = actionish.length ? actionish : lines.slice(0, 5);
    return {
      text: pick.length
        ? 'Action items:\n' + pick.map((l) => `☐ ${l}`).join('\n')
        : 'ไม่พบ action ที่ชัดเจน'
    };
  }

  if (action === 'rewrite') {
    if (!lines.length) return { text: '' };
    const cleaned = lines.map((l) => l.replace(/\s+/g, ' ').trim()).join('\n');
    return { text: cleaned };
  }

  return { text: 'ไม่รู้จักคำสั่ง AI นี้' };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function maybeOpenAiAssist(action, text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const prompts = {
    summarize: 'สรุปโน้ตต่อไปนี้เป็นภาษาไทยแบบกระชับ เป็นหัวข้อย่อย:',
    checklist: 'แปลงเนื้อหาเป็นรายการ checklist ทีละบรรทัด ขึ้นต้นด้วย - ',
    actions: 'ดึง action items จากโน้ตนี้เป็นรายการสั้น ๆ:',
    rewrite: 'จัดระเบียบข้อความให้อ่านง่าย รักษาความหมายเดิม:'
  };
  const system = prompts[action] || prompts.summarize;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: text.slice(0, 8000) }
        ],
        temperature: 0.3
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = data.choices?.[0]?.message?.content?.trim();
    if (!out) return null;
    if (action === 'checklist') {
      const lines = out
        .split(/\r?\n/)
        .map((l) => l.replace(/^[-*•]\s*/, '').trim())
        .filter(Boolean);
      const html = lines
        .map(
          (t) =>
            `<div class="check-item" data-checked="false"><input type="checkbox"><div class="check-text">${escapeHtml(
              t
            )}</div></div>`
        )
        .join('');
      return { html, text: out };
    }
    return { text: out };
  } catch (_) {
    return null;
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sticky-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true
    }
  }
]);

// ลิงก์ในโน้ตเปิดในเบราว์เซอร์; ลากไฟล์มาวางผิดที่จะไม่พาหน้าต่างออกจากแอป
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'window') return;
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
});

// Windows ปิดเครื่อง/ล็อกเอาต์ไม่ส่ง before-quit: ถือว่ากำลังออก จะได้จำโน้ตที่เปิดค้างไว้
app.on('browser-window-created', (_e, win) => {
  win.on('session-end', () => {
    isQuitting = true;
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  if (app.isReady()) globalShortcut.unregisterAll();
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  if (process.platform === 'win32') {
    // ต้องตรงกับ build.appId ใน package.json ไม่งั้นการแจ้งเตือนของแอปที่ติดตั้งอาจไม่ขึ้น
    app.setAppUserModelId('com.wunwun.app');
  }
  ensureMediaDir();

  protocol.handle('sticky-media', (request) => {
    try {
      const u = new URL(request.url);
      let name = decodeURIComponent((u.pathname || '').replace(/^\/+/, ''));
      if (!name && u.hostname) name = u.hostname;
      name = name.replace(/^media\//, '');
      const filePath = path.normalize(path.join(MEDIA_DIR, path.basename(name)));
      if (!filePath.startsWith(path.normalize(MEDIA_DIR))) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!fs.existsSync(filePath)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (_) {
      return new Response('Not found', { status: 404 });
    }
  });

  SyncService.loginAsGuest();

  loadStore();
  if (store.settings.autoStart === null) {
    store.settings.autoStart = app.isPackaged;
    saveStore();
  }
  applyAutoStart();

  createTray();
  registerHotkeys();
  createCaptureWindow();
  if (!START_HIDDEN) createHubWindow();
  restoreOpenNotes();

  setTimeout(checkReminders, 3000);
  setInterval(checkReminders, REMINDER_TICK_MS);

  app.on('activate', () => {
    if (!hubWindow) createHubWindow();
  });
});

// ปิดทุกหน้าต่างแล้วยังอยู่ใน tray เพื่อให้คีย์ลัดและการเตือนทำงานต่อ ออกจริงจากเมนู tray
app.on('window-all-closed', () => {});

ipcMain.handle('get-store', () => store);

ipcMain.handle('set-meta', (_e, meta) => {
  if (meta.activeTab != null) store.activeTab = meta.activeTab;
  if (meta.defaultColor != null) store.defaultColor = meta.defaultColor;
  if (meta.selectedNoteId !== undefined) store.selectedNoteId = meta.selectedNoteId;
  saveStore();
  broadcastStore(_e.sender.id);
  return store;
});

ipcMain.handle('create-note', (_e, opts = {}) => {
  const note = createBlankNote(opts.color);
  createNoteWindow(note.id);
  return note;
});

ipcMain.handle('open-note', (_e, id) => {
  const note = getNote(id);
  if (!note) return null;
  store.selectedNoteId = id;
  saveStore();
  createNoteWindow(id);
  broadcastStore(_e.sender.id);
  return note;
});

ipcMain.handle('save-note', (_e, patch) => {
  const note = getNote(patch.id);
  if (!note) return null;
  Object.assign(note, patch, { updatedAt: new Date().toISOString() });
  if (patch.contentHtml != null) {
    const text = stripHtml(patch.contentHtml).trim();
    note.title = text.split('\n')[0].slice(0, 60) || 'Untitled';
    note.kind = detectKind(patch.contentHtml + (patch.completedHtml || note.completedHtml || ''));
  }
  upsertNote(note);
  SyncService.enqueue({ type: 'note.upsert', id: note.id, updatedAt: note.updatedAt });
  broadcastStore(_e.sender.id);
  return note;
});

ipcMain.handle('delete-note', (_e, id) => {
  store.notes = store.notes.filter((n) => n.id !== id);
  if (store.selectedNoteId === id) store.selectedNoteId = null;
  if (store.inboxNoteId === id) store.inboxNoteId = null; // จดด่วนครั้งหน้าจะสร้าง Inbox ใหม่
  store.openNoteIds = (store.openNoteIds || []).filter((x) => x !== id);
  saveStore();
  const win = noteWindows.get(id);
  if (win && !win.isDestroyed()) win.close();
  noteWindows.delete(id);
  broadcastStore();
  return true;
});

ipcMain.handle('set-note-color', (_e, { id, color }) => {
  if (!id) {
    store.defaultColor = color;
    saveStore();
    broadcastStore(_e.sender.id);
    return { defaultColor: color };
  }
  const note = getNote(id);
  if (!note) return null;
  note.color = color;
  note.updatedAt = new Date().toISOString();
  upsertNote(note);
  const win = noteWindows.get(id);
  if (win && !win.isDestroyed()) {
    win.webContents.send('note-color-changed', color);
  }
  broadcastStore(_e.sender.id);
  return note;
});

ipcMain.handle('close-window', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle('toggle-always-on-top', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return false;
  const next = !win.isAlwaysOnTop();
  win.setAlwaysOnTop(next, 'floating');
  const noteId = findNoteIdByWebContents(e.sender);
  if (noteId) {
    const n = getNote(noteId);
    if (n) {
      n.alwaysOnTop = next;
      upsertNote(n);
    }
  }
  if (win === hubWindow) saveHubState();
  return next;
});

ipcMain.handle('get-always-on-top', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  return win && !win.isDestroyed() ? win.isAlwaysOnTop() : true;
});

ipcMain.handle('toggle-collapse-note', (e) => {
  const noteId = findNoteIdByWebContents(e.sender);
  if (!noteId) return false;
  const note = getNote(noteId);
  const win = noteWindows.get(noteId);
  if (!note || !win || win.isDestroyed()) return false;

  if (!note.collapsed) {
    note.expandedBounds = win.getBounds();
    note.collapsed = true;
  } else {
    note.collapsed = false;
  }
  note.updatedAt = new Date().toISOString();
  upsertNote(note);
  applyCollapsedState(win, note);
  broadcastStore(e.sender.id);
  return note.collapsed;
});

ipcMain.handle('get-collapse-state', (e) => {
  const noteId = findNoteIdByWebContents(e.sender);
  const note = noteId ? getNote(noteId) : null;
  return !!(note && note.collapsed);
});

ipcMain.handle('pick-media', async (e, kind = 'any') => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const filters =
    kind === 'video'
      ? [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'mkv'] }]
      : kind === 'image'
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }]
        : [
            {
              name: 'Media',
              extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'webm', 'mov', 'mkv']
            }
          ];

  const result = await dialog.showOpenDialog(win || undefined, {
    properties: ['openFile'],
    filters
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const src = result.filePaths[0];
  const mediaKind = mediaKindFromPath(src);
  if (mediaKind === 'image') {
    // Embed as data URL so images always render full-width reliably
    const stat = fs.statSync(src);
    if (stat.size <= 8 * 1024 * 1024) {
      return { url: fileToDataUrl(src), kind: 'image' };
    }
  }
  const saved = copyMediaIntoLibrary(src);
  if (mediaKind === 'image') {
    try {
      return { url: fileToDataUrl(saved.filePath), kind: 'image' };
    } catch (_) {}
  }
  return { url: saved.url, kind: mediaKind === 'video' ? 'video' : 'image' };
});

ipcMain.handle('pick-folder', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const result = await dialog.showOpenDialog(win || undefined, {
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('open-path', async (_e, targetPath) => {
  if (!targetPath || typeof targetPath !== 'string') return { ok: false };
  const err = await shell.openPath(targetPath);
  return { ok: !err, error: err || null };
});

ipcMain.handle('import-dropped-file', async (_e, filePath, mime = '') => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) return { kind: 'folder', path: filePath };
  const kind = mediaKindFromPath(filePath, mime);
  if (kind === 'image') {
    try {
      if (stat.size <= 8 * 1024 * 1024) {
        return { url: fileToDataUrl(filePath), kind: 'image' };
      }
    } catch (_) {}
  }
  if (kind === 'image' || kind === 'video') {
    const saved = copyMediaIntoLibrary(filePath);
    if (kind === 'image') {
      try {
        return { url: fileToDataUrl(saved.filePath), kind: 'image' };
      } catch (_) {}
    }
    return { url: saved.url, kind };
  }
  return { kind: 'file', path: filePath };
});

ipcMain.handle('auth-status', () => SyncService.getStatus());
ipcMain.handle('auth-guest', () => SyncService.loginAsGuest());
ipcMain.handle('auth-login', (_e, payload) => SyncService.login(payload || {}));
ipcMain.handle('auth-register', (_e, payload) => SyncService.register(payload || {}));
ipcMain.handle('auth-logout', () => SyncService.logout());
ipcMain.handle('sync-push', () => SyncService.push());
ipcMain.handle('sync-pull', () => SyncService.pull());

ipcMain.handle('start-snip', async (e) => {
  const caller = BrowserWindow.fromWebContents(e.sender);
  if (snipWindow && !snipWindow.isDestroyed()) {
    snipWindow.focus();
    return null;
  }

  const display = screen.getPrimaryDisplay();
  const { width, height, x, y } = display.bounds;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.floor(width * display.scaleFactor),
      height: Math.floor(height * display.scaleFactor)
    }
  });
  const primary =
    sources.find((s) => s.display_id === String(display.id)) || sources[0];
  if (!primary) return null;

  const dataUrl = primary.thumbnail.toDataURL();
  if (caller && !caller.isDestroyed()) caller.hide();

  return await new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    snipWindow = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      fullscreen: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    snipWindow.setAlwaysOnTop(true, 'screen-saver');
    snipWindow.loadFile('snip.html', {
      query: { shot: encodeURIComponent(dataUrl) }
    });

    const onSnipDone = async (_ev, rect) => {
      ipcMain.removeListener('snip-done', onSnipDone);
      try {
        if (snipWindow && !snipWindow.isDestroyed()) snipWindow.close();
      } catch (_) {}
      snipWindow = null;
      if (caller && !caller.isDestroyed()) caller.show();

      if (!rect || rect.w < 4 || rect.h < 4) {
        settle(null);
        return;
      }

      try {
        const img = nativeImage.createFromDataURL(dataUrl);
        const scale = display.scaleFactor || 1;
        const cropped = img.crop({
          x: Math.round(rect.x * scale),
          y: Math.round(rect.y * scale),
          width: Math.round(rect.w * scale),
          height: Math.round(rect.h * scale)
        });
        ensureMediaDir();
        const name = `snap-${Date.now()}.png`;
        const filePath = path.join(MEDIA_DIR, name);
        const png = cropped.toPNG();
        fs.writeFileSync(filePath, png);
        const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
        settle({ url: dataUrl, kind: 'image' });
      } catch (_) {
        settle(null);
      }
    };

    ipcMain.on('snip-done', onSnipDone);
    snipWindow.on('closed', () => {
      ipcMain.removeListener('snip-done', onSnipDone);
      snipWindow = null;
      if (caller && !caller.isDestroyed() && !caller.isVisible()) caller.show();
      settle(null);
    });
  });
});

ipcMain.handle('export-note', async (e, { id, format }) => {
  const note = getNote(id);
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!note) return { ok: false };

  const base = (note.title || 'note').replace(/[<>:"/\\|?*]/g, '_').slice(0, 40) || 'note';

  if (format === 'txt') {
    const { filePath, canceled } = await dialog.showSaveDialog(win || undefined, {
      defaultPath: `${base}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }]
    });
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, stripHtml(note.contentHtml), 'utf8');
    return { ok: true, filePath };
  }

  if (format === 'html') {
    const { filePath, canceled } = await dialog.showSaveDialog(win || undefined, {
      defaultPath: `${base}.html`,
      filters: [{ name: 'HTML', extensions: ['html'] }]
    });
    if (canceled || !filePath) return { ok: false };
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(
      note.title || 'Note'
    )}</title></head><body>${note.contentHtml}</body></html>`;
    fs.writeFileSync(filePath, html, 'utf8');
    return { ok: true, filePath };
  }

  if (format === 'png' || format === 'jpeg' || format === 'jpg') {
    const ext = format === 'png' ? 'png' : 'jpg';
    const { filePath, canceled } = await dialog.showSaveDialog(win || undefined, {
      defaultPath: `${base}.${ext}`,
      filters: [{ name: 'Image', extensions: [ext] }]
    });
    if (canceled || !filePath) return { ok: false };
    if (!win || win.isDestroyed()) return { ok: false };
    const image = await win.capturePage();
    if (ext === 'png') fs.writeFileSync(filePath, image.toPNG());
    else fs.writeFileSync(filePath, image.toJPEG(90));
    return { ok: true, filePath };
  }

  return { ok: false };
});

ipcMain.handle('ai-assist', async (_e, { action, text }) => {
  const remote = await maybeOpenAiAssist(action, text);
  if (remote) return { ...remote, provider: 'openai' };
  return { ...localAiAssist(action, text), provider: 'local' };
});

ipcMain.handle('show-notification', (_e, { title, body }) => {
  return !!notify(title || 'WunWun', body || '');
});

ipcMain.handle('capture-submit', (_e, text) => {
  const result = processCapture(text);
  if (result.ok) hideCapture();
  return result;
});

ipcMain.handle('capture-hide', () => hideCapture());

ipcMain.handle('open-inbox', () => openNoteFocused(ensureInbox().id));
