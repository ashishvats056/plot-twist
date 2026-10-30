// The effects you can trigger from the popup, and which gestures may trigger
// them automatically. To add an effect: add an entry to createActions (and, if
// a gesture should trigger it, a setting in GESTURE_SETTINGS, DEFAULT_SETTINGS
// and GESTURE_TOGGLES).
// Pure logic, no DOM: loaded in the page, the bridge, the popup and node tests.
(function (root) {
  'use strict';

  // Every gesture fires only when its setting is on.
  const GESTURE_SETTINGS = {
    snap: 'autoSnap',
    doubleSnap: 'autoSnap',
    facepalm: 'autoFacepalm',
    cinema: 'autoCinema',
  };

  const DEFAULT_SETTINGS = Object.freeze({ autoSnap: false, autoFacepalm: false, autoCinema: true });

  // Checkboxes shown in the popup, in order.
  const GESTURE_TOGGLES = Object.freeze([
    { key: 'autoSnap', label: 'Auto-detect snaps (camera + mic)' },
    { key: 'autoFacepalm', label: 'Auto-detect facepalm' },
    { key: 'autoCinema', label: 'Auto-detect Cinema gesture' },
  ]);

  function allowsGesture(event, settings) {
    const key = GESTURE_SETTINGS[event];
    return !!key && !!settings[key];
  }

  // Settings come from storage and cross extension contexts: keep only known
  // keys, as booleans, and fill in the defaults.
  function sanitizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      out[key] = Object.prototype.hasOwnProperty.call(src, key) ? !!src[key] : DEFAULT_SETTINGS[key];
    }
    return out;
  }

  // c: { mode, hasCamera, trigger(event) } — read live on every call.
  function createActions(c) {
    const visible = () => c.hasCamera && c.mode === 'visible';
    return [
      {
        id: 'vanish',
        icon: '🫰',
        label: () => (c.mode === 'vanished' ? 'Return' : 'Vanish'),
        enabled: () => c.hasCamera && (c.mode === 'visible' || c.mode === 'vanished'),
        run: () => c.trigger('snap'),
      },
      { id: 'money', icon: '💸', label: () => 'Money rain', enabled: visible, run: () => c.trigger('doubleSnap') },
      { id: 'facepalm', icon: '🤦', label: () => 'Facepalm', enabled: visible, run: () => c.trigger('facepalm') },
      { id: 'cinema', icon: '🎬', label: () => 'Cinema', enabled: visible, run: () => c.trigger('cinema') },
    ];
  }

  const api = { allowsGesture, createActions, sanitizeSettings, DEFAULT_SETTINGS, GESTURE_SETTINGS, GESTURE_TOGGLES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlotTwistActions = api;
})(globalThis);
