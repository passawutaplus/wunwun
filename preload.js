const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('stickyAPI', {
  getStore: () => ipcRenderer.invoke('get-store'),
  setMeta: (meta) => ipcRenderer.invoke('set-meta', meta),
  createNote: (opts) => ipcRenderer.invoke('create-note', opts),
  openNote: (id) => ipcRenderer.invoke('open-note', id),
  saveNote: (patch) => ipcRenderer.invoke('save-note', patch),
  deleteNote: (id) => ipcRenderer.invoke('delete-note', id),
  setNoteColor: (payload) => ipcRenderer.invoke('set-note-color', payload),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top'),
  toggleCollapse: () => ipcRenderer.invoke('toggle-collapse-note'),
  getCollapseState: () => ipcRenderer.invoke('get-collapse-state'),
  pickMedia: (kind) => ipcRenderer.invoke('pick-media', kind),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  importDroppedFile: (filePath, mime) =>
    ipcRenderer.invoke('import-dropped-file', filePath, mime),
  startSnip: () => ipcRenderer.invoke('start-snip'),
  exportNote: (payload) => ipcRenderer.invoke('export-note', payload),
  aiAssist: (payload) => ipcRenderer.invoke('ai-assist', payload),
  showNotification: (payload) => ipcRenderer.invoke('show-notification', payload),
  authStatus: () => ipcRenderer.invoke('auth-status'),
  authGuest: () => ipcRenderer.invoke('auth-guest'),
  authLogin: (payload) => ipcRenderer.invoke('auth-login', payload),
  authRegister: (payload) => ipcRenderer.invoke('auth-register', payload),
  authLogout: () => ipcRenderer.invoke('auth-logout'),
  syncPush: () => ipcRenderer.invoke('sync-push'),
  syncPull: () => ipcRenderer.invoke('sync-pull'),
  snipDone: (rect) => ipcRenderer.send('snip-done', rect),
  onStoreChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('store-changed', handler);
    return () => ipcRenderer.removeListener('store-changed', handler);
  },
  onNoteColorChanged: (cb) => {
    const handler = (_e, color) => cb(color);
    ipcRenderer.on('note-color-changed', handler);
    return () => ipcRenderer.removeListener('note-color-changed', handler);
  },
  onCollapseState: (cb) => {
    const handler = (_e, collapsed) => cb(collapsed);
    ipcRenderer.on('collapse-state', handler);
    return () => ipcRenderer.removeListener('collapse-state', handler);
  }
});
