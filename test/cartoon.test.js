const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/cartoon.js');

const { faceCrop, cartoonize, compose, growMask, averageColor, handColor } = globalThis.PlotTwistCartoon;

const solid = (w, h, rgb) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) d.set([...rgb, 255], i);
  return d;
};

test('the face crop is a square around the face, larger than the face box', () => {
  const c = faceCrop({ x: 0.4, y: 0.3, w: 0.2, h: 0.3 }, 1280, 720);
  assert.equal(c.size, Math.round(0.2 * 1280 * 1.9), 'from the larger side of the face box');
  assert.ok(c.size > 0.2 * 1280);
  const cx = c.x + c.size / 2;
  assert.ok(Math.abs(cx - 640) < 2, 'centred on the face horizontally');
});

test('the face crop stays inside the frame near the edges', () => {
  for (const face of [{ x: 0, y: 0, w: 0.2, h: 0.3 }, { x: 0.85, y: 0.75, w: 0.15, h: 0.25 }, { x: 0.1, y: 0.1, w: 0.9, h: 0.9 }]) {
    const c = faceCrop(face, 640, 360);
    assert.ok(c.x >= 0 && c.y >= 0, JSON.stringify(c));
    assert.ok(c.x + c.size <= 640 && c.y + c.size <= 360, JSON.stringify(c));
  }
});

test('a flat area becomes one flat colour, with no ink', () => {
  const out = cartoonize(solid(24, 24, [200, 120, 90]), 24, 24);
  const first = [...out.slice(0, 4)];
  for (let i = 0; i < out.length; i += 4) assert.deepEqual([...out.slice(i, i + 4)], first);
  assert.notDeepEqual(first.slice(0, 3), [38, 30, 48]);
  assert.ok(first[0] > first[1] && first[1] > first[2], 'keeps the hue');
});

test('a sharp edge gets an ink line, flat areas on each side do not', () => {
  const w = 40; const h = 12;
  const d = solid(w, h, [240, 240, 240]);
  for (let y = 0; y < h; y++) for (let x = 20; x < w; x++) d.set([20, 20, 20], (y * w + x) * 4);
  const out = cartoonize(d, w, h);
  const px = (x, y) => [...out.slice((y * w + x) * 4, (y * w + x) * 4 + 3)];
  const ink = [38, 30, 48];
  assert.ok([18, 19, 20, 21].some((x) => px(x, 6).join() === ink.join()), 'ink on the edge');
  assert.notDeepEqual(px(3, 6), ink);
  assert.notDeepEqual(px(36, 6), ink);
});

test('the hand takes the sampled skin colour, lifted when very dark', () => {
  const d = solid(10, 10, [200, 150, 120]);
  assert.deepEqual(averageColor(d, 10, 10, { x: 0.2, y: 0.2, w: 0.5, h: 0.5 }), [200, 150, 120]);
  assert.deepEqual(handColor([200, 150, 120]), [200, 150, 120]);
  const dark = handColor([30, 20, 15]);
  assert.ok(0.299 * dark[0] + 0.587 * dark[1] + 0.114 * dark[2] >= 89);
});

test('growMask widens a mask by r pixels and no more', () => {
  const w = 9; const h = 9;
  const m = new Uint8ClampedArray(w * h);
  m[4 * w + 4] = 255;
  const g = growMask(m, w, h, 2);
  assert.equal(g[4 * w + 6], 255);
  assert.equal(g[2 * w + 2], 255);
  assert.equal(g[4 * w + 7], 0);
  assert.equal(g[1 * w + 4], 0);
});

test('compose keeps the person, inks a rim round them, and backs them with the backdrop', () => {
  const w = 40; const h = 40;
  const toon = solid(w, h, [200, 100, 50]);
  const mask = new Uint8ClampedArray(w * h);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) mask[y * w + x] = 255;
  const out = compose(toon, mask, w, h);
  const px = (x, y) => [...out.slice((y * w + x) * 4, (y * w + x) * 4 + 3)];
  assert.deepEqual(px(20, 20), [200, 100, 50], 'person kept');
  assert.deepEqual(px(9, 20), [38, 30, 48], 'ink outline just outside');
  const bg = px(2, 2);
  assert.ok(bg[2] > bg[0], 'blue backdrop far outside');
  assert.deepEqual([...compose(toon, null, w, h).slice(0, 3)], [200, 100, 50], 'no mask: whole crop');
});
