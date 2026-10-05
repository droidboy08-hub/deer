"""Run every core test, one after the other (from gecko/):  python tests/core/all.py [--fast]

  smoke      shell hidden, Browser API, tab model, page actor, settings broadcast, 2nd + private window
  shell      caption hit-testing and buttons, bar clicks, address field, popup anchors, full screen
  api        the module hooks (openLink, openHidden/adopt, events, luma, page links...), the error
             page card, prompt accent, PDF viewer, paint sampling, lens cache, rebind and actor guards
  restart    settings survive an in-place restart
  session    session restore with deferred tabs
  adopt      VitreShell.adopt() on a window that was open before the package was registered
  app        the smoke test again from a separate build folder (--app), as parallel authors run it
  noboot     Deer starts with no test hook at all (screenshot from outside)
  brand      the name a person sees is Deer everywhere: titles, taskbar id, brand strings, Deer's
             layer, every Settings page, the Downloads panel
  launcher   launch guard, launcher\\Deer.exe / Deer.cmd, single instance, no Start Menu writes
--fast skips app and launcher. The IDM report is separate: python tests/core/idm.py --control
Each run prints only its failures and a summary line; full logs are in tests/core/out/.
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PY = sys.executable
RUN = [PY, os.path.join(ROOT, 'tools', 'run.py')]
T = os.path.join(ROOT, 'tests', 'core')
OUT = os.path.join(T, 'out')


def run(name, cmd, extra_checks=None):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    lines = (r.stdout + r.stderr).splitlines()
    ok = r.returncode == 0
    if extra_checks:
        for label, good in extra_checks(lines):
            lines.append(('PASS ' if good else 'FAIL ') + label)
            ok &= good
    passed = sum(1 for line in lines if line.startswith('PASS '))
    bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback')) or 'no window found' in line]
    print('%-9s %s  (%d checks passed)' % (name, 'ok' if ok else 'FAILED', passed))
    for line in bad:
        print('    ' + line)
    return ok


def noboot_checks(lines):
    """A run with no test hook can only be judged from outside: the window's title and taskbar id
    (printed by --identity) and the capture, whose top-left corner must be the page, not Firefox's
    toolbar (its Back / Forward icons are dark pixels there; Deer's bar is centred and the page shows
    through at the corner, white on example.com)."""
    out = []
    cap = [line for line in lines if line.startswith('[capture] noboot.png')]
    line = cap[0] if cap else ''
    out.append(("noboot: window title ends with 'Deer' and the taskbar id is Deer.Browser  %s" % line[:160],
                "Deer'" in line and "taskbar-id='Deer.Browser'" in line))
    png = os.path.join(OUT, 'noboot.png')
    try:
        from PIL import Image
        im = Image.open(png).convert('RGB')
        px = im.load()
        darkest = min(px[x, y][0] + px[x, y][1] + px[x, y][2] for x in range(12, 300, 3) for y in range(10, 60, 2))
        toolbar = darkest < 3 * 200
        out.append(('noboot: the top-left corner of the capture is the page, not a toolbar (darkest sample %d/765)' % darkest, not toolbar))
    except Exception as e:  # noqa: BLE001
        out.append(('noboot: capture readable (%s)' % e, False))
    return out


def main():
    fast = '--fast' in sys.argv
    ok = True
    for cmd in (['node', os.path.join(ROOT, 'tools', 'build.mjs')], ['npx', 'tsc', '--noEmit', '-p', '.']):
        r = subprocess.run(cmd, cwd=ROOT, shell=True)
        if r.returncode:
            sys.exit('build or type-check failed')
    web = ['--url', 'https://example.com']
    ok &= run('smoke', RUN + ['--test', os.path.join(T, 'smoke.js'), '--name', 'core-smoke', '--env', 'VITRE_SELFTEST=1', '--timeout', '150'] + web)
    ok &= run('shell', RUN + ['--test', os.path.join(T, 'shell.js'), '--name', 'core-shell', '--timeout', '150'] + web)
    ok &= run('api', RUN + ['--test', os.path.join(T, 'api.js'), '--name', 'core-api', '--timeout', '240'])
    ok &= run('restart', RUN + ['--test', os.path.join(T, 'restart.js'), '--name', 'core-restart', '--timeout', '120'])
    ok &= run('session', RUN + ['--test', os.path.join(T, 'session.js'), '--name', 'core-session', '--timeout', '150'] + web)
    ok &= run('adopt', RUN + ['--stock', '--test', os.path.join(T, 'adopt.js'), '--name', 'core-adopt', '--timeout', '90'] + web)
    ok &= run('noboot', RUN + ['--name', 'core-noboot', '--shoot', 'noboot:9', '--identity', '--out', OUT, '--timeout', '40'] + web, noboot_checks)
    ok &= run('brand', RUN + ['--test', os.path.join(T, 'brand.js'), '--name', 'core-brand', '--timeout', '150'])
    if not fast:
        build = os.path.join(ROOT, 'build-coretest')
        subprocess.run(['node', os.path.join(ROOT, 'tools', 'build.mjs'), '--out=build-coretest'], cwd=ROOT, shell=True, capture_output=True)
        ok &= run('app', RUN + ['--test', os.path.join(T, 'smoke.js'), '--name', 'core-smoke-app', '--app', 'build-coretest', '--env', 'VITRE_SELFTEST=1', '--timeout', '150'] + web)
        still_there = os.path.exists(os.path.join(build, 'chrome.manifest'))
        print('          build folder untouched by the profile clean-up: %s' % still_there)
        ok &= still_there
        shutil.rmtree(build, ignore_errors=True)
        ok &= run('launcher', [PY, os.path.join(T, 'launcher.py')])
    print('ALL OK' if ok else 'SOME FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
