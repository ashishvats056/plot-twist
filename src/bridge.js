// Isolated-world bridge between the extension (popup, chrome.storage) and the
// MAIN-world script (inject.js), which can't use chrome.* APIs.
//   popup ──chrome.tabs.sendMessage──► bridge ──token channel──► inject.js
//   storage.onChanged ───────────────► bridge ──token channel──► inject.js
//   inject.js ──state──► bridge (cached) ◄──getState── popup
//   inject.js ──background photo──► bridge ◄──► service worker (worker.js)
// It also mounts the hidden detector iframe, only when inject.js asks (i.e.
// when effects are on and a camera started).
(function () {
  'use strict';

  const A = globalThis.PlotTwistActions;
  const C = globalThis.PlotTwistChannel;
  const ID = 'plottwist-detector';
  const SRC = chrome.runtime.getURL('detector/detector.html');

  let state = null; // latest state reported by the page

  function mount() {
    const existing = document.getElementById(ID);
    if (existing && existing.src === SRC) return;
    if (existing) existing.remove(); // someone else's element with our id
    const parent = document.body || document.documentElement;
    if (!parent) return;
    const frame = document.createElement('iframe');
    frame.id = ID;
    frame.src = SRC;
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, {
      position: 'fixed', left: '-10px', bottom: '0', width: '1px', height: '1px',
      opacity: '0', border: '0', pointerEvents: 'none',
    });
    parent.appendChild(frame);
  }

  const channel = C.openBridge((msg) => {
    if (msg.type === 'mount') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
      else mount();
    } else if (msg.type === 'state') {
      state = A.sanitizeState(msg.state);
    } else if (msg.type === 'savePhoto') {
      const photo = A.sanitizeBgPhoto(msg.photo);
      if (photo) chrome.runtime.sendMessage({ type: 'savePhoto', photo }).catch(() => {});
    } else if (msg.type === 'dropPhoto') {
      chrome.runtime.sendMessage({ type: 'dropPhoto' }).catch(() => {});
    }
  });

  // The empty background photo taken before a reload (kept by the service worker).
  chrome.runtime.sendMessage({ type: 'loadPhoto' }).then((res) => {
    const photo = A.sanitizeBgPhoto(res && res.photo);
    if (photo) channel.post({ type: 'restorePhoto', photo });
  }, () => {});

  channel.post({ type: 'detectorOrigin', origin: new URL(SRC).origin });

  const sendSettings = (raw) => channel.post({ type: 'settings', settings: A.sanitizeSettings(raw) });
  chrome.storage.sync.get(Object.keys(A.DEFAULT_SETTINGS))
    .then(sendSettings, () => sendSettings({}));
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area !== 'sync') return;
    chrome.storage.sync.get(Object.keys(A.DEFAULT_SETTINGS)).then(sendSettings, () => {});
  });

  // Only our own popup (an extension page, not a tab) may send commands.
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.tab || !msg || typeof msg !== 'object') return false;
    if (msg.type === 'getState') reply({ ok: true, state });
    else if (msg.type === 'trigger' && A.TRIGGERS.includes(msg.event)) channel.post({ type: 'trigger', event: msg.event });
    else if (msg.type === 'captureBackground') channel.post({ type: 'captureBackground' });
    else if (msg.type === 'clearBackground') channel.post({ type: 'clearBackground' });
    else return false;
    if (msg.type !== 'getState') reply({ ok: true });
    return false;
  });
})();
