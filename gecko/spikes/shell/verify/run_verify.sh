#!/usr/bin/env bash
# The verifier's own scenarios (see VERIFY.md). Output: spikes/shell/verify/out.
#   bash spikes/shell/verify/run_verify.sh            (all, from gecko/)
#   bash spikes/shell/verify/run_verify.sh native     (one: popups noroute panels select native reveal misc tooltip progress early)
# The unchanged spike scenarios are rerun with rerun.sh.
# "native", "reveal" and "tooltip" move the REAL mouse cursor for a few seconds ("native" also
# presses the left button, only while this browser window is under the cursor) and put it back.
cd "$(dirname "$0")/../../.." || exit 1
V=spikes/shell/verify
S=spikes/shell
O=$V/out
mkdir -p "$O"
want() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }
ONLY="$1"

want popups  && python $S/run_popups.py --boot $V/boot-v-popups.js --name shell-verify-q-popups --timeout 200 --out $O --pref vitre.verify.improved=false 2>&1 | tee $O/vpopups.log
want noroute && python $S/run_popups.py --boot $V/boot-v-popups.js --name shell-verify-q-popups --timeout 200 --out $O --pref vitre.spike.noroute=true 2>&1 | tee $O/vpopups-noroute.log
if want panels; then
  echo "== spike rules" > $O/vpanels.log
  python $S/run_popups.py --boot $V/boot-v-panels.js --name shell-verify-s-panels --timeout 150 --out $O --pref vitre.verify.improved=false 2>&1 | tee -a $O/vpanels.log
  echo "== verifier rules" >> $O/vpanels.log
  python $S/run_popups.py --boot $V/boot-v-panels.js --name shell-verify-s-panels --timeout 150 --out $O 2>&1 | tee -a $O/vpanels.log
fi
if want select; then
  python $S/run_popups.py --boot $V/boot-v-select.js --name shell-verify-r-select --timeout 120 --out $O 2>&1 | tee $O/vselect.log
  echo "== no shell" >> $O/vselect.log
  python $S/run_popups.py --boot $V/boot-v-select.js --name shell-verify-r-select --timeout 120 --out $O --pref vitre.verify.noshell=true 2>&1 | tee -a $O/vselect.log
fi
if want native; then
  python $V/run_screen.py --boot $V/boot-v-native.js --name shell-verify-p-native --timeout 120 --out $O --pref vitre.verify.only=hover 2>&1 | tee $O/vnative-hover.log
  python $V/run_screen.py --boot $V/boot-v-native.js --name shell-verify-p-native --timeout 120 --out $O --pref vitre.verify.only=clicks,drag 2>&1 | tee $O/vnative-clicks-drag.log
  : > $O/vnative-pilldrag.log
  for m in sys-post nc-post; do
    echo "== $m" >> $O/vnative-pilldrag.log
    python $V/run_screen.py --boot $V/boot-v-native.js --name shell-verify-p-native --timeout 90 --out $O --pref vitre.verify.only=pilldrag --pref vitre.verify.pillmode=$m 2>&1 | tee -a $O/vnative-pilldrag.log
  done
  python $V/run_screen.py --boot $V/boot-v-native.js --name shell-verify-p-native --timeout 120 --out $O --pref vitre.verify.only=pillmax,wheel 2>&1 | tee $O/vnative-pillmax-wheel.log
fi
want reveal   && python tools/run.py      --boot $V/boot-v-reveal.js   --name shell-verify-t-reveal   --timeout 150 --out $O 2>&1 | tee $O/vreveal.log
want misc     && python tools/run.py      --boot $V/boot-v-misc.js     --name shell-verify-u-misc     --timeout 150 --out $O 2>&1 | tee $O/vmisc.log
want tooltip  && python $S/run_popups.py  --boot $V/boot-v-tooltip.js  --name shell-verify-w-tooltip  --timeout 90  --out $O 2>&1 | tee $O/vtooltip.log
want progress && python tools/run.py      --boot $V/boot-v-progress.js --name shell-verify-x-progress --timeout 120 --out $O 2>&1 | tee $O/vprogress.log
want early    && python $V/run_early_v.py --boot $S/boot-early.js      --name shell-verify-k-earlyv   --url https://example.com --timeout 90 --out $O/earlyv 2>&1 | tee $O/earlyv.log
echo "=== verify done"
