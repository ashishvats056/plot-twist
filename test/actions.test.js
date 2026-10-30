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

test('defaults: cinema gesture automatic, snaps and facepalm opt-in', () => {
  assert.deepEqual(A.DEFAULT_SETTINGS, { autoSnap: false, autoFacepalm: false, autoCinema: true });
  assert.equal(A.allowsGesture('cinema', A.DEFAULT_SETTINGS), true);
  assert.equal(A.allowsGesture('snap', A.DEFAULT_SETTINGS), false);
  assert.equal(A.allowsGesture('facepalm', A.DEFAULT_SETTINGS), false);
});

test('every auto-detect toggle has a label and a known setting key', () => {
  const keys = A.GESTURE_TOGGLES.map((t) => t.key);
  assert.deepEqual(keys, ['autoSnap', 'autoFacepalm', 'autoCinema']);
  for (const t of A.GESTURE_TOGGLES) assert.ok(t.label && t.key in A.DEFAULT_SETTINGS);
});

test('sanitizeSettings keeps known keys as booleans and fills in defaults', () => {
  assert.deepEqual(A.sanitizeSettings(undefined), A.DEFAULT_SETTINGS);
  assert.deepEqual(A.sanitizeSettings(null), A.DEFAULT_SETTINGS);
  assert.deepEqual(A.sanitizeSettings('nope'), A.DEFAULT_SETTINGS);
  const s = A.sanitizeSettings({ autoSnap: true, evil: true, autoCinema: 'yes', __proto__: { autoFacepalm: true } });
  assert.deepEqual(s, { autoSnap: true, autoFacepalm: false, autoCinema: true });
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

test('the fade into the room photo is quick (owner feedback), the dust timing is unchanged', () => {
  const { PHOTO_FADE_MS, DUST_MS } = globalThis.PlotTwistVanish;
  assert.equal(PHOTO_FADE_MS, 1200);
  assert.equal(DUST_MS, 2200);
});

test('the room photo fades in smoothly after the dust settles', () => {
  assert.equal(photoBlend(0, 4000), 0);
  assert.equal(photoBlend(4000, 4000), 1);
  assert.equal(photoBlend(9000, 4000), 1);
  assert.ok(photoBlend(1000, 4000) < 0.25, 'starts slow');
  assert.ok(Math.abs(photoBlend(2000, 4000) - 0.5) < 1e-9);
  assert.equal(photoBlend(-50, 4000), 0);
});
