const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/actions.js');
require('../src/vanish.js');

const { photoBlend } = globalThis.PlotTwistVanish;

function controller(over = {}) {
  const calls = [];
  return { calls, c: { mode: 'visible', hasCamera: true, trigger: (ev) => calls.push(ev), ...over } };
}

test('gestures: each auto-detect setting gates only its own gestures', () => {
  const off = { autoSnap: false, autoFacepalm: false, autoCinema: false };
  for (const ev of ['snap', 'doubleSnap', 'facepalm', 'cinema']) assert.equal(A.allowsGesture(ev, off), false, ev);
  assert.equal(A.allowsGesture('snap', { autoSnap: true }), true);
  assert.equal(A.allowsGesture('doubleSnap', { autoSnap: true }), true);
  assert.equal(A.allowsGesture('facepalm', { autoFacepalm: true }), true);
  assert.equal(A.allowsGesture('cinema', { autoCinema: true }), true);
  assert.equal(A.allowsGesture('snap', { autoCinema: true, autoFacepalm: true }), false);
});

test('defaults: effects on, cinema gesture automatic, snaps and facepalm opt-in', () => {
  assert.deepEqual(A.DEFAULT_SETTINGS, { enabled: true, autoSnap: false, autoFacepalm: false, autoCinema: true });
  assert.equal(A.allowsGesture('cinema', A.DEFAULT_SETTINGS), true);
  assert.equal(A.allowsGesture('snap', A.DEFAULT_SETTINGS), false);
  assert.equal(A.allowsGesture('facepalm', A.DEFAULT_SETTINGS), false);
});

test('every auto-detect toggle has a label and a known setting key', () => {
  const keys = A.GESTURE_TOGGLES.map((t) => t.key);
  assert.deepEqual(keys, ['autoSnap', 'autoFacepalm', 'autoCinema']);
  for (const t of A.GESTURE_TOGGLES) assert.ok(t.label && t.key in A.DEFAULT_SETTINGS);
});

test('the master switch does not count as a gesture setting', () => {
  assert.ok(!Object.values(A.GESTURE_SETTINGS).includes('enabled'));
  assert.ok(!A.GESTURE_TOGGLES.some((t) => t.key === 'enabled'));
});

test('popup state from the page is sanitized before use', () => {
  assert.deepEqual(A.sanitizeState(null), null);
  const s = A.sanitizeState({
    mode: 'vanished', hasCamera: 1, countdown: 3.7, hasBackgroundPhoto: true,
    thumb: 'data:image/jpeg;base64,AAAA', settings: { autoSnap: true }, extra: 'x',
  });
  assert.deepEqual(s, {
    mode: 'vanished', hasCamera: true, countdown: 4, hasBackgroundPhoto: true,
    thumb: 'data:image/jpeg;base64,AAAA', settings: { ...A.DEFAULT_SETTINGS, autoSnap: true },
  });
  const bad = A.sanitizeState({ mode: '<img>', countdown: 1e9, thumb: 'javascript:alert(1)' });
  assert.equal(bad.mode, 'visible');
  assert.equal(bad.countdown, 0);
  assert.equal(bad.thumb, null);
  assert.equal(A.sanitizeState({ thumb: `data:image/jpeg;base64,${'A'.repeat(300000)}` }).thumb, null);
});

test('only the four effect triggers are accepted from the popup', () => {
  assert.deepEqual([...A.TRIGGERS].sort(), ['cinema', 'doubleSnap', 'facepalm', 'snap']);
});

test('sanitizeSettings keeps known keys as booleans and fills in defaults', () => {
  assert.deepEqual(A.sanitizeSettings(undefined), A.DEFAULT_SETTINGS);
  assert.deepEqual(A.sanitizeSettings(null), A.DEFAULT_SETTINGS);
  assert.deepEqual(A.sanitizeSettings('nope'), A.DEFAULT_SETTINGS);
  const s = A.sanitizeSettings({ autoSnap: true, enabled: 0, evil: true, autoCinema: 'yes', __proto__: { autoFacepalm: true } });
  assert.deepEqual(s, { enabled: false, autoSnap: true, autoFacepalm: false, autoCinema: true });
  assert.equal(Object.prototype.hasOwnProperty.call(s, 'evil'), false);
});

test('the vanish button toggles its label and runs a snap', () => {
  const { c, calls } = controller();
  const vanish = A.createActions(c).find((a) => a.id === 'vanish');
  assert.equal(vanish.label(), 'Vanish');
  vanish.run();
  assert.deepEqual(calls, ['snap']);
  c.mode = 'vanished';
  assert.equal(vanish.label(), 'Return');
  assert.equal(vanish.enabled(), true);
});

test('buttons are disabled without a camera and while the dust animation runs', () => {
  const { c } = controller({ hasCamera: false });
  const actions = A.createActions(c);
  assert.ok(actions.every((a) => !a.enabled()));
  c.hasCamera = true;
  c.mode = 'vanishing';
  assert.ok(actions.every((a) => !a.enabled()));
});

test('overlay effects only run while you are visible', () => {
  const { c, calls } = controller();
  const byId = Object.fromEntries(A.createActions(c).map((a) => [a.id, a]));
  for (const id of ['money', 'facepalm', 'cinema']) assert.equal(byId[id].enabled(), true);
  byId.money.run();
  byId.facepalm.run();
  byId.cinema.run();
  assert.deepEqual(calls, ['doubleSnap', 'facepalm', 'cinema']);
  c.mode = 'vanished';
  for (const id of ['money', 'facepalm', 'cinema']) assert.equal(byId[id].enabled(), false);
});

test('every action has a unique id, an icon and a label', () => {
  const actions = A.createActions(controller().c);
  assert.equal(new Set(actions.map((a) => a.id)).size, actions.length);
  for (const a of actions) assert.ok(a.icon && a.label());
});

test('the fade into the empty background photo is quick (owner feedback), the dust timing is unchanged', () => {
  const { PHOTO_FADE_MS, DUST_MS } = globalThis.PlotTwistVanish;
  assert.equal(PHOTO_FADE_MS, 1200);
  assert.equal(DUST_MS, 2200);
});

test('the empty background photo fades in under the dust: no step when the dust settles', () => {
  const { photoAlphaAt, DUST_MS, PHOTO_FADE_MS } = globalThis.PlotTwistVanish;
  assert.equal(photoAlphaAt(0), 0);
  assert.equal(photoAlphaAt(DUST_MS + PHOTO_FADE_MS), 1, 'fully in 1.2 s after the dust');
  assert.equal(photoAlphaAt(99999), 1);
  let prev = 0;
  for (let t = 0; t <= DUST_MS + PHOTO_FADE_MS + 100; t += 33) { // one ~30 fps frame apart
    const a = photoAlphaAt(t);
    assert.ok(a >= prev, `never fades back (t=${t})`);
    assert.ok(a - prev < 0.025, `no jump between frames (t=${t}: +${(a - prev).toFixed(3)})`);
    prev = a;
  }
  assert.ok(photoAlphaAt(DUST_MS) > 0.6, 'mostly in by the time the dust settles');
});

test('photoBlend is a smoothstep', () => {
  assert.equal(photoBlend(0, 4000), 0);
  assert.equal(photoBlend(4000, 4000), 1);
  assert.equal(photoBlend(9000, 4000), 1);
  assert.ok(photoBlend(1000, 4000) < 0.25, 'starts slow');
  assert.ok(Math.abs(photoBlend(2000, 4000) - 0.5) < 1e-9);
  assert.equal(photoBlend(-50, 4000), 0);
});
