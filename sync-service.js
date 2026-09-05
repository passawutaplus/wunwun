/**
 * WunWun sync-service (Supabase-ready)
 * Local-first: UI always reads/writes local JSON via main process.
 * When logged in, queue changes and push/pull in background.
 */
const defaults = require('./config.defaults');

const SyncService = {
  mode: 'guest', // 'guest' | 'online'
  user: null,
  pending: [],
  lastSyncedAt: null,
  config: {
    supabaseUrl: process.env.WUNWUN_SUPABASE_URL || defaults.supabaseUrl || '',
    supabaseAnonKey: process.env.WUNWUN_SUPABASE_ANON_KEY || defaults.supabaseAnonKey || ''
  },

  isConfigured() {
    return !!(this.config.supabaseUrl && this.config.supabaseAnonKey);
  },

  getStatus() {
    return {
      mode: this.mode,
      user: this.user,
      pending: this.pending.length,
      lastSyncedAt: this.lastSyncedAt,
      configured: this.isConfigured()
    };
  },

  async loginAsGuest() {
    this.mode = 'guest';
    this.user = { id: 'guest', email: null, displayName: 'Guest' };
    return this.getStatus();
  },

  async login({ email }) {
    // Template: replace with Supabase auth.signInWithPassword / OAuth
    if (!this.isConfigured()) {
      this.mode = 'guest';
      this.user = { id: 'local', email: email || null, displayName: email || 'Local' };
      return { ...this.getStatus(), warning: 'Supabase not configured — staying local-only' };
    }
    this.mode = 'online';
    this.user = { id: `user-${Date.now()}`, email, displayName: email };
    return this.getStatus();
  },

  async register({ email }) {
    return this.login({ email });
  },

  async logout() {
    this.mode = 'guest';
    this.user = null;
    this.pending = [];
    return this.getStatus();
  },

  enqueue(change) {
    this.pending.push({ ...change, at: new Date().toISOString() });
    if (this.mode === 'online') {
      // fire-and-forget
      this.push().catch(() => {});
    }
  },

  async push() {
    if (this.mode !== 'online' || !this.isConfigured()) {
      return { ok: false, reason: 'offline-or-unconfigured', pending: this.pending.length };
    }
    // Template: POST pending mutations to Supabase
    this.pending = [];
    this.lastSyncedAt = new Date().toISOString();
    return { ok: true, lastSyncedAt: this.lastSyncedAt };
  },

  async pull() {
    if (this.mode !== 'online' || !this.isConfigured()) {
      return { ok: false, notes: null };
    }
    // Template: SELECT notes for user, merge with local (LWW by updatedAt)
    this.lastSyncedAt = new Date().toISOString();
    return { ok: true, notes: null, lastSyncedAt: this.lastSyncedAt };
  }
};

module.exports = { SyncService };
