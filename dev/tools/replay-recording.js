// Replays a raw landmark recording (from __plottwist.exportRaw + the guided prompter) through the gesture engine, step by step.
// Usage: node dev/tools/replay-recording.js src/gestures.js dev/recordings/recording-1-tuning.json [-v]
const fs = require('fs');
const G = require(require('path').resolve(process.argv[2]));
const data = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const verbose = process.argv[4] === '-v';
const toHand = (h) => ({ handedness: h.s, landmarks: h.l.map(([x, y]) => ({ x, y })) });
const frames = data.raw.map((r) => ({ t: r.t, hands: r.h.map(toHand), face: r.f }));
const clicks = data.clicks.map((c) => c.t);
const steps = data.steps;
const stepOf = (t) => { let s = 'before'; for (const st of steps) if (t >= st.t) s = st.label; return s; };
const e = G.createGestureEngine();
const events = [];
let ci = 0;
let lastFace = null;
for (const f of frames) {
  while (ci < clicks.length && clicks[ci] <= f.t) { e.onAudioTransient(clicks[ci]); events.push([clicks[ci], '(mic click)']); ci++; }
  if (f.face) lastFace = f.face;
  e.update(f, f.t).forEach((x) => events.push([f.t, x]));
}
for (let t = frames[frames.length - 1].t; t < frames[frames.length - 1].t + 1500; t += 50) e.tick(t).forEach((x) => events.push([t, x]));
console.log(`frames ${frames.length}, mic clicks ${clicks.length}, span ${((frames[frames.length - 1].t - frames[0].t) / 1000).toFixed(1)}s`);
for (const st of [{ label: 'before', t: -Infinity }, ...steps]) {
  const evs = events.filter(([t]) => stepOf(t) === st.label).map(([t, x]) => `${((t - st.t) / 1000).toFixed(2)}s ${x}`);
  console.log(`\n== ${st.label}: ${evs.join(', ') || '(no events)'}`);
  if (!verbose || st.t === -Infinity) continue;
  const fr = frames.filter((f) => stepOf(f.t) === st.label);
  const line = fr.filter((f) => f.hands.length).map((f) => {
    const face = f.face || lastFace;
    return `${((f.t - st.t) / 1000).toFixed(2)}:` + f.hands.map((h) => {
      const lm = h.landmarks;
      const tags = [G.pinchRatio(lm).toFixed(2), G.isMiddleFolded(lm) ? 'F' : '', G.isOpenPalm(lm) ? 'O' : '', face && G.isPalmOnFace(lm, face) ? 'P' : ''].join('');
      return tags;
    }).join('/');
  });
  console.log(line.join(' '));
}
