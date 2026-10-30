// Gesture detection from MediaPipe hand landmarks + face box + mic transients.
// Pure logic, no DOM: loaded as a content script in the page and by node tests.
(function (root) {
  'use strict';

  const LM = { WRIST: 0, THUMB_TIP: 4, INDEX_MCP: 5, MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_TIP: 12, PINKY_MCP: 17 };
  const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]]; // [tip, pip]

  const DEFAULTS = {
    // Camera-seen snap: thumb pressed to middle finger, held, then sprung open.
    // Ratios are thumb–middle-tip distance / hand size.
    pressRatio: 0.25, // pressed
    risingRatio: 0.45, // between this and springRatio: opening; falling back cancels
    springRatio: 0.55, // sprung open
    pressHoldMs: 200, // press must last this long (talking hands never hold it)...
    springMs: 300, // ...and spring open within this of the last pressed frame
    followUpFrames: 1, // 2nd snap of a double: no hold, a single pressed frame is enough
    foldMs: 100, // after the spring, the middle finger must land in the palm within this
    typingClicks: 3, // this many mic clicks in one group = typing, ignored
    handRecentMs: 1500, // a mic click counts only if a hand was seen this recently
    snapMergeMs: 250, // mic click + visual release of one snap land within this
    doubleSnapWindowMs: 650, // max gap between snaps of one group; also the settle time
    eyeLine: 0.3, // cinema: wrists above face top + 30% of face height
    defaultEyeY: 0.35,
    cinemaSpread: 0.6, // wrists at least this many face-widths apart
    defaultCinemaSpread: 0.15,
    facePad: 0.3, // facepalm: face box grown by 30% each side
    openPinch: 0.4, // facepalm: thumb at least this far from the middle finger
    clapDistance: 0.15,
    faceGuardMs: 500, // no snaps while / just after a palm is on the face
    cinemaHoldMs: 400,
    cinemaCooldownMs: 3500,
    facepalmHoldMs: 400,
    facepalmCooldownMs: 3000,
    faceMemoryMs: 3000,
  };

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const handSize = (lm) => dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]) || 1e-6;

  function pinchRatio(lm) {
    return dist(lm[LM.THUMB_TIP], lm[LM.MIDDLE_TIP]) / handSize(lm);
  }

  // A snap ends with the middle finger slapped into the palm: its tip is closer
  // to the wrist than its middle joint. An opening hand keeps it extended.
  function isMiddleFolded(lm) {
    return dist(lm[LM.MIDDLE_TIP], lm[LM.WRIST]) < dist(lm[LM.MIDDLE_PIP], lm[LM.WRIST]);
  }

  function isHandRaised(lm, eyeY) {
    const extended = FINGERS.filter(([tip, pip]) => lm[tip].y < lm[pip].y).length;
    return extended >= 3 && lm[LM.WRIST].y < eyeY;
  }

  function palmCenter(lm) {
    const pts = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.PINKY_MCP].map((i) => lm[i]);
    return { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
  }

  // An open palm: at least 3 fingers extended (tip farther from the wrist than
  // the middle joint, so it works at any angle) and the thumb off the middle
  // finger. A hand in the snap pose fails both.
  function isOpenPalm(lm) {
    const extended = FINGERS.filter(([tip, pip]) => dist(lm[tip], lm[LM.WRIST]) > dist(lm[pip], lm[LM.WRIST])).length;
    return extended >= 3 && pinchRatio(lm) > DEFAULTS.openPinch;
  }

  function isPalmOnFace(lm, face, pad = DEFAULTS.facePad) {
    if (!isOpenPalm(lm)) return false;
    const c = palmCenter(lm);
    const padX = face.w * pad;
    const padY = face.h * pad;
    const inside = c.x > face.x - padX && c.x < face.x + face.w + padX
      && c.y > face.y - padY && c.y < face.y + face.h + padY;
    return inside && handSize(lm) >= face.w * 0.5;
  }

  // A hold-to-trigger gesture with a cooldown.
  // A hold-to-trigger gesture: fires once per hold, and not again within cooldownMs.
  function createHold(holdMs, cooldownMs) {
    let since = null;
    let firedAt = -Infinity;
    let firedThisHold = false;
    return (active, t) => {
      if (!active) { since = null; firedThisHold = false; return false; }
      if (since === null) since = t;
      if (firedThisHold || t - since < holdMs || t - firedAt < cooldownMs) return false;
      firedAt = t;
      firedThisHold = true;
      return true;
    };
  }

  function createGestureEngine(options) {
    const o = { ...DEFAULTS, ...options };
    let lastFace = null;
    let lastFaceAt = -Infinity;
    let lastHands = [];
    let lastHandsAt = -Infinity;
    let lastOnFaceAt = -Infinity;
    const presses = new Map(); // hand key → { since, last, frames, risingAt, recentFolds }
    const springs = new Map(); // hand key → { t, until }: sprung, waiting for the fold
    let lastSnapAt = -Infinity;
    let group = []; // unresolved snaps: { t, src, key, claimedBy, faceAt }
    const cinema = createHold(o.cinemaHoldMs, o.cinemaCooldownMs);
    const facepalm = createHold(o.facepalmHoldMs, o.facepalmCooldownMs);

    // Snaps are grouped and resolved once no new one arrives for doubleSnapWindowMs:
    // 1 → snap, 2+ → doubleSnap, unless the group has typingClicks mic clicks.
    // A mic click and a camera-seen spring of the same snap merge into one; a
    // second hand springing at the same moment is a second snap.
    function registerSnap(t, src, key = null) {
      const last = group[group.length - 1];
      const close = last && last.src !== src && Math.abs(t - last.t) < o.snapMergeMs;
      if (close && src === 'audio') return [];
      if (close && (!last.claimedBy || last.claimedBy === key)) {
        group = [...group.slice(0, -1), { ...last, claimedBy: key }];
        return [];
      }
      group = [...group, { t, src, key, claimedBy: null, faceAt: null }];
      lastSnapAt = t;
      return [];
    }

    // A camera-only snap just before a palm lands on the face is the hand
    // moving to the face, not a snap.
    const handWentToFace = (g) => g.src === 'visual' && g.faceAt !== null
      && g.faceAt - g.t <= o.doubleSnapWindowMs;

    function tick(t) {
      const last = group[group.length - 1];
      if (!last || t - last.t < o.doubleSnapWindowMs) return [];
      const done = group.filter((g) => !handWentToFace(g));
      group = [];
      if (!done.length || done.filter((g) => g.src === 'audio').length >= o.typingClicks) return [];
      return done.length === 1 ? ['snap'] : ['doubleSnap'];
    }

    function isCinemaPose(hands, face) {
      const eyeY = face ? face.y + face.h * o.eyeLine : o.defaultEyeY;
      if (hands.length < 2 || !hands.every((h) => isHandRaised(h.landmarks, eyeY))) return false;
      const spread = Math.abs(hands[0].landmarks[LM.WRIST].x - hands[1].landmarks[LM.WRIST].x);
      return spread >= (face ? face.w * o.cinemaSpread : o.defaultCinemaSpread);
    }

    function isClap(hands) {
      return hands.length >= 2
        && dist(hands[0].landmarks[LM.WRIST], hands[1].landmarks[LM.WRIST]) < o.clapDistance;
    }

    // Fingers may take a frame or two to spring open (rising), but a rise that
    // falls back is not a snap. The second snap of a double is re-pressed too
    // quickly to require the hold.
    function confirmFold(key, lm, t) {
      const s = springs.get(key);
      if (!s) return;
      if (t > s.until) { springs.delete(key); return; }
      if (isMiddleFolded(lm)) { springs.delete(key); registerSnap(s.t, 'visual', key); }
    }

    function trackPress(key, lm, t) {
      confirmFold(key, lm, t);
      const r = pinchRatio(lm);
      const p = presses.get(key);
      if (r < o.pressRatio) {
        const continuing = p && p.risingAt === null;
        const folded = isMiddleFolded(lm);
        presses.set(key, continuing
          ? { ...p, last: t, frames: p.frames + 1, recentFolds: [...p.recentFolds.slice(-2), folded] }
          : { since: t, last: t, frames: 1, risingAt: null, recentFolds: [folded] });
        return;
      }
      if (!p) return;
      if (t - p.last > o.springMs) { presses.delete(key); return; }
      if (r > o.springRatio) {
        presses.delete(key);
        const held = p.last - p.since >= o.pressHoldMs;
        const followUp = p.frames >= o.followUpFrames && t - lastSnapAt <= o.doubleSnapWindowMs;
        // In a snap the middle finger is straight against the thumb, then curls
        // into the palm. Already curled while pressed = a fist or thinking pose.
        const straightPress = p.recentFolds.some((f) => !f);
        if ((held || followUp) && straightPress && t - lastOnFaceAt >= o.faceGuardMs) {
          springs.set(key, { t, until: t + o.foldMs });
          confirmFold(key, lm, t);
        }
      } else if (r >= o.risingRatio) {
        if (p.risingAt === null) presses.set(key, { ...p, risingAt: t });
      } else if (p.risingAt !== null) {
        presses.delete(key);
      }
    }

    function visualSnaps(hands, t) {
      hands.forEach((h, i) => trackPress(h.handedness || String(i), h.landmarks, t));
    }

    function update(result, t) {
      const hands = (result && result.hands) || [];
      if (result && result.face) { lastFace = result.face; lastFaceAt = t; }
      if (hands.length) { lastHands = hands; lastHandsAt = t; }
      const face = t - lastFaceAt <= o.faceMemoryMs ? lastFace : null;

      const onFace = !!face && hands.some((h) => isPalmOnFace(h.landmarks, face, o.facePad));
      if (onFace) {
        lastOnFaceAt = t;
        group = group.map((g) => (g.faceAt === null && t >= g.t ? { ...g, faceAt: t } : g));
      }
      visualSnaps(hands, t);
      const events = [];
      const bothUp = isCinemaPose(hands, face);
      if (cinema(bothUp, t)) events.push('cinema');
      if (facepalm(onFace && !bothUp, t)) events.push('facepalm');
      return [...events, ...tick(t)];
    }

    // A mic click counts as a snap if a hand was in view recently (not a clap,
    // not the end of a facepalm).
    function onAudioTransient(t) {
      const handInView = t - lastHandsAt <= o.handRecentMs;
      const nearFace = t - lastOnFaceAt < o.faceGuardMs;
      if (!handInView || nearFace || isClap(lastHands)) return [];
      return registerSnap(t, 'audio');
    }

    return {
      update,
      tick,
      onAudioTransient,
      trigger: (name) => [name],
    };
  }

  // Detects short, sharp, high-frequency clicks (finger snaps) in mic blocks:
  // a peak far above the running loudness floor, spiky (crest) and bright (hf).
  function createAudioTransientDetector(options) {
    // minPeak is low because the raw mic has auto-gain off. Real snaps measured
    // hf 0.43–1.0; speech stays under 0.25.
    const o = { minPeak: 0.05, floorRatio: 6, minHfRatio: 0.4, minCrest: 4, debounceMs: 150, ...options };
    let floor = null;
    let lastAt = -Infinity;
    return {
      last: null, // stats of the most recent block, for the debug recorder
      process(samples, t) {
        let peak = 0; let sum = 0; let dsum = 0;
        for (let i = 0; i < samples.length; i++) {
          const s = samples[i];
          const a = Math.abs(s);
          if (a > peak) peak = a;
          sum += s * s;
          if (i) { const d = s - samples[i - 1]; dsum += d * d; }
        }
        const rms = Math.sqrt(sum / samples.length) || 1e-9;
        const hfRatio = Math.sqrt(dsum / samples.length) / rms;
        const base = Math.max(floor === null ? rms : floor, 0.002);
        const isClick = peak >= o.minPeak && peak > base * o.floorRatio
          && hfRatio >= o.minHfRatio && peak / rms >= o.minCrest;
        this.last = { peak, overFloor: peak / base, crest: peak / rms, hf: hfRatio, isClick };
        if (!isClick) floor = floor === null ? rms : floor * 0.95 + rms * 0.05;
        if (!isClick || t - lastAt < o.debounceMs) return false;
        lastAt = t;
        return true;
      },
    };
  }

  const api = { pinchRatio, isMiddleFolded, isOpenPalm, isHandRaised, isPalmOnFace, palmCenter, createGestureEngine, createAudioTransientDetector, DEFAULTS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlotTwistGestures = api;
})(globalThis);
