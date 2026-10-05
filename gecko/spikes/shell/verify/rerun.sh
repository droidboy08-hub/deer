#!/usr/bin/env bash
# Verifier rerun of the "shell" spike scenarios, unchanged boot scripts, own profile names,
# output in spikes/shell/verify/out.
#   bash spikes/shell/verify/rerun.sh [scenario]
cd "$(dirname "$0")/../../.." || exit 1
S=spikes/shell
O=$S/verify/out
mkdir -p "$O"
want() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }
ONLY="$1"

want basic    && python tools/run.py      --boot $S/boot-basic.js    --name shell-verify-a-basic   --url https://example.com --timeout 90 --out $O 2>&1 | tee $O/basic.log
want titlebar0 && python tools/run.py     --boot $S/boot-basic.js    --name shell-verify-n-titlebar0 --url https://example.com --timeout 90 --pref browser.tabs.inTitlebar=0 --out $O/titlebar0 2>&1 | tee $O/titlebar0.log
want window   && python tools/run.py      --boot $S/boot-window.js   --name shell-verify-b-window  --timeout 120 --out $O 2>&1 | tee $O/window.log
want native   && python tools/run.py      --boot $S/boot-native.js   --name shell-verify-c-native  --timeout 150 --pref browser.tabs.inTitlebar=0 --out $O 2>&1 | tee $O/native.log
want popups   && python $S/run_popups.py  --boot $S/boot-popups.js   --name shell-verify-d-popups  --timeout 170 --out $O 2>&1 | tee $O/popups.log
want noroute  && python $S/run_popups.py  --boot $S/boot-popups.js   --name shell-verify-e-noroute --timeout 170 --pref vitre.spike.noroute=true --out $O 2>&1 | tee $O/popups-noroute.log
want tabs     && python tools/run.py      --boot $S/boot-tabs.js     --name shell-verify-f-tabs    --timeout 240 --out $O 2>&1 | tee $O/tabs.log
want windows  && python tools/run.py      --boot $S/boot-windows.js  --name shell-verify-g-windows --timeout 200 --out $O 2>&1 | tee $O/windows.log
want nativepopup && python tools/run.py   --boot $S/boot-windows.js  --name shell-verify-h-natpop  --timeout 200 --pref vitre.spike.nativepopup=true --out $O 2>&1 | tee $O/windows-nativepopup.log
want states   && python tools/run.py      --boot $S/boot-states.js   --name shell-verify-i-states  --timeout 200 --out $O 2>&1 | tee $O/states.log
if want session; then
  python tools/run.py --boot $S/boot-session.js --name shell-verify-j-session --timeout 120 --pref vitre.spike.phase=1 --out $O 2>&1 | tee $O/session.log
  echo "=== phase 2 (restart, same profile)" | tee -a $O/session.log
  python tools/run.py --boot $S/boot-session.js --name shell-verify-j-session --keep-profile --timeout 120 --pref vitre.spike.phase=2 --pref browser.startup.page=3 --pref browser.sessionstore.resume_from_crash=true --out $O 2>&1 | tee -a $O/session.log
fi
if want ncprobe; then
  : > $O/ncprobe.log
  for v in raw-none raw-toggle raw-maximize shipped hover; do
    python tools/run.py --boot $S/boot-ncprobe.js --name shell-verify-l-ncprobe --timeout 60 --pref vitre.spike.variant=$v --pref vitre.spike.msgs=move,down,gap,up --out $O 2>&1 | tee -a $O/ncprobe.log
  done
fi
want favicon  && python tools/run.py      --boot $S/boot-favicon.js  --name shell-verify-m-favicon --timeout 90 --out $O 2>&1 | tee $O/favicon.log
echo "=== rerun done"
