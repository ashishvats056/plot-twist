# Browser regression test, on macOS, Windows and Linux. Loads the extension in
# Playwright's Chromium with a fake camera showing a person, joins a Meet-like
# stub page over a WebRTC loopback, and checks that cinema, facepalm, money
# rain and the vanish dust reach both the self view and the far end.
#
# By default it tests exactly the files the Chrome Web Store zip ships
# (dev/tools/store-files.txt), so the local facepalm.gif is never involved:
# the facepalm must be the cartoon of your face, or the emoji without one.
#
# Needs: Python 3.9+, pip install playwright pillow, python -m playwright install chromium
# Usage: python dev/e2e/run.py [--quick] [--jobs N] [--ext DIR] [--only NAME ...]
#   --quick   the 5 most telling scenarios (about 2 min)
#   --ext DIR test this unpacked extension instead of the store file set
import argparse, os, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')

# name: (args for regress.py, words the summary line must contain)
BASIC = 'cinema:OK facepalm:OK money:OK vanish:OK return:OK'
SCENARIOS = {
    'plain-self': (['t', 'plain', 'self'], [BASIC]),
    'plain-remote': (['t', 'plain', 'remote'], [BASIC, 'facepalm-kind:emoji']),
    'pipe-self': (['t', 'pipe', 'self'], [BASIC]),
    'pipe-remote': (['t', 'pipe', 'remote'], [BASIC]),
    'effect-self': (['t', 'effect', 'self'], [BASIC]),
    'effect-remote': (['t', 'effect', 'remote'], [BASIC]),
    'replace-self': (['t', 'replace', 'self'], [BASIC]),
    'replace-remote': (['t', 'replace', 'remote'], [BASIC]),
    'live-plain': (['live', 'plain', 'remote'], [BASIC, 'live-switch:OK']),
    'live-effect': (['live', 'effect', 'remote'], [BASIC, 'live-switch:OK']),
    'meet-bg-picture': (['t', 'bgpic', 'remote'], ['vanish:OK', 'meet-bg-fills:OK']),
    'photo-plain': (['photo', 'plain', 'remote'], ['vanish:OK', 'photo-fade:OK']),
    'cartoon-remote': (['t', 'plain', 'remote', 'face'], [BASIC, 'facepalm-kind:cartoon']),
    'cartoon-replace': (['t', 'replace', 'remote', 'face'], [BASIC, 'facepalm-kind:cartoon']),
    'custom-picture': (['custom', 'plain', 'remote', 'face'], [BASIC, 'facepalm-kind:custom']),
}
QUICK = ['pipe-self', 'replace-remote', 'meet-bg-picture', 'cartoon-remote', 'custom-picture']

# Fake camera: a few seconds of the still picture with a little sensor noise,
# as a Y4M video (what Chromium's --use-file-for-fake-video-capture plays).
def make_y4m(jpg, dest, seconds=12, fps=15):
    from PIL import Image
    import random
    im = Image.open(jpg).convert('RGB').resize((640, 360))
    w, h = im.size
    ycc = im.convert('YCbCr')
    y, cb, cr = ycc.split()
    cb = bytes(cb.resize((w // 2, h // 2)).tobytes())
    cr = bytes(cr.resize((w // 2, h // 2)).tobytes())
    base = bytearray(y.tobytes())
    rnd = random.Random(1)
    with open(dest + '.part', 'wb') as f:
        f.write(f'YUV4MPEG2 W{w} H{h} F{fps}:1 Ip A1:1 C420jpeg\n'.encode())
        noise = [bytes(min(255, max(0, v + rnd.randint(-3, 3))) for v in base) for _ in range(4)]
        for i in range(seconds * fps):
            f.write(b'FRAME\n'); f.write(noise[i % 4]); f.write(cb); f.write(cr)
    os.replace(dest + '.part', dest)

def store_copy(dest):
    """The store zip's files, copied to dest (same list package.py zips)."""
    if os.path.isdir(dest): shutil.rmtree(dest)
    os.makedirs(dest)
    for line in open(os.path.join(REPO, 'dev', 'tools', 'store-files.txt'), encoding='utf-8'):
        item = line.strip()
        if not item or item.startswith('#'): continue
        src = os.path.join(REPO, item)
        dst = os.path.join(dest, item)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.isdir(src): shutil.copytree(src, dst, ignore=shutil.ignore_patterns('.DS_Store'))
        else: shutil.copy2(src, dst)
    if os.path.exists(os.path.join(dest, 'assets', 'facepalm.gif')):
        sys.exit('store copy contains assets/facepalm.gif')
    return dest

def run_one(name, ext):
    # Timing checks (fades, dust) can trip on a busy machine, so a failure is
    # rerun once on its own; the line says when that happened.
    name, ok, line = attempt(name, ext)
    if ok: return name, ok, line
    name, ok, again = attempt(name, ext)
    return name, ok, again + ('  [passed on retry; first run: ' + line + ']' if ok else '')

def attempt(name, ext):
    args, want = SCENARIOS[name]
    profile = os.path.join(OUT, f'profile-{name}')
    shutil.rmtree(profile, ignore_errors=True)
    env = {**os.environ, 'PT_PROFILE': profile}
    env['PYTHONUTF8'] = '1'  # Windows consoles default to a legacy code page
    text = dict(capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
    try:
        p = subprocess.run([sys.executable, os.path.join(HERE, 'regress.py'), ext, *args], timeout=300, **text)
        out = p.stdout + p.stderr
    except subprocess.TimeoutExpired:
        out = 'timed out after 300 s'
    s = subprocess.run([sys.executable, os.path.join(HERE, 'summary.py'), name], input=out, **text)
    line = s.stdout.strip() or out[-800:]
    ok = all(w in line for w in want) and 'FAIL' not in line and "errors []" in line
    shutil.rmtree(profile, ignore_errors=True)
    return name, ok, line

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--quick', action='store_true')
    ap.add_argument('--jobs', type=int, default=2)
    ap.add_argument('--ext')
    ap.add_argument('--only', nargs='*')
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    for pic, cam in [('statue.jpg', 'person.y4m'), ('face.jpg', 'face.y4m')]:
        dest = os.path.join(OUT, cam)
        if not os.path.exists(dest) or os.path.getmtime(dest) < os.path.getmtime(os.path.join(HERE, 'fixtures', pic)):
            make_y4m(os.path.join(HERE, 'fixtures', pic), dest)
    ext = os.path.abspath(a.ext) if a.ext else store_copy(os.path.join(OUT, 'store-build'))
    names = a.only or (QUICK if a.quick else list(SCENARIOS))
    print(f'testing {ext} ({len(names)} scenarios, {a.jobs} at a time)', flush=True)
    failed = 0
    with ThreadPoolExecutor(a.jobs) as pool:
        for name, ok, line in pool.map(lambda n: run_one(n, ext), names):
            print(('PASS ' if ok else 'FAIL ') + line, flush=True)
            failed += not ok
    print('e2e: all passed' if not failed else f'e2e: {failed} FAILED')
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    main()
