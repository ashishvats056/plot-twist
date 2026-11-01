# Renders the Chrome Web Store promo images into dist/store-assets/:
#   promo-small-440x280.png   (small promo tile, required)
#   promo-marquee-1400x560.png (marquee, optional)
# Drawn as HTML/CSS in headless Chromium, so it renders the same on macOS,
# Windows and Linux (the emoji follow the OS's emoji font).
# Needs: pip install playwright; python -m playwright install chromium
# Usage: python dev/tools/make_promo.py
import asyncio, base64, os
from playwright.async_api import async_playwright

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, 'dist', 'store-assets')

PAGE = r"""<!doctype html><meta charset=utf-8>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { width: %W%px; height: %H%px; overflow: hidden; position: relative;
    font-family: "Google Sans", "Product Sans", Roboto, "Segoe UI", system-ui, -apple-system, sans-serif;
    color: #fff;
    background:
      radial-gradient(120% 90% at 0% 0%, #7FB0FF 0%, rgba(127,176,255,0) 55%),
      radial-gradient(90% 120% at 100% 100%, #5B3FD9 0%, rgba(91,63,217,0) 60%),
      linear-gradient(135deg, #2F7BF5 0%, #1A5DD8 45%, #1238A8 100%); }
  /* soft light sweep */
  .glow { position: absolute; border-radius: 50%; filter: blur(calc(var(--u) * 40)); opacity: .55; }
  .g1 { width: calc(var(--u) * 260); height: calc(var(--u) * 260); left: calc(var(--u) * 210); top: calc(var(--u) * -120); background: #A9CBFF; }
  .g2 { width: calc(var(--u) * 200); height: calc(var(--u) * 200); left: calc(var(--u) * -60); top: calc(var(--u) * 170); background: #3D8BFF; }
  .grain { position: absolute; inset: 0; opacity: .08; mix-blend-mode: overlay;
    background-image: radial-gradient(#fff 0.6px, transparent 0.6px); background-size: 3px 3px; }
  .copy { position: absolute; left: calc(var(--u) * 28); top: 50%; transform: translateY(-50%); width: calc(var(--u) * 210); }
  .logo { width: calc(var(--u) * 46); height: calc(var(--u) * 46); border-radius: calc(var(--u) * 11);
    box-shadow: 0 calc(var(--u) * 6) calc(var(--u) * 18) rgba(6,20,70,.35); display: block; margin-bottom: calc(var(--u) * 12); }
  h1 { margin: 0; font-size: calc(var(--u) * 40); line-height: 1; font-weight: 700; letter-spacing: calc(var(--u) * -0.8);
    text-shadow: 0 calc(var(--u) * 3) calc(var(--u) * 14) rgba(6,20,70,.35); }
  h1 .twist { background: linear-gradient(90deg, #fff 0%, #D6E6FF 60%, #B9D3FF 100%);
    -webkit-background-clip: text; background-clip: text; color: transparent; }
  p { margin: calc(var(--u) * 10) 0 0; font-size: calc(var(--u) * 14.5); line-height: 1.3; color: #E3EDFF; font-weight: 500; }
  .chips { display: flex; gap: calc(var(--u) * 6); margin-top: calc(var(--u) * 14); }
  .chip { width: calc(var(--u) * 30); height: calc(var(--u) * 30); border-radius: 50%; display: grid; place-items: center;
    font-size: calc(var(--u) * 15); background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.28);
    backdrop-filter: blur(4px);
    font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; }
  /* the video tile */
  .tile { position: absolute; right: calc(var(--u) * 24); top: 50%; transform: translateY(-50%) rotate(-4deg);
    width: calc(var(--u) * 176); height: calc(var(--u) * 196); border-radius: calc(var(--u) * 20);
    background: linear-gradient(180deg, #FFFFFF 0%, #EAF1FE 100%);
    box-shadow: 0 calc(var(--u) * 18) calc(var(--u) * 40) rgba(6,20,70,.45), inset 0 0 0 1px rgba(255,255,255,.6); }
  .tile .bar { position: absolute; left: calc(var(--u) * 12); bottom: calc(var(--u) * 10); display: flex; gap: calc(var(--u) * 5); align-items: center; }
  .tile .dot { width: calc(var(--u) * 7); height: calc(var(--u) * 7); border-radius: 50%; background: #EA4335; }
  .tile .name { height: calc(var(--u) * 7); width: calc(var(--u) * 46); border-radius: 99px; background: #C9D8F5; }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
</style>
<div class="glow g1"></div><div class="glow g2"></div><div class="grain"></div>
<div class="copy">
  <img class="logo" src="%LOGO%">
  <h1>Plot <span class="twist">Twist</span></h1>
  <p>Dissolve into dust on your Google&nbsp;Meet camera.</p>
  <div class="chips"><span class="chip">💨</span><span class="chip">💸</span><span class="chip">🎬</span><span class="chip">🤦</span></div>
</div>
<div class="tile">
  <svg viewBox="0 0 176 196" id="art"></svg>
  <div class="bar"><span class="dot"></span><span class="name"></span></div>
</div>
<svg viewBox="0 0 %W% %H%" id="sky" style="pointer-events:none"></svg>
<script>
  // Seeded, so every render is identical.
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (parent, tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
  const art = document.getElementById('art');
  const defs = el(art, 'defs', {});
  const lg = el(defs, 'linearGradient', { id: 'p', x1: 0, y1: 0, x2: 1, y2: 0 });
  el(lg, 'stop', { offset: 0, 'stop-color': '#1A5DD8' });
  el(lg, 'stop', { offset: 1, 'stop-color': '#2F7BF5' });
  const clip = el(defs, 'clipPath', { id: 'half' });
  el(clip, 'rect', { x: 0, y: 0, width: 98, height: 196 });
  // person: whole silhouette, left half solid
  const g = el(art, 'g', { 'clip-path': 'url(#half)', fill: '#1A5DD8' });
  el(g, 'circle', { cx: 88, cy: 70, r: 30 });
  el(g, 'rect', { x: 76, y: 92, width: 24, height: 30 });
  el(g, 'path', { d: 'M28 196 C28 140 52 116 88 116 C124 116 148 140 148 196 Z' });
  // right half: the same shape, sampled into tiles that drift right and fade
  const inside = (x, y) => ((x - 88) ** 2 + (y - 70) ** 2 <= 30 * 30) || (y >= 92 && y < 122 && x < 100) || (y >= 118 && Math.abs(x - 88) <= 60 * Math.min(1, (y - 112) / 34));
  const tile = document.querySelector('.tile').getBoundingClientRect();
  const sky = document.getElementById('sky');
  const S = 6;
  for (let y = 38; y < 196; y += S) {
    for (let x = 98; x < 150; x += S) {
      if (!inside(x + S / 2, y + S / 2)) continue;
      const k = (x - 92) / 58; // 0 at the seam, 1 at the far edge
      const fly = Math.pow(k, 1.3) * (0.25 + 0.75 * rnd());
      const dx = fly * 150 + rnd() * 10 * k, dy = -fly * 60 - rnd() * 22 * k;
      const s = S - 0.4 - fly * 2.6;
      el(art, 'rect', { x: x + dx, y: y + dy, width: s, height: s, rx: 1.3, fill: k < 0.2 ? '#1A5DD8' : '#2F7BF5',
        opacity: Math.max(0.12, 1 - fly * 1.1).toFixed(2), transform: `rotate(${(fly * 70 * (rnd() - 0.3)).toFixed(1)} ${x + dx + s / 2} ${y + dy + s / 2})` });
    }
  }
  // fine dust escaping past the tile, in white
  for (let i = 0; i < 46; i++) {
    const t = rnd();
    const x = tile.left + tile.width * (0.65 + t * 0.6) + rnd() * 20;
    const y = tile.top + tile.height * (0.15 + rnd() * 0.6) - t * 40;
    const s = (1 - t) * 4 + 1;
    el(sky, 'rect', { x, y, width: s, height: s, rx: s / 4, fill: '#fff', opacity: ((1 - t) * 0.7 + 0.1).toFixed(2) });
  }
</script>"""


async def render(page, w, h, u, logo, dest):
    await page.set_viewport_size({'width': w, 'height': h})
    html = PAGE.replace('%W%', str(w)).replace('%H%', str(h)).replace('%LOGO%', logo)
    html = html.replace('<style>', f'<style>:root {{ --u: {u}px; }}', 1)
    await page.set_content(html)
    await page.evaluate('document.fonts.ready')
    await page.wait_for_timeout(200)
    await page.screenshot(path=dest, clip={'x': 0, 'y': 0, 'width': w, 'height': h})
    print(os.path.relpath(dest, REPO).replace(os.sep, '/'))


async def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(REPO, 'icons', 'logo.svg'), 'rb') as f:
        logo = 'data:image/svg+xml;base64,' + base64.b64encode(f.read()).decode()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        page = await b.new_page(device_scale_factor=1)
        await render(page, 440, 280, 1, logo, os.path.join(OUT, 'promo-small-440x280.png'))
        await b.close()

asyncio.run(main())
