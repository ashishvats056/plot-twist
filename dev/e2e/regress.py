# One browser scenario, run by run.py (which makes the fake cameras in out/).
# Usage: python regress.py <extension-dir> <tag> plain|pipe|effect|replace|bgpic self|remote [statue|face]
# Plain Meet-like stub: getUserMedia → video element (self view) → WebRTC loopback
# → remote video. Optional ?effect=1 applies a Meet-style background effect.
# Measures the remote video: overlays (cinema greyscale, facepalm GIF frames,
# money-green), and the dust (frame-to-frame change concentrated in the person
# area during the vanish) vs an instant removal.
import asyncio, json, sys, os
from playwright.async_api import async_playwright

EXT = sys.argv[1]
TAG = sys.argv[2]
MODE = sys.argv[3] if len(sys.argv) > 3 else 'plain'
EFFECT = MODE != 'plain'
VIEW = sys.argv[4] if len(sys.argv) > 4 else 'remote'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
CAMERA = sys.argv[5] if len(sys.argv) > 5 else 'statue'
CAM = os.path.join(OUT, 'face.y4m' if CAMERA == 'face' else 'person.y4m')
PROFILE = os.environ.get('PT_PROFILE') or os.path.join(OUT, f'profile-{TAG}-{MODE}-{VIEW}-{CAMERA}')

STUB = r"""<!doctype html><meta charset=utf-8><body style="margin:0">
<video id=self autoplay muted playsinline width=320></video>
<video id=remote autoplay muted playsinline width=320></video>
<canvas id=c width=160 height=90></canvas>
<script>
const MODE = '%MODE%';
// Meet-style background replacement stand-in: everything outside a centred
// "person" ellipse becomes magenta, as Meet's segmentation would replace it.
function makeReplace(cam) {
  const gen = new MediaStreamTrackGenerator({ kind: 'video' });
  const proc = new MediaStreamTrackProcessor({ track: cam });
  const cv = new OffscreenCanvas(2, 2), x = cv.getContext('2d');
  proc.readable.pipeThrough(new TransformStream({ transform(f, c) {
    const W = f.displayWidth, H = f.displayHeight; cv.width = W; cv.height = H;
    x.fillStyle = '#c000c0'; x.fillRect(0, 0, W, H);
    x.save(); x.beginPath(); x.ellipse(W * 0.5, H * 0.55, W * 0.22, H * 0.5, 0, 0, Math.PI * 2); x.clip();
    x.drawImage(f, 0, 0); x.restore();
    c.enqueue(new VideoFrame(cv, { timestamp: f.timestamp })); f.close(); } })).pipeTo(gen.writable);
  return gen;
}
// Meet background picture with a stand-in for Meet's person segmentation: the
// statue's area counts as "person" only while it still looks like the statue
// (snapshot of the first frames). If our camera stage erases you, Meet sees no
// person there and its blue background picture fills your place.
const inBox = (i) => { const px = (i / 4) % 160, py = Math.floor(i / 4 / 160); return px > 40 && px < 125 && py > 5; };
function makeBgPicture(cam) {
  const gen = new MediaStreamTrackGenerator({ kind: 'video' });
  const proc = new MediaStreamTrackProcessor({ track: cam });
  const cv = new OffscreenCanvas(160, 90), x = cv.getContext('2d', { willReadFrequently: true });
  const out = new OffscreenCanvas(2, 2), o = out.getContext('2d');
  let person = null, n = 0;
  proc.readable.pipeThrough(new TransformStream({ transform(f, c) {
    const W = f.displayWidth, H = f.displayHeight; out.width = W; out.height = H;
    x.drawImage(f, 0, 0, 160, 90); const img = x.getImageData(0, 0, 160, 90);
    if (n++ === 5) person = img.data.slice();
    const m = new ImageData(160, 90);
    for (let i = 0; i < img.data.length; i += 4) {
      const looksLikePerson = person && inBox(i) && Math.abs(img.data[i] - person[i]) + Math.abs(img.data[i+1] - person[i+1]) + Math.abs(img.data[i+2] - person[i+2]) < 60;
      m.data[i] = 30; m.data[i+1] = 90; m.data[i+2] = 220; m.data[i+3] = looksLikePerson || !person ? 0 : 255;
    }
    o.drawImage(f, 0, 0, W, H);
    x.putImageData(m, 0, 0); o.drawImage(cv, 0, 0, W, H);
    c.enqueue(new VideoFrame(out, { timestamp: f.timestamp })); f.close(); } })).pipeTo(gen.writable);
  return gen;
}
function makeEffect(cam) {
  const gen = new MediaStreamTrackGenerator({ kind: 'video' });
  const proc = new MediaStreamTrackProcessor({ track: cam });
  const cv = new OffscreenCanvas(2, 2), x = cv.getContext('2d');
  proc.readable.pipeThrough(new TransformStream({ transform(f, c) {
    cv.width = f.displayWidth; cv.height = f.displayHeight;
    x.drawImage(f, 0, 0);
    c.enqueue(new VideoFrame(cv, { timestamp: f.timestamp })); f.close(); } })).pipeTo(gen.writable);
  return gen;
}
window.join = async () => {
  const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 }, audio: false });
  const cam = s.getVideoTracks()[0];
  const sent = MODE === 'plain' ? cam : MODE === 'replace' ? makeReplace(cam) : MODE === 'bgpic' ? makeBgPicture(cam) : makeEffect(cam);
  document.getElementById('self').srcObject = new MediaStream([MODE === 'pipe' ? cam : sent]);
  const a = new RTCPeerConnection(), b = new RTCPeerConnection();
  b.ontrack = (e) => { const rv = document.getElementById('remote'); rv.srcObject = new MediaStream([e.track]); rv.play().catch(() => {}); };
  a.addTrack(sent, new MediaStream([sent]));
  const gathered = (pc) => new Promise((r) => { if (pc.iceGatheringState === 'complete') r(); else pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && r()); setTimeout(r, 3000); });
  const lo = (d) => ({ type: d.type, sdp: d.sdp.replace(/(a=candidate:\S+ \d udp \d+ )\S+( \d+ typ host)/g, '$1127.0.0.1$2') });
  await a.setLocalDescription(await a.createOffer()); await gathered(a); await b.setRemoteDescription(lo(a.localDescription));
  await b.setLocalDescription(await b.createAnswer()); await gathered(b); await a.setRemoteDescription(lo(b.localDescription));
  const rv = document.getElementById('remote');
  for (let i = 0; i < 100 && !(rv.readyState >= 2 && rv.videoWidth); i++) await new Promise(r => setTimeout(r, 100));
  return rv.readyState >= 2;
};
let prev = null; window.VIEW = '%VIEW%';
// Stats of the remote frame: saturation, money-green fraction, change vs previous sample.
window.sample = () => {
  const c = document.getElementById('c'), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(document.getElementById(window.VIEW), 0, 0, 160, 90);
  const d = x.getImageData(0, 0, 160, 90).data; let sat = 0, green = 0, diff = 0, edgeGreen = 0, blue = 0, yellow = 0, magenta = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];
    const px = (i / 4) % 160, py = Math.floor(i / 4 / 160);
    const outside = ((px - 80) / 35) ** 2 + ((py - 49.5) / 45) ** 2 > 1.15;
    if (r > 200 && g > 140 && b < 90 && r - b > 130) yellow++;
    if (r > 150 && b > 150 && g < 110) magenta++;
    if (b > 180 && r < 70 && g > 60 && g < 130) { blue++; if (inBox(i)) window.__blueIn = (window.__blueIn || 0) + 1; }
    if (outside && Math.abs(r - 95) < 30 && Math.abs(g - 159) < 30 && Math.abs(b - 90) < 30) edgeGreen++;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
    if (Math.abs(r - 95) < 30 && Math.abs(g - 159) < 30 && Math.abs(b - 90) < 30) green++;
    if (prev) diff += Math.abs(r - prev[i]) + Math.abs(g - prev[i+1]) + Math.abs(b - prev[i+2]);
  }
  prev = d; const n = d.length / 4; const bi = window.__blueIn || 0; window.__blueIn = 0;
  return { sat: +(sat / n).toFixed(1), green: +(green / n).toFixed(3), edgeGreen: +(edgeGreen / n).toFixed(3), blue: +(blue / n).toFixed(3), blueIn: +(bi / (84 * 84)).toFixed(3), yellow: +(yellow / n).toFixed(3), magenta: +(magenta / n).toFixed(3), diff: +(diff / n / 3).toFixed(2), img: c.toDataURL('image/jpeg', 0.7) };
};
// The cartoon sticker's white rim: share of white pixels on a thin ring at the
// sticker's edge (radius 0.33 h × 1.045, centred).
window.ring = () => {
  const W = 320, H = 180, c = new OffscreenCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(document.getElementById(window.VIEW), 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data, R = 0.33 * H * 1.045; let n = 0, white = 0;
  for (let i = 0; i < 720; i++) {
    const a = (i / 720) * Math.PI * 2, px = Math.round(W / 2 + Math.cos(a) * R), py = Math.round(H / 2 + Math.sin(a) * R);
    if (py < 0 || py >= H) continue;
    const k = (py * W + px) * 4; n++;
    if (d[k] > 215 && d[k + 1] > 215 && d[k + 2] > 215) white++;
  }
  return +(white / n).toFixed(2);
};
</script>""".replace('%MODE%', MODE).replace('%VIEW%', VIEW)

import time
T0 = time.time()
def step(msg):  # progress on stderr, kept by run.py if the scenario times out
    print(f'[{time.time() - T0:5.1f}s] {msg}', file=sys.stderr, flush=True)

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(PROFILE, headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}',
                  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-video-capture={CAM}',
                  '--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection'],
            permissions=['camera', 'microphone'])
        await ctx.route('https://meet.google.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body=STUB))
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        step('browser up'); await page.goto('https://meet.google.com/abc')
        pg = await ctx.new_page(); await pg.goto('chrome://extensions')
        # wait for the list rather than a fixed delay (slow CI machines)
        item = "document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-item-list')?.shadowRoot?.querySelector('extensions-item')"
        await pg.wait_for_function(f"!!{item}", timeout=30000)
        ext = await pg.evaluate(f"{item}.id")
        await pg.goto(f'chrome-extension://{ext}/popup/popup.html')
        if TAG == 'live':  # join with effects off, switch them on mid-call
            await pg.evaluate("chrome.storage.sync.set({enabled: false})")
            await page.wait_for_timeout(300)
        step('popup open'); res = {'tag': TAG, 'effect': EFFECT, 'connected': await page.evaluate('join()')}; step('joined')
        if TAG == 'live':
            await page.wait_for_timeout(1500)
            res['detector_while_off'] = await page.evaluate("!!document.getElementById('plottwist-detector')")
            await pg.evaluate("chrome.storage.sync.set({enabled: true})")
        tid = await pg.evaluate("""chrome.tabs.query({}).then(async ts => { for (const t of ts) { try { if (await chrome.tabs.sendMessage(t.id, {type:'getState'})) return t.id; } catch {} } })""")
        q = lambda m: pg.evaluate(f"chrome.tabs.sendMessage({tid}, {json.dumps(m)})")
        # Effects are started with the in-call keyboard shortcuts. The popup
        # shares the extension's process with the busy detector frame, so on a
        # slow machine a popup button can land seconds late, after the window
        # the samples below look at. (The call tab is not brought to the front:
        # on a machine without a GPU that made a scenario twice as slow.)
        KEY = {'cinema': 'KeyC', 'facepalm': 'KeyF', 'doubleSnap': 'KeyM', 'snap': 'KeyS'}
        if TAG == 'custom':  # your own facepalm picture, set mid-call from the editor's storage key
            await pg.evaluate("""(async () => {
              const c = new OffscreenCanvas(64, 36); const x = c.getContext('2d'); x.fillStyle = '#ff00ff'; x.fillRect(0, 0, 64, 36);
              const b = await c.convertToBlob({ type: 'image/png' });
              const url = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
              await chrome.storage.local.set({ customFacepalm: { kind: 'image', dataUrl: url } });
            })()""")
        step('tab found'); await page.wait_for_timeout(6000)  # detector warm-up + person mask
        res['state'] = {k: v for k, v in (await q({'type': 'getState'}))['state'].items() if k != 'thumb'}
        shots = []
        async def run(label, event, ms, every=150):
            step(label)
            await page.evaluate('sample()')
            base = await page.evaluate('sample()')
            await page.keyboard.press('Alt+Shift+' + KEY[event])
            series = []; rings = []
            for i in range(ms // every):
                await page.wait_for_timeout(every)
                s = await page.evaluate('sample()'); series.append(s)
                if event == 'facepalm': rings.append(await page.evaluate('ring()'))
            shots.extend([series[len(series) * k // 4]['img'] for k in range(4)])
            res[label] = {'base_sat': base['sat'], 'base_blue': base['blue'], 'min_sat': min(s['sat'] for s in series),
                          'max_green': max(s['green'] for s in series),
                          'max_edge_green': max(s['edgeGreen'] for s in series),
                          'diffs': [s['diff'] for s in series],
                          'max_yellow': max(s['yellow'] for s in series), 'base_yellow': base['yellow'],
                          'max_magenta': max(s['magenta'] for s in series), 'base_magenta': base['magenta'],
                          'max_ring': max(rings) if rings else 0, 'base_ring': await page.evaluate('ring()') if rings else 0}
            await page.wait_for_timeout(1500)
        if TAG == 'photo':  # capture an empty background first (the "person" stays: fine for timing)
            await q({'type': 'captureBackground'})
            await page.wait_for_timeout(5800)
            res['has_photo'] = (await q({'type': 'getState'}))['state'].get('hasBackgroundPhoto')
        await run('cinema', 'cinema', 2400)
        res['cartoon_ready'] = (await q({'type': 'getState'}))['state'].get('cartoonReady')
        await run('facepalm', 'facepalm', 2400)
        await run('money', 'doubleSnap', 3000)
        await run('vanish', 'snap', 3000, 100)
        res['mode_after_vanish'] = (await q({'type': 'getState'}))['state']['mode']
        res['blue_before'] = res['vanish'].get('base_blue')
        await page.wait_for_timeout(800)
        sv = await page.evaluate('sample()'); res['blue_vanished'] = sv['blue']; res['blue_in_vanished'] = sv['blueIn']
        await run('return', 'snap', 2800, 100)
        if TAG == 'live':  # and off again: money must not show
            await pg.evaluate("chrome.storage.sync.set({enabled: false})")
            await page.wait_for_timeout(500)
            await page.keyboard.press('Alt+Shift+KeyM')
            g = 0
            for i in range(8):
                await page.wait_for_timeout(250); g = max(g, (await page.evaluate('sample()'))['green'])
            res['off_again_green'] = g
            await pg.evaluate("chrome.storage.sync.set({enabled: true})")
        res['errors'] = errs
        html = '<body style="margin:0;background:#000">' + ''.join(f'<img src="{s}" width=160>' for s in shots) + '</body>'
        sheet = await ctx.new_page(); await sheet.set_viewport_size({'width': 640, 'height': 450})
        await sheet.set_content(html); await sheet.wait_for_timeout(300)
        await sheet.screenshot(path=os.path.join(OUT, f'sheet-{os.path.basename(PROFILE)}.png'))
        res['viewer'] = VIEW; res['mode'] = MODE; res['camera'] = CAMERA
        print(json.dumps(res))
        await ctx.close()

asyncio.run(main())
