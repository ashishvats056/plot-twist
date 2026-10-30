# Regression E2E with a person on camera (fake device from person.y4m, made by run.sh).
# Usage: python3 regress.py <extension-dir> <tag> plain|pipe|effect self|remote
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
CAM = os.path.join(HERE, 'person.y4m')

STUB = r"""<!doctype html><meta charset=utf-8><body style="margin:0">
<video id=self autoplay muted playsinline width=320></video>
<video id=remote autoplay muted playsinline width=320></video>
<canvas id=c width=160 height=90></canvas>
<script>
const MODE = '%MODE%';
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
  const sent = MODE === 'plain' ? cam : makeEffect(cam);
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
  const d = x.getImageData(0, 0, 160, 90).data; let sat = 0, green = 0, diff = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];
    sat += Math.max(r, g, b) - Math.min(r, g, b);
    if (Math.abs(r - 95) < 30 && Math.abs(g - 159) < 30 && Math.abs(b - 90) < 30) green++;
    if (prev) diff += Math.abs(r - prev[i]) + Math.abs(g - prev[i+1]) + Math.abs(b - prev[i+2]);
  }
  prev = d; const n = d.length / 4;
  return { sat: +(sat / n).toFixed(1), green: +(green / n).toFixed(3), diff: +(diff / n / 3).toFixed(2), img: c.toDataURL('image/jpeg', 0.7) };
};
</script>""".replace('%MODE%', MODE).replace('%VIEW%', VIEW)

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(os.path.join(HERE, f'profile-{TAG}-{MODE}-{VIEW}'), headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}',
                  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-video-capture={CAM}',
                  '--disable-features=WebRtcHideLocalIpsWithMdns', '--allow-loopback-in-peer-connection'],
            permissions=['camera', 'microphone'])
        await ctx.route('https://meet.google.com/**', lambda r: r.fulfill(status=200, content_type='text/html', body=STUB))
        page = await ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto('https://meet.google.com/abc')
        pg = await ctx.new_page(); await pg.goto('chrome://extensions'); await pg.wait_for_timeout(500)
        ext = await pg.evaluate("document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item').id")
        await pg.goto(f'chrome-extension://{ext}/popup/popup.html')
        if TAG == 'live':  # join with effects off, switch them on mid-call
            await pg.evaluate("chrome.storage.sync.set({enabled: false})")
            await page.wait_for_timeout(300)
        res = {'tag': TAG, 'effect': EFFECT, 'connected': await page.evaluate('join()')}
        if TAG == 'live':
            await page.wait_for_timeout(1500)
            res['detector_while_off'] = await page.evaluate("!!document.getElementById('plottwist-detector')")
            await pg.evaluate("chrome.storage.sync.set({enabled: true})")
        tid = await pg.evaluate("""chrome.tabs.query({}).then(async ts => { for (const t of ts) { try { if (await chrome.tabs.sendMessage(t.id, {type:'getState'})) return t.id; } catch {} } })""")
        q = lambda m: pg.evaluate(f"chrome.tabs.sendMessage({tid}, {json.dumps(m)})")
        await page.wait_for_timeout(6000)  # detector warm-up + person mask
        res['state'] = {k: v for k, v in (await q({'type': 'getState'}))['state'].items() if k != 'thumb'}
        shots = []
        async def run(label, event, ms, every=150):
            await page.evaluate('sample()')
            base = await page.evaluate('sample()')
            await q({'type': 'trigger', 'event': event})
            series = []
            for i in range(ms // every):
                await page.wait_for_timeout(every)
                s = await page.evaluate('sample()'); series.append(s)
            shots.extend([series[len(series) * k // 4]['img'] for k in range(4)])
            res[label] = {'base_sat': base['sat'], 'min_sat': min(s['sat'] for s in series),
                          'max_green': max(s['green'] for s in series),
                          'diffs': [s['diff'] for s in series]}
            await page.wait_for_timeout(1500)
        await run('cinema', 'cinema', 2400)
        await run('facepalm', 'facepalm', 2400)
        await run('money', 'doubleSnap', 3000)
        await run('vanish', 'snap', 3000, 100)
        res['mode_after_vanish'] = (await q({'type': 'getState'}))['state']['mode']
        await run('return', 'snap', 2800, 100)
        if TAG == 'live':  # and off again: money must not show
            await pg.evaluate("chrome.storage.sync.set({enabled: false})")
            await page.wait_for_timeout(500)
            await q({'type': 'trigger', 'event': 'doubleSnap'})
            g = 0
            for i in range(8):
                await page.wait_for_timeout(250); g = max(g, (await page.evaluate('sample()'))['green'])
            res['off_again_green'] = g
            await pg.evaluate("chrome.storage.sync.set({enabled: true})")
        res['errors'] = errs
        html = '<body style="margin:0;background:#000">' + ''.join(f'<img src="{s}" width=160>' for s in shots) + '</body>'
        sheet = await ctx.new_page(); await sheet.set_viewport_size({'width': 640, 'height': 450})
        await sheet.set_content(html); await sheet.wait_for_timeout(300)
        await sheet.screenshot(path=os.path.join(HERE, f'sheet-{TAG}.png'))
        res['viewer'] = VIEW
        print(json.dumps(res))
        await ctx.close()

asyncio.run(main())
