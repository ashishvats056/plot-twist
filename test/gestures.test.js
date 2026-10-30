const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../src/gestures.js');

// Builds 21 MediaPipe hand landmarks (normalized coords, y grows downward).
// cx/cy = wrist position, size = wrist→middle-MCP distance. Like a real snap,
// the middle finger is straight while pressed to the thumb (pinch < 0.5) and
// curled into the palm once sprung open, unless `folded` says otherwise.
function hand({ cx = 0.7, cy = 0.6, size = 0.1, pinch = 1, raised = false, folded = !raised && pinch >= 0.5 } = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  const up = (k) => cy - size * k;
  lm[0] = { x: cx, y: cy, z: 0 };
  // MCPs
  lm[5] = { x: cx - size * 0.3, y: up(1), z: 0 };
  lm[9] = { x: cx, y: up(1), z: 0 };
  lm[13] = { x: cx + size * 0.2, y: up(0.95), z: 0 };
  lm[17] = { x: cx + size * 0.4, y: up(0.85), z: 0 };
  // PIPs
  lm[6] = { x: cx - size * 0.35, y: up(1.4), z: 0 };
  lm[10] = { x: cx, y: up(1.45), z: 0 };
  lm[14] = { x: cx + size * 0.22, y: up(1.4), z: 0 };
  lm[18] = { x: cx + size * 0.42, y: up(1.25), z: 0 };
  // Tips: extended when raised, curled otherwise
  const tipK = raised ? 2 : 1.2;
  lm[8] = { x: cx - size * 0.4, y: up(tipK + 0.1), z: 0 };
  lm[16] = { x: cx + size * 0.25, y: up(tipK), z: 0 };
  lm[20] = { x: cx + size * 0.45, y: up(tipK - 0.2), z: 0 };
  // Middle tip: extended when raised, straight-ish when not folded, curled when folded.
  // Thumb tip sits `pinch * size` away from it.
  const middleK = raised ? tipK + 0.15 : folded ? 1.35 : 1.7;
  lm[12] = { x: cx, y: up(middleK), z: 0 };
  lm[4] = { x: lm[12].x - pinch * size, y: lm[12].y, z: 0 };
  return lm;
}

const FACE = { x: 0.4, y: 0.25, w: 0.2, h: 0.3, noseY: 0.4 };
const frame = (hands, face = FACE) => ({ hands: hands.map((landmarks) => ({ landmarks })), face });

function run(engine, steps) {
  const events = [];
  for (const [t, result] of steps) events.push(...engine.update(result, t).map((e) => [e, t]));
  return events;
}

test('pinchRatio is thumb–middle distance relative to hand size', () => {
  assert.ok(Math.abs(G.pinchRatio(hand({ pinch: 0.2 })) - 0.2) < 1e-9);
  assert.ok(Math.abs(G.pinchRatio(hand({ pinch: 1 })) - 1) < 1e-9);
});

// A camera-seen snap: thumb pressed to middle finger (ratio < 0.25) for at least
// 250 ms, then sprung open (> 0.55) within 150 ms of the last pressed frame.
test('a held press then a fast spring open is a snap, resolved after the double window', () => {
  const e = G.createGestureEngine();
  const ev = run(e, [
    [0, frame([hand({ pinch: 0.2 })])],
    [150, frame([hand({ pinch: 0.2 })])],
    [300, frame([hand({ pinch: 0.2 })])],
    [350, frame([hand({ pinch: 1 })])],
    [700, frame([hand({ pinch: 1 })])],
    [1100, frame([hand({ pinch: 1 })])],
  ]);
  assert.deepEqual(ev.map(([x]) => x), ['snap']);
  assert.equal(ev[0][1], 1100);
});

test('slow pinch release is not a snap', () => {
  const e = G.createGestureEngine();
  const ev = run(e, [
    [0, frame([hand({ pinch: 0.2 })])],
    [1000, frame([hand({ pinch: 1 })])],
    [2000, frame([hand({ pinch: 1 })])],
  ]);
  assert.deepEqual(ev, []);
});

test('a brief pinch-release without a held press is not a snap (talking hands)', () => {
  const e = G.createGestureEngine();
  const ev = run(e, [[0, frame([hand({ pinch: 0.2 })])], [40, frame([hand({ pinch: 0.9 })])], [1500, frame([hand({ pinch: 0.9 })])]]);
  assert.deepEqual(ev, []);
});

test('a wobble to 0.3 during the press does not break it', () => {
  const e = G.createGestureEngine();
  const ev = run(e, [
    [0, frame([hand({ pinch: 0.2 })])],
    [150, frame([hand({ pinch: 0.3 })])],
    [300, frame([hand({ pinch: 0.2 })])],
    [350, frame([hand({ pinch: 1 })])],
    [1100, frame([hand({ pinch: 1 })])],
  ]);
  assert.deepEqual(ev.map(([x]) => x), ['snap']);
});

test('a partial spring open (ratio ~0.56) still counts', () => {
  const e = G.createGestureEngine();
  const ev = run(e, [
    [0, frame([hand({ pinch: 0.2 })])],
    [150, frame([hand({ pinch: 0.2 })])],
    [300, frame([hand({ pinch: 0.2 })])],
    [340, frame([hand({ pinch: 0.56 })])],
    [1100, frame([hand({ pinch: 0.56 })])],
  ]);
  assert.deepEqual(ev.map(([x]) => x), ['snap']);
});

test('double snap: the second snap needs no long press', () => {
  const e = G.createGestureEngine();
  const ev = run(e, [
    [0, frame([hand({ pinch: 0.2 })])],
    [150, frame([hand({ pinch: 0.2 })])],
    [300, frame([hand({ pinch: 0.2 })])],
    [350, frame([hand({ pinch: 1 })])],
    [450, frame([hand({ pinch: 0.2 })])],
    [550, frame([hand({ pinch: 0.2 })])],
    [600, frame([hand({ pinch: 1 })])],
    [1500, frame([hand({ pinch: 1 })])],
  ]);
  assert.deepEqual(ev.map(([x]) => x), ['doubleSnap']);
});

test('fingers springing open over two frames (0.50, 0.54, then 0.69) is a snap', () => {
  const e = G.createGestureEngine();
  const ev = run(e, [
    [0, frame([hand({ pinch: 0.1 })])],
    [300, frame([hand({ pinch: 0.1 })])],
    [600, frame([hand({ pinch: 0.1 })])],
    [660, frame([hand({ pinch: 0.5 })])],
    [710, frame([hand({ pinch: 0.54 })])],
    [760, frame([hand({ pinch: 0.69 })])],
    [1500, frame([hand({ pinch: 0.9 })])],
  ]);
  assert.deepEqual(ev.map(([x]) => x), ['snap']);
});

test('a rise that drops back down cancels the press (hand sliding off the face)', () => {
  const e = G.createGestureEngine();
  const ev = run(e, [
    [0, frame([hand({ pinch: 0.1 })])],
    [400, frame([hand({ pinch: 0.1 })])],
    [450, frame([hand({ pinch: 0.45 })])],
    [500, frame([hand({ pinch: 0.3 })])],
    [550, frame([hand({ pinch: 0.24 })])],
    [670, frame([hand({ pinch: 0.92 })])],
    [1500, frame([hand({ pinch: 0.92 })])],
  ]);
  assert.deepEqual(ev, []);
});

test('a one-frame pinch flicker between the two snaps of a double is not a third snap', () => {
  const e = G.createGestureEngine();
  const ev = run(e, [
    [0, frame([hand({ pinch: 0.1 })])],
    [300, frame([hand({ pinch: 0.1 })])],
    [330, frame([hand({ pinch: 0.77 })])],
    [480, frame([hand({ pinch: 0.13 })])],
    [520, frame([hand({ pinch: 0.57 })])],
    [670, frame([hand({ pinch: 0.21 })])],
    [710, frame([hand({ pinch: 0.1 })])],
    [740, frame([hand({ pinch: 0.61 })])],
    [1600, frame([hand({ pinch: 0.9 })])],
  ]);
  assert.deepEqual(ev.map(([x]) => x), ['doubleSnap']);
});

test('three snaps seen by the camera are a doubleSnap, not discarded as typing', () => {
  const e = G.createGestureEngine();
  const steps = [];
  for (const start of [0, 400, 800]) {
    steps.push([start, frame([hand({ pinch: 0.1 })])], [start + 300, frame([hand({ pinch: 0.1 })])], [start + 340, frame([hand({ pinch: 0.9 })])]);
  }
  const ev = run(e, [...steps, [2000, frame([hand({ pinch: 0.9 })])]]);
  assert.deepEqual(ev.map(([x]) => x), ['doubleSnap']);
});

test('opening into an open hand (fingers extended) is not a snap: a snap ends with the middle finger in the palm', () => {
  const e = G.createGestureEngine();
  const ev = run(e, [
    [0, frame([hand({ pinch: 0.15 })])],
    [300, frame([hand({ pinch: 0.15 })])],
    [600, frame([hand({ pinch: 0.15 })])],
    [650, frame([hand({ pinch: 0.9, raised: true })])],
    [700, frame([hand({ pinch: 1, raised: true })])],
    [1500, frame([hand({ pinch: 1, raised: true })])],
  ]);
  assert.deepEqual(ev, []);
});

test('the middle finger may land in the palm a frame after the spring', () => {
  const e = G.createGestureEngine();
  const ev = run(e, [
    [0, frame([hand({ pinch: 0.15 })])],
    [300, frame([hand({ pinch: 0.15 })])],
    [600, frame([hand({ pinch: 0.15 })])],
    [650, frame([hand({ pinch: 0.9, raised: true })])],
    [690, frame([hand({ pinch: 0.9 })])],
    [1500, frame([hand({ pinch: 0.9 })])],
  ]);
  assert.deepEqual(ev.map(([x]) => x), ['snap']);
});

test('a pinch made with the middle finger already curled (fist / thinking pose) is not a snap', () => {
  const e = G.createGestureEngine();
  const fist = (pinch) => frame([hand({ pinch, folded: true })]);
  const ev = run(e, [[0, fist(0.1)], [150, fist(0.1)], [300, fist(0.1)], [350, fist(0.6)], [1200, fist(0.6)]]);
  assert.deepEqual(ev, []);
});

test('a slow spring (fingers open over ~250 ms) still counts', () => {
  const e = G.createGestureEngine();
  const ev = run(e, [
    [0, frame([hand({ pinch: 0.12 })])],
    [300, frame([hand({ pinch: 0.12 })])],
    [340, frame([hand({ pinch: 0.36 })])],
    [430, frame([hand({ pinch: 0.48 })])],
    [510, frame([hand({ pinch: 0.52 })])],
    [550, frame([hand({ pinch: 0.63 })])],
    [1300, frame([hand({ pinch: 0.68 })])],
  ]);
  assert.deepEqual(ev.map(([x]) => x), ['snap']);
});

test('a camera-only snap right before the palm lands on the face is dropped (hand moving to the face)', () => {
  const e = G.createGestureEngine();
  const near = (pinch) => frame([hand({ cx: 0.9, cy: 0.9, size: 0.15, pinch })]);
  const palmOnFace = frame([hand({ cx: 0.5, cy: 0.55, size: 0.15, raised: true })]);
  const ev = run(e, [[0, near(0.15)], [300, near(0.15)], [340, near(0.9)], [500, palmOnFace], [700, palmOnFace], [950, palmOnFace], [1500, palmOnFace]]);
  assert.ok(!ev.some(([x]) => x === 'snap' || x === 'doubleSnap'));
});

test('both hands snapping at the same moment is a doubleSnap, even with a mic click', () => {
  const e = G.createGestureEngine();
  const both = (pinch) => frame([hand({ cx: 0.25, pinch }), hand({ cx: 0.75, pinch })]);
  run(e, [[0, both(0.12)], [150, both(0.12)], [300, both(0.12)]]);
  e.onAudioTransient(320);
  const ev = run(e, [[340, both(0.8)], [1200, both(0.9)]]);
  assert.deepEqual(ev.map(([x]) => x), ['doubleSnap']);
});

test('a facepalm held for 6 s fires once', () => {
  const e = G.createGestureEngine();
  const palm = frame([hand({ cx: 0.5, cy: 0.55, size: 0.15, raised: true })]);
  const steps = Array.from({ length: 31 }, (_, i) => [i * 200, palm]);
  const ev = run(e, steps);
  assert.deepEqual(ev.map(([x]) => x), ['facepalm']);
});

test('second snap of a double: one re-pressed frame between the snaps is enough', () => {
  const e = G.createGestureEngine();
  const ev = run(e, [
    [0, frame([hand({ pinch: 0.1 })])],
    [240, frame([hand({ pinch: 0.1 })])],
    [280, frame([hand({ pinch: 0.84 })])],
    [400, frame([hand({ pinch: 0.28 })])],
    [440, frame([hand({ pinch: 0.16 })])],
    [470, frame([hand({ pinch: 0.82 })])],
    [1300, frame([hand({ pinch: 1 })])],
  ]);
  assert.deepEqual(ev.map(([x]) => x), ['doubleSnap']);
});

test('mic click while the hand is pressed is a snap even if the release is not seen', () => {
  const e = G.createGestureEngine();
  run(e, [[2000, frame([hand({ pinch: 0.2 })])]]);
  e.onAudioTransient(2150);
  const ev = run(e, [[2200, frame([])], [3000, frame([])]]);
  assert.deepEqual(ev.map(([x]) => x), ['snap']);
});

test('mic click and camera-seen release of the same snap count once', () => {
  const e = G.createGestureEngine();
  run(e, [[0, frame([hand({ pinch: 0.2 })])], [150, frame([hand({ pinch: 0.2 })])], [300, frame([hand({ pinch: 0.2 })])]]);
  e.onAudioTransient(330);
  const ev = run(e, [[350, frame([hand({ pinch: 1 })])], [1200, frame([hand({ pinch: 1 })])]]);
  assert.deepEqual(ev.map(([x]) => x), ['snap']);
});

test('a mic click with a hand seen in the last 1.5 s is a snap, no pinch needed', () => {
  const e = G.createGestureEngine();
  run(e, [[0, frame([hand({ pinch: 1 })])], [100, frame([])]]);
  e.onAudioTransient(1200);
  const ev = run(e, [[1300, frame([])], [2000, frame([])]]);
  assert.deepEqual(ev.map(([x]) => x), ['snap']);
});

test('two clicks 400 ms apart are a doubleSnap', () => {
  const e = G.createGestureEngine();
  run(e, [[0, frame([hand()])]]);
  e.onAudioTransient(100);
  e.onAudioTransient(500);
  const ev = run(e, [[600, frame([hand()])], [1300, frame([hand()])]]);
  assert.deepEqual(ev.map(([x]) => x), ['doubleSnap']);
});

test('a burst of 3+ clicks (typing) is ignored', () => {
  const e = G.createGestureEngine();
  run(e, [[0, frame([hand()])]]);
  for (const t of [100, 300, 450, 700]) e.onAudioTransient(t);
  const ev = run(e, [[800, frame([hand()])], [2000, frame([hand()])]]);
  assert.deepEqual(ev, []);
});

test('both hands raised but held close together near the face is not cinema', () => {
  const e = G.createGestureEngine();
  const close = [hand({ cx: 0.46, cy: 0.3, raised: true }), hand({ cx: 0.54, cy: 0.3, raised: true })];
  const ev = run(e, [[0, frame(close)], [300, frame(close)], [600, frame(close)]]);
  assert.ok(!ev.some(([x]) => x === 'cinema'));
});

test('mic click with no hand in view is ignored', () => {
  const e = G.createGestureEngine();
  e.onAudioTransient(100);
  assert.deepEqual(run(e, [[200, frame([])], [2000, frame([])]]), []);
});

test('mic click during a clap (two hands together) is ignored', () => {
  const e = G.createGestureEngine();
  const clap = [hand({ cx: 0.5, pinch: 0.2 }), hand({ cx: 0.52, pinch: 0.2 })];
  run(e, [[0, frame(clap)]]);
  e.onAudioTransient(50);
  assert.deepEqual(run(e, [[100, frame(clap)], [2000, frame(clap)]]), []);
});

test('both hands raised above eye level, held, emits cinema once per cooldown', () => {
  const e = G.createGestureEngine();
  const up = [hand({ cx: 0.3, cy: 0.3, raised: true }), hand({ cx: 0.7, cy: 0.3, raised: true })];
  const ev = run(e, [[0, frame(up)], [200, frame(up)], [400, frame(up)], [800, frame(up)], [1500, frame(up)]]);
  assert.deepEqual(ev.map(([x]) => x), ['cinema']);
  assert.equal(ev[0][1], 400);
});

test('one raised hand is not cinema', () => {
  const e = G.createGestureEngine();
  const one = [hand({ cx: 0.2, cy: 0.3, raised: true }), hand({ cx: 0.8, cy: 0.9 })];
  assert.deepEqual(run(e, [[0, frame(one)], [500, frame(one)], [1000, frame(one)]]), []);
});

test('open hands gesturing at chest height are not cinema', () => {
  const e = G.createGestureEngine();
  const chest = [hand({ cx: 0.2, cy: 0.75, raised: true }), hand({ cx: 0.8, cy: 0.75, raised: true })];
  assert.deepEqual(run(e, [[0, frame(chest)], [500, frame(chest)], [1000, frame(chest)]]), []);
});

test('palm over the forehead, just above the face box, is a facepalm', () => {
  const e = G.createGestureEngine();
  const palm = hand({ cx: 0.5, cy: 0.28, size: 0.15, raised: true });
  const ev = run(e, [[0, frame([palm])], [200, frame([palm])], [400, frame([palm])]]);
  assert.deepEqual(ev.map(([x]) => x), ['facepalm']);
});

test('a snapping hand (thumb pressed to middle finger) in front of the face is not a facepalm', () => {
  const e = G.createGestureEngine();
  const snapping = hand({ cx: 0.5, cy: 0.55, size: 0.15, pinch: 0.15 });
  const ev = run(e, [[0, frame([snapping])], [300, frame([snapping])], [600, frame([snapping])]]);
  assert.deepEqual(ev, []);
});

test('a snap made right in front of the face still counts', () => {
  const e = G.createGestureEngine();
  const at = (pinch) => frame([hand({ cx: 0.5, cy: 0.55, size: 0.15, pinch })]);
  const ev = run(e, [[0, at(0.15)], [150, at(0.15)], [300, at(0.15)], [340, at(0.9)], [1100, at(0.9)]]);
  assert.deepEqual(ev.map(([x]) => x), ['snap']);
});

test('palm held over the face emits facepalm, even if the face is lost', () => {
  const e = G.createGestureEngine();
  run(e, [[0, frame([], FACE)]]);
  const palm = hand({ cx: 0.5, cy: 0.55, size: 0.15, raised: true });
  const ev = run(e, [[100, frame([palm], null)], [300, frame([palm], null)], [500, frame([palm], null)]]);
  assert.deepEqual(ev.map(([x]) => x), ['facepalm']);
});

test('a press-and-spring right after a facepalm (hand leaving the face) is not a snap', () => {
  const e = G.createGestureEngine();
  const palmOnFace = frame([hand({ cx: 0.5, cy: 0.55, size: 0.15, raised: true })]);
  const offFace = (pinch) => frame([hand({ cx: 0.9, cy: 0.9, size: 0.15, pinch })]);
  const ev = run(e, [[0, palmOnFace], [80, palmOnFace], [100, offFace(0.2)], [380, offFace(0.2)], [420, offFace(0.9)], [1500, offFace(0.9)]]);
  assert.deepEqual(ev.map(([x]) => x), []);
});

test('manual trigger bypasses detection', () => {
  const e = G.createGestureEngine();
  assert.deepEqual(e.trigger('cinema', 0), ['cinema']);
});

test('audio transient detector: fires on a sharp click, not on steady noise', () => {
  const d = G.createAudioTransientDetector();
  const noise = (amp) => Float32Array.from({ length: 1024 }, () => (Math.random() * 2 - 1) * amp);
  for (let i = 0; i < 50; i++) assert.equal(d.process(noise(0.01), i * 21), false);
  const click = noise(0.01);
  for (let i = 500; i < 540; i++) click[i] = i % 2 ? 0.6 : -0.6;
  assert.equal(d.process(click, 2000), true);
  assert.equal(d.process(click, 2050), false, 'debounced');
});

test('audio transient detector: a sharp click over loud background noise still fires', () => {
  const d = G.createAudioTransientDetector();
  const noise = () => Float32Array.from({ length: 1024 }, () => (Math.random() * 2 - 1) * 0.08);
  for (let i = 0; i < 50; i++) d.process(noise(), i * 21);
  const click = noise();
  for (let i = 500; i < 512; i++) click[i] = i % 2 ? 0.7 : -0.7;
  assert.equal(d.process(click, 2000), true);
});

test('audio transient detector: a loud low-frequency hum is not a snap', () => {
  const d = G.createAudioTransientDetector();
  const hum = Float32Array.from({ length: 1024 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 100 * i) / 48000));
  for (let i = 0; i < 20; i++) d.process(new Float32Array(1024).fill(0.001), i * 21);
  assert.equal(d.process(hum, 1000), false);
});
