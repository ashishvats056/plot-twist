// The effects you can trigger from the control panel, and which gestures may
// trigger them automatically. To add an effect: add an entry to createActions
// (and, if a gesture should trigger it, a setting in GESTURE_SETTINGS).
// Pure logic, no DOM: loaded in the page and by node tests.
(function (root) {
  'use strict';

  // Gestures that only fire when their setting is on. Anything not listed
  // (both hands up → cinema) is always automatic.
  const GESTURE_SETTINGS = { snap: 'autoSnap', doubleSnap: 'autoSnap', facepalm: 'autoFacepalm' };

  const DEFAULT_SETTINGS = { autoSnap: false, autoFacepalm: false };

  function allowsGesture(event, settings) {
    const key = GESTURE_SETTINGS[event];
    return !key || !!settings[key];
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

  const api = { allowsGesture, createActions, DEFAULT_SETTINGS, GESTURE_SETTINGS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlotTwistActions = api;
})(globalThis);
