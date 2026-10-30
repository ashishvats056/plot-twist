#!/bin/sh
# Browser regression test: loads the unpacked extension in Playwright's
# Chromium with a fake camera showing a person, joins a Meet-like stub page
# over a WebRTC loopback, and checks that cinema, facepalm, money rain and
# the vanish dust reach both the self view and the far end, in three set-ups:
#   plain  — the page sends our camera track as is
#   pipe   — the page runs its own effects pipeline in passthrough (like Meet
#            with no background set), self view shows the camera
#   effect — the page sends its own processed track (like a Meet background)
# Needs: python3 + playwright (pip install playwright; playwright install chromium), ffmpeg.
# Usage: sh dev/e2e/run.sh [extension-dir]   (default: this repo)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
ext=$(cd "${1:-$here/../..}" && pwd)
out="$here/out"
mkdir -p "$out"
if [ ! -f "$out/person.y4m" ]; then
  # Fake camera: Henri Vidal's statue "Cain" (1896), photo by Joe deSousa,
  # CC0 (Wikimedia Commons), framed like a webcam head-and-shoulders shot.
  curl -sfL -A "plot-twist-e2e" -o "$out/cain.jpg" \
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Ca%C3%AFn_venant_de_tuer_son_fr%C3%A8re_Abel_by_Henri_Vidal%2C_Tuileries_Garden%2C_18_July_2017.jpg/960px-Ca%C3%AFn_venant_de_tuer_son_fr%C3%A8re_Abel_by_Henri_Vidal%2C_Tuileries_Garden%2C_18_July_2017.jpg"
  ffmpeg -v error -y -loop 1 -i "$out/cain.jpg" -t 12 -r 15 \
    -vf "crop=960:540:0:120,scale=640:360,noise=alls=3:allf=t,format=yuv420p" "$out/person.y4m"
fi
cp "$here/regress.py" "$here/summary.py" "$out/"
cd "$out"
status=0
for cfg in "plain self" "plain remote" "pipe self" "pipe remote" "effect self" "effect remote"; do
  set -- $cfg
  rm -rf profile-*
  line=$(python3 regress.py "$ext" t "$1" "$2" 2>&1 | python3 summary.py "$1") || true
  echo "$line"
  case "$line" in *"cinema:OK facepalm:OK money:OK vanish:OK return:OK"*) ;; *) status=1 ;; esac
done
# Effects off at join, switched on mid-call (must all work), then off again.
for cfg in "plain remote" "effect remote"; do
  set -- $cfg
  rm -rf profile-*
  line=$(python3 regress.py "$ext" live "$1" "$2" 2>&1 | python3 summary.py "live-switch $1") || true
  echo "$line"
  case "$line" in *"cinema:OK facepalm:OK money:OK vanish:OK return:OK live-switch:OK"*) ;; *) status=1 ;; esac
done
[ $status -eq 0 ] && echo "e2e: all passed" || echo "e2e: FAILED"
exit $status
