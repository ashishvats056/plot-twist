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
  const EDGE = 22; // Sobel magnitude (0–255 scale) that becomes an ink line
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

  // Photo → cartoon (cel shading): flat, smoothed colour whose brightness is
  // cut into a few bands, with ink outlines where the smoothed picture has
  // strong edges. Banding brightness only (not each channel) keeps skin
  // tones clean. Returns a new buffer.
  function cartoonize(src, w, h, o = {}) {
    const levels = o.levels || LEVELS;
    const edge = o.edge || EDGE;
    const r = Math.max(1, Math.round(w / 160));
    const soft = boxBlur(boxBlur(src, w, h, r), w, h, r); // for the outlines
    const flat = boxBlur(soft, w, h, r); // for the colour
    const out = new Uint8ClampedArray(src.length);
    const band = 255 / levels;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let mag = 0;
        if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
          const at = (dx, dy) => luma(soft, ((y + dy) * w + x + dx) * 4);
          const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
          const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
          mag = Math.sqrt(gx * gx + gy * gy) / 4;
        }
        if (mag > edge) {
          out[i] = INK[0]; out[i + 1] = INK[1]; out[i + 2] = INK[2];
        } else {
          const l = Math.max(1, luma(flat, i));
          const target = Math.min(255, (Math.floor(l / band) + 0.6) * band);
          for (let c = 0; c < 3; c++) {
            const sat = l + (flat[i + c] - l) * SATURATE;
            out[i + c] = clamp(sat * (target / l), 0, 255);
          }
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

  // The hand, in sticker units (radius 1), palm centred on the origin,
  // fingers pointing up.
  function drawHand(c, R, fill, ink) {
    const round = (x, y, w, h, r) => {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    };
    c.lineWidth = R * 0.035;
    c.lineJoin = 'round';
    c.strokeStyle = ink;
    c.fillStyle = fill;
    // fingers first, so the palm overlaps their roots
    const fingers = [[-0.27, 0.36], [-0.09, 0.44], [0.09, 0.42], [0.26, 0.33]];
    for (const [fx, len] of fingers) {
      round((fx - 0.075) * R, (-0.2 - len) * R, 0.15 * R, (len + 0.1) * R, 0.075 * R);
      c.fill(); c.stroke();
    }
    // thumb, folded across
    c.save();
    c.translate(-0.34 * R, 0.02 * R);
    c.rotate(-0.9);
    round(-0.08 * R, -0.3 * R, 0.16 * R, 0.34 * R, 0.08 * R);
    c.fill(); c.stroke();
    c.restore();
    round(-0.36 * R, -0.24 * R, 0.72 * R, 0.56 * R, 0.2 * R);
    c.fill(); c.stroke();
    // knuckle creases
    c.lineWidth = R * 0.018;
    c.beginPath();
    for (const [fx] of fingers.slice(0, 3)) {
      c.moveTo((fx + 0.02) * R, -0.18 * R);
      c.lineTo((fx + 0.06) * R, -0.1 * R);
    }
    c.stroke();
  }

  function createCartoonFacepalm() {
    let art = null; // OffscreenCanvas with the cartoon face, or null
    let hand = '#f1c27d';

    // Hand pose at elapsed ms: where the palm is (sticker units), its angle.
    function handPose(e) {
      const end = { x: 0.16, y: -0.3, a: -0.62 };
      if (e < SLAP_FROM_MS) return null;
      if (e < SLAP_AT_MS) {
        const k = easeInCubic((e - SLAP_FROM_MS) / (SLAP_AT_MS - SLAP_FROM_MS));
        return { x: 1.25 + (end.x - 1.25) * k, y: 1.15 + (end.y - 1.15) * k, a: 0.35 + (end.a - 0.35) * k };
      }
      const drag = DRAG * easeInOut(clamp((e - SLAP_AT_MS) / 1400, 0, 1));
      return { x: end.x, y: end.y + drag, a: end.a };
    }

    return {
      get ready() { return !!art; },
      // source: the raw camera frame; face: detector box, normalised.
      build(source, face, sw, sh) {
        const crop = faceCrop(face, sw, sh);
        if (crop.size < 48) return false;
        const c = new OffscreenCanvas(SIZE, SIZE);
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(source, crop.x, crop.y, crop.size, crop.size, 0, 0, SIZE, SIZE);
        const img = ctx.getImageData(0, 0, SIZE, SIZE);
        const [r, g, b] = handColor(averageColor(img.data, SIZE, SIZE, { x: 0.36, y: 0.46, w: 0.28, h: 0.12 }));
        hand = `rgb(${r},${g},${b})`;
        img.data.set(cartoonize(img.data, SIZE, SIZE));
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
          // sleeve, then the hand on top
          ctx.save();
          ctx.lineCap = 'round';
          ctx.strokeStyle = '#26324d';
          ctx.lineWidth = R * 0.42;
          ctx.beginPath();
          ctx.moveTo((pose.x + 0.35) * R, (pose.y + 0.45) * R);
          ctx.lineTo((pose.x + 1.3) * R, (pose.y + 1.9) * R);
          ctx.stroke();
          ctx.strokeStyle = '#4c8df6';
          ctx.lineWidth = R * 0.34;
          ctx.stroke();
          ctx.translate(pose.x * R, pose.y * R);
          ctx.rotate(pose.a);
          ctx.scale(1.1, 1.1);
          drawHand(ctx, R, hand, `rgb(${INK.join(',')})`);
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

  root.PlotTwistCartoon = { createCartoonFacepalm, faceCrop, cartoonize, averageColor, handColor, boxBlur };
})(globalThis);
