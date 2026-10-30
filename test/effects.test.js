const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/effects.js');

const { mediaFrameAt, mediaDuration, facepalmDuration, gifFrameMs } = globalThis.PlotTwistEffects;

const gif = { frames: [{ ms: 100 }, { ms: 50 }, { ms: 150 }] };

test('animated facepalm: picks the frame showing at each moment', () => {
  assert.equal(mediaFrameAt(gif, 0), gif.frames[0]);
  assert.equal(mediaFrameAt(gif, 99), gif.frames[0]);
  assert.equal(mediaFrameAt(gif, 100), gif.frames[1]);
  assert.equal(mediaFrameAt(gif, 149), gif.frames[1]);
  assert.equal(mediaFrameAt(gif, 150), gif.frames[2]);
  assert.equal(mediaFrameAt(gif, 299), gif.frames[2]);
});

test('animated facepalm: holds the last frame instead of looping, and clamps early times', () => {
  assert.equal(mediaFrameAt(gif, 300), gif.frames[2]);
  assert.equal(mediaFrameAt(gif, 10000), gif.frames[2]);
  assert.equal(mediaFrameAt(gif, -5), gif.frames[0]);
});

test('a still image is a single frame', () => {
  const still = { frames: [{ ms: Infinity }] };
  assert.equal(mediaFrameAt(still, 0), still.frames[0]);
  assert.equal(mediaFrameAt(still, 5000), still.frames[0]);
  assert.equal(mediaDuration(still), Infinity);
});

test('the facepalm effect lasts as long as the GIF plays once (bounded), else the default', () => {
  assert.equal(mediaDuration(gif), 300);
  assert.equal(facepalmDuration({ frames: [{ ms: 1950 }] }), 1950);
  assert.equal(facepalmDuration({ frames: [{ ms: 200 }] }), 1500, 'too short: at least 1.5 s');
  assert.equal(facepalmDuration({ frames: [{ ms: 60000 }] }), 6000, 'too long: at most 6 s');
  assert.equal(facepalmDuration({ frames: [{ ms: Infinity }] }), 2500, 'still image: default');
  assert.equal(facepalmDuration(null), 2500, 'emoji placeholder: default');
});

test('empty or missing media has no frame', () => {
  assert.equal(mediaFrameAt(null, 0), null);
  assert.equal(mediaFrameAt({ frames: [] }, 0), null);
});

test('GIF frame delays: microseconds to ms, with the browser minimum for 0–10 ms delays', () => {
  assert.equal(gifFrameMs(50000), 50);
  assert.equal(gifFrameMs(0), 100);
  assert.equal(gifFrameMs(10000), 100);
  assert.equal(gifFrameMs(null), 100);
  assert.equal(gifFrameMs(20000), 20);
});
