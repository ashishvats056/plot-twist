// Runs MediaPipe hand + face detection in the extension's own origin, where
// Meet's CSP / Trusted Types can't block the wasm runtime. The page posts
// ImageBitmaps in and gets normalized landmarks back.
import { FilesetResolver, HandLandmarker, FaceDetector, ImageSegmenter } from '../vendor/vision_bundle.mjs';

const MEET_ORIGIN = 'https://meet.google.com';
const NOSE_TIP = 2; // BlazeFace keypoint index
const PERSON_THRESHOLD = 0.3; // lower lets chair and room into the mask; the grow step covers hair
const GROW_DIVISOR = 60; // grow the person mask by width / 60 px
const HAND_CONFIDENCE = 0.3; // fast snapping hands score low; 0.5 missed most snaps
const root = new URL('..', location.href);
const asset = (p) => new URL(p, root).href;

// Inside the extension only Meet may talk to us; the dev harness is same-origin http.
const isAllowedOrigin = (origin) =>
  origin === MEET_ORIGIN || (location.protocol === 'http:' && origin === location.origin);

let parentOrigin = null;
const post = (msg, transfer = []) => {
  if (parentOrigin) parent.postMessage({ source: 'plottwist-detector', ...msg }, parentOrigin, transfer);
};

async function create(Task, fileset, modelPath, extra) {
  let lastError;
  for (const delegate of ['GPU', 'CPU']) {
    try {
      return await Task.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: asset(modelPath), delegate },
        runningMode: 'VIDEO',
        ...extra,
      });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function loadFacepalmImage() {
  for (const name of ['facepalm.png', 'facepalm.jpg', 'facepalm.jpeg', 'facepalm.webp']) {
    try {
      const res = await fetch(asset(`assets/${name}`));
      if (res.ok) return await createImageBitmap(await res.blob());
    } catch {
      // not present; try the next name
    }
  }
  return null;
}

let models = null;
let lastTs = 0;

// Separable max filter on a 0/1 mask: grows the person by r pixels.
function grow(bin, w, h, r) {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const end = Math.min(w - 1, x + r);
      let k = Math.max(0, x - r);
      while (k <= end && !bin[row + k]) k++;
      tmp[row + x] = k <= end ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const end = Math.min(h - 1, y + r);
      let k = Math.max(0, y - r);
      while (k <= end && !tmp[k * w + x]) k++;
      out[y * w + x] = k <= end ? 1 : 0;
    }
  }
  return out;
}

// Hard-edged, slightly grown person mask as ImageData (alpha 255 = person).
// Hard edges matter: a soft edge lets a little of the person leak into the
// background image on every update, which builds up into a ghost. A mask that
// misses a detected face is wrong (common on the first frames) and is dropped,
// or the person would be saved as part of the empty room.
function personMask(bitmap, ts, face) {
  const result = models.segmenter.segmentForVideo(bitmap, ts);
  const mask = result.confidenceMasks && result.confidenceMasks[0];
  if (!mask) { result.close(); return null; }
  const { width: w, height: h } = mask;
  const conf = mask.getAsFloat32Array();
  const bin = new Uint8Array(conf.length);
  for (let i = 0; i < conf.length; i++) bin[i] = conf[i] > PERSON_THRESHOLD ? 1 : 0;
  result.close();
  if (face) {
    const cx = Math.min(w - 1, Math.floor((face.x + face.w / 2) * w));
    const cy = Math.min(h - 1, Math.floor((face.y + face.h / 2) * h));
    if (!bin[cy * w + cx]) return null;
  }
  const grown = grow(bin, w, h, Math.max(2, Math.round(w / GROW_DIVISOR)));
  const rgba = new Uint8ClampedArray(grown.length * 4);
  for (let i = 0; i < grown.length; i++) {
    rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = grown[i] * 255;
  }
  return new ImageData(rgba, w, h);
}

function detect(bitmap, segment) {
  const ts = Math.max(performance.now(), lastTs + 1);
  lastTs = ts;
  const { width, height } = bitmap;
  const hr = models.hands.detectForVideo(bitmap, ts);
  const fr = models.face.detectForVideo(bitmap, ts);
  const sides = hr.handedness || hr.handednesses || [];
  const hands = hr.landmarks.map((landmarks, i) => ({
    landmarks: landmarks.map(({ x, y }) => ({ x, y })),
    handedness: sides[i] && sides[i][0] ? sides[i][0].categoryName : undefined,
  }));
  const d = fr.detections[0];
  const face = d && d.boundingBox ? {
    x: d.boundingBox.originX / width,
    y: d.boundingBox.originY / height,
    w: d.boundingBox.width / width,
    h: d.boundingBox.height / height,
    noseY: d.keypoints && d.keypoints[NOSE_TIP] ? d.keypoints[NOSE_TIP].y : undefined,
  } : null;
  return { hands, face, maskData: segment ? personMask(bitmap, ts, face) : null };
}

addEventListener('message', (e) => {
  const msg = e.data;
  if (!isAllowedOrigin(e.origin) || e.source !== parent || !msg || msg.source !== 'plottwist') return;
  parentOrigin = e.origin;
  if (msg.type === 'hello') {
    ready.then(
      (assets) => post({ type: 'ready', ...assets }), // ImageBitmap is cloned, so repeat hellos are safe
      (err) => post({ type: 'error', message: String(err && err.message || err) }),
    );
    return;
  }
  if (msg.type !== 'detect') return;
  const { id, bitmap, segment } = msg;
  let result;
  try {
    if (!models) throw new Error('models not loaded');
    result = detect(bitmap, segment);
  } catch (err) {
    result = { hands: [], face: null, maskData: null, error: String(err && err.message || err) };
  } finally {
    bitmap.close();
  }
  const { maskData, ...rest } = result;
  if (!maskData) { post({ type: 'result', id, ...rest }); return; }
  createImageBitmap(maskData).then(
    (mask) => post({ type: 'result', id, ...rest, mask }, [mask]),
    () => post({ type: 'result', id, ...rest }),
  );
});

const ready = (async () => {
  const fileset = await FilesetResolver.forVisionTasks(asset('vendor/wasm'));
  const [hands, face, segmenter, facepalm] = await Promise.all([
    create(HandLandmarker, fileset, 'models/hand_landmarker.task', {
      numHands: 2,
      minHandDetectionConfidence: HAND_CONFIDENCE,
      minHandPresenceConfidence: HAND_CONFIDENCE,
      minTrackingConfidence: HAND_CONFIDENCE,
    }),
    create(FaceDetector, fileset, 'models/blaze_face_short_range.tflite', { minDetectionConfidence: 0.5 }),
    create(ImageSegmenter, fileset, 'models/selfie_segmenter.tflite', {
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    }),
    loadFacepalmImage(),
  ]);
  models = { hands, face, segmenter };
  return { facepalm };
})();
