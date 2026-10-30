// Floating control panel on the Meet page (visible only to you, never in the
// video). Buttons come from window.__plottwist.actions, so new effects show up here
// without touching this file. Shadow DOM keeps Meet's styles out.
(function () {
  'use strict';

  const REFRESH_MS = 250;
  const CAPTURE_COUNTDOWN_S = 5;
  const HOST_ID = 'plottwist-panel';

  const CSS = `
    .card { position: fixed; top: 76px; right: 16px; z-index: 2147483647; width: 240px;
      box-sizing: border-box; padding: 8px; border-radius: 12px; color: #e8eaed;
      font: 13px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif;
      background: rgba(32, 33, 36, 0.94); border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35); user-select: none; }
    .head { display: flex; align-items: center; justify-content: space-between;
      padding: 2px 4px 6px; cursor: grab; font-weight: 600; }
    .head:active { cursor: grabbing; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    button { all: unset; box-sizing: border-box; padding: 8px 6px; border-radius: 8px;
      text-align: center; cursor: pointer; color: inherit; font: inherit;
      background: rgba(255, 255, 255, 0.08); }
    button:hover:not([disabled]) { background: rgba(255, 255, 255, 0.16); }
    button:focus-visible { outline: 2px solid #8ab4f8; }
    button[disabled] { opacity: 0.4; cursor: default; }
    .icon-btn { padding: 2px 8px; background: none; }
    .wide { grid-column: 1 / -1; }
    .room { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
    .room button.capture { flex: 1; }
    canvas.thumb { width: 64px; height: 36px; border-radius: 4px; background: #000; }
    canvas.thumb[hidden], .clear[hidden] { display: none; }
    label { display: flex; gap: 6px; align-items: center; margin-top: 6px; font-size: 12px; cursor: pointer; }
    .status { margin-top: 6px; font-size: 11.5px; opacity: 0.75; }
    .collapsed .body { display: none; }
  `;

  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    children.forEach((c) => node.append(c));
    return node;
  };

  function makeDraggable(card, handle) {
    let start = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = card.getBoundingClientRect();
      start = { x: e.clientX - r.left, y: e.clientY - r.top };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      const left = Math.max(0, Math.min(innerWidth - card.offsetWidth, e.clientX - start.x));
      const top = Math.max(0, Math.min(innerHeight - 40, e.clientY - start.y));
      Object.assign(card.style, { left: `${left}px`, top: `${top}px`, right: 'auto' });
    });
    handle.addEventListener('pointerup', () => { start = null; });
  }

  function build(fx) {
    const host = el('div', { id: HOST_ID });
    const root = host.attachShadow({ mode: 'open' });
    const collapse = el('button', { className: 'icon-btn', textContent: '–', title: 'Collapse' });
    const head = el('div', { className: 'head' }, [el('span', { textContent: '✨ Plot Twist' }), collapse]);

    const actionButtons = fx.actions.map((a) => {
      const b = el('button', { type: 'button' });
      b.addEventListener('click', () => { if (a.enabled()) a.run(); });
      return { a, b };
    });

    let countdown = 0;
    const capture = el('button', { type: 'button', className: 'capture' });
    const thumb = el('canvas', { className: 'thumb', width: 128, height: 72, hidden: true, title: 'Room photo (this call only)' });
    const clear = el('button', { type: 'button', className: 'icon-btn clear', textContent: '✕', title: 'Delete room photo', hidden: true });
    capture.addEventListener('click', () => {
      if (countdown || !fx.hasCamera) return;
      countdown = CAPTURE_COUNTDOWN_S;
      const timer = setInterval(() => {
        countdown -= 1;
        if (countdown > 0) return;
        clearInterval(timer);
        fx.captureRoom();
      }, 1000);
    });
    clear.addEventListener('click', () => fx.clearRoom());

    const toggles = Object.keys(fx.settings).map((key) => {
      const input = el('input', { type: 'checkbox' });
      input.addEventListener('change', () => fx.setSetting(key, input.checked));
      const text = key === 'autoSnap' ? 'Auto-detect snaps (camera + mic)' : 'Auto-detect facepalm';
      return { key, input, label: el('label', {}, [input, text]) };
    });

    const status = el('div', { className: 'status' });
    const body = el('div', { className: 'body' }, [
      el('div', { className: 'grid' }, actionButtons.map(({ b }) => b)),
      el('div', { className: 'room' }, [capture, thumb, clear]),
      ...toggles.map((t) => t.label),
      status,
    ]);
    const card = el('div', { className: 'card' }, [head, body]);
    collapse.addEventListener('click', () => {
      card.classList.toggle('collapsed');
      collapse.textContent = card.classList.contains('collapsed') ? '+' : '–';
    });
    makeDraggable(card, head);
    root.append(el('style', { textContent: CSS }), card);

    let shownPhoto = null;
    function refresh() {
      for (const { a, b } of actionButtons) {
        b.textContent = `${a.icon} ${a.label()}`;
        b.disabled = !a.enabled();
        b.classList.toggle('wide', a.id === 'vanish');
      }
      const photo = fx.roomPhoto;
      capture.disabled = !fx.hasCamera || countdown > 0;
      capture.textContent = countdown ? `Step out of frame… ${countdown}` : `📷 ${photo ? 'Retake' : 'Capture'} empty room`;
      thumb.hidden = !photo;
      clear.hidden = !photo;
      if (photo && photo !== shownPhoto) thumb.getContext('2d').drawImage(photo, 0, 0, thumb.width, thumb.height);
      shownPhoto = photo;
      for (const t of toggles) t.input.checked = !!fx.settings[t.key];
      status.textContent = !fx.hasCamera ? 'Turn your camera on to use effects.'
        : photo ? 'Vanish will fade into your room photo.' : 'Tip: capture the empty room for a cleaner vanish.';
    }
    return { host, refresh };
  }

  let panel = null;
  setInterval(() => {
    const fx = window.__plottwist;
    if (!fx || !document.body) return;
    if (!panel) {
      if (!fx.hasCamera) return; // appears once your camera is on
      panel = build(fx);
    }
    if (!panel.host.isConnected) document.body.append(panel.host);
    panel.refresh();
  }, REFRESH_MS);
})();
