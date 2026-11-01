// Toolbar popup. Settings are written straight to chrome.storage.sync (the Meet
// tab picks them up through storage.onChanged). Effect buttons and the empty
// background capture are sent to the active tab's bridge; state is polled from it while
// the popup is open. The popup needs no "tabs" permission: it messages the
// active tab, and only a Meet tab (with our content script) answers.
(function () {
  'use strict';

  const A = globalThis.PlotTwistActions;
  const POLL_MS = 250;
  const KEYS = Object.keys(A.DEFAULT_SETTINGS);
  const $ = (id) => document.getElementById(id);

  let tabId = null;
  let noContentScript = false; // a Meet tab opened before the extension was installed/reloaded
  let state = null; // sanitized state from the Meet tab, or null
  let settings = { ...A.DEFAULT_SETTINGS };

  async function send(msg) {
    if (tabId === null) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return null;
      tabId = tab.id;
    }
    try {
      const res = await chrome.tabs.sendMessage(tabId, msg);
      noContentScript = false;
      return res;
    } catch {
      // Not a Meet tab, or a Meet tab without our script (opened before the
      // extension was installed/reloaded). Only Meet tabs expose their URL to
      // us (host permission), so a URL means the latter.
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      noContentScript = !!(tab && tab.url && tab.url.startsWith('https://meet.google.com/'));
      return null;
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
  $('capture').addEventListener('click', () => send({ type: 'captureBackground' }).then(refresh));
  $('clear').addEventListener('click', () => send({ type: 'clearBackground' }).then(refresh));

  // [text, tone]: tone colours the status dot (ok / warn / busy / off).
  function status() {
    if (noContentScript) return ['Reload this Meet tab to use Plot Twist.', 'warn'];
    if (!state) return ['Open a Meet call with your camera on. Already in one? Reload the Meet tab.', 'off'];
    if (!settings.enabled) return ['Effects off. Your camera is sent unchanged.', 'off'];
    if (!state.hasCamera) return ['Turn your camera on in Meet.', 'warn'];
    if (state.countdown) return [`Step out of frame… ${state.countdown}`, 'busy'];
    if (state.mode === 'vanished') return ['You have vanished. Click Return to come back.', 'ok'];
    if (state.hasBackgroundPhoto) return ['Ready. Vanish fades into your empty background.', 'ok'];
    if (state.meetEffect) return ['Ready. Vanish reveals your Meet background.', 'ok'];
    return ['Ready. Tip: capture an empty background first.', 'ok'];
  }

  function render() {
    for (const { a, b, label } of actions) {
      label.textContent = a.label();
      b.disabled = !a.enabled();
    }
    $('enabled').checked = settings.enabled;
    $('master-note').textContent = settings.enabled ? 'Effects for your Meet camera' : 'Effects off';
    for (const t of toggles) {
      t.input.checked = settings[t.key];
      t.input.disabled = !settings.enabled;
    }
    $('toggles').parentElement.classList.toggle('disabled', !settings.enabled);

    const live = controller.hasCamera;
    const counting = !!(state && state.countdown);
    $('capture').disabled = !live || counting;
    const hasPhoto = !!(state && state.hasBackgroundPhoto);
    $('capture-label').textContent = counting ? `Step out of frame… ${state.countdown}`
      : `${hasPhoto ? 'Retake' : 'Capture'} empty background`;
    $('capture-hint').textContent = counting ? 'Taking the photo when the count ends'
      : hasPhoto ? 'Used when you vanish (this call only)'
        : state && state.meetEffect ? 'Optional with a Meet background' : 'Step out of frame for 5 s';
    const thumb = state && state.hasBackgroundPhoto && state.thumb;
    $('thumb-wrap').hidden = !(state && state.hasBackgroundPhoto);
    if (thumb && $('thumb').getAttribute('src') !== thumb) $('thumb').src = thumb;
    const [text, tone] = status();
    $('status-text').textContent = text;
    $('status').dataset.tone = tone;
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
