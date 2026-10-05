"""Crash recovery (from gecko/):  python tests/input/crash.py [--app build-x]

Runs tests/input/crash.js twice on one throwaway profile. Run 1 opens tabs, has the session written
and ends without quitting, so tools/run.py stops the process tree with taskkill /F (a crash as far
as Firefox can tell). Run 2 starts on the same profile with session recovery on and checks the tabs.
The harness's blank start page stays as it is, so a restored session can only come from the crash.
"""
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
NAME = 'input-crash'


def run(extra):
    cmd = [sys.executable, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(ROOT, 'tests', 'input', 'crash.js'),
           '--name', NAME, '--keep-profile', '--timeout', '120', '--pref', 'browser.sessionstore.resume_from_crash=true'] + extra
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    sys.stdout.write(r.stdout + r.stderr)
    return r.returncode


def main():
    extra = []
    if '--app' in sys.argv:
        extra = ['--app', sys.argv[sys.argv.index('--app') + 1]]
    profile = os.path.join(tempfile.gettempdir(), 'vitre-gecko-' + NAME)
    shutil.rmtree(profile, ignore_errors=True)
    try:
        print('--- run 1: open tabs, write the session, get killed')
        first = run(extra)
        print('--- run 2: start again on the same profile')
        second = run(extra)
    finally:
        link = os.path.join(profile, 'chrome', 'vitre-app')
        if os.path.lexists(link):
            try:
                os.rmdir(link)  # a junction to the build folder: unlink, never follow
            except OSError:
                pass
        if not os.path.lexists(link):
            shutil.rmtree(profile, ignore_errors=True)
    return 1 if first or second else 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
