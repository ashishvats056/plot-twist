// Cartoon facepalm: a round sticker of your own face, cartoonised, with a
// cartoon hand slapping your forehead. Built on your device from one camera
// frame, once per camera session, and held in memory only: it is never saved,
// and it is dropped when the camera stops. Until it is ready, the 🤦 emoji
// stands in. The pixel maths below is pure and unit-tested.
(function (root) {
  'use strict';

  const SIZE = 224; // sticker artwork, px square
  const LEVELS = 5; // brightness bands
  const SATURATE = 1.3;
  const EDGE = 9; // how much darker than its surroundings (0–255) a line must be to become ink
  const INK = [38, 30, 48];
  const POP_MS = 260; // sticker pops in
  const SLAP_FROM_MS = 140; // hand swings in…
  const SLAP_AT_MS = 480; // …and lands on the forehead
  const WOBBLE_MS = 220; // squash after the slap
  const DRAG = 0.06; // hand then drags down the face by this much of the radius

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const easeOutBack = (k) => 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;
  const easeInCubic = (k) => k * k * k;
  const easeInOut = (k) => k * k * (3 - 2 * k);

  // Square crop around a detected face (box normalised to the frame), grown to
  // take in the hair and chin, shifted up a little, kept inside the frame.
  function faceCrop(face, sw, sh) {
    const fw = face.w * sw;
    const fh = face.h * sh;
    const size = Math.min(sw, sh, Math.round(Math.max(fw, fh) * 1.9));
    const cx = (face.x + face.w / 2) * sw;
    const cy = (face.y + face.h / 2) * sh - fh * 0.12;
    return {
      x: Math.round(clamp(cx - size / 2, 0, sw - size)),
      y: Math.round(clamp(cy - size / 2, 0, sh - size)),
      size,
    };
  }

  // Separable box blur, radius r, on RGB (alpha is left as is).
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h * 3);
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s0 = 0; let s1 = 0; let s2 = 0; let n = 0;
        for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) {
          const i = (y * w + k) * 4;
          s0 += src[i]; s1 += src[i + 1]; s2 += src[i + 2]; n++;
        }
        const o = (y * w + x) * 3;
        tmp[o] = s0 / n; tmp[o + 1] = s1 / n; tmp[o + 2] = s2 / n;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s0 = 0; let s1 = 0; let s2 = 0; let n = 0;
        for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) {
          const o = (k * w + x) * 3;
          s0 += tmp[o]; s1 += tmp[o + 1]; s2 += tmp[o + 2]; n++;
        }
        const i = (y * w + x) * 4;
        out[i] = s0 / n; out[i + 1] = s1 / n; out[i + 2] = s2 / n; out[i + 3] = src[i + 3];
      }
    }
    return out;
  }

  const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  // Edge-preserving smoothing (a small bilateral filter): flattens skin and
  // cloth into clean areas but keeps the edges of eyes, brows and mouth sharp.
  function bilateral(src, w, h, r = 2, sigma = 28) {
    const out = new Uint8ClampedArray(src.length);
    const k = -1 / (2 * sigma * sigma);
    const ks = -1 / (2 * r * r);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const c0 = src[i]; const c1 = src[i + 1]; const c2 = src[i + 2];
        let s0 = 0; let s1 = 0; let s2 = 0; let n = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const j = (yy * w + xx) * 4;
            const d0 = src[j] - c0; const d1 = src[j + 1] - c1; const d2 = src[j + 2] - c2;
            const wt = Math.exp((d0 * d0 + d1 * d1 + d2 * d2) * k + (dx * dx + dy * dy) * ks);
            s0 += src[j] * wt; s1 += src[j + 1] * wt; s2 += src[j + 2] * wt; n += wt;
          }
        }
        out[i] = s0 / n; out[i + 1] = s1 / n; out[i + 2] = s2 / n; out[i + 3] = src[i + 3];
      }
    }
    return out;
  }

  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  // Photo → cartoon (cel shading): edge-preserving smoothing, colour boost,
  // brightness cut into a few bands, and ink lines from a difference of
  // Gaussians (dark, thin features: eyes, brows, nostrils, lips, outlines).
  // Banding brightness only (not each channel) keeps skin tones clean.
  // Returns a new buffer.
  function cartoonize(src, w, h, o = {}) {
    const levels = o.levels || LEVELS;
    const edge = o.edge || EDGE;
    const r = Math.max(1, Math.round(w / 112));
    let flat = bilateral(src, w, h, r + 1);
    flat = bilateral(flat, w, h, r + 1);
    const fine = boxBlur(flat, w, h, Math.max(1, r - 1));
    const wide = boxBlur(boxBlur(flat, w, h, r * 2), w, h, r * 2);
    const out = new Uint8ClampedArray(src.length);
    const band = 255 / levels;
    for (let i = 0; i < out.length; i += 4) {
      const l = Math.max(1, luma(flat, i));
      // soft band edges (about 6 levels wide) instead of jagged steps
      const pos = l / band;
      const lo = Math.floor(pos);
      const target = Math.min(255, (lo + 0.55 + 0.9 * smoothstep(0.82, 1, pos - lo)) * band);
      const dog = luma(wide, i) - luma(fine, i); // > 0: darker than its surroundings
      const ink = smoothstep(edge * 0.6, edge, dog);
      for (let c = 0; c < 3; c++) {
        const sat = l + (flat[i + c] - l) * SATURATE;
        const v = clamp(sat * (target / l), 0, 255);
        out[i + c] = v + (INK[c] - v) * ink;
      }
      out[i + 3] = 255;
    }
    return out;
  }

  // Grows a 0–255 mask by r pixels (separable max filter).
  function growMask(m, w, h, r) {
    const tmp = new Uint8ClampedArray(m.length);
    const out = new Uint8ClampedArray(m.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) v = Math.max(v, m[y * w + k]);
        tmp[y * w + x] = v;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) v = Math.max(v, tmp[k * w + x]);
        out[y * w + x] = v;
      }
    }
    return out;
  }

  // Sticker art: the cartoon person (cut out with the person mask, with a bold
  // ink outline) over a comic backdrop. Without a mask the whole crop is used.
  function compose(toon, mask, w, h) {
    const out = new Uint8ClampedArray(toon.length);
    const outline = mask ? growMask(mask, w, h, Math.max(2, Math.round(w / 70))) : null;
    const dot = Math.max(6, Math.round(w / 22));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const i = p * 4;
        // backdrop: light blue radial gradient with halftone dots
        const dx = x / w - 0.5; const dy = y / h - 0.42;
        const g = clamp(1 - Math.sqrt(dx * dx + dy * dy) * 1.3, 0, 1);
        let bg = [140 + 90 * g, 185 + 60 * g, 250];
        const cx = (Math.floor(x / dot) + 0.5) * dot; const cy = (Math.floor(y / dot) + 0.5) * dot;
        const rr = dot * 0.16 * (1.4 - g);
        if ((x - cx) ** 2 + (y - cy) ** 2 < rr * rr) bg = bg.map((v) => v - 22);
        const a = mask ? mask[p] / 255 : 1;
        const ol = outline ? outline[p] / 255 : 0;
        for (let c = 0; c < 3; c++) {
          const under = bg[c] + (INK[c] - bg[c]) * ol;
          out[i + c] = under + (toon[i + c] - under) * a;
        }
        out[i + 3] = 255;
      }
    }
    return out;
  }

  // Average colour of a box (fractions of the image): the skin tone for the hand.
  function averageColor(d, w, h, box) {
    const x0 = Math.floor(box.x * w); const x1 = Math.ceil((box.x + box.w) * w);
    const y0 = Math.floor(box.y * h); const y1 = Math.ceil((box.y + box.h) * h);
    let r = 0; let g = 0; let b = 0; let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
    }
    return n ? [r / n, g / n, b / n].map(Math.round) : [241, 194, 125];
  }

  // A pleasant hand colour from the sampled skin: never too dark to read
  // against the ink, never grey.
  function handColor([r, g, b]) {
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const lift = l < 90 ? 90 - l : 0;
    return [r, g, b].map((v) => Math.round(clamp(v + lift, 0, 255)));
  }

  const rgb = (c) => `rgb(${c.map(Math.round).join(',')})`;
  const shade = (c, k) => c.map((v) => clamp(v * k, 0, 255));

  // The back of a hand, fingers together and pointing up, with its sleeve, in
  // sticker units (R = sticker radius). The palm centre is the origin.
  function drawHand(c, R, skin) {
    const ink = rgb(INK);
    const capsule = (x, y0, y1, half) => {
      c.moveTo(x + half, y1);
      c.arc(x, y1, half, 0, Math.PI);
      c.arc(x, y0, half, Math.PI, 0);
      c.closePath();
    };
    const fingers = [[-0.21, -0.6], [-0.07, -0.67], [0.07, -0.64], [0.205, -0.54]];
    const handPath = () => {
      c.beginPath();
      for (const [fx, top] of fingers) capsule(fx * R, top * R, -0.05 * R, 0.075 * R);
      c.roundRect(-0.29 * R, -0.2 * R, 0.58 * R, 0.5 * R, 0.17 * R);
    };
    const thumbPath = () => {
      c.beginPath();
      c.save();
      c.translate(-0.22 * R, 0.14 * R);
      c.rotate(-0.62);
      capsule(0, -0.26 * R, 0, 0.08 * R);
      c.restore();
    };
    // sleeve: a gently tapered, curved arm down to the wrist
    c.save();
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(-0.22 * R, 0.3 * R);
    c.bezierCurveTo(-0.3 * R, 0.8 * R, -0.1 * R, 1.6 * R, 0.1 * R, 3.2 * R);
    c.lineTo(0.75 * R, 3.2 * R);
    c.bezierCurveTo(0.45 * R, 1.5 * R, 0.3 * R, 0.8 * R, 0.22 * R, 0.3 * R);
    c.closePath();
    const sleeve = c.createLinearGradient(-0.3 * R, 0, 0.4 * R, 0);
    sleeve.addColorStop(0, '#6aa1ff'); sleeve.addColorStop(1, '#2f6fe0');
    c.fillStyle = sleeve; c.strokeStyle = ink; c.lineWidth = R * 0.045;
    c.fill(); c.stroke();
    // cuff
    c.beginPath();
    c.roundRect(-0.27 * R, 0.24 * R, 0.54 * R, 0.13 * R, 0.05 * R);
    c.fillStyle = '#e8f0fe'; c.fill(); c.stroke();
    c.restore();
    // outline first (thick), then the fills: only the outer edge gets ink
    c.save();
    c.lineJoin = 'round';
    c.strokeStyle = ink;
    c.lineWidth = R * 0.07;
    thumbPath(); c.stroke();
    handPath(); c.stroke();
    const g = c.createLinearGradient(-0.3 * R, -0.6 * R, 0.3 * R, 0.3 * R);
    g.addColorStop(0, rgb(shade(skin, 1.12)));
    g.addColorStop(0.55, rgb(skin));
    g.addColorStop(1, rgb(shade(skin, 0.82)));
    c.fillStyle = g;
    thumbPath(); c.fill();
    c.lineWidth = R * 0.03; thumbPath(); c.stroke(); // the thumb overlaps the palm edge
    c.fillStyle = g;
    handPath(); c.fill();
    // finger gaps, knuckles, nails
    const crease = rgb(shade(skin, 0.62));
    c.strokeStyle = crease;
    c.lineCap = 'round';
    c.lineWidth = R * 0.022;
    c.beginPath();
    for (let k = 0; k < 3; k++) {
      const x = ((fingers[k][0] + fingers[k + 1][0]) / 2) * R;
      c.moveTo(x, (Math.max(fingers[k][1], fingers[k + 1][1]) + 0.12) * R);
      c.lineTo(x, -0.1 * R);
    }
    c.stroke();
    c.lineWidth = R * 0.016;
    c.beginPath();
    for (const [fx, top] of fingers) {
      const y = (top + 0.3) * R;
      c.moveTo((fx - 0.035) * R, y); c.quadraticCurveTo(fx * R, y - 0.025 * R, (fx + 0.035) * R, y);
    }
    c.stroke();
    c.fillStyle = rgb(shade(skin, 1.22).map((v) => Math.min(255, v + 18)));
    for (const [fx, top] of fingers) {
      c.beginPath();
      c.roundRect((fx - 0.045) * R, (top - 0.035) * R, 0.09 * R, 0.1 * R, 0.035 * R);
      c.fill();
    }
    c.restore();
  }

  function createCartoonFacepalm() {
    let art = null; // OffscreenCanvas with the cartoon face, or null
    let hand = [241, 194, 125];

    // Hand pose at elapsed ms: where the palm is (sticker units), its angle.
    function handPose(e) {
      const end = { x: 0.08, y: -0.24, a: -0.52 };
      if (e < SLAP_FROM_MS) return null;
      if (e < SLAP_AT_MS) {
        const k = easeInCubic((e - SLAP_FROM_MS) / (SLAP_AT_MS - SLAP_FROM_MS));
        return { x: 1.1 + (end.x - 1.1) * k, y: 1.4 + (end.y - 1.4) * k, a: 0.25 + (end.a - 0.25) * k };
      }
      const drag = DRAG * easeInOut(clamp((e - SLAP_AT_MS) / 1400, 0, 1));
      return { x: end.x, y: end.y + drag, a: end.a };
    }

    return {
      get ready() { return !!art; },
      // source: the raw camera frame; face: detector box, normalised;
      // mask (optional): person mask of the same frame, alpha = person.
      build(source, face, sw, sh, mask) {
        const crop = faceCrop(face, sw, sh);
        if (crop.size < 48) return false;
        const c = new OffscreenCanvas(SIZE, SIZE);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(source, crop.x, crop.y, crop.size, crop.size, 0, 0, SIZE, SIZE);
        const img = ctx.getImageData(0, 0, SIZE, SIZE);
        const [r, g, b] = handColor(averageColor(img.data, SIZE, SIZE, { x: 0.36, y: 0.46, w: 0.28, h: 0.12 }));
        hand = [r, g, b];
        let cut = null;
        if (mask) {
          const m = new OffscreenCanvas(SIZE, SIZE).getContext('2d', { willReadFrequently: true });
          m.filter = 'blur(1px)';
          m.drawImage(mask, (crop.x / sw) * mask.width, (crop.y / sh) * mask.height,
            (crop.size / sw) * mask.width, (crop.size / sh) * mask.height, 0, 0, SIZE, SIZE);
          const a = m.getImageData(0, 0, SIZE, SIZE).data;
          cut = new Uint8ClampedArray(SIZE * SIZE);
          let on = 0;
          for (let p = 0; p < cut.length; p++) { cut[p] = a[p * 4 + 3]; on += cut[p] > 127; }
          if (on < cut.length * 0.08) cut = null; // the mask missed the person: use the whole crop
        }
        img.data.set(compose(cartoonize(img.data, SIZE, SIZE), cut, SIZE, SIZE));
        ctx.putImageData(img, 0, 0);
        art = c;
        return true;
      },
      clear() { art = null; },
      // e: ms since the facepalm started; alpha: the fade in/out.
      draw(ctx, e, w, h, alpha) {
        if (!art) return;
        const R = h * 0.33;
        const cx = w / 2;
        const cy = h * 0.5;
        const pop = easeOutBack(clamp(e / POP_MS, 0, 1));
        const hit = e - SLAP_AT_MS;
        const squash = hit >= 0 && hit < WOBBLE_MS ? Math.sin((hit / WOBBLE_MS) * Math.PI) * 0.07 : 0;
        const tilt = e > SLAP_AT_MS ? Math.sin((e - SLAP_AT_MS) / 260) * 0.035 : 0;
        ctx.save();
        ctx.globalAlpha = alpha * clamp(e / (POP_MS * 0.6), 0, 1);
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.scale(pop * (1 + squash), pop * (1 - squash));
        // sticker: shadow, white rim, blue ring, the cartoon face
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = R * 0.18;
        ctx.shadowOffsetY = R * 0.05;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(0, 0, R * 1.07, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#0b57d0';
        ctx.beginPath(); ctx.arc(0, 0, R * 1.015, 0, Math.PI * 2); ctx.fill();
        ctx.save();
        ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(art, -R, -R, 2 * R, 2 * R);
        const pose = handPose(e);
        if (pose && e >= SLAP_AT_MS) {
          // the slap's shadow on the face
          ctx.fillStyle = 'rgba(30,20,40,0.18)';
          ctx.beginPath();
          ctx.ellipse((pose.x - 0.05) * R, (pose.y + 0.12) * R, 0.42 * R, 0.3 * R, pose.a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        if (pose) {
          // the hand (with its sleeve), over the sticker's edge
          ctx.save();
          ctx.translate(pose.x * R, pose.y * R);
          ctx.rotate(pose.a);
          ctx.scale(1.05, 1.05);
          drawHand(ctx, R, hand);
          ctx.restore();
        }
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
        if (e > SLAP_AT_MS + 250) {
          // sweat drop
          const k = clamp((e - SLAP_AT_MS - 250) / 300, 0, 1);
          const dx = -0.62 * R;
          const dy = (-0.42 + 0.12 * easeInOut(clamp((e - SLAP_AT_MS - 250) / 1500, 0, 1))) * R;
          const s = R * 0.12 * easeOutBack(k);
          ctx.save();
          ctx.fillStyle = '#8ec5ff';
          ctx.strokeStyle = `rgb(${INK.join(',')})`;
          ctx.lineWidth = R * 0.025;
          ctx.beginPath();
          ctx.moveTo(dx, dy - s * 1.6);
          ctx.quadraticCurveTo(dx + s, dy - s * 0.2, dx + s * 0.9, dy + s * 0.25);
          ctx.arc(dx, dy + s * 0.25, s * 0.9, 0, Math.PI);
          ctx.quadraticCurveTo(dx - s, dy - s * 0.2, dx, dy - s * 1.6);
          ctx.fill(); ctx.stroke();
          ctx.restore();
        }
        ctx.restore();
      },
    };
  }

  root.PlotTwistCartoon = { createCartoonFacepalm, faceCrop, cartoonize, compose, growMask, bilateral, averageColor, handColor, boxBlur };
})(globalThis);
