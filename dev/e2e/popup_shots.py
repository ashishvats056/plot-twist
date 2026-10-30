# Renders the popup in light and dark mode, in a sample "in a call" state, to
# dev/e2e/out/popup-{light,dark}.png. Usage: python3 dev/e2e/popup_shots.py
import asyncio, os
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')

async def main():
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(os.path.join(OUT, 'profile-popup'), headless=True, channel='chromium',
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width': 320, 'height': 600})
        pg = await ctx.new_page()
        await pg.goto('chrome://extensions'); await pg.wait_for_timeout(600)
        ext = await pg.evaluate("document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item').id")
        for scheme in ['light', 'dark']:
            await pg.emulate_media(color_scheme=scheme)
            await pg.goto(f'chrome-extension://{ext}/popup/popup.html'); await pg.wait_for_timeout(500)
            await pg.evaluate("""() => {
              document.querySelectorAll('.action').forEach(b => b.disabled = false);
              document.getElementById('capture').disabled = false;
              document.getElementById('status-text').textContent = 'Ready. Vanish reveals your Meet background.';
              document.getElementById('status').dataset.tone = 'ok';
            }""")
            h = await pg.evaluate('document.body.scrollHeight')
            await pg.set_viewport_size({'width': 320, 'height': h})
            await pg.screenshot(path=os.path.join(OUT, f'popup-{scheme}.png'))
        await ctx.close()

asyncio.run(main())
