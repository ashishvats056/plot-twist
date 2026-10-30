// Runs in Meet's page (MAIN world) before Meet's own scripts. Wraps the camera
// track so every frame passes through the effects renderer, and listens to the
// mic for snap clicks. Hand/face detection happens in the detector iframe.
(function () {
  'use strict';

  const G = window.PlotTwistGestures;
  const E = window.PlotTwistEffects;
  const A = window.PlotTwistActions;
  const C = window.PlotTwistChannel;
  const md = navigator.mediaDevices;
  if (!G || !E || !A || !C || !md || !md.getUserMedia) return;

  // Dev tools (window.__plottwist, the landmark/mic recorders, the debug
  // overlay) exist only on the local harness. On Meet, page scripts share this
  // world and could read them.
  const DEV = location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(location.hostname);

  const IFRAME_ID = 'plottwist-detector';
  const DETECT_WIDTH = 640; // larger input finds small, fast snapping hands more often
  const DETECT_TIMEOUT_MS = 2000;
  const SEGMENT_EVERY_MS = 120; // how often the person mask refreshes the background
  const WARMUP_MS = 1000; // cameras send black/dim frames at first: don't learn the background from them
  const MIN_LUMA = 12; // frames darker than this (0–255 average) aren't learned either
  const TICK_MS = 100;
  const POLL_MS = 1000;
  const LOG_MAX = 50;
  const SETTINGS_WAIT_MS = 3000; // how long getUserMedia waits for the saved settings
  const PUBLISH_MS = 250; // how often state is sent to the popup (only when it changed)
  const CAPTURE_COUNTDOWN_S = 5;
  const THUMB_W = 192;
  const THUMB_H = 108;
  const REC_MS = 60000; // dev recorder keeps the last 60 s

  const origGetUserMedia = md.getUserMedia.bind(md);
  const engine = G.createGestureEngine();
  const renderer = E.createRenderer();
  // Everything needed is captured above; don't leave the modules where Meet's
  // scripts can reach them.
  if (!DEV) {
    for (const name of ['PlotTwistGestures', 'PlotTwistEffects', 'PlotTwistActions', 'PlotTwistChannel', 'PlotTwistVanish', 'PlotTwistBackground']) {
      delete window[name];
    }
  }
  const state = {
    settings: { ...A.DEFAULT_SETTINGS },
    cameras: 0, // live processed camera tracks
    rawCameras: [], // camera tracks passed through untouched because effects were off
    detectorOrigin: null, // told by the bridge; frames from any other origin are ignored
    countdown: 0, // seconds left before the empty background photo is taken
    thumb: null, // small JPEG data URL of the empty background photo, for the popup
    micTrack: null, // Meet's mic track, tapped for snap clicks only when autoSnap is on
    wantPhoto: false,
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
    if (!DEV) return;
    const kept = state.rec[key].filter((x) => item.t - x.t <= REC_MS);
    state.rec = { ...state.rec, [key]: [...kept, item] };
  }

  // source 'gesture': detected (honours the auto-detect settings); 'manual': a
  // button or keyboard shortcut (always runs).
  function handle(events, now, source = 'gesture') {
    if (!state.settings.enabled) return;
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

    // The bridge mounts the frame and tells us its origin. A frame with our id
    // but another origin (planted by the page) is never talked to.
    function locate() {
      frame = document.getElementById(IFRAME_ID);
      if (!frame) {
        channel.post({ type: 'mount' });
        frame = document.getElementById(IFRAME_ID);
      }
      origin = frame && state.detectorOrigin;
      if (frame && new URL(frame.src, location.href).origin !== origin) frame = null;
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
        if (m.facepalm) renderer.setFacepalmMedia(m.facepalm);
      } else if (m.type === 'error') {
        log(`detector error: ${m.message}`);
      } else if (m.type === 'result') {
        busySince = null;
        if (m.error) log(`detect error: ${m.error}`);
        const now = performance.now();
        if (DEV) state.lastResult = m;
        if (DEV) remember('raw', {
          t: Math.round(now),
          h: m.hands.map((h) => ({ s: h.handedness, l: h.landmarks.map((p) => [+p.x.toFixed(3), +p.y.toFixed(3)]) })),
          f: m.face && Object.fromEntries(Object.entries(m.face).map(([k, v]) => [k, v == null ? v : +v.toFixed(3)])),
        });
        if (DEV) remember('frames', {
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
    // person leak into the saved background image.
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
      if (!state.settings.enabled) { ctx.drawImage(source, 0, 0, w, h); return out; }
      if (state.pendingMask) {
        renderer.setMask(segFrame, state.pendingMask, w, h, worthLearning(now), state.pendingHands);
        state.pendingMask.close();
        state.pendingMask = null;
      }
      if (state.wantPhoto) {
        renderer.setBgPhoto(source, w, h);
        state.wantPhoto = false;
        log('background photo captured');
        makeThumb();
      }
      if (state.wantVanish) {
        if (!renderer.vanish(now, source, w, h)) log('vanish skipped: no person mask yet');
        state.wantVanish = false;
      }
      if (detector.idle(now)) {
        detCtx.drawImage(source, 0, 0, det.width, det.height);
        if (detector.send(det.transferToImageBitmap(), now)) segCtx.drawImage(source, 0, 0, w, h);
      }
      renderer.draw(ctx, source, w, h, now, DEV && state.debug ? debugInfo() : null);
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

  // The empty background photo is for this call only: forget it once no camera is running.
  function cameraStopped() {
    state.cameras = Math.max(0, state.cameras - 1);
    if (state.cameras || !renderer.bgPhoto) return;
    clearBackground();
    log('background photo cleared (camera stopped)');
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
      if (!wantsMic()) { listen.stop(); audioTap = null; return; }
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
        if (DEV && a && a.peak > 0.03) {
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

  const wantsMic = () => state.settings.enabled && state.settings.autoSnap;

  md.getUserMedia = async function getUserMedia(constraints) {
    const stream = await origGetUserMedia(constraints);
    try {
      await settingsLoaded;
      const [audio] = stream.getAudioTracks();
      if (audio) {
        state.micTrack = audio;
        if (wantsMic()) tapAudio(audio);
      }
      const [video] = stream.getVideoTracks();
      if (!video) return stream;
      if (!state.settings.enabled) {
        // Effects off: Meet gets the real camera; no detector, no mic tap.
        state.rawCameras = [...state.rawCameras.filter((t) => t.readyState === 'live'), video];
        log('effects off: camera passed through');
        return stream;
      }
      detector.start();
      return new MediaStream([wrapVideoTrack(video), ...stream.getAudioTracks()]);
    } catch (err) {
      log(`passthrough: ${err.message}`);
      return stream;
    }
  };

  setInterval(() => { const now = performance.now(); handle(engine.tick(now), now); }, TICK_MS);

  // Settings are saved by the popup (chrome.storage) and relayed by the bridge.
  // Switching effects off during a call passes frames through live; switching
  // them on only applies to the next camera start (the popup says so).
  function applySettings(next) {
    const prev = state.settings;
    state.settings = next;
    for (const key of Object.keys(next)) if (next[key] !== prev[key]) log(`${key} ${next[key] ? 'on' : 'off'}`);
    const mic = state.micTrack;
    if (wantsMic() && mic && mic.readyState === 'live') tapAudio(mic);
    if (!wantsMic() && audioTap) audioTap.stop();
  }
  function setSetting(key, value) {
    if (key in A.DEFAULT_SETTINGS) applySettings({ ...state.settings, [key]: !!value });
  }

  function clearBackground() {
    renderer.clearBgPhoto();
    state.thumb = null;
  }

  function makeThumb() {
    const photo = renderer.bgPhoto;
    if (!photo) return;
    const c = new OffscreenCanvas(THUMB_W, THUMB_H);
    c.getContext('2d').drawImage(photo, 0, 0, THUMB_W, THUMB_H);
    c.convertToBlob({ type: 'image/jpeg', quality: 0.75 }).then((blob) => {
      const reader = new FileReader();
      reader.onload = () => { if (renderer.bgPhoto === photo) state.thumb = reader.result; };
      reader.readAsDataURL(blob);
    }).catch(() => {});
  }

  // The countdown runs here, not in the popup: the popup closes as soon as it
  // loses focus, which must not cancel the capture.
  let countdownTimer = null;
  function captureBackground() {
    if (countdownTimer || !state.cameras || !state.settings.enabled) return;
    state.countdown = CAPTURE_COUNTDOWN_S;
    countdownTimer = setInterval(() => {
      state.countdown -= 1;
      if (state.countdown > 0) return;
      clearInterval(countdownTimer);
      countdownTimer = null;
      if (state.cameras) state.wantPhoto = true;
    }, 1000);
  }

  function snapshot() {
    return {
      mode: renderer.mode,
      hasCamera: state.cameras > 0,
      needsRestart: state.settings.enabled && state.cameras === 0
        && state.rawCameras.some((t) => t.readyState === 'live'),
      countdown: state.countdown,
      hasBackgroundPhoto: !!renderer.bgPhoto,
      thumb: state.thumb,
      settings: state.settings,
    };
  }

  const trigger = (ev) => { if (state.settings.enabled) handle([ev], performance.now(), 'manual'); };
  const controller = {
    get mode() { return renderer.mode; },
    get hasCamera() { return state.cameras > 0 && state.settings.enabled; },
    trigger,
  };

  let markSettingsLoaded;
  const settingsLoaded = new Promise((resolve) => { markSettingsLoaded = resolve; });
  setTimeout(() => markSettingsLoaded(), SETTINGS_WAIT_MS); // never block Meet's camera for long

  const channel = C.openMain((msg) => {
    switch (msg.type) {
      case 'settings':
        applySettings(A.sanitizeSettings(msg.settings));
        markSettingsLoaded();
        break;
      case 'detectorOrigin':
        if (typeof msg.origin === 'string' && !state.detectorOrigin) state.detectorOrigin = msg.origin;
        break;
      case 'trigger':
        if (A.TRIGGERS.includes(msg.event)) trigger(msg.event);
        break;
      case 'captureBackground': captureBackground(); break;
      case 'clearBackground': clearBackground(); log('background photo cleared'); break;
      default: break;
    }
  });

  let published = '';
  setInterval(() => {
    const next = JSON.stringify(snapshot());
    if (next === published) return;
    published = next;
    channel.post({ type: 'state', state: JSON.parse(next) });
  }, PUBLISH_MS);

  const KEYS = {
    KeyS: () => ['snap'],
    KeyM: () => ['doubleSnap'],
    KeyC: () => ['cinema'],
    KeyF: () => ['facepalm'],
    ...(DEV ? { KeyD: () => { state.debug = !state.debug; return []; } } : {}),
  };
  window.addEventListener('keydown', (e) => {
    const action = e.altKey && e.shiftKey && KEYS[e.code];
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    handle(action(), performance.now(), 'manual');
  }, true);

  if (!DEV) return;
  window.__plottwist = {
    trigger,
    actions: A.createActions(controller),
    get settings() { return state.settings; },
    setSetting,
    get hasCamera() { return controller.hasCamera; },
    get bgPhoto() { return renderer.bgPhoto; },
    captureBackground,
    clearBackground,
    get mode() { return renderer.mode; },
    get log() { return state.log; },
    get audio() { return state.audio; },
    get lastResult() { return state.lastResult; },
    dump: () => ({ log: state.log, frames: state.rec.frames, audio: state.rec.audio }),
    exportRaw: () => ({ log: state.log, raw: state.rec.raw, clicks: state.rec.clicks, audio: state.rec.audio }),
    debugCanvases: () => renderer.debugCanvases(),
  };
})();
