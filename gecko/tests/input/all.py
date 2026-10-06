"""Run the input tests, one after the other (from gecko/):  python tests/input/all.py [name ...] [--app build-x]

  keys       the key battery: every binding of design/keymap.json with its priority, pages keeping
             page-first keys, text editing, guards (IME, AltGr, repeat, Windows key), hardware keys,
             hooks, rebinding in every window, Esc and page layers, keyboard lock, and Firefox's own
             shortcuts doing nothing
  actions    the built-in actions on real pages: tabs, Ctrl+Tab, navigation, zoom, F6, the Esc and
             close ladders, the peek hook, view source, full screen, windows, developer tools
  omnibox    the address field: look (captures), suggestions, its keys, focus, private windows,
             history search in a 30 000-place history
  home       Home with each background kind (captures), glass theme, video pause, every window
  homeflash  new Home tabs start from the remembered picture, decoded, with no blank frame first;
             its mean colour under it
  preload    new tabs take the Home page each window keeps drawn in a hidden browser: no white or
             grey frame (every frame read back), the tab is called Home
  inset      the page top inset: the strip under the bar on plain, dark, fixed / sticky / absolute
             header, wrapper-coloured and app pages, the setting at runtime, bfcache, pushState,
             iframes, zoom, a page fighting the push, text and view-source, Wikipedia and DuckDuckGo
  youtube    the strip on YouTube: its header and the guide (side menu) below Deer's bar, on the
             home and watch pages and with the guide opened; the decision stays put (needs the network)
  edges      the inset's edge cases: the site's root padding / margin, background kinds and images,
             late / scroll-triggered / hiding headers, inner scrollers, element full screen, print
             preview, the PDF viewer and other excluded pages, zoom 50-300 % and site zoom, pages that
             loop, cost on a 60 000-element page and Wikipedia, a narrow window, ten tabs, two windows
  restart    the session comes back after a restart, with a selected Home tab; history survives
  crash      Firefox's crash recovery brings the tabs back after the process is killed
Without names all of them run (about 10 minutes). Each run prints its failures and a summary line;
full logs and captures are in tests/input/out/ (log-<name>.txt).
The tests need the network for example.com / example.org (inset: en.wikipedia.org, duckduckgo.com;
edges: en.wikipedia.org).
A person clicking the test window while it runs can disturb the key battery; it says so in its log
when that happened.
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PY = sys.executable
RUN = [PY, os.path.join(ROOT, 'tools', 'run.py')]
T = os.path.join(ROOT, 'tests', 'input')
OUT = os.path.join(T, 'out')

TESTS = {
    'keys': ('keys.js', 420),
    'actions': ('actions.js', 300),
    'omnibox': ('omnibox.js', 400),
    'home': ('home.js', 300),
    'homeflash': ('home-flash.js', 240),
    'preload': ('home-preload.js', 240),
    'inset': ('inset.js', 300),
    'private': ('private.js', 120),
    'edges': ('inset-edge.js', 400),
    'youtube': ('inset-youtube.js', 240),
    'restart': ('restart.js', 200),
}


def report(name, returncode, text):
    lines = text.splitlines()
    passed = sum(1 for line in lines if line.startswith('PASS '))
    bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', 'SKIP', 'NOTE')) or 'no window found' in line]
    print('%-9s %s  (%d checks passed)' % (name, 'ok' if returncode == 0 else 'FAILED', passed))
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
    names = args or list(TESTS) + ['crash']
    os.makedirs(OUT, exist_ok=True)
    if not app:
        for cmd in (['node', os.path.join(ROOT, 'tools', 'build.mjs')], ['npx', 'tsc', '--noEmit', '-p', '.']):
            if subprocess.run(cmd, cwd=ROOT, shell=True).returncode:
                sys.exit('build or type-check failed')
    ok = True
    for name in names:
        if name == 'crash':
            r = subprocess.run([PY, os.path.join(T, 'crash.py')] + app, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        elif name in TESTS:
            script, timeout = TESTS[name]
            r = subprocess.run(RUN + ['--test', os.path.join(T, script), '--name', 'input-' + name, '--timeout', str(timeout), '--out', OUT] + app,
                               cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        else:
            sys.exit('no such test: %s (have: %s, crash)' % (name, ', '.join(TESTS)))
        ok &= report(name, r.returncode, r.stdout + r.stderr)
    for f in os.listdir(OUT):
        if f.endswith('.done'):
            os.remove(os.path.join(OUT, f))
    print('ALL OK' if ok else 'SOME FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
