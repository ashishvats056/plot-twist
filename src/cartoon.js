// Cartoon facepalm: a cute animated character of you (big head, big eyes)
// slapping its forehead. It is drawn in code, personalised from one camera
// frame: your skin tone, hair colour, glasses, beard and shirt colour. Only
// those few colours and yes/no traits are kept, in memory, for that camera
// session; no picture of you is kept. Until it is ready, the 🤦 emoji stands
// in. The trait reading and the timeline below are pure and unit-tested.
(function (root) {
  'use strict';

  const POP_MS = 260; // sticker pops in
  const BLINK_AT_MS = 200;
  const SLAP_FROM_MS = 360; // hand swings in…
  const SLAP_AT_MS = 620; // …and lands on the forehead
  const WOBBLE_MS = 240; // squash after the slap
  const SIGH_AT_MS = 1350; // eyes go from squeezed shut to resigned, with a sigh
  const ANALYSE_W = 640; // the frame is read at this width
  const INK = [43, 34, 51];

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const easeOutBack = (k) => 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;
  const easeInCubic = (k) => k * k * k;
  const easeInOut = (k) => k * k * (3 - 2 * k);
  const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const luma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const rgb = (c, a = 1) => `rgba(${c.map((v) => Math.round(clamp(v, 0, 255))).join(',')},${a})`;
  const light = (c, k) => mix(c, [255, 255, 255], k);
  const dark = (c, k) => mix(c, [0, 0, 0], k);

  // ---- Reading you from one frame (pure: RGBA pixels in, traits out) ----

  // Pixels in a box (px), optionally only where the person mask is on.
  function pixels(d, w, h, x0, y0, x1, y1, mask) {
    const out = [];
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) {
        const p = y * w + x;
        if (mask && mask[p] < 128) continue;
        out.push([d[p * 4], d[p * 4 + 1], d[p * 4 + 2]]);
      }
    }
    return out;
  }

  function median(px) {
    if (!px.length) return null;
    return [0, 1, 2].map((c) => {
      const v = px.map((p) => p[c]).sort((a, b) => a - b);
      return v[v.length >> 1];
    });
  }

  const meanLuma = (px) => (px.length ? px.reduce((s, p) => s + luma(p), 0) / px.length : 255);

  // face: detector box (normalised) with kp: [right eye, left eye, nose tip,
  // mouth] as normalised [x, y]. mask (optional): 0–255 per pixel, person = on.
  function readTraits(d, w, h, face, mask) {
    const fw = face.w * w;
    const fh = face.h * h;
    const kp = face.kp && face.kp.length >= 4 ? face.kp.map(([x, y]) => [x * w, y * h]) : [
      [(face.x + face.w * 0.32) * w, (face.y + face.h * 0.4) * h],
      [(face.x + face.w * 0.68) * w, (face.y + face.h * 0.4) * h],
      [(face.x + face.w * 0.5) * w, (face.y + face.h * 0.6) * h],
      [(face.x + face.w * 0.5) * w, (face.y + face.h * 0.78) * h],
    ];
    const [eR, eL, , mouth] = kp;
    const ed = Math.max(4, Math.hypot(eL[0] - eR[0], eL[1] - eR[1])); // eye distance
    const eyeY = (eR[1] + eL[1]) / 2;
    const midX = (eR[0] + eL[0]) / 2;
    const box = (cx, cy, rx, ry, m) => pixels(d, w, h, cx - rx, cy - ry, cx + rx, cy + ry, m);

    // skin: the cheeks, under each eye
    const cheekY = (eyeY + mouth[1]) / 2 + 0.05 * ed;
    const skin = median([...box(eR[0] - 0.05 * ed, cheekY, 0.12 * ed, 0.1 * ed), ...box(eL[0] + 0.05 * ed, cheekY, 0.12 * ed, 0.1 * ed)])
      || [224, 172, 135];
    const skinL = Math.max(1, luma(skin));
    const dip = (l) => (skinL - l) / skinL; // how much darker than the skin, 0–1

    // hair: the band above the face box (the box top is mid-forehead), on you
    const top = face.y * h;
    const above = box(midX, top - 0.3 * fh, 0.28 * fw, 0.15 * fh, mask);
    const hairPx = above.filter((p) => dist(p, skin) > 45);
    const bald = hairPx.length < above.length * 0.3;
    const hair = bald ? dark(skin, 0.25) : median(hairPx);

    // glasses: dark frame lines at the bridge, beside and under each eye
    const rowMin = (x0, x1, y0, y1) => {
      let m = 255;
      for (let y = Math.round(y0); y <= Math.round(y1); y++) m = Math.min(m, meanLuma(pixels(d, w, h, x0, y, x1, y + 1)));
      return m;
    };
    const colMin = (x0, x1, y0, y1) => {
      let m = 255;
      const [a, b] = x0 < x1 ? [x0, x1] : [x1, x0];
      for (let x = Math.round(a); x <= Math.round(b); x++) m = Math.min(m, meanLuma(pixels(d, w, h, x, y0, x + 1, y1)));
      return m;
    };
    const probes = [
      rowMin(midX - 0.05 * ed, midX + 0.05 * ed, eyeY - 0.3 * ed, eyeY + 0.1 * ed), // bridge
      colMin(eR[0] - 0.3 * ed, eR[0] - 0.55 * ed, eyeY - 0.06 * ed, eyeY + 0.06 * ed), // outer rims
      colMin(eL[0] + 0.3 * ed, eL[0] + 0.55 * ed, eyeY - 0.06 * ed, eyeY + 0.06 * ed),
      rowMin(eR[0] - 0.1 * ed, eR[0] + 0.1 * ed, eR[1] + 0.22 * ed, eR[1] + 0.45 * ed), // lower rims
      rowMin(eL[0] - 0.1 * ed, eL[0] + 0.1 * ed, eL[1] + 0.22 * ed, eL[1] + 0.45 * ed),
    ].map(dip);
    const glasses = probes.filter((p) => p > 0.35).length >= 3;

    // beard: many dark pixels on the chin that are greyer than the skin
    // (a shadow keeps the skin's warm colour, hair doesn't); moustache likewise
    const warmth = (p) => (p[0] - p[2]) / Math.max(1, luma(p));
    const skinWarm = Math.max(0.05, warmth(skin));
    const hairy = (px) => {
      const dk = px.filter((p) => luma(p) < skinL * 0.7);
      const grey = dk.length ? dk.reduce((a, p) => a + warmth(p), 0) / dk.length / skinWarm : 9;
      return { frac: px.length ? dk.length / px.length : 0, grey };
    };
    const chin = hairy(box(mouth[0], mouth[1] + 0.5 * ed, 0.1 * ed, 0.06 * ed));
    const lip = hairy(box(mouth[0], mouth[1] - 0.16 * ed, 0.1 * ed, 0.06 * ed));
    const beard = chin.frac > 0.3 && chin.grey < 0.9 ? clamp(chin.frac * 1.6, 0.6, 1) : 0;
    const moustache = beard > 0 || (lip.frac > 0.25 && lip.grey < 0.9);

    // shirt: at the shoulders, on you, not skin (a neckline shows skin)
    const shoulders = [-1, 1].flatMap((sd) => box(midX + sd * 0.75 * fw, top + fh * 1.6, 0.18 * fw, 0.12 * fh, mask))
      .filter((p) => dist(p, skin) > 40);
    const shirt = median(shoulders) || [11, 87, 208];

    // long hair: hair colour beside the cheeks and the jaw, on both sides
    const nose = kp[2];
    const side = [nose[1], mouth[1] + 0.3 * ed].flatMap((y) =>
      [midX - 1.25 * ed, midX + 1.25 * ed].map((x) => median(box(x, y, 0.1 * ed, 0.12 * ed, mask))));
    const longHair = !bald && side.every((c) => c && dist(c, hair) < 40 && dist(c, skin) > 45 && dist(c, shirt) > 45);

    return { skin, hair, bald, glasses, beard, moustache, shirt, longHair };
  }

  // Cartoon colours from the camera's: brighter and warmer, the same tone.
  function toonSkin(c) {
    const l = luma(c);
    const lifted = c.map((v) => v + (l < 110 ? (110 - l) * 0.8 : 0));
    return mix(lifted, light(lifted, 0.25), 0.5).map((v, i) => v + [10, 2, -4][i]);
  }
  function toonHair(c) {
    if (luma(c) < 75) return mix(c, [52, 36, 30], 0.6);
    const l = luma(c);
    return c.map((v) => l + (v - l) * 1.25);
  }
  function toonShirt(c) {
    const l = luma(c);
    const sat = c.map((v) => l + (v - l) * 1.35);
    return l < 55 ? mix(sat, [70, 72, 90], 0.45) : sat;
  }

  // ---- The face's expression over time (pure) ----

  // eyes: 'open' | 'squeeze' (>_<) | 'rest' (closed, resigned); open: 0–1 lid;
  // brow: 0 relaxed … 1 worried; mouth: 'smile' | 'ugh' | 'sigh'.
  function expression(e) {
    if (e < SLAP_AT_MS) {
      const b = e - BLINK_AT_MS;
      const open = b > 0 && b < 120 ? Math.abs(b - 60) / 60 : 1;
      return { eyes: 'open', open, brow: e > SLAP_FROM_MS ? 0.4 : 0, mouth: e > SLAP_FROM_MS ? 'ugh' : 'smile' };
    }
    if (e < SIGH_AT_MS) return { eyes: 'squeeze', open: 0, brow: 1, mouth: 'ugh' };
    return { eyes: 'rest', open: 0, brow: 1, mouth: 'sigh' };
  }

  // Hand pose at elapsed ms: where the palm is (sticker units), its angle.
  function handPose(e) {
    const end = { x: 0.06, y: -0.33, a: -0.42 };
    if (e < SLAP_FROM_MS) return null;
    if (e < SLAP_AT_MS) {
      const k = easeInCubic((e - SLAP_FROM_MS) / (SLAP_AT_MS - SLAP_FROM_MS));
      return { x: 1.1 + (end.x - 1.1) * k, y: 1.4 + (end.y - 1.4) * k, a: 0.5 + (end.a - 0.5) * k };
    }
    const drag = 0.06 * easeInOut(clamp((e - SLAP_AT_MS) / 1500, 0, 1));
    return { x: end.x, y: end.y + drag, a: end.a };
  }

  // ---- Drawing (sticker units: R = sticker radius, origin = its centre) ----

  function outlined(c, R, fill, w = 0.03) {
    c.fillStyle = fill;
    c.fill();
    c.lineWidth = R * w;
    c.strokeStyle = rgb(INK);
    c.stroke();
  }

  function headPath(c, R) {
    c.beginPath();
    c.moveTo(0, -0.56 * R);
    c.bezierCurveTo(0.36 * R, -0.56 * R, 0.53 * R, -0.32 * R, 0.53 * R, -0.02 * R);
    c.bezierCurveTo(0.53 * R, 0.3 * R, 0.3 * R, 0.49 * R, 0, 0.49 * R);
    c.bezierCurveTo(-0.3 * R, 0.49 * R, -0.53 * R, 0.3 * R, -0.53 * R, -0.02 * R);
    c.bezierCurveTo(-0.53 * R, -0.32 * R, -0.36 * R, -0.56 * R, 0, -0.56 * R);
    c.closePath();
  }

  function drawBody(c, R, t) {
    const shirt = t.shirtC;
    c.save();
    c.lineJoin = 'round';
    // neck
    c.beginPath();
    c.roundRect(-0.13 * R, 0.3 * R, 0.26 * R, 0.36 * R, 0.08 * R);
    outlined(c, R, rgb(dark(t.skinC, 0.12)));
    // torso
    c.beginPath();
    c.moveTo(-0.95 * R, 1.3 * R);
    c.bezierCurveTo(-0.9 * R, 0.85 * R, -0.62 * R, 0.62 * R, -0.24 * R, 0.6 * R);
    c.quadraticCurveTo(0, 0.7 * R, 0.24 * R, 0.6 * R);
    c.bezierCurveTo(0.62 * R, 0.62 * R, 0.9 * R, 0.85 * R, 0.95 * R, 1.3 * R);
    c.closePath();
    const g = c.createLinearGradient(0, 0.6 * R, 0, 1.1 * R);
    g.addColorStop(0, rgb(light(shirt, 0.12)));
    g.addColorStop(1, rgb(dark(shirt, 0.18)));
    outlined(c, R, g);
    // collar
    c.beginPath();
    c.moveTo(-0.24 * R, 0.6 * R);
    c.quadraticCurveTo(0, 0.78 * R, 0.24 * R, 0.6 * R);
    c.lineWidth = R * 0.05;
    c.strokeStyle = rgb(dark(shirt, 0.25));
    c.stroke();
    c.restore();
  }

  function drawHairBack(c, R, t) {
    if (!t.longHair) return;
    c.beginPath();
    c.moveTo(-0.6 * R, -0.2 * R);
    c.bezierCurveTo(-0.72 * R, 0.3 * R, -0.66 * R, 0.6 * R, -0.5 * R, 0.72 * R);
    c.lineTo(0.5 * R, 0.72 * R);
    c.bezierCurveTo(0.66 * R, 0.6 * R, 0.72 * R, 0.3 * R, 0.6 * R, -0.2 * R);
    c.closePath();
    outlined(c, R, rgb(dark(t.hairC, 0.12)));
  }

  function drawHead(c, R, t) {
    // ears
    for (const s of [-1, 1]) {
      c.beginPath();
      c.ellipse(s * 0.51 * R, 0.04 * R, 0.085 * R, 0.115 * R, 0, 0, Math.PI * 2);
      outlined(c, R, rgb(t.skinC));
      c.beginPath();
      c.arc(s * 0.51 * R, 0.05 * R, 0.045 * R, s < 0 ? -1.2 : Math.PI - 1.9, s < 0 ? 1.9 : Math.PI + 1.2);
      c.lineWidth = R * 0.02;
      c.strokeStyle = rgb(dark(t.skinC, 0.25));
      c.stroke();
    }
    headPath(c, R);
    const g = c.createRadialGradient(-0.16 * R, -0.22 * R, 0.05 * R, 0, 0, 0.72 * R);
    g.addColorStop(0, rgb(light(t.skinC, 0.18)));
    g.addColorStop(0.6, rgb(t.skinC));
    g.addColorStop(1, rgb(dark(t.skinC, 0.14)));
    outlined(c, R, g);
    // cheeks
    c.fillStyle = 'rgba(255,110,120,0.26)';
    for (const s of [-1, 1]) {
      c.beginPath();
      c.ellipse(s * 0.31 * R, 0.24 * R, 0.085 * R, 0.05 * R, 0, 0, Math.PI * 2);
      c.fill();
    }
  }

  function drawBeard(c, R, t) {
    if (!t.beard && !t.moustache) return;
    c.save();
    headPath(c, R);
    c.clip();
    c.fillStyle = rgb(t.hairC, 0.55 + 0.4 * t.beard);
    if (t.beard) {
      // jaw to jaw, with tufty edges along the cheeks
      c.beginPath();
      c.moveTo(-0.56 * R, -0.04 * R);
      const edge = [[-0.46, 0.14], [-0.36, 0.2], [-0.26, 0.27], [-0.14, 0.24], [0, 0.22], [0.14, 0.24], [0.26, 0.27], [0.36, 0.2], [0.46, 0.14], [0.56, -0.04]];
      let [px, py] = [-0.56, -0.04];
      for (const [x, y] of edge) {
        c.quadraticCurveTo(((px + x) / 2) * R, (Math.max(py, y) + 0.04) * R, x * R, y * R);
        [px, py] = [x, y];
      }
      c.lineTo(0.6 * R, 0.6 * R);
      c.lineTo(-0.6 * R, 0.6 * R);
      c.closePath();
      c.fill();
    }
    if (t.moustache) {
      for (const s of [-1, 1]) {
        c.beginPath();
        c.ellipse(s * 0.065 * R, 0.265 * R, 0.08 * R, 0.035 * R, s * 0.25, 0, Math.PI * 2);
        c.fillStyle = rgb(dark(t.hairC, 0.1));
        c.fill();
      }
    }
    c.restore();
  }

  function drawEyes(c, R, t, x) {
    const ink = rgb(INK);
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const s of [-1, 1]) {
      const ex = s * 0.19 * R;
      const ey = 0.07 * R;
      if (x.eyes === 'open' && x.open > 0.05) {
        const ry = 0.12 * R * x.open;
        c.save();
        c.beginPath();
        c.ellipse(ex, ey, 0.1 * R, ry, 0, 0, Math.PI * 2);
        c.fillStyle = '#ffffff';
        c.fill();
        c.clip();
        const ig = c.createRadialGradient(ex, ey + 0.03 * R, 0.01 * R, ex, ey + 0.01 * R, 0.08 * R);
        ig.addColorStop(0, '#7a4b2e');
        ig.addColorStop(1, '#2a1a12');
        c.fillStyle = ig;
        c.beginPath(); c.arc(ex, ey + 0.012 * R, 0.078 * R, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#120c0a';
        c.beginPath(); c.arc(ex, ey + 0.015 * R, 0.038 * R, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#ffffff';
        c.beginPath(); c.arc(ex + 0.028 * R, ey - 0.03 * R, 0.028 * R, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(ex - 0.03 * R, ey + 0.04 * R, 0.013 * R, 0, Math.PI * 2); c.fill();
        c.restore();
        // upper lid line with a little flick at the outer corner
        c.beginPath();
        c.ellipse(ex, ey, 0.1 * R, ry, 0, Math.PI * 1.05, Math.PI * 1.95);
        c.lineWidth = R * 0.03;
        c.strokeStyle = ink;
        c.stroke();
        c.beginPath();
        c.moveTo(ex + s * 0.095 * R, ey - 0.035 * R * x.open);
        c.lineTo(ex + s * 0.125 * R, ey - 0.065 * R * x.open);
        c.stroke();
      } else if (x.eyes === 'squeeze' || (x.eyes === 'open' && x.open <= 0.05)) {
        c.beginPath();
        if (x.eyes === 'open') {
          c.moveTo(ex - 0.09 * R, ey); c.quadraticCurveTo(ex, ey + 0.04 * R, ex + 0.09 * R, ey);
        } else {
          // > <
          c.moveTo(ex - s * 0.08 * R, ey - 0.06 * R);
          c.lineTo(ex + s * 0.06 * R, ey);
          c.lineTo(ex - s * 0.08 * R, ey + 0.06 * R);
        }
        c.lineWidth = R * 0.034;
        c.strokeStyle = ink;
        c.stroke();
      } else {
        // resigned: closed, drooping lids
        c.beginPath();
        c.moveTo(ex - 0.09 * R, ey - 0.005 * R);
        c.quadraticCurveTo(ex, ey + 0.05 * R, ex + 0.09 * R, ey - 0.005 * R);
        c.lineWidth = R * 0.032;
        c.strokeStyle = ink;
        c.stroke();
      }
      // brow: worried raises the inner end
      const lift = x.brow * 0.06 * R;
      c.beginPath();
      c.moveTo(ex + s * 0.09 * R, ey - 0.17 * R + lift * 0.3);
      c.quadraticCurveTo(ex, ey - 0.22 * R - lift * 0.2, ex - s * 0.08 * R, ey - 0.18 * R - lift);
      c.lineWidth = R * 0.045;
      c.strokeStyle = rgb(dark(t.hairC, 0.2));
      c.stroke();
    }
    c.restore();
  }

  function drawNoseMouth(c, R, t, x) {
    const ink = rgb(INK);
    c.save();
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(-0.03 * R, 0.19 * R);
    c.quadraticCurveTo(0, 0.215 * R, 0.03 * R, 0.19 * R);
    c.lineWidth = R * 0.022;
    c.strokeStyle = rgb(dark(t.skinC, 0.35));
    c.stroke();
    const my = 0.33 * R;
    c.beginPath();
    if (x.mouth === 'smile') {
      c.moveTo(-0.08 * R, my - 0.02 * R);
      c.quadraticCurveTo(0, my + 0.06 * R, 0.08 * R, my - 0.02 * R);
      c.lineWidth = R * 0.028;
      c.strokeStyle = ink;
      c.stroke();
    } else if (x.mouth === 'ugh') {
      // wobbly grimace
      c.moveTo(-0.085 * R, my + 0.01 * R);
      c.bezierCurveTo(-0.05 * R, my - 0.03 * R, -0.02 * R, my + 0.03 * R, 0, my);
      c.bezierCurveTo(0.02 * R, my - 0.03 * R, 0.05 * R, my + 0.03 * R, 0.085 * R, my - 0.005 * R);
      c.lineWidth = R * 0.028;
      c.strokeStyle = ink;
      c.stroke();
    } else {
      c.ellipse(0.01 * R, my, 0.035 * R, 0.028 * R, 0, 0, Math.PI * 2);
      c.fillStyle = '#7a2f3a';
      c.fill();
      c.lineWidth = R * 0.022;
      c.strokeStyle = ink;
      c.stroke();
    }
    c.restore();
  }

  function drawHairFront(c, R, t) {
    if (t.bald) {
      c.beginPath();
      c.arc(-0.12 * R, -0.36 * R, 0.14 * R, Math.PI * 1.1, Math.PI * 1.6);
      c.lineWidth = R * 0.035;
      c.lineCap = 'round';
      c.strokeStyle = 'rgba(255,255,255,0.45)';
      c.stroke();
      return;
    }
    const low = t.longHair ? 0.34 : 0.04; // how far down the sides come
    c.save();
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(-0.57 * R, low * R);
    c.bezierCurveTo(-0.64 * R, -0.46 * R, -0.32 * R, -0.72 * R, 0.02 * R, -0.7 * R);
    c.bezierCurveTo(0.38 * R, -0.7 * R, 0.64 * R, -0.46 * R, 0.57 * R, low * R);
    c.lineTo(0.48 * R, (low - 0.08) * R);
    c.quadraticCurveTo(0.48 * R, -0.24 * R, 0.37 * R, -0.3 * R);
    // a swept fringe of tufts, right to left
    const tufts = [[0.24, -0.2], [0.13, -0.31], [0.0, -0.19], [-0.12, -0.31], [-0.25, -0.2], [-0.35, -0.3], [-0.47, -0.1]];
    let [px, py] = [0.37, -0.3];
    for (const [tx, ty] of tufts) {
      c.quadraticCurveTo(((px + tx) / 2 + 0.03) * R, (Math.min(py, ty) - 0.0) * R + 0.06 * R * (ty > py ? 1 : 0), tx * R, ty * R);
      [px, py] = [tx, ty];
    }
    c.lineTo(-0.48 * R, (low - 0.08) * R);
    c.closePath();
    const g = c.createLinearGradient(0, -0.7 * R, 0, 0);
    g.addColorStop(0, rgb(light(t.hairC, 0.12)));
    g.addColorStop(1, rgb(dark(t.hairC, 0.1)));
    outlined(c, R, g);
    // shine and strands
    c.lineCap = 'round';
    c.beginPath();
    c.arc(-0.05 * R, -0.3 * R, 0.3 * R, Math.PI * 1.18, Math.PI * 1.42);
    c.lineWidth = R * 0.04;
    c.strokeStyle = 'rgba(255,255,255,0.3)';
    c.stroke();
    c.beginPath();
    for (const [x0, y0, x1, y1] of [[0.25, -0.58, 0.32, -0.38], [0.05, -0.62, 0.1, -0.42], [-0.3, -0.52, -0.22, -0.38]]) {
      c.moveTo(x0 * R, y0 * R); c.quadraticCurveTo((x0 + 0.06) * R, ((y0 + y1) / 2) * R, x1 * R, y1 * R);
    }
    c.lineWidth = R * 0.016;
    c.strokeStyle = rgb(dark(t.hairC, 0.3));
    c.stroke();
    c.restore();
  }

  function drawGlasses(c, R, t) {
    if (!t.glasses) return;
    c.save();
    const frame = rgb([32, 28, 38]);
    c.lineJoin = 'round';
    for (const s of [-1, 1]) {
      c.beginPath();
      c.roundRect(s * 0.19 * R - 0.135 * R, 0.07 * R - 0.105 * R, 0.27 * R, 0.21 * R, 0.07 * R);
      c.fillStyle = 'rgba(190,215,255,0.16)';
      c.fill();
      c.lineWidth = R * 0.036;
      c.strokeStyle = frame;
      c.stroke();
      c.beginPath(); // glint
      c.moveTo(s * 0.19 * R + 0.03 * R, 0.0 * R);
      c.lineTo(s * 0.19 * R + 0.075 * R, -0.015 * R);
      c.lineWidth = R * 0.02;
      c.lineCap = 'round';
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.stroke();
      c.beginPath(); // arm to the ear
      c.moveTo(s * 0.325 * R, 0.03 * R);
      c.lineTo(s * 0.5 * R, 0.0);
      c.lineWidth = R * 0.03;
      c.strokeStyle = frame;
      c.stroke();
    }
    c.beginPath();
    c.moveTo(-0.055 * R, 0.04 * R);
    c.quadraticCurveTo(0, 0.0, 0.055 * R, 0.04 * R);
    c.lineWidth = R * 0.03;
    c.strokeStyle = frame;
    c.stroke();
    c.restore();
  }

  // A soft, cute hand (back of it, fingers together, pointing up), with its
  // sleeve in your shirt colour. The palm centre is the origin.
  function drawHand(c, R, skin, sleeveC) {
    const ink = rgb(INK);
    const capsule = (x, y0, y1, half) => {
      c.moveTo(x + half, y1);
      c.arc(x, y1, half, 0, Math.PI);
      c.arc(x, y0, half, Math.PI, 0);
      c.closePath();
    };
    const fingers = [[-0.15, -0.38], [-0.05, -0.44], [0.05, -0.42], [0.15, -0.35]];
    const handPath = () => {
      c.beginPath();
      for (const [fx, top] of fingers) capsule(fx * R, top * R, -0.05 * R, 0.062 * R);
      c.roundRect(-0.21 * R, -0.16 * R, 0.42 * R, 0.36 * R, 0.15 * R);
    };
    const thumbPath = () => {
      c.beginPath();
      c.save();
      c.translate(-0.17 * R, 0.08 * R);
      c.rotate(-0.7);
      capsule(0, -0.2 * R, 0, 0.065 * R);
      c.restore();
    };
    c.save();
    c.lineJoin = 'round';
    // sleeve, down and off the sticker
    c.beginPath();
    c.moveTo(-0.17 * R, 0.16 * R);
    c.bezierCurveTo(-0.22 * R, 0.7 * R, -0.05 * R, 1.6 * R, 0.1 * R, 3.2 * R);
    c.lineTo(0.7 * R, 3.2 * R);
    c.bezierCurveTo(0.4 * R, 1.5 * R, 0.24 * R, 0.7 * R, 0.17 * R, 0.16 * R);
    c.closePath();
    const sg = c.createLinearGradient(-0.2 * R, 0, 0.3 * R, 0);
    sg.addColorStop(0, rgb(light(sleeveC, 0.15)));
    sg.addColorStop(1, rgb(dark(sleeveC, 0.15)));
    outlined(c, R, sg, 0.035);
    c.beginPath();
    c.roundRect(-0.2 * R, 0.13 * R, 0.4 * R, 0.1 * R, 0.04 * R);
    outlined(c, R, rgb(dark(sleeveC, 0.2)), 0.03);
    // the hand: thick outline first, then fills, so only the outer edge is inked
    c.strokeStyle = ink;
    c.lineWidth = R * 0.055;
    thumbPath(); c.stroke();
    handPath(); c.stroke();
    const g = c.createLinearGradient(-0.2 * R, -0.45 * R, 0.2 * R, 0.2 * R);
    g.addColorStop(0, rgb(light(skin, 0.15)));
    g.addColorStop(0.6, rgb(skin));
    g.addColorStop(1, rgb(dark(skin, 0.12)));
    c.fillStyle = g;
    thumbPath(); c.fill();
    c.lineWidth = R * 0.025; thumbPath(); c.stroke();
    c.fillStyle = g;
    handPath(); c.fill();
    c.strokeStyle = rgb(dark(skin, 0.3));
    c.lineCap = 'round';
    c.lineWidth = R * 0.018;
    c.beginPath();
    for (let k = 0; k < 3; k++) {
      const x = ((fingers[k][0] + fingers[k + 1][0]) / 2) * R;
      c.moveTo(x, (Math.max(fingers[k][1], fingers[k + 1][1]) + 0.1) * R);
      c.lineTo(x, -0.1 * R);
    }
    c.stroke();
    c.restore();
  }

  // The sticker's backdrop: light blue with soft halftone dots.
  function makeBackdrop(size) {
    const c = new OffscreenCanvas(size, size);
    const x = c.getContext('2d');
    const g = x.createRadialGradient(size / 2, size * 0.4, size * 0.05, size / 2, size / 2, size * 0.7);
    g.addColorStop(0, '#e8f1ff');
    g.addColorStop(1, '#8fbaf7');
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    x.fillStyle = 'rgba(11,87,208,0.1)';
    const step = size / 18;
    for (let yy = step / 2; yy < size; yy += step) {
      for (let xx = step / 2; xx < size; xx += step) {
        const r = step * 0.16 * (0.4 + Math.hypot(xx / size - 0.5, yy / size - 0.45) * 1.6);
        x.beginPath(); x.arc(xx, yy, r, 0, Math.PI * 2); x.fill();
      }
    }
    return c;
  }

  function createCartoonFacepalm() {
    let look = null; // traits with cartoon colours, or null
    let backdrop = null;

    return {
      get ready() { return !!look; },
      // source: the raw camera frame; face: detector box (normalised, with kp);
      // mask (optional): person mask of the same frame, alpha = person.
      build(source, face, sw, sh, mask) {
        if (face.w * sw < 40) return false;
        const w = ANALYSE_W;
        const h = Math.round((ANALYSE_W * sh) / sw);
        const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
        ctx.drawImage(source, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        let m = null;
        if (mask) {
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(mask, 0, 0, w, h);
          const a = ctx.getImageData(0, 0, w, h).data;
          m = new Uint8ClampedArray(w * h);
          for (let p = 0; p < m.length; p++) m[p] = a[p * 4 + 3];
        }
        const t = readTraits(d, w, h, face, m);
        look = { ...t, skinC: toonSkin(t.skin), hairC: toonHair(t.hair), shirtC: toonShirt(t.shirt) };
        backdrop = backdrop || makeBackdrop(256);
        return true;
      },
      clear() { look = null; },
      get traits() { return look; },
      // e: ms since the facepalm started; alpha: the fade in/out.
      draw(ctx, e, w, h, alpha) {
        if (!look) return;
        const R = h * 0.33;
        const pop = easeOutBack(clamp(e / POP_MS, 0, 1));
        const hit = e - SLAP_AT_MS;
        const squash = hit >= 0 && hit < WOBBLE_MS ? Math.sin((hit / WOBBLE_MS) * Math.PI) * 0.08 : 0;
        const x = expression(e);
        const pose = handPose(e);
        // head: knocked back a touch by the slap, then a slow disappointed shake
        const after = Math.max(0, hit);
        const tilt = hit >= 0 ? -0.05 + Math.sin(after / 170) * 0.05 * Math.exp(-after / 1200) : 0;
        const drop = hit >= 0 ? 0.03 * R * Math.min(1, after / 120) : 0;
        ctx.save();
        ctx.globalAlpha = alpha * clamp(e / (POP_MS * 0.6), 0, 1);
        ctx.translate(w / 2, h * 0.5);
        ctx.scale(pop * (1 + squash), pop * (1 - squash));
        // sticker: shadow, white rim, blue ring
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = R * 0.18;
        ctx.shadowOffsetY = R * 0.05;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(0, 0, R * 1.07, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#0b57d0';
        ctx.beginPath(); ctx.arc(0, 0, R * 1.015, 0, Math.PI * 2); ctx.fill();
        // the character, inside the sticker
        ctx.save();
        ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(backdrop, -R, -R, 2 * R, 2 * R);
        ctx.translate(0, 0.12 * R);
        drawBody(ctx, R, look);
        ctx.translate(0, 0.62 * R + drop);
        ctx.rotate(tilt);
        ctx.translate(0, -0.62 * R);
        drawHairBack(ctx, R, look);
        drawHead(ctx, R, look);
        drawBeard(ctx, R, look);
        drawEyes(ctx, R, look, x);
        drawNoseMouth(ctx, R, look, x);
        drawHairFront(ctx, R, look);
        drawGlasses(ctx, R, look);
        if (hit > 500) {
          // gloom lines on the forehead
          const k = clamp((hit - 500) / 300, 0, 1);
          ctx.save();
          ctx.globalAlpha *= 0.55 * k;
          ctx.strokeStyle = '#5b4a9e';
          ctx.lineCap = 'round';
          ctx.lineWidth = R * 0.022;
          ctx.beginPath();
          for (const gx of [-0.36, -0.29, -0.22]) {
            ctx.moveTo(gx * R, -0.2 * R); ctx.lineTo(gx * R, (-0.2 + 0.13 * k) * R);
          }
          ctx.stroke();
          ctx.restore();
        }
        if (pose) {
          ctx.save();
          ctx.translate(pose.x * R, pose.y * R + 0.12 * R);
          ctx.rotate(pose.a - tilt);
          drawHand(ctx, R, look.skinC, look.shirtC);
          ctx.restore();
        }
        ctx.restore();
        ctx.restore();
        // outside the head's tilt but inside the sticker's pop
        ctx.save();
        ctx.globalAlpha = alpha * clamp(e / (POP_MS * 0.6), 0, 1);
        ctx.translate(w / 2, h * 0.5);
        ctx.scale(pop, pop);
        if (hit >= 0 && hit < 420) {
          // impact lines by the forehead
          const k = hit / 420;
          ctx.save();
          ctx.globalAlpha *= 1 - k;
          ctx.strokeStyle = '#ffffff';
          ctx.lineCap = 'round';
          ctx.lineWidth = R * 0.05;
          for (const a of [-2.5, -2.05, -1.6]) {
            const r0 = R * (1.1 + 0.15 * k);
            const r1 = r0 + R * 0.22;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * r0 - 0.15 * R, Math.sin(a) * r0);
            ctx.lineTo(Math.cos(a) * r1 - 0.15 * R, Math.sin(a) * r1);
            ctx.stroke();
          }
          ctx.restore();
        }
        if (hit > 250) {
          // sweat drop
          const k = clamp((hit - 250) / 300, 0, 1);
          const dx = -0.5 * R;
          const dy = (-0.3 + 0.14 * easeInOut(clamp((hit - 250) / 1500, 0, 1))) * R;
          const s = R * 0.1 * easeOutBack(k);
          ctx.fillStyle = '#8ec5ff';
          ctx.strokeStyle = rgb(INK);
          ctx.lineWidth = R * 0.022;
          ctx.beginPath();
          ctx.moveTo(dx, dy - s * 1.6);
          ctx.quadraticCurveTo(dx + s, dy - s * 0.2, dx + s * 0.9, dy + s * 0.25);
          ctx.arc(dx, dy + s * 0.25, s * 0.9, 0, Math.PI);
          ctx.quadraticCurveTo(dx - s, dy - s * 0.2, dx, dy - s * 1.6);
          ctx.fill(); ctx.stroke();
        }
        if (e > SIGH_AT_MS) {
          // a sigh puff drifting off from the mouth
          const k = clamp((e - SIGH_AT_MS) / 900, 0, 1);
          ctx.save();
          ctx.globalAlpha *= Math.sin(k * Math.PI) * 0.9;
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = 'rgba(43,34,51,0.5)';
          ctx.lineWidth = R * 0.015;
          const px = (-0.28 - 0.35 * k) * R;
          const py = (0.55 - 0.12 * k) * R;
          for (const [ox, oy, r] of [[0, 0, 0.07], [-0.07, -0.03, 0.055], [0.06, -0.03, 0.05]]) {
            ctx.beginPath(); ctx.arc(px + ox * R, py + oy * R, r * R * (0.6 + 0.6 * k), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
          ctx.restore();
        }
        ctx.restore();
      },
    };
  }

  root.PlotTwistCartoon = { createCartoonFacepalm, readTraits, expression, handPose, toonSkin, toonHair, toonShirt };
})(globalThis);
