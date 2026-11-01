# Builds the Chrome Web Store upload: dist/plot-twist-<version>.zip
# Works on macOS, Windows and Linux. Ships only the runtime files listed in
# dev/tools/store-files.txt (the browser test runs exactly that set), plus a
# rights-cleared still facepalm image if one is present. Never the local
# assets/facepalm.gif: it is a film clip we have no rights to ship.
# Usage: python dev/tools/package.py
import json, os, subprocess, sys, zipfile

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FORBIDDEN = ('facepalm.gif', 'dev/', 'test/', 'tmp/', 'store/', 'HANDOFF', 'GO_LIVE', 'recordings', '.DS_Store')
OPTIONAL = ['assets/facepalm.png', 'assets/facepalm.jpg', 'assets/facepalm.webp']


def store_files():
    items = []
    for line in open(os.path.join(REPO, 'dev', 'tools', 'store-files.txt'), encoding='utf-8'):
        line = line.strip()
        if line and not line.startswith('#'):
            items.append(line)
    items += [f for f in OPTIONAL if os.path.exists(os.path.join(REPO, f))]
    files = []
    for item in items:
        path = os.path.join(REPO, item)
        if os.path.isdir(path):
            for d, _, names in os.walk(path):
                files += [os.path.relpath(os.path.join(d, n), REPO) for n in names]
        else:
            files.append(item)
    # zip entries always use forward slashes, whatever the OS
    return sorted(f.replace(os.sep, '/') for f in files if not f.endswith('.DS_Store'))


def main():
    node = 'node'
    subprocess.run([node, 'dev/tools/build-isolated.js', '--check'], cwd=REPO, check=True)
    tests = sorted(os.path.join('test', f) for f in os.listdir(os.path.join(REPO, 'test')) if f.endswith('.test.js'))
    subprocess.run([node, '--test', *tests], cwd=REPO, check=True, stdout=subprocess.DEVNULL)
    version = json.load(open(os.path.join(REPO, 'manifest.json'), encoding='utf-8'))['version']
    out = os.path.join(REPO, 'dist', f'plot-twist-{version}.zip')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    files = store_files()
    bad = [f for f in files if any(x in f for x in FORBIDDEN)]
    if bad:
        sys.exit(f'package.py: forbidden files: {bad}')
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in files:
            info = zipfile.ZipInfo(f, date_time=(2026, 1, 1, 0, 0, 0))  # reproducible
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(os.path.join(REPO, f), 'rb') as fh:
                z.writestr(info, fh.read())
    print(os.path.relpath(out, REPO).replace(os.sep, '/'))
    print(f'{len(files)} files, {os.path.getsize(out) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
