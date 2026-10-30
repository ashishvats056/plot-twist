#!/bin/sh
# Fast subset of run.sh (~4 min): plain self view, Meet-style background
# replacement at the far end, Meet background picture. Two at a time.
# Usage: sh dev/e2e/quick.sh [extension-dir]
set -eu
here=$(cd "$(dirname "$0")" && pwd)
ext=$(cd "${1:-$here/../..}" && pwd)
out="$here/out"
[ -f "$out/person.y4m" ] || { echo "run sh dev/e2e/run.sh once first (makes the fake camera)"; exit 1; }
cp "$here/regress.py" "$here/summary.py" "$out/"
cd "$out"
rm -rf profile-*
python3 regress.py "$ext" q1 pipe self > q1.txt 2>&1 &
python3 regress.py "$ext" q2 replace remote > q2.txt 2>&1 &
wait
python3 regress.py "$ext" q3 bgpic remote > q3.txt 2>&1
status=0
for n in 1 2 3; do
  line=$(python3 summary.py "quick$n" < q$n.txt) || true
  echo "$line"
  case "$line" in *"cinema:OK facepalm:OK money:OK vanish:OK return:OK"*) ;; *) status=1 ;; esac
  case "$line" in *FAIL*) status=1 ;; esac
done
[ $status -eq 0 ] && echo "quick e2e: passed" || echo "quick e2e: FAILED"
exit $status
