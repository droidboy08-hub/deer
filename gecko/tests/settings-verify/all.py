"""The Settings verifier's tests, one after the other (from gecko/):  python tests/settings-verify/all.py [names] [--no-build]

  ladder       the panel is the topmost surface: page keys (reload, zoom, print, Ctrl+Q...) never act
               on the page under it, Esc closes it over an alert or print preview, the Esc and Ctrl+W
               ladders inside it, rapid and repeated input, element full screen
  keyboard     everything by keys alone: sidebar, every kind of control, focus trap, Find a setting,
               rebind and Reset, Caret browsing, Home's Background popover
  windows      a second window following live, a private window, a popup window (Settings goes to the
               normal window), windows closed with the panel open are collected
  scale        150 % and 125 % scaling, F11, auto-hide, the address field, dark and light pages in both
               modes, a real site (example.com), idle cost
  restart      settings changed through the panel survive a restart and work after it
  hung         a load that never ends and a hung page
  a11y         forced colours, reduced motion, the lens mid-open, About's version, accessible names
  integration  with every module built: registered pages, Downloads hand-off, Peek, find, Ctrl+Tab

The first seven run on build-settings-verify (node tools/build.mjs --out=build-settings-verify
--modules=settings), integration on build-settings-verify-full (every module); --no-build skips the
builds. Captures and logs: tests/settings-verify/out/<name>/. The builder's own suite is
tests/settings/all.py.
"""
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PY = sys.executable
T = os.path.join(ROOT, 'tests', 'settings-verify')

TESTS = [
    ('ladder', 'build-settings-verify', 260, []),
    ('keyboard', 'build-settings-verify', 260, []),
    ('windows', 'build-settings-verify', 280, []),
    ('scale', 'build-settings-verify', 320, []),
    ('restart', 'build-settings-verify', 320, []),
    ('hung', 'build-settings-verify', 260, []),
    ('a11y', 'build-settings-verify', 260, []),
    ('integration', 'build-settings-verify-full', 320, []),
]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    picked = [t for t in TESTS if not args or t[0] in args]
    if '--no-build' not in sys.argv:
        for out, mods in (('build-settings-verify', ' --modules=settings'), ('build-settings-verify-full', '')):
            if not any(t[1] == out for t in picked):
                continue
            r = subprocess.run('node tools/build.mjs --out=%s%s' % (out, mods), cwd=ROOT, shell=True, capture_output=True, text=True)
            text = (r.stdout + r.stderr).strip()
            print(text.splitlines()[-1][:120] if text else 'build: no output')
            if r.returncode:
                print(text)
                return 1
    ok = True
    for name, app, timeout, extra in picked:
        cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--app', app, '--test', os.path.join(T, name + '.js'), '--name', 'settings-verify-' + name,
               '--timeout', str(timeout), '--out', os.path.join(T, 'out', name)] + extra
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        lines = (r.stdout + r.stderr).splitlines()
        passed = sum(1 for line in lines if line.startswith('PASS '))
        bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback'))]
        good = r.returncode == 0
        ok &= good
        print('%-12s %s  (%d checks passed)' % (name, 'ok' if good else 'FAILED', passed))
        for line in bad:
            print('    ' + line[:500])
    print('all ok' if ok else 'FAILURES')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
