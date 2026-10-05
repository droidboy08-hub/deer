"""Run the switcher tests, one after the other (from gecko/):
    python tests/switcher/all.py [name ...] [--app build-switcher]

  styles   Deck, Grid and Strip at 3, 12 and 40 real pages, held Ctrl+Tab: captures, every card painted,
           first paint after the Ctrl+Tab keydown, release opens the card, the bitmap cap at 40 tabs
  keys     quick tap, held stepping and release, cancel (back to the start, wallpaper click, lost focus),
           Ctrl+W / Delete, typing latches, Ctrl+Shift+A, latched keys, global keys swallowed, Type to
           search off, Grid arrows, tab-bar order, the 'switcher' service, the Esc ladder, the page
           never sees the keys
  mouse    click / middle click / dock circles in the Deck, close badge and New tab card in the Grid,
           click and cancel in the Strip
  search   Ctrl+Shift+A and "glass" over real pages in each style (TabSearch board), no match, a word
           in the address
  thumbs   fresh pictures of changed background tabs, the picture at discard, zoom, JPEGs on disk keyed
           through SessionStore, private windows write nothing, restored tabs show last session's
           picture after a restart, the sweep of unused files
  motion   the opening, a step and the release frozen part-way (captures) with their timings and curves
           from the running animations; reduced motion is cross-fades only
Without names all of them run (about 8 minutes). Without --app the default build is made and used.
Logs and captures: tests/switcher/out/ (log-<name>.txt). The tests need the network (Wikipedia,
mozilla.org and other real sites).
"""
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PY = sys.executable
RUN = [PY, os.path.join(ROOT, 'tools', 'run.py')]
T = os.path.join(ROOT, 'tests', 'switcher')
OUT = os.path.join(T, 'out')

TESTS = {
    'styles': ('styles.js', 420),
    'keys': ('keys.js', 240),
    'mouse': ('mouse.js', 200),
    'search': ('search.js', 240),
    'thumbs': ('thumbs.js', 240),
    'motion': ('motion.js', 240),
}


def report(name, returncode, text):
    lines = text.splitlines()
    passed = sum(1 for line in lines if line.startswith('PASS '))
    bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback')) or 'no window found' in line]
    print('%-8s %s  (%d checks passed)' % (name, 'ok' if returncode == 0 else 'FAILED', passed))
    for line in bad:
        print('    ' + line[:600])
    with open(os.path.join(OUT, 'log-%s.txt' % name), 'w', encoding='utf-8') as f:
        f.write(text)
    return returncode == 0


def main():
    args = sys.argv[1:]
    app = []
    if '--app' in args:
        i = args.index('--app')
        app = ['--app', args[i + 1]]
        del args[i:i + 2]
    names = args or list(TESTS)
    os.makedirs(OUT, exist_ok=True)
    if not app:
        if subprocess.run(['node', os.path.join(ROOT, 'tools', 'build.mjs')], cwd=ROOT, shell=True).returncode:
            sys.exit('build failed')
    ok = True
    for name in names:
        if name not in TESTS:
            sys.exit('no such test: %s (have: %s)' % (name, ', '.join(TESTS)))
        script, timeout = TESTS[name]
        r = subprocess.run(RUN + ['--test', os.path.join(T, script), '--name', 'switcher-' + name, '--timeout', str(timeout), '--out', OUT] + app,
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
