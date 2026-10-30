const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/actions.js');
require('../src/vanish.js');

const { photoBlend } = globalThis.PlotTwistVanish;

function controller(over = {}) {
  const calls = [];
  return { calls, c: { mode: 'visible', hasCamera: true, trigger: (ev) => calls.push(ev), ...over } };
}

test('gestures: hands-up cinema is always automatic; snaps and facepalm only when switched on', () => {
  const off = { autoSnap: false, autoFacepalm: false };
  assert.equal(A.allowsGesture('cinema', off), true);
  assert.equal(A.allowsGesture('snap', off), false);
  assert.equal(A.allowsGesture('doubleSnap', off), false);
  assert.equal(A.allowsGesture('facepalm', off), false);
  assert.equal(A.allowsGesture('snap', { autoSnap: true }), true);
  assert.equal(A.allowsGesture('facepalm', { autoFacepalm: true }), true);
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
