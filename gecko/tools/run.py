"""Run Vitre (the Gecko runtime with Vitre's chrome package) with a test script, capture real window
screenshots, print the script's log, then stop it.

  python tools/run.py --test tests/x/smoke.js --name x [--url https://example.com] [--timeout 90]
                      [--app build-x] [--pref key=value ...] [--env KEY=VALUE ...] [--arg -private-window]
                      [--keep-profile] [--out tests/x/out] [--shoot name:seconds ...] [--stock] [--identity]

  --test SCRIPT     (alias --boot) runs in every browser window once Vitre has booted there, with the
                    `spike` helpers from tools/spike-lib.js. spike.main() runs its body in the first
                    window only. Without --test, give --shoot: Vitre starts with no test hook at all.
  --name NAME       the throwaway profile %TEMP%/vitre-gecko-NAME (deleted afterwards). Runs with
                    different names are independent and can run at the same time.
  --app build-x     use another build output (node tools/build.mjs --out=build-x) instead of
                    runtime/vitre: it is linked into the profile's chrome folder, which sandboxed
                    content processes can read, and passed as VITRE_APP_DIR.
  --shoot N:SECS    screenshot the window SECS seconds after start, from outside (no script needed).
  --stock           VITRE_DISABLE=1: plain Firefox interface (to compare against).
  --exe NAME        start runtime/NAME instead of vitre.exe (only for control runs that need the
                    process to be called firefox.exe; Vitre itself always runs as vitre.exe).
  --identity        with every capture also print the window title and taskbar id and save its icon.
  --until-exit      the run also ends, normally, when the runtime quits by itself after the script
                    started (a test of something that quits Deer: tests/update/apply.js).
  Exit code: 0 when the script finished and logged no FAIL or ERROR line, 1 otherwise.

Script protocol (lines the script writes to the log; spike-lib does it):
  @@capture NAME [HWND]   screenshot that window (PrintWindow: the composited picture) to OUT/NAME.png
  @@modules TEXT          print the DLLs loaded in this run's processes whose name contains TEXT
  @@quit                  the script is done
  @@pid PID               the runtime process the script runs in (spike-lib, once per process): followed with
                          its children, as an in-place restart's new process may come from a launcher
                          that exits before it is seen
  @@kill [PID]            a hard kill: every runtime process of this run is terminated (taskkill /F, no
                          shutdown runs, as in a crash) and the runtime is started again on the same
                          profile; the script runs again with spike.run + 1 (spike.kill())
Anything else is printed. Panels and menus are separate OS windows and are not in a window capture.

The runtime is started as runtime/vitre.exe with -profile and -no-remote, focusmanager.testmode=true
and VITRE_ALLOW_ANY_PROFILE=1, on a profile carrying the "vitre-harness" marker (config.js honours
the test hook and VITRE_APP_DIR only there). Processes are followed by parent/child from the one
started here, so an in-place restart (whose command line no longer names the profile) is still
captured and stopped.

macOS (tools/harness/mac.py): the engine is runtime/Deer Dev.app/Contents/MacOS/firefox (never renamed:
there is no vitre.exe and no --exe), started with -no-remote -foreground -profile on a profile in
$TMPDIR (links resolved: /private/var/folders/...), never with an inherited XRE_PROFILE_PATH (--env
XRE_PROFILE_PATH / XRE_PROFILE_LOCAL_PATH and --arg -profile / -P / -ProfileManager are refused). --app makes
a symbolic link; config.js adds its real folder to the content sandbox. Processes are found with ps and
stopped with SIGTERM, then SIGKILL (@@kill: SIGKILL at once); the person's own Deer Dev, which runs from
the same bundle, is never followed: only descendants of the process started here, and processes whose
command line names this run's profile. Windows and captures go through tools/mac/wintool.py (built with
swiftc on first use); a capture brings the window to the front first, and pictures are in physical
pixels (2 per point on Retina). --identity prints the title (None without the permission below) and
the bundle id as taskbar-id, and saves the bundle's icon.
  --no-capture      take no screenshots: @@capture and --shoot are answered without one (macOS only).
  Exit code 4: the Screen Recording permission is off for the app that runs the harness (Terminal,
  an editor, the Claude app): System Settings › Privacy & Security › Screen & System Audio Recording.
  A sandboxed shell may be refused access to the window server: run the harness outside it.
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from harness import backend as _select_backend  # noqa: E402
from harness import common as _common  # noqa: E402

_backend = _select_backend()

# The platform half's names (VITRE, PREFS, processes, stale_pids, kill, find_window, capture, shoot, png,
# window_title, window_aumid, remove_profile, link_app, raise_window, ...; on Windows also user32 and
# the rest of the Win32 code), as before the split.
for _name in dir(_backend):
    if not _name.startswith('_'):
        globals()[_name] = getattr(_backend, _name)
pref_value = _common.pref_value


class _Front(types.ModuleType):
    """Assigning one of those names here also assigns it in the platform half, where the functions
    that use it look it up: tests/extensions/runx.py sets run.capture to its own and calls run.main()."""

    def __setattr__(self, name, value):
        types.ModuleType.__setattr__(self, name, value)
        if not name.startswith('_') and hasattr(_backend, name):
            setattr(_backend, name, value)


sys.modules[__name__].__class__ = _Front


def main():
    return _common.main(_backend, __doc__)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
