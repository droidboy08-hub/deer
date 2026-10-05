#!/usr/bin/env bash
# Runs every scenario of the "shell" spike, one after the other, and keeps each run's console
# output in out/<scenario>.log (out/log.txt is the harness channel and is overwritten per run).
#   bash spikes/shell/run_all.sh            (from gecko/)
#   bash spikes/shell/run_all.sh tabs       (one scenario: basic titlebar0 window native popups noroute tabs
#                                            windows nativepopup states session early ncprobe)
# Profile names never share a prefix: tools/run.py finds and kills processes by substring match
# on the profile name, so "x" and "x-base" running at the same time would capture and kill each other.
cd "$(dirname "$0")/../.." || exit 1
S=spikes/shell
O=$S/out
mkdir -p "$O"
want() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }
ONLY="$1"

want basic    && python tools/run.py      --boot $S/boot-basic.js    --name shell-a-basic   --url https://example.com --timeout 90  2>&1 | tee $O/basic.log
want titlebar0 && python tools/run.py     --boot $S/boot-basic.js    --name shell-n-titlebar0 --url https://example.com --timeout 90 --pref browser.tabs.inTitlebar=0 --out $O/titlebar0 2>&1 | tee $O/titlebar0.log
want window   && python tools/run.py      --boot $S/boot-window.js   --name shell-b-window  --timeout 120 2>&1 | tee $O/window.log
want native   && python tools/run.py      --boot $S/boot-native.js   --name shell-c-native  --timeout 150 --pref browser.tabs.inTitlebar=0 2>&1 | tee $O/native.log
want popups   && python $S/run_popups.py  --boot $S/boot-popups.js   --name shell-d-popups  --timeout 170 2>&1 | tee $O/popups.log
want noroute  && python $S/run_popups.py  --boot $S/boot-popups.js   --name shell-e-noroute --timeout 170 --pref vitre.spike.noroute=true 2>&1 | tee $O/popups-noroute.log
want tabs     && python tools/run.py      --boot $S/boot-tabs.js     --name shell-f-tabs    --timeout 240 2>&1 | tee $O/tabs.log
want windows  && python tools/run.py      --boot $S/boot-windows.js  --name shell-g-windows --timeout 200 2>&1 | tee $O/windows.log
want nativepopup && python tools/run.py   --boot $S/boot-windows.js  --name shell-h-natpop  --timeout 200 --pref vitre.spike.nativepopup=true 2>&1 | tee $O/windows-nativepopup.log
want states   && python tools/run.py      --boot $S/boot-states.js   --name shell-i-states  --timeout 200 2>&1 | tee $O/states.log
if want session; then
  python tools/run.py --boot $S/boot-session.js --name shell-j-session --timeout 120 --pref vitre.spike.phase=1 2>&1 | tee $O/session.log
  echo "=== phase 2 (restart, same profile)" | tee -a $O/session.log
  python tools/run.py --boot $S/boot-session.js --name shell-j-session --keep-profile --timeout 120 --pref vitre.spike.phase=2 --pref browser.startup.page=3 --pref browser.sessionstore.resume_from_crash=true 2>&1 | tee -a $O/session.log
fi
want early    && python $S/run_early.py   --boot $S/boot-early.js    --name shell-k-early   --url https://example.com --timeout 90 2>&1 | tee $O/early.log
if want ncprobe; then
  : > $O/ncprobe.log
  for v in raw-none raw-toggle raw-maximize shipped hover; do
    python tools/run.py --boot $S/boot-ncprobe.js --name shell-l-ncprobe --timeout 60 --pref vitre.spike.variant=$v --pref vitre.spike.msgs=move,down,gap,up 2>&1 | tee -a $O/ncprobe.log
  done
fi
