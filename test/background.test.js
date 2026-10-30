const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/background.js');

const { fillScanlines } = globalThis.PlotTwistBackground;

// Builds an RGBA buffer from rows of [r, a] pairs (g = b = r for brevity).
function image(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const d = new Uint8ClampedArray(w * h * 4);
  rows.flat().forEach(([v, a], i) => { d.set([v, v, v, a], i * 4); });
  return { d, w, h };
}
const px = (img, x, y) => Array.from(img.d.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));

test('a gap between two known pixels is blended across the row', () => {
  const img = image([[[0, 255], [0, 0], [0, 0], [0, 0], [200, 255]]]);
  fillScanlines(img.d, img.w, img.h);
  assert.deepEqual(px(img, 2, 0), [100, 100, 100, 255]);
  assert.deepEqual(px(img, 1, 0), [50, 50, 50, 255]);
});

test('a gap touching the edge copies the nearest known pixel', () => {
  const img = image([[[0, 0], [0, 0], [80, 255]]]);
  fillScanlines(img.d, img.w, img.h);
  assert.deepEqual(px(img, 0, 0), [80, 80, 80, 255]);
});

test('a row with nothing known is filled from the rows above and below', () => {
  const img = image([
    [[0, 255], [0, 255]],
    [[0, 0], [0, 0]],
    [[100, 255], [100, 255]],
  ]);
  fillScanlines(img.d, img.w, img.h);
  assert.deepEqual(px(img, 1, 1), [50, 50, 50, 255]);
});

test('half-transparent pixels count as known and become opaque', () => {
  const img = image([[[60, 200], [0, 0]]]);
  fillScanlines(img.d, img.w, img.h);
  assert.deepEqual(px(img, 0, 0), [60, 60, 60, 255]);
  assert.deepEqual(px(img, 1, 0), [60, 60, 60, 255]);
});

test('an image with nothing known stays transparent', () => {
  const img = image([[[0, 0], [0, 0]]]);
  fillScanlines(img.d, img.w, img.h);
  assert.equal(px(img, 0, 0)[3], 0);
});

const { convexHull } = globalThis.PlotTwistBackground;

test('convexHull returns the outline of a point cloud, dropping inner points', () => {
  const hull = convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 0.5]]);
  assert.deepEqual(new Set(hull.map(String)), new Set(['0,0', '2,0', '2,2', '0,2']));
});

test('convexHull of fewer than 3 points returns them unchanged', () => {
  assert.deepEqual(convexHull([[1, 1], [2, 2]]), [[1, 1], [2, 2]]);
});
