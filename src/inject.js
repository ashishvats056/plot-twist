// Runs in Meet's page (MAIN world) before Meet's own scripts. Wraps the camera
// track so every frame passes through the effects renderer, and listens to the
// mic for snap clicks. Hand/face detection happens in the detector iframe.
(function () {
  'use strict';

  const G = window.PlotTwistGestures;
  const E = window.PlotTwistEffects;
  const A = window.PlotTwistActions;
  const md = navigator.mediaDevices;
  if (window.__plottwist || !G || !E || !A || !md || !md.getUserMedia) return;

  const IFRAME_ID = 'plottwist-detector';
  const DETECT_WIDTH = 640; // larger input finds small, fast snapping hands more often
  const DETECT_TIMEOUT_MS = 2000;
  const SEGMENT_EVERY_MS = 120; // how often the person mask refreshes the background
  const WARMUP_MS = 1000; // cameras send black/dim frames at first: don't learn the room from them
  const MIN_LUMA = 12; // frames darker than this (0–255 average) aren't learned either
  const TICK_MS = 100;
  const POLL_MS = 1000;
  const LOG_MAX = 50;
  const REC_MS = 60000; // debug recorder keeps the last 60 s

  const origGetUserMedia = md.getUserMedia.bind(md);
  const engine = G.createGestureEngine();
  const renderer = E.createRenderer();
  const state = {
    settings: { ...A.DEFAULT_SETTINGS },
    cameras: 0, // live processed camera tracks
    micTrack: null, // Meet's mic track, tapped for snap clicks only when autoSnap is on
    wantPhoto: false,
    enabled: true,
    debug: false,
    log: [],
    lastEvent: '',
    lastResult: null,
    audio: false,
    pendingMask: null,
    pendingHands: [], // hand landmarks from the same frame as pendingMask
    wantVanish: false,
    rec: { frames: [], audio: [], raw: [], clicks: [] },
  };

  function log(msg) {
    state.log = [...state.log.slice(1 - LOG_MAX), `${Math.round(performance.now())} ${msg}`];
    state.lastEvent = msg;
  }

  function remember(key, item) {
    const kept = state.rec[key].filter((x) => item.t - x.t <= REC_MS);
    state.rec = { ...state.rec, [key]: [...kept, item] };
  }

  // source 'gesture': detected (honours the auto-detect settings); 'manual': a
  // button or keyboard shortcut (always runs).
  function handle(events, now, source = 'gesture') {
    for (const ev of events) {
      if (source === 'gesture' && !A.allowsGesture(ev, state.settings)) continue;
      log(source === 'manual' ? `${ev} (button)` : ev);
      const { mode } = renderer;
      if (ev === 'snap' || ev === 'doubleSnap') {
        // Snaps during the dust animation are ignored, so one stray click
        // can't undo a vanish half a second after it started.
        if (mode === 'vanished') renderer.reappear(now);
        else if (mode === 'visible' && ev === 'doubleSnap') renderer.money(now);
        else if (mode === 'visible') state.wantVanish = true;
      } else if (mode === 'visible' && ev === 'cinema') renderer.cinema(now);
      else if (mode === 'visible' && ev === 'facepalm') renderer.facepalm(now);
    }
  }

  const detector = (() => {
    let frame = null;
    let origin = null;
    let ready = false;
    let busySince = null;
    let nextId = 1;
    let helloTimer = null;
    let lastSegmentAt = -Infinity;

    function locate() {
      frame = document.getElementById(IFRAME_ID);
      if (!frame) {
        window.dispatchEvent(new CustomEvent('plottwist:mount'));
        frame = document.getElementById(IFRAME_ID);
      }
      origin = frame ? new URL(frame.src, location.href).origin : null;
      return !!frame;
    }

    window.addEventListener('message', (e) => {
      const m = e.data;
      if (!frame || e.source !== frame.contentWindow || e.origin !== origin) return;
      if (!m || m.source !== 'plottwist-detector') return;
      if (m.type === 'ready') {
        if (!ready) log('detector ready');
        ready = true;
        clearInterval(helloTimer);
        if (m.facepalm) renderer.setFacepalmImage(m.facepalm);
      } else if (m.type === 'error') {
        log(`detector error: ${m.message}`);
      } else if (m.type === 'result') {
        busySince = null;
        if (m.error) log(`detect error: ${m.error}`);
        const now = performance.now();
        state.lastResult = m;
        remember('raw', {
          t: Math.round(now),
          h: m.hands.map((h) => ({ s: h.handedness, l: h.landmarks.map((p) => [+p.x.toFixed(3), +p.y.toFixed(3)]) })),
          f: m.face && Object.fromEntries(Object.entries(m.face).map(([k, v]) => [k, v == null ? v : +v.toFixed(3)])),
        });
        remember('frames', {
          t: Math.round(now),
          p: m.hands.map((h) => G.pinchRatio(h.landmarks).toFixed(2) + (G.isMiddleFolded(h.landmarks) ? 'f' : '')),
          f: m.face ? 1 : 0,
        });
        if (m.mask) {
          if (state.pendingMask) state.pendingMask.close();
          state.pendingMask = m.mask;
          state.pendingHands = m.hands;
        }
        handle(engine.update(m, now), now);
      }
    });

    return {
      start() {
        if (helloTimer || ready) return;
        const hello = () => {
          if (locate() && frame.contentWindow) frame.contentWindow.postMessage({ source: 'plottwist', type: 'hello' }, origin);
        };
        hello();
        helloTimer = setInterval(hello, POLL_MS);
      },
      idle(now) {
        if (busySince !== null && now - busySince > DETECT_TIMEOUT_MS) busySince = null;
        return ready && busySince === null;
      },
      // Returns whether a person mask was requested for this frame.
      send(bitmap, now) {
        busySince = now;
        // Every frame while vanished (the person must be erased live), else ~8/s.
        const segment = renderer.mode !== 'visible' || now - lastSegmentAt >= SEGMENT_EVERY_MS;
        if (segment) lastSegmentAt = now;
        frame.contentWindow.postMessage({ source: 'plottwist', type: 'detect', id: nextId++, bitmap, segment }, origin, [bitmap]);
        return segment;
      },
    };
  })();

  function debugInfo() {
    const r = state.lastResult || { hands: [], face: null };
    const pinch = r.hands.map((h) => G.pinchRatio(h.landmarks).toFixed(2)).join(',');
    return { ...r, text: `${renderer.mode} | mic:${state.audio ? 'on' : 'off'} | pinch:${pinch || '-'} | ${state.lastEvent}` };
  }

  function createPipeline() {
    const out = new OffscreenCanvas(2, 2);
    const ctx = out.getContext('2d');
    const det = new OffscreenCanvas(DETECT_WIDTH, 2);
    const detCtx = det.getContext('2d');
    // The exact frame a person mask was computed from. The mask arrives a few
    // frames later; applying it to the newest frame instead would let a moving
    // person leak into the saved room image.
    const segFrame = new OffscreenCanvas(2, 2);
    const segCtx = segFrame.getContext('2d');
    const probe = new OffscreenCanvas(16, 9).getContext('2d', { willReadFrequently: true });
    let startedAt = null;
    const worthLearning = (now) => {
      if (now - startedAt < WARMUP_MS) return false;
      probe.drawImage(segFrame, 0, 0, 16, 9);
      const d = probe.getImageData(0, 0, 16, 9).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum / (d.length / 4) / 3 >= MIN_LUMA;
    };
    return function process(source, w, h) {
      if (out.width !== w || out.height !== h) {
        out.width = w; out.height = h;
        segFrame.width = w; segFrame.height = h;
        det.height = Math.round((DETECT_WIDTH * h) / w);
      }
      const now = performance.now();
      if (startedAt === null) startedAt = now;
      if (!state.enabled) { ctx.drawImage(source, 0, 0, w, h); return out; }
      if (state.pendingMask) {
        renderer.setMask(segFrame, state.pendingMask, w, h, worthLearning(now), state.pendingHands);
        state.pendingMask.close();
        state.pendingMask = null;
      }
      if (state.wantPhoto) {
        renderer.setRoomPhoto(source, w, h);
        state.wantPhoto = false;
        log('room photo captured');
      }
      if (state.wantVanish) {
        if (!renderer.vanish(now, source, w, h)) log('vanish skipped: no person mask yet');
        state.wantVanish = false;
      }
      if (detector.idle(now)) {
        detCtx.drawImage(source, 0, 0, det.width, det.height);
        if (detector.send(det.transferToImageBitmap(), now)) segCtx.drawImage(source, 0, 0, w, h);
      }
      renderer.draw(ctx, source, w, h, now, state.debug ? debugInfo() : null);
      return out;
    };
  }

  // Make the processed track look like the real camera to Meet, and release the
  // camera once Meet has stopped every copy of it.
  function disguise(fake, real) {
    let live = 1;
    const release = () => { live -= 1; if (live <= 0) real.stop(); };
    const patch = (t) => {
      const stop = t.stop.bind(t);
      const clone = t.clone.bind(t);
      Object.defineProperty(t, 'label', { get: () => real.label, configurable: true });
      t.getSettings = () => ({ ...real.getSettings() });
      t.getCapabilities = () => (real.getCapabilities ? real.getCapabilities() : {});
      t.getConstraints = () => real.getConstraints();
      t.applyConstraints = (c) => real.applyConstraints(c);
      t.stop = () => { if (t.readyState !== 'ended') release(); stop(); };
      t.clone = () => { live += 1; return patch(clone()); };
      return t;
    };
    return patch(fake);
  }

  function wrapWithBreakoutBox(track, process) {
    const processor = new MediaStreamTrackProcessor({ track });
    const generator = new MediaStreamTrackGenerator({ kind: 'video' });
    const transformer = new TransformStream({
      transform(frame, controller) {
        try {
          const canvas = process(frame, frame.displayWidth, frame.displayHeight);
          controller.enqueue(new VideoFrame(canvas, { timestamp: frame.timestamp, alpha: 'discard' }));
        } catch (err) {
          log(`frame error: ${err.message}`);
          controller.enqueue(frame.clone());
        } finally {
          frame.close();
        }
      },
    });
    processor.readable.pipeThrough(transformer).pipeTo(generator.writable).catch(() => {}).finally(cameraStopped);
    return disguise(generator, track);
  }

  // Older Chrome without MediaStreamTrackGenerator: draw into a captured canvas.
  function wrapWithCanvas(track, process) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    video.play().catch(() => {});
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const [fake] = canvas.captureStream(30).getVideoTracks();
    const timer = setInterval(() => {
      if (track.readyState === 'ended') { clearInterval(timer); fake.stop(); cameraStopped(); return; }
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w) return;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.drawImage(process(video, w, h), 0, 0);
    }, 1000 / 30);
    return disguise(fake, track);
  }

  // The room photo is for this call only: forget it once no camera is running.
  function cameraStopped() {
    state.cameras = Math.max(0, state.cameras - 1);
    if (state.cameras || !renderer.roomPhoto) return;
    renderer.clearRoomPhoto();
    log('room photo cleared (camera stopped)');
  }

  function wrapVideoTrack(track) {
    state.cameras += 1;
    const process = createPipeline();
    const hasBreakoutBox = typeof MediaStreamTrackProcessor === 'function'
      && typeof MediaStreamTrackGenerator === 'function';
    return hasBreakoutBox ? wrapWithBreakoutBox(track, process) : wrapWithCanvas(track, process);
  }

  // Chrome's default mic processing (noise suppression, auto-gain) strips most
  // of a snap's click, so listen on a separate raw stream of the same mic.
  async function openRawMic(track) {
    const { deviceId } = track.getSettings();
    try {
      const raw = await origGetUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      return { listen: raw.getAudioTracks()[0], raw: true };
    } catch (err) {
      log(`raw mic unavailable, using Meet's: ${err.message}`);
      return { listen: track.clone(), raw: false };
    }
  }

  let audioTap = null;
  async function tapAudio(track) {
    if (audioTap && audioTap.source.readyState === 'live') return;
    audioTap = { source: track, stop: () => {} }; // claim before awaiting so we never tap twice
    try {
      const { listen, raw } = await openRawMic(track);
      if (!state.settings.autoSnap) { listen.stop(); audioTap = null; return; }
      const ctx = new AudioContext();
      const input = ctx.createMediaStreamSource(new MediaStream([listen]));
      const node = ctx.createScriptProcessor(1024, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0;
      const clicks = G.createAudioTransientDetector();
      node.onaudioprocess = (e) => {
        const now = performance.now();
        const hit = clicks.process(e.inputBuffer.getChannelData(0), now);
        const a = clicks.last;
        if (a && a.peak > 0.03) {
          remember('audio', { t: Math.round(now), pk: +a.peak.toFixed(3), of: +a.overFloor.toFixed(1), cr: +a.crest.toFixed(1), hf: +a.hf.toFixed(2) });
        }
        if (hit) {
          remember('clicks', { t: Math.round(now) });
          log('mic click');
          handle(engine.onAudioTransient(now), now);
        }
      };
      input.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
      const syncState = () => { state.audio = ctx.state === 'running'; };
      ctx.onstatechange = syncState;
      ctx.resume().catch(() => {});
      syncState();
      log(raw ? 'listening on raw mic' : 'listening on processed mic');
      let poll = null;
      const stop = () => {
        clearInterval(poll);
        listen.stop();
        ctx.close().catch(() => {});
        state.audio = false;
        audioTap = null;
      };
      audioTap = { source: track, stop };
      // Meet stops tracks with stop(), which fires no 'ended' event, so poll.
      poll = setInterval(() => { if (track.readyState === 'ended') stop(); }, POLL_MS);
    } catch (err) {
      audioTap = null;
      log(`mic tap failed: ${err.message}`);
    }
  }

  md.getUserMedia = async function getUserMedia(constraints) {
    const stream = await origGetUserMedia(constraints);
    try {
      const [audio] = stream.getAudioTracks();
      if (audio) {
        state.micTrack = audio;
        if (state.settings.autoSnap) tapAudio(audio);
      }
      const [video] = stream.getVideoTracks();
      if (!video) return stream;
      detector.start();
      return new MediaStream([wrapVideoTrack(video), ...stream.getAudioTracks()]);
    } catch (err) {
      log(`passthrough: ${err.message}`);
      return stream;
    }
  };

  setInterval(() => { const now = performance.now(); handle(engine.tick(now), now); }, TICK_MS);

  function setSetting(key, value) {
    if (!(key in A.DEFAULT_SETTINGS)) return;
    state.settings = { ...state.settings, [key]: !!value };
    log(`${key} ${value ? 'on' : 'off'}`);
    if (key !== 'autoSnap') return;
    const mic = state.micTrack;
    if (value && mic && mic.readyState === 'live') tapAudio(mic);
    if (!value && audioTap) audioTap.stop();
  }

  const trigger = (ev) => handle([ev], performance.now(), 'manual');
  const controller = {
    get mode() { return renderer.mode; },
    get hasCamera() { return state.cameras > 0; },
    trigger,
  };

  const KEYS = {
    KeyS: () => ['snap'],
    KeyM: () => ['doubleSnap'],
    KeyC: () => ['cinema'],
    KeyF: () => ['facepalm'],
    KeyD: () => { state.debug = !state.debug; return []; },
    KeyX: () => { state.enabled = !state.enabled; log(state.enabled ? 'effects on' : 'effects off'); return []; },
  };
  window.addEventListener('keydown', (e) => {
    const action = e.altKey && e.shiftKey && KEYS[e.code];
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    handle(action(), performance.now(), 'manual');
  }, true);

  window.__plottwist = {
    trigger,
    actions: A.createActions(controller),
    get settings() { return state.settings; },
    setSetting,
    get hasCamera() { return controller.hasCamera; },
    get roomPhoto() { return renderer.roomPhoto; },
    captureRoom: () => { state.wantPhoto = true; },
    clearRoom: () => { renderer.clearRoomPhoto(); log('room photo cleared'); },
    get mode() { return renderer.mode; },
    get log() { return state.log; },
    get audio() { return state.audio; },
    get lastResult() { return state.lastResult; },
    dump: () => ({ log: state.log, frames: state.rec.frames, audio: state.rec.audio }),
    exportRaw: () => ({ log: state.log, raw: state.rec.raw, clicks: state.rec.clicks, audio: state.rec.audio }),
    debugCanvases: () => renderer.debugCanvases(),
  };
})();
