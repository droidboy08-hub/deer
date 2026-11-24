#!/bin/zsh
# Runs the mac-glass behaviour spikes (S3, S4, S5, S7, S8, S9) one engine at a time, each with
# behave_mon.py beside it. Needs the screen unlocked (it waits up to 30 min for that), the Screen
# Recording and Accessibility permissions for the app running it, and /opt/homebrew/bin/ffmpeg.
#   cd gecko && zsh spikes/mac-glass/run-behave.sh [s3 s4 s5 s7 s8 s9]      (default: all)
# Logs go to spikes/mac-glass/logs/<run name>/, captures to tests/menus/out/glass-behave-*.png.
setopt NULL_GLOB
cd "$(dirname "$0")/../.." || exit 9
OUT=tests/menus/out
TMP=${TMPDIR:-/tmp}/mac-glass-behave
mkdir -p $TMP/vids
TOOL=$TMP/wininfo
if [ ! -x $TOOL ] || [ spikes/mac-glass/wininfo.swift -nt $TOOL ]; then
  xcrun swiftc -O spikes/mac-glass/wininfo.swift -o $TOOL || exit 9
fi

unlocked() {
  ! ioreg -n Root -d1 -a | plutil -extract IOConsoleUsers xml1 -o - - | grep -A1 CGSSessionScreenIsLocked | grep -q true
}

run() {  # run <script.js> <name> <timeout> [run.py args...]
  local SCRIPT=$1 NAME=$2 TO=$3; shift 3
  for i in $(seq 1 30); do unlocked && break; echo "screen locked, waiting ($i)"; sleep 60; done
  unlocked || { echo "screen still locked: $NAME skipped"; return 1; }
  rm -f $OUT/log.txt $OUT/beh-*
  /usr/bin/python3 -u spikes/mac-glass/behave_mon.py $OUT --tool $TOOL --vids $TMP/vids --timeout $((TO + 60)) > $TMP/mon-$NAME.txt 2>&1 &
  local MON=$!
  sleep 0.5
  /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/$SCRIPT --name $NAME --url about:blank --timeout $TO --out $OUT "$@" > $TMP/run-$NAME.txt 2>&1
  echo "$NAME: exit $?"
  sleep 3
  kill $MON 2>/dev/null
  mkdir -p spikes/mac-glass/logs/$NAME
  cp $OUT/log.txt spikes/mac-glass/logs/$NAME/log.txt
  cp $TMP/mon-$NAME.txt spikes/mac-glass/logs/$NAME/monitor.txt
  mv $OUT/beh-*.json spikes/mac-glass/logs/$NAME/ 2>/dev/null
  rm -f $OUT/beh-done-* $OUT/beh-go-*
  grep -E "^(PASS|FAIL|ERROR|RESULT)|\[run\]" $TMP/run-$NAME.txt
}

WANT=${@:-s3 s4 s5 s7 s8 s9}
for s in ${=WANT}; do
  case $s in
    s3) run s3-lifetime.js mac-glass-s3 600 --pref ui.systemUsesDarkTheme=1 ;;
    s4) run s4-input.js mac-glass-s4 400 --pref ui.systemUsesDarkTheme=1 ;;
    s5) run s5-order.js mac-glass-s5 500 --pref ui.systemUsesDarkTheme=1 ;;
    s7) run s7-cost.js mac-glass-s7 500 --pref ui.systemUsesDarkTheme=1 ;;
    s8) run s8-popover.js mac-glass-s8-dark 500 --pref widget.macos.native-popovers=true --pref ui.systemUsesDarkTheme=1
        run s8-popover.js mac-glass-s8-light 500 --pref widget.macos.native-popovers=true --pref ui.systemUsesDarkTheme=0 ;;
    s9) run s9-count.js mac-glass-s9 600 --pref ui.systemUsesDarkTheme=1 ;;
  esac
done
# The raw videos (S3 drag-resize, S7 typing) are in $TMP/vids: cut filmstrips from them
# (spikes/mac-glass/video_markers.py measures S3's), then delete them.
echo "videos: $TMP/vids"
