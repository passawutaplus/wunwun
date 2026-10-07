(() => {
  const form = document.getElementById('capture-form');
  const input = document.getElementById('capture-input');
  const chipKind = document.getElementById('chip-kind');
  const chipWhen = document.getElementById('chip-when');
  const hintText = document.getElementById('hint-text');
  const DEFAULT_HINT = hintText.textContent;
  const KIND_LABEL = { task: 'งาน', idea: 'ไอเดีย', link: 'ลิงก์', empty: 'งาน' };
  let busy = false;

  function preview() {
    const value = input.value;
    const parsed = window.WunWhen.parseWhen(value);
    const kind = window.WunWhen.classify(value, parsed);
    chipKind.textContent = KIND_LABEL[kind];
    chipKind.dataset.kind = kind;
    const showWhen = kind === 'task' && parsed.at;
    chipWhen.classList.toggle('hidden', !showWhen);
    if (showWhen) {
      chipWhen.textContent = `เตือน ${window.WunWhen.formatWhen(parsed.at, parsed.repeat)}`;
      hintText.textContent = parsed.text ? `→ ${parsed.text}` : '';
    } else {
      hintText.textContent = value.trim() ? 'Enter เพื่อเก็บลง Inbox' : DEFAULT_HINT;
    }
  }

  function reset() {
    busy = false;
    form.classList.remove('saved');
    input.value = '';
    preview();
    input.focus();
  }

  input.addEventListener('input', preview);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!input.value.trim()) {
      window.stickyAPI.captureHide();
      return;
    }
    busy = true;
    form.classList.add('saved');
    const result = await window.stickyAPI.captureSubmit(input.value);
    if (!result?.ok) busy = false; // หน้าต่างถูกซ่อนเองเมื่อบันทึกสำเร็จ
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      window.stickyAPI.captureHide();
    }
  });

  window.stickyAPI.onCaptureShow(reset);
  reset();
})();
