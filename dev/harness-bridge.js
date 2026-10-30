// Harness stand-in for src/bridge.js + the popup: there is no chrome.* API on
// the local test page, so settings live in localStorage and the controls are
// plain buttons. Uses the same token channel as the extension.
(function () {
  'use strict';

  const A = globalThis.PlotTwistActions;
  const KEY = 'plottwist-harness-settings';
  let settings = A.sanitizeSettings(JSON.parse(localStorage.getItem(KEY) || '{}'));
  let state = null;

  const channel = globalThis.PlotTwistChannel.openBridge((msg) => {
    if (msg.type === 'state') state = A.sanitizeState(msg.state);
  });
  channel.post({ type: 'detectorOrigin', origin: location.origin });
  channel.post({ type: 'settings', settings });

  globalThis.harness = {
    get state() { return state; },
    get settings() { return settings; },
    set(key, value) {
      settings = A.sanitizeSettings({ ...settings, [key]: value });
      localStorage.setItem(KEY, JSON.stringify(settings));
      channel.post({ type: 'settings', settings });
    },
    trigger: (event) => channel.post({ type: 'trigger', event }),
    captureBackground: () => channel.post({ type: 'captureBackground' }),
    clearBackground: () => channel.post({ type: 'clearBackground' }),
  };
})();
