#!/bin/sh
# Builds the Chrome Web Store upload: dist/plot-twist-<version>.zip
# Includes only what the extension needs at runtime plus licences and notices.
# Excludes dev/, test/, tmp/, store/, HANDOFF.md, and assets/facepalm.gif
# (a local film clip we have no rights to ship).
# Usage: sh dev/tools/package.sh
set -eu
cd "$(dirname "$0")/../.."

node dev/tools/build-isolated.js --check
node --test test/*.test.js > /dev/null

version=$(node -p "require('./manifest.json').version")
out="dist/plot-twist-$version.zip"
mkdir -p dist
rm -f "$out"

zip -q -X -r "$out" \
  manifest.json \
  LICENSE-APACHE-2.0.txt THIRD_PARTY_NOTICES.md PRIVACY.md \
  icons popup src detector vendor models \
  assets/README.txt \
  -x '*.DS_Store'

# Optional, rights-cleared facepalm image (never the git-ignored GIF).
for f in assets/facepalm.png assets/facepalm.jpg assets/facepalm.webp; do
  if [ -f "$f" ]; then zip -q -X "$out" "$f"; fi
done

if unzip -l "$out" | grep -qE 'facepalm\.gif|dev/|test/|tmp/|HANDOFF|recordings'; then
  echo "package.sh: forbidden file in $out" >&2
  exit 1
fi
echo "$out"
unzip -l "$out" | tail -1
