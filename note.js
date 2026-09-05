(() => {
  const params = new URLSearchParams(window.location.search);
  const noteId = params.get('id');
  if (!noteId) {
    document.body.textContent = 'Missing note id';
    return;
  }

  const SAVE_MS = 300;
  const PRIORITIES = ['high', 'medium', 'low'];
  let note = null;
  let saveTimer = null;
  let applying = false;
  let checklistMode = false;
  let focusView = false;
  let lastAiResult = null;
  let defaultPriority = 'medium';

  const els = {
    bar: document.getElementById('note-bar'),
    editor: document.getElementById('editor'),
    btnNew: document.getElementById('btn-new'),
    btnMenu: document.getElementById('btn-menu'),
    noteMenu: document.getElementById('note-menu'),
    btnPin: document.getElementById('btn-pin'),
    btnCollapse: document.getElementById('btn-collapse'),
    btnDelete: document.getElementById('btn-delete'),
    btnClose: document.getElementById('btn-close'),
    btnChecklist: document.getElementById('btn-checklist'),
    btnPriority: document.getElementById('btn-priority'),
    btnMedia: document.getElementById('btn-media'),
    btnSnap: document.getElementById('btn-snap'),
    btnFolder: document.getElementById('btn-folder'),
    btnAi: document.getElementById('btn-ai'),
    aiPanel: document.getElementById('ai-panel'),
    aiOutput: document.getElementById('ai-output'),
    btnAiClose: document.getElementById('btn-ai-close'),
    btnAiApply: document.getElementById('btn-ai-apply'),
    dockTitle: document.getElementById('dock-title'),
    completedWrap: document.getElementById('completed-wrap'),
    completedToggle: document.getElementById('completed-toggle'),
    completedList: document.getElementById('completed-list'),
    completedCount: document.getElementById('completed-count'),
    completedCaret: document.getElementById('completed-caret'),
    viewTabs: [...document.querySelectorAll('.view-tab')]
  };

  function setColor(color) {
    document.documentElement.style.setProperty('--note-color', color);
    if (els.bar) els.bar.style.background = color;
  }

  function markEmpty() {
    const text = els.editor.innerText.replace(/\u200B/g, '').trim();
    const hasMedia = !!els.editor.querySelector('img, video, .folder-link');
    els.editor.dataset.empty = text || hasMedia ? 'false' : 'true';
  }

  function scheduleSave() {
    if (applying) return;
    markEmpty();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_MS);
  }

  async function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!note) return;
    const completedHtml = els.completedList.innerHTML;
    await window.stickyAPI.saveNote({
      id: note.id,
      contentHtml: els.editor.innerHTML,
      completedHtml,
      color: note.color
    });
  }

  function updateDockTitle() {
    els.dockTitle.textContent = note?.title || 'Note';
  }

  function setCollapsedUI(collapsed) {
    document.body.classList.toggle('collapsed', !!collapsed);
    els.btnCollapse.textContent = collapsed ? '□' : '−';
    els.btnCollapse.title = collapsed ? 'กางโน้ต' : 'ย่อมุมล่างขวา';
    updateDockTitle();
  }

  async function refreshPin() {
    const pinned = await window.stickyAPI.getAlwaysOnTop();
    els.btnPin.classList.toggle('active', pinned);
  }

  function syncCompletedUI() {
    const items = [...els.completedList.querySelectorAll('.check-item')];
    const n = items.length;
    els.completedCount.textContent = String(n);
    els.completedWrap.classList.toggle('hidden', n === 0);
  }

  function buildCheckItem({ text = '', depth = 0, priority = 'medium', starred = false } = {}) {
    const item = document.createElement('div');
    item.className = 'check-item';
    item.dataset.checked = 'false';
    item.dataset.depth = String(depth);
    item.dataset.priority = priority;
    item.dataset.starred = starred ? 'true' : 'false';
    item.style.setProperty('--depth', String(depth));
    item.draggable = true;

    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'star-btn';
    star.textContent = starred ? '★' : '☆';
    star.title = 'Focus / Star';

    const dot = document.createElement('span');
    dot.className = 'priority-dot';
    dot.title = 'Priority';

    const cb = document.createElement('input');
    cb.type = 'checkbox';

    const span = document.createElement('div');
    span.className = 'check-text';
    span.contentEditable = 'true';
    span.innerHTML = text || '<br>';

    item.append(star, dot, cb, span);
    return item;
  }

  function wireItem(item) {
    if (item.dataset.wired) return;
    item.dataset.wired = '1';

    const depth = Number(item.dataset.depth || 0);
    item.style.setProperty('--depth', String(depth));

    if (!item.querySelector('.star-btn')) {
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'star-btn';
      star.textContent = item.dataset.starred === 'true' ? '★' : '☆';
      item.insertBefore(star, item.firstChild);
    }
    if (!item.querySelector('.priority-dot')) {
      const dot = document.createElement('span');
      dot.className = 'priority-dot';
      const star = item.querySelector('.star-btn');
      item.insertBefore(dot, star ? star.nextSibling : item.firstChild);
    }
    if (!item.dataset.priority) item.dataset.priority = 'medium';

    const cb = item.querySelector('input[type="checkbox"]');
    const starBtn = item.querySelector('.star-btn');
    const dot = item.querySelector('.priority-dot');

    if (cb && !cb.dataset.wired) {
      cb.dataset.wired = '1';
      cb.addEventListener('change', () => onCheckToggle(item, cb.checked));
    }
    if (starBtn && !starBtn.dataset.wired) {
      starBtn.dataset.wired = '1';
      starBtn.addEventListener('mousedown', (e) => e.preventDefault());
      starBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = item.dataset.starred !== 'true';
        item.dataset.starred = next ? 'true' : 'false';
        starBtn.textContent = next ? '★' : '☆';
        scheduleSave();
      });
    }
    if (dot && !dot.dataset.wired) {
      dot.dataset.wired = '1';
      dot.addEventListener('mousedown', (e) => e.preventDefault());
      dot.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cyclePriority(item);
      });
    }

    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', 'check-item');
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
  }

  function wireAll(root = document) {
    root.querySelectorAll('.check-item').forEach(wireItem);
    root.querySelectorAll('a.folder-link').forEach(wireFolderLink);
  }

  function wireFolderLink(a) {
    if (a.dataset.wired) return;
    a.dataset.wired = '1';
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      const p = a.dataset.path || a.textContent.replace(/^📁\s*/, '').trim();
      if (p) await window.stickyAPI.openPath(p);
    });
  }

  function cyclePriority(item) {
    const cur = item.dataset.priority || 'medium';
    const idx = PRIORITIES.indexOf(cur);
    const next = PRIORITIES[(idx + 1) % PRIORITIES.length];
    item.dataset.priority = next;
    scheduleSave();
  }

  function onCheckToggle(item, checked) {
    item.dataset.checked = checked ? 'true' : 'false';
    item.classList.toggle('done', checked);

    // Recurring: if text has @every-..., uncheck and keep (reset)
    const text = item.querySelector('.check-text')?.innerText || '';
    const recur = text.match(/@every-([a-z0-9-]+)/i);
    if (checked && recur) {
      setTimeout(() => {
        const cb = item.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = false;
        item.dataset.checked = 'false';
        item.classList.remove('done');
        scheduleSave();
        window.stickyAPI.showNotification({
          title: 'WunWun Recurring',
          body: `รีเซ็ตงานซ้ำ: ${recur[0]}`
        });
      }, 600);
      scheduleSave();
      return;
    }

    if (checked) {
      item.classList.add('sliding');
      setTimeout(() => {
        item.classList.remove('sliding');
        const clone = item.cloneNode(true);
        clone.classList.add('done');
        const cb = clone.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = true;
        item.remove();
        els.completedList.prepend(clone);
        wireItem(clone);
        // uncheck in completed restores
        const ccb = clone.querySelector('input[type="checkbox"]');
        if (ccb) {
          ccb.onchange = null;
          ccb.addEventListener('change', () => {
            if (!ccb.checked) {
              clone.classList.remove('done');
              clone.dataset.checked = 'false';
              els.editor.appendChild(clone);
              wireItem(clone);
              syncCompletedUI();
              scheduleSave();
            }
          });
        }
        syncCompletedUI();
        scheduleSave();
      }, 220);
    } else {
      scheduleSave();
    }
  }

  function insertAtCaret(node) {
    els.editor.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      els.editor.appendChild(node);
    }
  }

  function insertChecklistItem(text = '', depth = 0) {
    const item = buildCheckItem({ text, depth, priority: defaultPriority });
    insertAtCaret(item);
    const span = item.querySelector('.check-text');
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(span);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    wireItem(item);
    scheduleSave();
  }

  function currentCheckItem() {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode) return null;
    const node = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    return node?.closest?.('.check-item') || null;
  }

  function changeDepth(item, delta) {
    let depth = Number(item.dataset.depth || 0) + delta;
    depth = Math.max(0, Math.min(3, depth));
    item.dataset.depth = String(depth);
    item.style.setProperty('--depth', String(depth));
    scheduleSave();
  }

  function insertMedia(url, kind) {
    if (kind === 'video') {
      const video = document.createElement('video');
      video.className = 'note-media';
      video.controls = true;
      video.src = url;
      insertAtCaret(video);
    } else {
      const img = document.createElement('img');
      img.className = 'note-media';
      img.src = url;
      img.alt = '';
      insertAtCaret(img);
    }
    const br = document.createElement('div');
    br.innerHTML = '<br>';
    insertAtCaret(br);
    scheduleSave();
  }

  function insertFolderLink(folderPath) {
    const a = document.createElement('a');
    a.className = 'folder-link';
    a.href = '#';
    a.dataset.path = folderPath;
    a.textContent = `📁 ${folderPath}`;
    insertAtCaret(a);
    const br = document.createElement('div');
    br.innerHTML = '<br>';
    insertAtCaret(br);
    wireFolderLink(a);
    scheduleSave();
  }

  function setChecklistMode(on) {
    checklistMode = on;
    els.btnChecklist.classList.toggle('active', on);
    if (on) insertChecklistItem('');
  }

  function applyNote(data) {
    applying = true;
    note = data;
    setColor(data.color || '#f1c40f');
    if (els.editor.innerHTML !== data.contentHtml) {
      els.editor.innerHTML = data.contentHtml || '<div><br></div>';
    }
    els.completedList.innerHTML = data.completedHtml || '';
    wireAll(els.editor);
    wireAll(els.completedList);
    syncCompletedUI();
    markEmpty();
    updateDockTitle();
    applying = false;
  }

  async function load() {
    const store = await window.stickyAPI.getStore();
    const found = (store.notes || []).find((n) => n.id === noteId);
    if (!found) {
      document.body.textContent = 'Note not found';
      return;
    }
    applyNote(found);
    await refreshPin();
    setCollapsedUI(await window.stickyAPI.getCollapseState());
  }

  // Events
  els.editor.addEventListener('input', scheduleSave);
  els.editor.addEventListener('keyup', scheduleSave);
  els.editor.addEventListener('paste', () => setTimeout(() => { wireAll(els.editor); scheduleSave(); }, 0));

  els.editor.addEventListener('keydown', (e) => {
    const item = currentCheckItem();

    if (e.key === 'Tab' && item) {
      e.preventDefault();
      changeDepth(item, e.shiftKey ? -1 : 1);
      return;
    }

    if (e.key === 'Enter') {
      if (!checklistMode && !item) return;
      if (checklistMode || item) {
        e.preventDefault();
        const depth = item ? Number(item.dataset.depth || 0) : 0;
        insertChecklistItem('', depth);
      }
    }
  });

  // DnD reorder over editor
  els.editor.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = els.editor.querySelector('.dragging');
    const target = e.target.closest?.('.check-item');
    if (!dragging || !target || dragging === target) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    els.editor.insertBefore(dragging, before ? target : target.nextSibling);
  });

  // Drop files / URLs
  els.editor.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].includes('Files') || [...e.dataTransfer.types].includes('text/uri-list')) {
      e.preventDefault();
    }
  });
  els.editor.addEventListener('drop', async (e) => {
    const files = [...(e.dataTransfer.files || [])];
    const uri = e.dataTransfer.getData('text/uri-list');
    if (files.length || uri) e.preventDefault();

    for (const file of files) {
      const result = await window.stickyAPI.importDroppedFile(file.path, file.type);
      if (!result) continue;
      if (result.kind === 'folder' || result.kind === 'file') {
        insertFolderLink(result.path);
      } else {
        insertMedia(result.url, result.kind);
      }
    }
    if (uri && /^https?:/i.test(uri)) {
      const a = document.createElement('a');
      a.href = uri;
      a.target = '_blank';
      a.textContent = uri;
      a.style.color = 'var(--note-color)';
      insertAtCaret(a);
      scheduleSave();
    }
  });

  document.querySelectorAll('.tool[data-cmd]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      els.editor.focus();
      document.execCommand(btn.dataset.cmd, false);
      scheduleSave();
    });
  });

  els.btnChecklist.addEventListener('mousedown', (e) => e.preventDefault());
  els.btnChecklist.addEventListener('click', () => setChecklistMode(!checklistMode));

  els.btnPriority.addEventListener('mousedown', (e) => e.preventDefault());
  els.btnPriority.addEventListener('click', () => {
    const item = currentCheckItem();
    if (item) cyclePriority(item);
    else {
      const idx = PRIORITIES.indexOf(defaultPriority);
      defaultPriority = PRIORITIES[(idx + 1) % PRIORITIES.length];
      els.btnPriority.style.color =
        defaultPriority === 'high' ? '#e74c3c' : defaultPriority === 'low' ? '#2ecc71' : '#f1c40f';
    }
  });

  els.btnMedia.addEventListener('mousedown', (e) => e.preventDefault());
  els.btnMedia.addEventListener('click', async () => {
    const media = await window.stickyAPI.pickMedia('any');
    if (media?.url) insertMedia(media.url, media.kind);
  });

  els.btnSnap.addEventListener('mousedown', (e) => e.preventDefault());
  els.btnSnap.addEventListener('click', async () => {
    await flushSave();
    const media = await window.stickyAPI.startSnip();
    if (media?.url) insertMedia(media.url, 'image');
  });

  els.btnFolder.addEventListener('mousedown', (e) => e.preventDefault());
  els.btnFolder.addEventListener('click', async () => {
    const folder = await window.stickyAPI.pickFolder();
    if (folder) insertFolderLink(folder);
  });

  els.btnAi.addEventListener('click', () => els.aiPanel.classList.toggle('hidden'));
  els.btnAiClose.addEventListener('click', () => els.aiPanel.classList.add('hidden'));

  document.querySelectorAll('[data-ai]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      els.aiOutput.textContent = 'กำลังช่วยคิด...';
      els.btnAiApply.classList.add('hidden');
      const result = await window.stickyAPI.aiAssist({
        action: btn.dataset.ai,
        text: els.editor.innerText || ''
      });
      lastAiResult = result;
      els.aiOutput.textContent = `${result.text || ''}\n\n(${result.provider})`;
      if (result.html || result.text) els.btnAiApply.classList.remove('hidden');
    });
  });

  els.btnAiApply.addEventListener('click', () => {
    if (!lastAiResult) return;
    if (lastAiResult.html) {
      document.execCommand('insertHTML', false, lastAiResult.html);
      wireAll(els.editor);
      setChecklistMode(true);
    } else if (lastAiResult.text) {
      const block = document.createElement('div');
      block.textContent = lastAiResult.text;
      insertAtCaret(block);
    }
    scheduleSave();
    els.aiPanel.classList.add('hidden');
  });

  els.completedToggle.addEventListener('click', () => {
    const open = els.completedList.classList.toggle('hidden');
    els.completedCaret.textContent = open ? '▾' : '▴';
    // classList.toggle returns true if now present; we use hidden so invert
    els.completedCaret.textContent = els.completedList.classList.contains('hidden') ? '▾' : '▴';
  });

  els.viewTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      focusView = tab.dataset.view === 'focus';
      els.viewTabs.forEach((t) => t.classList.toggle('active', t === tab));
      els.editor.classList.toggle('focus-filter', focusView);
    });
  });

  els.btnNew.addEventListener('click', async () => {
    await flushSave();
    await window.stickyAPI.createNote({ color: note?.color });
  });

  els.btnMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    els.noteMenu.classList.toggle('hidden');
  });

  els.noteMenu.addEventListener('click', async (e) => {
    const colorBtn = e.target.closest('button[data-color]');
    if (colorBtn) {
      note.color = colorBtn.dataset.color;
      setColor(note.color);
      await window.stickyAPI.setNoteColor({ id: note.id, color: note.color });
      els.noteMenu.classList.add('hidden');
      return;
    }
    const exportBtn = e.target.closest('[data-export]');
    if (exportBtn) {
      await flushSave();
      const res = await window.stickyAPI.exportNote({ id: noteId, format: exportBtn.dataset.export });
      els.noteMenu.classList.add('hidden');
      if (res?.ok) {
        await window.stickyAPI.showNotification({ title: 'Export สำเร็จ', body: res.filePath || '' });
      }
    }
  });

  els.btnPin.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.stickyAPI.toggleAlwaysOnTop();
    await refreshPin();
  });

  els.btnCollapse.addEventListener('click', async (e) => {
    e.stopPropagation();
    await flushSave();
    setCollapsedUI(await window.stickyAPI.toggleCollapse());
  });

  els.bar.addEventListener('dblclick', async () => {
    if (!document.body.classList.contains('collapsed')) return;
    setCollapsedUI(await window.stickyAPI.toggleCollapse());
  });

  els.btnDelete.addEventListener('click', async () => {
    if (!confirm('ลบโน้ตนี้?')) return;
    await window.stickyAPI.deleteNote(noteId);
  });

  els.btnClose.addEventListener('click', async () => {
    await flushSave();
    window.stickyAPI.closeWindow();
  });

  document.addEventListener('click', () => els.noteMenu.classList.add('hidden'));

  window.stickyAPI.onStoreChanged((store) => {
    const found = (store.notes || []).find((n) => n.id === noteId);
    if (!found) return;
    if (document.activeElement === els.editor || els.editor.contains(document.activeElement)) {
      if (found.color !== note?.color) {
        note.color = found.color;
        setColor(found.color);
      }
      note.title = found.title;
      updateDockTitle();
      return;
    }
    applyNote(found);
  });

  window.stickyAPI.onNoteColorChanged((color) => {
    if (!note) return;
    note.color = color;
    setColor(color);
  });

  window.stickyAPI.onCollapseState(setCollapsedUI);

  load();
})();
