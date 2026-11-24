#!/bin/zsh
# Spike S10, the capsule demo (capsule-demo.js): serves the demo pages on 127.0.0.1 under fake
# .example hosts (network.dns.localDomains, test profile only), waits up to 30 min for an unlocked
# screen, runs the demo with behave_mon.py beside it (60 fps videos, the window server's track,
# CPU), then capsule_post.py makes the summaries, the mp4s and the numbers. One engine at a time.
#   cd gecko && zsh spikes/mac-glass/run-capsule-demo.sh [stills,motion,measure]
#   DRY=1 zsh spikes/mac-glass/run-capsule-demo.sh     a logic run: no waiting, no pictures, no monitor
#                                                      (works with the screen locked; logs to ...-dry)
# Needs the Screen Recording permission for the app running it, /opt/homebrew/bin/ffmpeg and xcrun.
# Captures land in tests/menus/out/glass-demo-*; logs, the track and the per-frame records in
# spikes/mac-glass/logs/mac-glass-s10/. Raw videos go to $TMPDIR/mac-glass-s10/vids and are deleted
# once the mp4s are made.
setopt NULL_GLOB
cd "$(dirname "$0")/../.." || exit 9
OUT=tests/menus/out
TMP=${TMPDIR:-/tmp}/mac-glass-s10
PAGES=$TMP/pages
PORT=${CD_PORT:-8765}
TOOL=${TMPDIR:-/tmp}/mac-glass-behave/wininfo
LOGS=spikes/mac-glass/logs/mac-glass-s10
ONLY=${1:-stills,motion,measure}
TO=1200
EXTRA=(--env CD_MON=1)
if [ -n "$DRY" ]; then
  LOGS=$LOGS-dry
  ONLY=${1:-stills,logic}
  EXTRA=(--no-capture --env CD_MON=0)
fi
mkdir -p $TMP/vids $PAGES $LOGS ${TOOL:h}
if [ ! -x $TOOL ] || [ spikes/mac-glass/wininfo.swift -nt $TOOL ]; then
  xcrun swiftc -O spikes/mac-glass/wininfo.swift -o $TOOL || exit 9
fi

# The pages: the HTML in capsule-pages/, and five photos from macOS's own account pictures
# (/Library/User Pictures, HEIC, which Gecko 157 does not decode) made into JPEGs with sips.
cp spikes/mac-glass/capsule-pages/*.html $PAGES/
for spec in Nature/Leaf:leaf Nature/Lightning:lightning Animals/Parrot:parrot Flowers/Poppy:poppy Animals/Zebra:zebra; do
  [ -f $PAGES/${spec##*:}.jpg ] || sips -s format jpeg -s formatOptions 88 "/Library/User Pictures/${spec%%:*}.heic" --out $PAGES/${spec##*:}.jpg >/dev/null || exit 9
done
/usr/bin/python3 -m http.server $PORT --bind 127.0.0.1 --directory $PAGES > $TMP/http.txt 2>&1 &
HTTP=$!
MON=
trap 'kill $HTTP $MON 2>/dev/null' EXIT

unlocked() {
  ! ioreg -n Root -d1 -a | plutil -extract IOConsoleUsers xml1 -o - - | grep -A1 CGSSessionScreenIsLocked | grep -q true
}
if [ -z "$DRY" ]; then
  for i in $(seq 1 30); do unlocked && break; echo "screen locked, waiting ($i)"; sleep 60; done
  unlocked || { echo "screen still locked: nothing run"; exit 3; }
fi

rm -f $OUT/log.txt $OUT/beh-* $OUT/cd-rec-*.json $TMP/vids/*.mkv
/usr/bin/python3 -u spikes/mac-glass/behave_mon.py $OUT --tool $TOOL --vids $TMP/vids --timeout $((TO + 60)) > $TMP/mon.txt 2>&1 &
MON=$!
sleep 0.5
curl -s -o /dev/null -w "page server: %{http_code}\n" http://127.0.0.1:$PORT/article.html
DOMAINS=fieldnotes.example,nightshift.example,wildlife.example,tideline.example,refract.example,moltentin.example
/usr/bin/python3 -u tools/run.py --test spikes/mac-glass/capsule-demo.js --name mac-glass-s10 --url about:blank --timeout $TO --out $OUT \
  --pref ui.systemUsesDarkTheme=1 --pref dom.security.https_first=false --pref network.dns.localDomains=$DOMAINS \
  --env CD_PORT=$PORT --env CD_ONLY=$ONLY $EXTRA > $TMP/run.txt 2>&1
echo "run: exit $?"
sleep 3
kill $MON 2>/dev/null
cp $OUT/log.txt $LOGS/log.txt
cp $TMP/mon.txt $LOGS/monitor.txt
cp $TMP/run.txt $LOGS/run.txt
mv $OUT/beh-*.json $OUT/cd-rec-*.json $LOGS/ 2>/dev/null
rm -f $OUT/beh-done-* $OUT/beh-go-* $OUT/glass-demo-*.png.done
grep -E "^(PASS|FAIL|ERROR|RESULT)" $TMP/run.txt
/usr/bin/python3 spikes/mac-glass/capsule_post.py $LOGS --vids $TMP/vids --out $OUT
