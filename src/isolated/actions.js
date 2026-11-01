// GENERATED from src/actions.js by dev/tools/build-isolated.js. Do not edit.
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

  // enabled: the master on/off switch. Off → the camera passes through untouched.
  const DEFAULT_SETTINGS = Object.freeze({ enabled: true, autoSnap: false, autoFacepalm: false, autoCinema: true });

  // Events the popup may ask the page to run.
  const TRIGGERS = Object.freeze(['snap', 'doubleSnap', 'facepalm', 'cinema']);
  const MODES = ['visible', 'vanishing', 'vanished', 'reappearing'];
  const MAX_COUNTDOWN_S = 10;
  const MAX_THUMB_CHARS = 200000;
  const THUMB_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

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

  // State reported by the page (the MAIN world, which Meet's scripts share)
  // to the popup: never trust its shape.
  function sanitizeState(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const countdown = Math.ceil(Number(raw.countdown) || 0);
    const thumb = typeof raw.thumb === 'string' && raw.thumb.length <= MAX_THUMB_CHARS && THUMB_RE.test(raw.thumb)
      ? raw.thumb : null;
    return {
      mode: MODES.includes(raw.mode) ? raw.mode : 'visible',
      hasCamera: !!raw.hasCamera,
      countdown: countdown > 0 && countdown <= MAX_COUNTDOWN_S ? countdown : 0,
      hasBackgroundPhoto: !!raw.hasBackgroundPhoto,
      meetEffect: !!raw.meetEffect,
      cartoonReady: !!raw.cartoonReady,
      thumb,
      settings: sanitizeSettings(raw.settings),
    };
  }

  // Your own facepalm, set in the facepalm editor and kept in
  // chrome.storage.local (this device only): an emoji, or a picture or GIF as
  // a data: URL. It crosses extension contexts and the page: never trust it.
  const CUSTOM_FACEPALM_KEY = 'customFacepalm';
  const MAX_FACEPALM_BYTES = 4 * 1024 * 1024;
  const MAX_FACEPALM_CHARS = Math.ceil(MAX_FACEPALM_BYTES / 3) * 4 + 32;
  const FACEPALM_IMAGE_RE = /^data:image\/(gif|png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
  const MAX_EMOJI_CHARS = 32;

  function sanitizeEmoji(raw) {
    if (typeof raw !== 'string') return null;
    const t = raw.trim();
    // eslint-disable-next-line no-control-regex
    return t && t.length <= MAX_EMOJI_CHARS && !/[\u0000-\u001f\u007f]/.test(t) ? t : null;
  }

  function sanitizeCustomFacepalm(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.kind === 'emoji') {
      const emoji = sanitizeEmoji(raw.emoji);
      return emoji ? { kind: 'emoji', emoji } : null;
    }
    if (raw.kind === 'image' && typeof raw.dataUrl === 'string' && raw.dataUrl.length <= MAX_FACEPALM_CHARS
      && FACEPALM_IMAGE_RE.test(raw.dataUrl)) return { kind: 'image', dataUrl: raw.dataUrl };
    return null;
  }

  // c: { mode, hasCamera, trigger(event) } — read live on every call.
  function createActions(c) {
    const visible = () => c.hasCamera && c.mode === 'visible';
    return [
      {
        id: 'vanish',
        icon: '💨',
        label: () => (c.mode === 'vanished' ? 'Return' : 'Vanish'),
        enabled: () => c.hasCamera && (c.mode === 'visible' || c.mode === 'vanished'),
        run: () => c.trigger('snap'),
      },
      { id: 'money', icon: '💸', label: () => 'Money rain', enabled: visible, run: () => c.trigger('doubleSnap') },
      { id: 'facepalm', icon: '🤦', label: () => 'Facepalm', enabled: visible, run: () => c.trigger('facepalm') },
      { id: 'cinema', icon: '🎬', label: () => 'Cinema', enabled: visible, run: () => c.trigger('cinema') },
    ];
  }

  const api = {
    allowsGesture, createActions, sanitizeSettings, sanitizeState, sanitizeEmoji, sanitizeCustomFacepalm,
    CUSTOM_FACEPALM_KEY, MAX_FACEPALM_BYTES, DEFAULT_SETTINGS, GESTURE_SETTINGS, GESTURE_TOGGLES, TRIGGERS,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlotTwistActions = api;
})(globalThis);
