// Thanos snap: only the person turns to dust and disappears; the rest of the
// frame stays live. While vanished, the person's area is painted with the room
// behind them (from PlotTwistBackground). If a photo of the empty room was taken,
// the whole frame then fades slowly into it, so no outline or halo remains.
(function (root) {
  'use strict';

  const DUST_MS = 2200;
  const TILE_LIFE_S = 0.9;
  const TILE_DIVISOR = 110; // tile size = width / 110
  const TILE_MIN_ALPHA = 40; // a tile is "person" if its mask alpha is above this (0–255)
  const SOFT_EDGE_DIVISOR = 90; // the filled-in patch fades out over width / 90 px
  const PHOTO_FADE_MS = 4000; // after the dust settles, fade into the room photo over this
  const PHOTO_RETURN_MS = 500; // on return, fade the photo back out over this

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  // How much of the room photo shows, ms after the dust settled: smoothstep, so
  // the change starts and ends imperceptibly.
  function photoBlend(ms, fadeMs) {
    const k = clamp01(ms / fadeMs);
    return k * k * (3 - 2 * k);
  }

  function createVanish() {
    const B = root.PlotTwistBackground;
    const background = B.createBackground();
    let w = 0;
    let h = 0;
    let personMask = null; // grown mask of the latest segmentation
    let softMask = null; // same, with a soft edge, for blending the filled-in room
    let hasMask = false;
    let room = null; // background, clipped to the person's area
    let person = null; // person-only cutout that turns to dust
    let tiles = [];
    let mode = 'visible';
    let modeAt = 0;
    let photo = null; // empty-room photo for this call, held in memory only
    let photoAtReturn = 0; // how much photo was showing when Return was pressed

    function resize(nw, nh) {
      if (nw === w && nh === h) return;
      w = nw; h = nh;
      personMask = B.makeCanvas(w, h);
      softMask = B.makeCanvas(w, h);
      room = B.makeCanvas(w, h);
      person = B.makeCanvas(w, h);
      hasMask = false;
    }

    // target = image ∩ mask
    function clipToPerson(target, image, mask = personMask) {
      const c = target.ctx;
      c.globalCompositeOperation = 'copy';
      c.drawImage(image, 0, 0, w, h);
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(mask.canvas, 0, 0);
      c.globalCompositeOperation = 'source-over';
    }

    // Tiles only where the person is, so the background never breaks apart.
    function makeTiles() {
      const size = Math.max(6, Math.round(w / TILE_DIVISOR));
      const cols = Math.ceil(w / size);
      const rows = Math.ceil(h / size);
      const probe = B.makeCanvas(cols, rows);
      probe.ctx.drawImage(personMask.canvas, 0, 0, cols, rows);
      const alpha = probe.ctx.getImageData(0, 0, cols, rows).data;
      const scale = w / 1280;
      const out = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (alpha[(r * cols + c) * 4 + 3] < TILE_MIN_ALPHA) continue;
          out.push({
            x: c * size, y: r * size, size,
            delay: (c / cols) * 0.7 + rand(0, 0.6),
            vx: rand(60, 220) * scale,
            vy: -rand(20, 120) * scale,
            ax: rand(40, 120) * scale,
          });
        }
      }
      return out;
    }

    function drawEmptyRoom(ctx, source) {
      ctx.drawImage(source, 0, 0, w, h);
      if (!hasMask || !background.ready) return;
      clipToPerson(room, background.canvas, softMask);
      ctx.drawImage(room.canvas, 0, 0);
    }

    function photoAlpha(now) {
      if (!photo) return 0;
      if (mode === 'vanished') return photoBlend(now - modeAt - DUST_MS, PHOTO_FADE_MS);
      if (mode === 'reappearing') return photoAtReturn * (1 - clamp01((now - modeAt) / PHOTO_RETURN_MS));
      return 0;
    }

    function drawPhoto(ctx, alpha) {
      if (alpha <= 0) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(photo.canvas, 0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // elapsedS runs forward while vanishing, backward while reappearing.
    function drawDust(ctx, elapsedS) {
      for (const t of tiles) {
        const tau = elapsedS - t.delay;
        if (tau >= TILE_LIFE_S) continue;
        if (tau <= 0) {
          ctx.drawImage(person.canvas, t.x, t.y, t.size, t.size, t.x, t.y, t.size, t.size);
          continue;
        }
        const k = tau / TILE_LIFE_S;
        ctx.globalAlpha = 1 - k;
        const dx = t.vx * tau + 0.5 * t.ax * tau * tau;
        const dy = t.vy * tau;
        const sz = t.size * (1 - 0.5 * k);
        ctx.drawImage(person.canvas, t.x, t.y, t.size, t.size, t.x + dx, t.y + dy, sz, sz);
      }
      ctx.globalAlpha = 1;
    }

    return {
      get mode() { return mode; },
      get roomPhoto() { return photo && photo.canvas; },
      setRoomPhoto(source, sw, sh) {
        resize(sw, sh);
        photo = B.makeCanvas(w, h);
        photo.ctx.drawImage(source, 0, 0, w, h);
      },
      clearRoomPhoto() { photo = null; },
      debugCanvases: () => ({ room: background.canvas, mask: personMask && personMask.canvas, soft: softMask && softMask.canvas, ...background.debug }),
      // Called whenever a fresh segmentation mask arrives, with the frame it was
      // computed from. learn=false: use it to erase the person, but don't save the
      // frame into the room image (camera warm-up, very dark frames).
      setMask(source, mask, sw, sh, learn = true, hands = []) {
        resize(sw, sh);
        B.dilateMask(personMask, mask, w, h, hands);
        softMask.ctx.clearRect(0, 0, w, h);
        softMask.ctx.filter = `blur(${Math.max(2, Math.round(w / SOFT_EDGE_DIVISOR))}px)`;
        softMask.ctx.drawImage(personMask.canvas, 0, 0);
        softMask.ctx.filter = 'none';
        hasMask = true;
        if (learn) background.update(source, personMask.canvas, w, h, performance.now());
      },
      vanish(now, source, sw, sh) {
        if (mode !== 'visible' || !hasMask) return false;
        resize(sw, sh);
        clipToPerson(person, source);
        tiles = makeTiles();
        mode = 'vanishing'; modeAt = now;
        return true;
      },
      reappear(now) {
        if (mode !== 'vanished' && mode !== 'vanishing') return false;
        photoAtReturn = photoAlpha(now);
        tiles = makeTiles();
        mode = 'reappearing'; modeAt = now;
        return true;
      },
      draw(ctx, source, sw, sh, now) {
        resize(sw, sh);
        const elapsed = now - modeAt;
        if (mode === 'vanishing' && elapsed >= DUST_MS) mode = 'vanished';
        if (mode === 'reappearing' && elapsed >= DUST_MS) mode = 'visible';
        if (mode === 'visible') { ctx.drawImage(source, 0, 0, w, h); return; }
        drawEmptyRoom(ctx, source);
        drawPhoto(ctx, photoAlpha(now));
        if (mode === 'vanishing') drawDust(ctx, elapsed / 1000);
        if (mode === 'reappearing') {
          clipToPerson(person, source);
          drawDust(ctx, (DUST_MS - elapsed) / 1000);
        }
      },
    };
  }

  root.PlotTwistVanish = { createVanish, photoBlend };
})(globalThis);
