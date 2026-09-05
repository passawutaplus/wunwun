(() => {
  const state = {
    notes: [],
    activeTab: 'all',
    defaultColor: '#f1c40f',
    selectedNoteId: null,
    search: ''
  };

  const els = {
    notesList: document.getElementById('notes-list'),
    searchInput: document.getElementById('search-input'),
    btnNew: document.getElementById('btn-new-note'),
    btnPin: document.getElementById('btn-pin'),
    btnClose: document.getElementById('btn-close'),
    btnColor: document.getElementById('btn-color'),
    btnAccount: document.getElementById('btn-account'),
    colorMenu: document.getElementById('color-menu'),
    colorDot: document.getElementById('color-dot'),
    colorHint: document.getElementById('color-hint'),
    syncHint: document.getElementById('sync-hint'),
    tabIndicator: document.getElementById('tab-indicator'),
    tabs: [...document.querySelectorAll('.tab')],
    authModal: document.getElementById('auth-modal'),
    authEmail: document.getElementById('auth-email'),
    authStatus: document.getElementById('auth-status'),
    authLogin: document.getElementById('auth-login'),
    authRegister: document.getElementById('auth-register'),
    authGuest: document.getElementById('auth-guest'),
    authLogout: document.getElementById('auth-logout'),
    authClose: document.getElementById('auth-close')
  };

  function applyStore(data) {
    state.notes = data.notes || [];
    state.activeTab = data.activeTab || 'all';
    state.defaultColor = data.defaultColor || '#f1c40f';
    state.selectedNoteId = data.selectedNoteId || null;
    updateColorUI();
    updateTabUI();
    render();
  }

  function selectedColor() {
    const note = state.notes.find((n) => n.id === state.selectedNoteId);
    return note?.color || state.defaultColor;
  }

  function updateColorUI() {
    const color = selectedColor();
    document.documentElement.style.setProperty('--accent', state.defaultColor);
    els.colorDot.style.background = color;
    els.colorDot.style.boxShadow = `0 0 0 2px #1e1e1e, 0 0 0 3px ${color}`;
    els.colorHint.textContent = state.selectedNoteId
      ? 'สีจะเปลี่ยนที่โน้ตที่เลือกอยู่'
      : 'ยังไม่เลือกโน้ต — สีนี้ใช้กับโน้ตใหม่';
  }

  function updateTabUI() {
    const order = ['all', 'tasks', 'projects', 'focus'];
    const idx = Math.max(0, order.indexOf(state.activeTab));
    els.tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === state.activeTab));
    const tabsWidth = els.tabs[0]?.parentElement?.clientWidth || 0;
    const pad = 12;
    const usable = tabsWidth - pad * 2;
    const w = usable / 4;
    els.tabIndicator.style.width = `${w}px`;
    els.tabIndicator.style.transform = `translateX(${idx * w}px)`;
  }

  function formatTimestamp(iso) {
    const d = new Date(iso);
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function stripHtml(html) {
    return String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  }

  function hasStarred(note) {
    return /data-starred="true"/i.test(`${note.contentHtml || ''}${note.completedHtml || ''}`);
  }

  function filteredNotes() {
    const q = state.search.trim().toLowerCase();
    return state.notes
      .filter((n) => {
        if (state.activeTab === 'tasks') return n.kind === 'task';
        if (state.activeTab === 'projects') return n.kind === 'project';
        if (state.activeTab === 'focus') return hasStarred(n);
        return true;
      })
      .filter((n) => {
        if (!q) return true;
        const hay = `${n.title || ''} ${stripHtml(n.contentHtml)}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function render() {
    const notes = filteredNotes();
    els.notesList.innerHTML = '';

    if (!notes.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent =
        state.activeTab === 'focus'
          ? 'ยังไม่มีงานติดดาว — เปิดโน้ตแล้วกด ⭐ ที่รายการ'
          : state.search
            ? 'ไม่พบโน้ตที่ตรงกับคำค้น'
            : 'ยังไม่มีโน้ต กด + Note เพื่อเริ่มวันนี้';
      els.notesList.appendChild(empty);
      return;
    }

    notes.forEach((note) => {
      const card = document.createElement('article');
      card.className = `card${note.id === state.selectedNoteId ? ' selected' : ''}`;
      card.style.borderTopColor = note.color || state.defaultColor;

      const header = document.createElement('div');
      header.className = 'card-header';

      const title = document.createElement('div');
      title.className = 'card-title';
      title.textContent = (hasStarred(note) ? '⭐ ' : '') + (note.title || 'Untitled');

      const time = document.createElement('div');
      time.className = 'card-time';
      time.textContent = formatTimestamp(note.updatedAt || note.createdAt);

      header.append(title, time);

      const preview = document.createElement('div');
      preview.className = 'card-preview';
      preview.textContent = stripHtml(note.contentHtml) || 'ว่างเปล่า';

      const meta = document.createElement('div');
      meta.className = 'card-meta';

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = note.kind || 'note';
      meta.appendChild(badge);

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      const openBtn = document.createElement('button');
      openBtn.className = 'mini-btn';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.stickyAPI.openNote(note.id);
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'mini-btn';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('ลบโน้ตนี้?')) return;
        await window.stickyAPI.deleteNote(note.id);
      });

      actions.append(openBtn, delBtn);
      meta.appendChild(actions);
      card.append(header, preview, meta);

      card.addEventListener('click', async () => {
        state.selectedNoteId = note.id;
        updateColorUI();
        render();
        await window.stickyAPI.setMeta({ selectedNoteId: note.id });
      });

      card.addEventListener('dblclick', (e) => {
        e.preventDefault();
        window.stickyAPI.openNote(note.id);
      });

      els.notesList.appendChild(card);
    });
  }

  async function refreshAuth() {
    const s = await window.stickyAPI.authStatus();
    els.syncHint.textContent =
      s.mode === 'online' ? `Online · ${s.user?.email || 'user'}` : 'Local-first · Guest';
    els.authStatus.textContent = s.configured ? 'Supabase ready' : 'Sync stub (offline OK)';
  }

  els.tabs.forEach((tab) => {
    tab.addEventListener('click', async () => {
      state.activeTab = tab.dataset.tab;
      updateTabUI();
      render();
      await window.stickyAPI.setMeta({ activeTab: state.activeTab });
    });
  });

  els.searchInput.addEventListener('input', () => {
    state.search = els.searchInput.value;
    render();
  });

  els.btnNew.addEventListener('click', async () => {
    await window.stickyAPI.createNote({ color: state.defaultColor });
  });

  els.btnPin.addEventListener('click', async () => {
    const pinned = await window.stickyAPI.toggleAlwaysOnTop();
    els.btnPin.classList.toggle('active', pinned);
  });

  els.btnClose.addEventListener('click', () => window.stickyAPI.closeWindow());

  els.btnColor.addEventListener('click', (e) => {
    e.stopPropagation();
    els.colorMenu.classList.toggle('hidden');
  });

  els.colorMenu.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-color]');
    if (!btn) return;
    const color = btn.dataset.color;
    els.colorMenu.classList.add('hidden');
    if (state.selectedNoteId) {
      await window.stickyAPI.setNoteColor({ id: state.selectedNoteId, color });
    } else {
      state.defaultColor = color;
      await window.stickyAPI.setNoteColor({ id: null, color });
      await window.stickyAPI.setMeta({ defaultColor: color });
    }
    updateColorUI();
  });

  els.btnAccount.addEventListener('click', async () => {
    els.authModal.classList.remove('hidden');
    await refreshAuth();
  });
  els.authClose.addEventListener('click', () => els.authModal.classList.add('hidden'));
  els.authGuest.addEventListener('click', async () => {
    await window.stickyAPI.authGuest();
    await refreshAuth();
  });
  els.authLogin.addEventListener('click', async () => {
    await window.stickyAPI.authLogin({ email: els.authEmail.value.trim() });
    await refreshAuth();
  });
  els.authRegister.addEventListener('click', async () => {
    await window.stickyAPI.authRegister({ email: els.authEmail.value.trim() });
    await refreshAuth();
  });
  els.authLogout.addEventListener('click', async () => {
    await window.stickyAPI.authLogout();
    await refreshAuth();
  });

  document.addEventListener('click', () => els.colorMenu.classList.add('hidden'));
  window.addEventListener('resize', updateTabUI);

  (async () => {
    const data = await window.stickyAPI.getStore();
    applyStore(data);
    const pinned = await window.stickyAPI.getAlwaysOnTop();
    els.btnPin.classList.toggle('active', pinned);
    await refreshAuth();
    window.stickyAPI.onStoreChanged(applyStore);
  })();
})();
