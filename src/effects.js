// Draws the outgoing video: live frame (via PlotTwistVanish) + cinema, facepalm, money rain.
// The facepalm is, in order of preference: your own (an emoji, picture or GIF
// set in the facepalm editor), a local image in assets/ (never in the store
// build), a cartoon of your face (PlotTwistCartoon), or the 🤦 emoji.
// Everything is drawn on the camera frame (draw). When Google Meet sends a
// processed copy of it instead (background blur/replacement), redrawOverlays
// paints the same overlays on Meet's frame too, because Meet's background
// replacement cuts out anything outside you.
(function (root) {
  'use strict';

  const CINEMA_MS = 3000;
  const FACEPALM_MS = 2500; // emoji or still image
  const FACEPALM_MIN_MS = 1500; // an animated facepalm plays once, held within these bounds
  const FACEPALM_MAX_MS = 6000;
  const STILL_ALPHA = 0.55; // a still image is blended over you
  const ANIMATED_ALPHA = 1; // an animated one is a full-frame cut-away, like a meme reaction
  const MONEY_MS = 4500;
  const MONEY_NOTES = 70;
  const FADE_MS = 250;
  // Colour emoji on macOS, Windows, ChromeOS/Linux.
  const EMOJI_FONTS = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", sans-serif';

  const makeCanvas = (w, h) => {
    const c = new OffscreenCanvas(w, h);
    return { canvas: c, ctx: c.getContext('2d') };
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const fade = (elapsed, total) => Math.max(0, Math.min(1, elapsed / FADE_MS, (total - elapsed) / FADE_MS));

  // Facepalm media: { frames: [{ bitmap, ms }] }. A still image is one frame
  // lasting forever. Pure helpers below are unit-tested.
  function mediaDuration(media) {
    return media ? media.frames.reduce((sum, f) => sum + f.ms, 0) : 0;
  }

  // The frame showing `elapsed` ms after the start. Plays once, then holds the
  // last frame (a looping facepalm restarting mid-fade looks broken).
  function mediaFrameAt(media, elapsed) {
    if (!media || !media.frames.length) return null;
    let t = Math.max(0, elapsed);
    for (const f of media.frames) {
      if (t < f.ms) return f;
      t -= f.ms;
    }
    return media.frames[media.frames.length - 1];
  }

  function facepalmDuration(media) {
    const d = mediaDuration(media);
    if (!media || !Number.isFinite(d)) return FACEPALM_MS;
    return Math.min(FACEPALM_MAX_MS, Math.max(FACEPALM_MIN_MS, d));
  }

  // ImageDecoder reports GIF delays in microseconds. Browsers play 0–10 ms
  // delays at 100 ms, and GIFs are authored for that.
  function gifFrameMs(us) {
    const ms = Math.round((Number(us) || 0) / 1000);
    return ms <= 10 ? 100 : ms;
  }

  function drawCover(ctx, img, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s;
    const dh = img.height * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function makeNoteSprite() {
    const { canvas, ctx } = makeCanvas(160, 72);
    ctx.fillStyle = '#5f9f5a';
    ctx.fillRect(0, 0, 160, 72);
    ctx.strokeStyle = '#2f5e2b';
    ctx.lineWidth = 4;
    ctx.strokeRect(4, 4, 152, 64);
    ctx.fillStyle = '#d8ecd2';
    ctx.beginPath();
    ctx.ellipse(80, 36, 20, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f5e2b';
    ctx.font = 'bold 28px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 80, 37);
    ctx.font = 'bold 16px Georgia, serif';
    ctx.fillText('100', 24, 20);
    ctx.fillText('100', 136, 54);
    return canvas;
  }

  function createRenderer() {
    let w = 0;
    let h = 0;
    const vanish = root.PlotTwistVanish.createVanish();
    let notes = [];
    const noteSprite = makeNoteSprite();
    const s = { cinemaAt: -Infinity, facepalmAt: -Infinity, moneyAt: -Infinity };
    let facepalmMedia = null;
    let facepalmEmoji = null; // your own emoji, instead of the cartoon
    const cartoon = root.PlotTwistCartoon ? root.PlotTwistCartoon.createCartoonFacepalm() : null;

    function drawCinema(ctx, now) {
      const e = now - s.cinemaAt;
      if (e < 0 || e > CINEMA_MS) return;
      const a = fade(e, CINEMA_MS);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.filter = 'grayscale(1) contrast(1.3) brightness(0.9)';
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.filter = 'none';
      const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.9);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.75)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = h * 0.02;
      ctx.font = `600 ${Math.round(h * 0.045)}px Helvetica, Arial, sans-serif`;
      ctx.fillText('A B S O L U T E', w / 2, h * 0.76);
      ctx.font = `900 ${Math.round(h * 0.15)}px Helvetica, Arial, sans-serif`;
      ctx.fillText('CINEMA', w / 2, h * 0.9);
      ctx.restore();
    }

    function drawFacepalm(ctx, now) {
      const e = now - s.facepalmAt;
      const total = facepalmDuration(facepalmMedia);
      if (e < 0 || e > total) return;
      const a = fade(e, total);
      const frame = mediaFrameAt(facepalmMedia, e);
      ctx.save();
      if (frame) {
        ctx.globalAlpha = (facepalmMedia.frames.length > 1 ? ANIMATED_ALPHA : STILL_ALPHA) * a;
        drawCover(ctx, frame.bitmap, w, h);
      } else if (!facepalmEmoji && cartoon && cartoon.ready) {
        cartoon.draw(ctx, e, w, h, a);
      } else {
        ctx.globalAlpha = 0.9 * a;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${Math.round(h * 0.45)}px ${EMOJI_FONTS}`;
        ctx.fillText(facepalmEmoji || '\u{1F926}', w / 2, h * 0.5);
      }
      ctx.restore();
    }

    function spawnNotes() {
      const scale = w / 1280;
      notes = Array.from({ length: MONEY_NOTES }, () => ({
        x: rand(0, w),
        y: -rand(40, 200) * scale,
        delay: rand(0, 1.6),
        vy: rand(180, 360) * scale,
        sway: rand(20, 60) * scale,
        phase: rand(0, Math.PI * 2),
        rot: rand(-1, 1),
        spin: rand(-2.5, 2.5),
        size: rand(0.6, 1.1) * scale,
      }));
    }

    function drawMoney(ctx, now) {
      const e = now - s.moneyAt;
      if (e < 0 || e > MONEY_MS) return;
      const sec = e / 1000;
      const a = Math.min(1, (MONEY_MS - e) / 600);
      ctx.save();
      ctx.globalAlpha = a;
      for (const n of notes) {
        const t = sec - n.delay;
        if (t < 0) continue;
        const y = n.y + n.vy * t;
        if (y > h + 100) continue;
        const x = n.x + Math.sin(n.phase + t * 3) * n.sway;
        ctx.setTransform(n.size, 0, 0, n.size, x, y);
        ctx.rotate(n.rot + n.spin * t);
        ctx.drawImage(noteSprite, -80, -36);
      }
      ctx.restore();
    }

    function drawDebug(ctx, debug) {
      if (!debug) return;
      ctx.save();
      ctx.fillStyle = '#0f0';
      for (const hand of debug.hands || []) {
        for (const p of hand.landmarks) ctx.fillRect(p.x * w - 3, p.y * h - 3, 6, 6);
      }
      if (debug.face) {
        ctx.strokeStyle = '#ff0';
        ctx.lineWidth = 3;
        ctx.strokeRect(debug.face.x * w, debug.face.y * h, debug.face.w * w, debug.face.h * h);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, w, 34);
      ctx.fillStyle = '#0f0';
      ctx.font = '20px monospace';
      ctx.fillText(debug.text || '', 10, 24);
      ctx.restore();
    }

    return {
      get mode() { return vanish.mode; },
      debugCanvases: () => vanish.debugCanvases(),
      // media: { frames: [{ bitmap, ms }] } from the detector, or null;
      // emoji: your own emoji, or null. Neither: the cartoon or the 🤦 emoji.
      setFacepalm(media, emoji) {
        const ok = media && Array.isArray(media.frames) && media.frames.length
          && media.frames.every((f) => f && f.bitmap && f.ms > 0);
        const old = facepalmMedia;
        facepalmMedia = ok ? media : null;
        facepalmEmoji = facepalmMedia ? null : (typeof emoji === 'string' && emoji) || null;
        if (old && old !== facepalmMedia) for (const f of old.frames) if (f.bitmap.close) f.bitmap.close();
      },
      // The cartoon facepalm, built once per camera session from a frame
      // with your face in it. Not needed when you set your own.
      get wantsCartoon() { return !!cartoon && !cartoon.ready && !facepalmMedia && !facepalmEmoji; },
      get customFacepalm() { return !!(facepalmMedia || facepalmEmoji); },
      get hasCartoon() { return !!cartoon && cartoon.ready; },
      buildCartoon: (source, face, sw, sh, mask) => !!cartoon && cartoon.build(source, face, sw, sh, mask),
      clearCartoon() { if (cartoon) cartoon.clear(); },
      setMask: (source, mask, sw, sh, learn, hands) => vanish.setMask(source, mask, sw, sh, learn, hands),
      vanish: (now, source, sw, sh) => vanish.vanish(now, source, sw, sh),
      reappear: (now) => vanish.reappear(now),
      get bgPhoto() { return vanish.bgPhoto; },
      setBgPhoto: (source, sw, sh) => vanish.setBgPhoto(source, sw, sh),
      clearBgPhoto: () => vanish.clearBgPhoto(),
      cinema(now) { s.cinemaAt = now; },
      facepalm(now) { s.facepalmAt = now; },
      money(now) { s.moneyAt = now; spawnNotes(); },
      // Whether any overlay (not the vanish) is on screen right now.
      overlaysActive(now) {
        return now - s.cinemaAt <= CINEMA_MS || now - s.facepalmAt <= facepalmDuration(facepalmMedia)
          || now - s.moneyAt <= MONEY_MS;
      },
      // Meet's processed frame: draw the overlays again on top of it.
      redrawOverlays(ctx, source, sw, sh, now) {
        w = sw; h = sh;
        ctx.drawImage(source, 0, 0, sw, sh);
        drawCinema(ctx, now);
        drawFacepalm(ctx, now);
        drawMoney(ctx, now);
      },
      draw(ctx, source, sw, sh, now, debug) {
        w = sw; h = sh;
        vanish.draw(ctx, source, sw, sh, now);
        drawCinema(ctx, now);
        drawFacepalm(ctx, now);
        drawMoney(ctx, now);
        drawDebug(ctx, debug);
      },
    };
  }

  root.PlotTwistEffects = { createRenderer, mediaFrameAt, mediaDuration, facepalmDuration, gifFrameMs };
})(globalThis);
