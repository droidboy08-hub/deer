"""Adversarial verification of the tab switcher (from gecko/):
    python tests/switcher-verify/all.py [name ...] [--app build-switcher-verify]

The builder's suites (tests/switcher/*.js) rerun under this folder's profile names, plus the
verifier's attacks (tests/switcher-verify/*.js):

  styles keys mouse search thumbs motion   the builder's six suites (tests/switcher/all.py)
  ladders   Esc and Ctrl+W ladders against the core and other modules (address field, find, menus,
            peek, settings panel), a menu open over the switcher, F11, element full screen
  windows   second window, private window, popup window: each has its own switcher (or none), keys
            in one never reach another, closing a window with the switcher up leaks nothing
  scale     150% (layout.css.devPixelsPerPx 1.5 at runtime): geometry of the three styles, picture
            sharpness, the window controls on top of the deck and grid, a scale change while
            the switcher is up; captures
  stress    rapid repeated input (key repeat, Tab storms, open/close storms, closing every tab from
            the switcher, tabs closing underneath), slow and hung pages, dark and light pages,
            console errors and idle CPU cost
  restore   restart and session restore with the switcher open at quit, pictures across the restart
  pages     Home as the start tab, WebGL and video-stream pictures, a resize while the deck is up,
            Ctrl+W on a filtered result, long / right-to-left / emoji titles
  input     Sticky Keys (stubbed on), IME composition, AltGr while held, Ctrl+Alt+Tab ignored
Without names all of them run. Without --app the build build-switcher-verify is made and used.
Logs and captures: tests/switcher-verify/out/ (log-<name>.txt).
"""
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PY = sys.executable
RUN = [PY, os.path.join(ROOT, 'tools', 'run.py')]
MINE = os.path.join(ROOT, 'tests', 'switcher-verify')
THEIRS = os.path.join(ROOT, 'tests', 'switcher')
OUT = os.path.join(MINE, 'out')

TESTS = {
    'styles': (THEIRS, 'styles.js', 420),
    'keys': (THEIRS, 'keys.js', 240),
    'mouse': (THEIRS, 'mouse.js', 200),
    'search': (THEIRS, 'search.js', 240),
    'thumbs': (THEIRS, 'thumbs.js', 240),
    'motion': (THEIRS, 'motion.js', 240),
    'ladders': (MINE, 'ladders.js', 300),
    'windows': (MINE, 'windows.js', 300),
    'scale': (MINE, 'scale.js', 300),
    'stress': (MINE, 'stress.js', 420),
    'restore': (MINE, 'restore.js', 300),
    'pages': (MINE, 'pages.js', 300),
    'input': (MINE, 'input.js', 240),
}


def report(name, returncode, text):
    lines = text.splitlines()
    passed = sum(1 for line in lines if line.startswith('PASS '))
    bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', '[console.error]')) or 'no window found' in line]
    print('%-8s %s  (%d checks passed)' % (name, 'ok' if returncode == 0 else 'FAILED', passed), flush=True)
    for line in bad:
        print('    ' + line[:600], flush=True)
    with open(os.path.join(OUT, 'log-%s.txt' % name), 'w', encoding='utf-8') as f:
        f.write(text)
    return returncode == 0


def main():
    args = sys.argv[1:]
    app = 'build-switcher-verify'
    if '--app' in args:
        i = args.index('--app')
        app = args[i + 1]
        del args[i:i + 2]
    else:
        if subprocess.run(['node', os.path.join(ROOT, 'tools', 'build.mjs'), '--out=' + app], cwd=ROOT, shell=True).returncode:
            sys.exit('build failed')
    names = args or list(TESTS)
    os.makedirs(OUT, exist_ok=True)
    ok = True
    for name in names:
        if name not in TESTS:
            sys.exit('no such test: %s (have: %s)' % (name, ', '.join(TESTS)))
        folder, script, timeout = TESTS[name]
        r = subprocess.run(RUN + ['--test', os.path.join(folder, script), '--name', 'swverify-' + name, '--timeout', str(timeout), '--out', OUT, '--app', app],
                           cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        ok &= report(name, r.returncode, r.stdout + r.stderr)
    for f in os.listdir(OUT):
        if f.endswith('.done'):
            os.remove(os.path.join(OUT, f))
    print('ALL OK' if ok else 'SOME FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
