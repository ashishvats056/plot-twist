// Builds an "empty room" image while you sit in front of the camera: every
// frame with the person cut out (via the segmentation mask) is layered onto an
// accumulator, and pixels never seen are filled row by row from the room on
// either side (walls and furniture mostly run horizontally).
(function (root) {
  'use strict';

  const FILL_WIDTH = 320; // hole filling runs on a small copy, then is scaled up
  const SMOOTH_DIVISOR = 256; // fill is softened by width / 256 px to hide streaks
  const KNOWN_ALPHA = 128; // a pixel with at least this alpha counts as seen room
  const FADE_PER_SEC = 0.01; // room pixels not seen again fade below KNOWN_ALPHA in ~70 s
  const FADE_STEP = 0.02; // canvas alpha is 8-bit: apply fades in steps big enough to register
  const MASK_STAMPS = 2; // keeps the feathered edge opaque on the inside
  const FEATHER_DIVISOR = 200; // soft edge of width / 200 px (the detector already grew the mask)
  const HAND_PAD_DIVISOR = 30; // hand outlines are padded by width / 30 px (fingers are thin)

  const makeCanvas = (w, h, readBack = false) => {
    const c = new OffscreenCanvas(w, h);
    return { canvas: c, ctx: c.getContext('2d', { willReadFrequently: readBack }) };
  };

  // Monotone-chain convex hull of [x, y] points.
  function convexHull(points) {
    if (points.length < 3) return points;
    const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (list) => list.reduce((hull, p) => {
      const out = [...hull];
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      return [...out, p];
    }, []);
    const lower = half(pts);
    const upper = half([...pts].reverse());
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
  }

  // The person segmenter often misses hands held away from the body; the hand
  // tracker doesn't, so its landmarks are drawn into the mask as padded outlines.
  function drawHands(c, hands, w, h) {
    c.fillStyle = '#fff';
    c.strokeStyle = '#fff';
    c.lineJoin = 'round';
    c.lineWidth = Math.max(4, Math.round(w / HAND_PAD_DIVISOR));
    for (const hand of hands) {
      const hull = convexHull(hand.landmarks.map((p) => [p.x * w, p.y * h]));
      c.beginPath();
      hull.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
      c.fill();
      c.stroke();
    }
  }

  // Hard person mask from the detector (+ hand outlines) → frame-sized mask
  // with a lightly feathered edge.
  function dilateMask(target, mask, w, h, hands = []) {
    const c = target.ctx;
    c.clearRect(0, 0, w, h);
    c.filter = `blur(${Math.max(1, Math.round(w / FEATHER_DIVISOR))}px)`;
    for (let i = 0; i < MASK_STAMPS; i++) {
      c.drawImage(mask, 0, 0, w, h);
      drawHands(c, hands, w, h);
    }
    c.filter = 'none';
  }

  // Fills one line of an RGBA buffer in place; at(i) is the byte offset of item i.
  // Each gap is blended between the known pixels on either side of it.
  function fillLine(d, n, at) {
    let left = -1;
    let i = 0;
    while (i < n) {
      if (d[at(i) + 3] >= KNOWN_ALPHA) { d[at(i) + 3] = 255; left = i; i++; continue; }
      let j = i;
      while (j < n && d[at(j) + 3] < KNOWN_ALPHA) j++;
      const right = j < n ? j : -1;
      if (left >= 0 || right >= 0) {
        const a = at(left >= 0 ? left : right);
        const b = at(right >= 0 ? right : left);
        for (let k = i; k < j; k++) {
          const t = left >= 0 && right >= 0 ? (k - left) / (right - left) : 0;
          const o = at(k);
          for (let c = 0; c < 3; c++) d[o + c] = d[a + c] + (d[b + c] - d[a + c]) * t;
          d[o + 3] = 255;
        }
      }
      i = j;
    }
  }

  // Fills unseen pixels (alpha < KNOWN_ALPHA) of an RGBA buffer in place: rows
  // first, then columns for rows that had no known pixel at all.
  function fillScanlines(d, fw, fh) {
    for (let y = 0; y < fh; y++) fillLine(d, fw, (x) => (y * fw + x) * 4);
    for (let x = 0; x < fw; x++) fillLine(d, fh, (y) => (y * fw + x) * 4);
  }

  function createBackground() {
    let w = 0;
    let h = 0;
    let cut = null;
    let accum = null;
    let filled = null;
    let small = null;
    let ready = false;
    let lastUpdateAt = null;
    let fadeOwed = 0;

    function resize(nw, nh) {
      if (nw === w && nh === h) return;
      w = nw; h = nh;
      cut = makeCanvas(w, h);
      accum = makeCanvas(w, h);
      filled = makeCanvas(w, h);
      ready = false;
      small = makeCanvas(FILL_WIDTH, Math.max(1, Math.round((h * FILL_WIDTH) / w)), true);
    }

    function cutOutPerson(source, personMask) {
      const c = cut.ctx;
      c.globalCompositeOperation = 'copy';
      c.drawImage(source, 0, 0, w, h);
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(personMask, 0, 0);
      c.globalCompositeOperation = 'source-over';
    }

    // Fade the whole saved room a little; whatever is visible now is redrawn at
    // full strength right after, so only pixels not seen for a while fade out.
    function fadeStale(now) {
      const dt = lastUpdateAt === null ? 0 : Math.min(1, (now - lastUpdateAt) / 1000);
      lastUpdateAt = now;
      fadeOwed += FADE_PER_SEC * dt;
      if (fadeOwed < FADE_STEP) return;
      const c = accum.ctx;
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = `rgba(0,0,0,${fadeOwed})`;
      fadeOwed = 0;
      c.fillRect(0, 0, w, h);
      c.globalCompositeOperation = 'source-over';
    }

    // Paint the row-filled small copy behind the sharp accumulator, so seen room
    // stays sharp and only never-seen pixels come from the fill.
    function fillHoles() {
      const { width: fw, height: fh } = small.canvas;
      small.ctx.clearRect(0, 0, fw, fh);
      small.ctx.drawImage(accum.canvas, 0, 0, fw, fh);
      const img = small.ctx.getImageData(0, 0, fw, fh);
      fillScanlines(img.data, fw, fh);
      small.ctx.putImageData(img, 0, 0);
      const f = filled.ctx;
      f.globalCompositeOperation = 'copy';
      f.drawImage(accum.canvas, 0, 0);
      f.globalCompositeOperation = 'destination-over';
      f.filter = `blur(${Math.max(1, Math.round(w / SMOOTH_DIVISOR))}px)`;
      f.drawImage(small.canvas, 0, 0, w, h);
      f.filter = 'none';
      f.globalCompositeOperation = 'source-over';
    }

    return {
      get ready() { return ready; },
      get canvas() { return filled && filled.canvas; },
      get debug() { return { cut: cut && cut.canvas, accum: accum && accum.canvas, small: small && small.canvas }; },
      // personMask: output of dilateMask at the same size as the frame.
      update(source, personMask, sw, sh, now) {
        resize(sw, sh);
        cutOutPerson(source, personMask);
        fadeStale(now);
        accum.ctx.drawImage(cut.canvas, 0, 0);
        fillHoles();
        ready = true;
      },
    };
  }

  root.PlotTwistBackground = { createBackground, dilateMask, makeCanvas, fillScanlines, convexHull };
})(globalThis);
