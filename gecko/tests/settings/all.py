"""Run every Settings test, one after the other (from gecko/):  python tests/settings/all.py [--no-build]

  pages    every page captured (dark and light), controls wired live, Find a setting, the page
           registry (the 'settings' service), the panel's keys, a small window
  rebind   Keyboard shortcuts: capture with refusals, the new key working in the key router, Reset
  clear    Clear browsing data through Firefox's Sanitizer: the last hour, then all time
  picker   Home's background through the REAL Windows file dialog, Home's Background popover, and
           the downloads folder through the real folder dialog
  appicon  Appearance › App icon: the tiles, open and new windows switching icon, a test shortcut
           following (never a real one)

The module is built alone into build-settings (node tools/build.mjs --out=build-settings
--modules=settings) so other authors' half-written modules cannot get in the way; --no-build skips it.
Each run prints only its failures and a summary line; logs and captures are in tests/settings/out/.
"""
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PY = sys.executable
RUN = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--app', 'build-settings']
T = os.path.join(ROOT, 'tests', 'settings')

TESTS = [
    ('pages', 'settings-pages', 260),
    ('rebind', 'settings-rebind', 200),
    ('clear', 'settings-clear', 200),
    ('picker', 'settings-picker', 240),
    ('appicon', 'settings-appicon', 160),
]


def main():
    if '--no-build' not in sys.argv:
        r = subprocess.run('node tools/build.mjs --out=build-settings --modules=settings', cwd=ROOT, shell=True, capture_output=True, text=True)
        print((r.stdout + r.stderr).strip().splitlines()[-1] if (r.stdout + r.stderr).strip() else 'build: no output')
        if r.returncode != 0:
            print(r.stdout + r.stderr)
            return 1
    ok = True
    for script, name, timeout in TESTS:
        r = subprocess.run(RUN + ['--test', os.path.join(T, script + '.js'), '--name', name, '--timeout', str(timeout)], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        lines = (r.stdout + r.stderr).splitlines()
        passed = sum(1 for line in lines if line.startswith('PASS '))
        bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', '[console.error]'))]
        good = r.returncode == 0
        ok &= good
        print('%-7s %s  (%d checks passed)' % (script, 'ok' if good else 'FAILED', passed))
        for line in bad:
            print('    ' + line)
    print('all ok' if ok else 'FAILURES')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
