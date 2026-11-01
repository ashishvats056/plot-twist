const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/cartoon.js');

const { readTraits, expression, handPose, toonSkin, toonHair, toonShirt } = globalThis.PlotTwistCartoon;

const W = 200;
const H = 200;
const SKIN = [200, 150, 120];
const HAIR = [40, 35, 35];
const SHIRT = [40, 90, 200];
const BG = [235, 235, 235];
// eyes at (80,80) and (120,80), nose (100,95), mouth (100,110): eye distance 40
const FACE = { x: 0.3, y: 0.3, w: 0.4, h: 0.4, kp: [[0.4, 0.4], [0.6, 0.4], [0.5, 0.475], [0.5, 0.55]] };

// A flat cartoon person: hair above the face box, skin face, shirt below.
function person({ beard = false, glasses = false, bald = false } = {}) {
  const d = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, c) => d.set([...c, 255], (y * W + x) * 4);
  const fill = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, c); };
  fill(0, 0, W, H, BG);
  fill(60, 20, 140, 60, bald ? SKIN : HAIR);
  fill(60, 60, 140, 140, SKIN);
  fill(20, 160, 180, 200, SHIRT);
  if (beard) fill(70, 98, 130, 140, HAIR);
  if (glasses) {
    for (const cx of [80, 120]) {
      fill(cx - 18, 70, cx + 18, 72, HAIR); fill(cx - 18, 92, cx + 18, 94, HAIR);
      fill(cx - 18, 70, cx - 16, 94, HAIR); fill(cx + 16, 70, cx + 18, 94, HAIR);
    }
    fill(96, 72, 104, 76, HAIR);
  }
  return d;
}

test('reads skin, hair and shirt colours', () => {
  const t = readTraits(person(), W, H, FACE, null);
  assert.deepEqual(t.skin, SKIN);
  assert.deepEqual(t.hair, HAIR);
  assert.deepEqual(t.shirt, SHIRT);
  assert.equal(t.bald, false);
});

test('a plain face has no glasses, beard or moustache', () => {
  const t = readTraits(person(), W, H, FACE, null);
  assert.equal(t.glasses, false);
  assert.equal(t.beard, 0);
  assert.equal(t.moustache, false);
});

test('finds glasses frames and a beard', () => {
  const t = readTraits(person({ glasses: true, beard: true }), W, H, FACE, null);
  assert.equal(t.glasses, true);
  assert.ok(t.beard > 0.5, String(t.beard));
  assert.equal(t.moustache, true);
});

test('a dark but skin-coloured chin (a shadow) is not a beard', () => {
  const d = person();
  for (let y = 120; y < 140; y++) for (let x = 85; x < 115; x++) d.set([110, 70, 50, 255], (y * W + x) * 4);
  assert.equal(readTraits(d, W, H, FACE, null).beard, 0);
});

test('no hair above the face reads as bald', () => {
  assert.equal(readTraits(person({ bald: true }), W, H, FACE, null).bald, true);
});

test('works without keypoints, and ignores pixels outside the person mask', () => {
  const { kp, ...noKp } = FACE;
  assert.deepEqual(readTraits(person(), W, H, noKp, null).skin, SKIN);
  const mask = new Uint8ClampedArray(W * H).fill(255);
  for (let y = 150; y < H; y++) for (let x = 0; x < W; x++) mask[y * W + x] = 0;
  assert.deepEqual(readTraits(person(), W, H, FACE, mask).shirt, [11, 87, 208], 'falls back to the brand blue');
});

test('the expression: blink, squeeze shut on the slap, then a resigned sigh', () => {
  assert.equal(expression(0).eyes, 'open');
  assert.equal(expression(0).mouth, 'smile');
  assert.ok(expression(260).open < 0.1, 'mid-blink');
  assert.equal(expression(700).eyes, 'squeeze');
  assert.equal(expression(2000).eyes, 'rest');
  assert.equal(expression(2000).mouth, 'sigh');
});

test('the hand swings in and lands on the forehead', () => {
  assert.equal(handPose(100), null);
  const mid = handPose(450);
  const land = handPose(620);
  assert.ok(mid.x > land.x && mid.y > land.y, 'comes up from the bottom right');
  assert.ok(land.y < 0, 'on the forehead, above the centre');
  assert.ok(Math.abs(handPose(3000).y - land.y) < 0.1, 'stays there');
});

test('cartoon colours stay valid and keep the tone', () => {
  for (const c of [[40, 25, 20], [150, 115, 90], [250, 220, 200]]) {
    for (const f of [toonSkin, toonHair, toonShirt]) {
      const o = f(c);
      assert.equal(o.length, 3);
      assert.ok(o.every(Number.isFinite));
    }
  }
  assert.ok(toonSkin([150, 115, 90])[0] > 150, 'skin is brightened');
  const l = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  assert.ok(l(toonSkin([60, 40, 30])) < l(toonSkin([230, 190, 170])), 'dark skin stays darker than light skin');
});
