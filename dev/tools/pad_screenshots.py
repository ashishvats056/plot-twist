# Fits store screenshots into exactly 1280x800 (scaled down to fit, never
# stretched, padded with white) and writes them to dist/store-assets/.
# Works on macOS, Windows and Linux. Needs: pip install pillow
# Usage: python dev/tools/pad_screenshots.py <image> [<image> ...]
import os, sys
from PIL import Image

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, 'dist', 'store-assets')
W, H = 1280, 800


def main(paths):
    if not paths:
        sys.exit(__doc__ or 'usage: python dev/tools/pad_screenshots.py <image> ...')
    os.makedirs(OUT, exist_ok=True)
    for p in paths:
        im = Image.open(p).convert('RGB')
        k = min(W / im.width, H / im.height, 1)
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        page = Image.new('RGB', (W, H), 'white')
        page.paste(im, ((W - im.width) // 2, (H - im.height) // 2))
        dest = os.path.join(OUT, os.path.splitext(os.path.basename(p))[0] + '.png')
        page.save(dest)
        print(os.path.relpath(dest, REPO).replace(os.sep, '/'))


if __name__ == '__main__':
    main(sys.argv[1:])
