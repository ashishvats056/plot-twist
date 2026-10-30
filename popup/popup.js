// Toolbar popup. Settings are written straight to chrome.storage.sync (the Meet
// tab picks them up through storage.onChanged). Effect buttons and the room
// capture are sent to the active tab's bridge; state is polled from it while
// the popup is open. The popup needs no "tabs" permission: it messages the
// active tab, and only a Meet tab (with our content script) answers.
(function () {
  'use strict';

  const A = globalThis.PlotTwistActions;
  const POLL_MS = 250;
  const KEYS = Object.keys(A.DEFAULT_SETTINGS);
  const $ = (id) => document.getElementById(id);

  let tabId = null;
  let state = null; // sanitized state from the Meet tab, or null
  let settings = { ...A.DEFAULT_SETTINGS };

  async function send(msg) {
    if (tabId === null) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return null;
      tabId = tab.id;
    }
    try {
      return await chrome.tabs.sendMessage(tabId, msg);
    } catch {
      return null; // not a Meet tab, or the tab was opened before the extension loaded
    }
  }

  // Buttons come from the shared registry; their enabled/label logic reads state.
  const controller = {
    get mode() { return state ? state.mode : 'visible'; },
    get hasCamera() { return !!(state && state.hasCamera && settings.enabled); },
    trigger: (event) => { send({ type: 'trigger', event }).then(refresh); },
  };
  const actions = A.createActions(controller).map((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'action';
    b.dataset.id = a.id;
    const icon = Object.assign(document.createElement('span'), { className: 'icon', textContent: a.icon });
    icon.setAttribute('aria-hidden', 'true');
    const label = Object.assign(document.createElement('span'), { className: 'label' });
    b.append(icon, label);
    b.addEventListener('click', () => { if (a.enabled()) a.run(); });
    $('actions').append(b);
    return { a, b, label };
  });

  const toggles = A.GESTURE_TOGGLES.map(({ key, label }) => {
    const input = Object.assign(document.createElement('input'), { type: 'checkbox' });
    input.addEventListener('change', () => save(key, input.checked));
    const row = document.createElement('label');
    row.append(Object.assign(document.createElement('span'), { textContent: label }), input);
    $('toggles').append(row);
    return { key, input };
  });

  function save(key, value) {
    settings = { ...settings, [key]: value };
    chrome.storage.sync.set({ [key]: value });
    render();
  }
  $('enabled').addEventListener('change', (e) => save('enabled', e.target.checked));
  $('capture').addEventListener('click', () => send({ type: 'captureRoom' }).then(refresh));
  $('clear').addEventListener('click', () => send({ type: 'clearRoom' }).then(refresh));

  function statusText() {
    if (!state) return 'Open a Meet call with your camera on.';
    if (!settings.enabled) return 'Effects are off. Your camera is sent unchanged.';
    if (state.needsRestart) return 'Turn your camera off and on again to start effects.';
    if (!state.hasCamera) return 'Open a Meet call with your camera on.';
    if (state.countdown) return `Step out of frame… ${state.countdown}`;
    if (state.hasRoomPhoto) return 'Vanish will fade into your room photo.';
    return 'Tip: capture the empty room for a cleaner vanish.';
  }

  function render() {
    for (const { a, b, label } of actions) {
      label.textContent = a.label();
      b.disabled = !a.enabled();
    }
    $('enabled').checked = settings.enabled;
    $('master-note').textContent = settings.enabled ? 'On for your Meet camera' : 'Camera passes through untouched';
    for (const t of toggles) {
      t.input.checked = settings[t.key];
      t.input.disabled = !settings.enabled;
    }
    $('toggles').classList.toggle('disabled', !settings.enabled);

    const live = controller.hasCamera;
    const counting = !!(state && state.countdown);
    $('capture').disabled = !live || counting;
    $('capture-label').textContent = counting ? `Step out of frame… ${state.countdown}`
      : `${state && state.hasRoomPhoto ? 'Retake' : 'Capture'} empty room`;
    const thumb = state && state.hasRoomPhoto && state.thumb;
    $('thumb-wrap').hidden = !(state && state.hasRoomPhoto);
    if (thumb && $('thumb').getAttribute('src') !== thumb) $('thumb').src = thumb;
    $('status').textContent = statusText();
  }

  async function refresh() {
    const res = await send({ type: 'getState' });
    state = res && res.ok ? A.sanitizeState(res.state) : null;
    render();
  }

  chrome.storage.sync.get(KEYS).then((raw) => {
    settings = A.sanitizeSettings(raw);
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const next = { ...settings };
    for (const key of KEYS) if (changes[key]) next[key] = changes[key].newValue;
    settings = A.sanitizeSettings(next);
    render();
  });

  render();
  refresh();
  setInterval(refresh, POLL_MS);
})();
