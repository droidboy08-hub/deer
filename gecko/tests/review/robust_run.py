"""Robustness review scripts (from gecko/):  python tests/review/robust_run.py [names...] [--app build-x] [-j N]

Runs tests/review/robust-<name>.js through tools/run.py, each on its own throwaway profile, with its
captures and log in tests/review/out-robust/<name>/. Default: every script, three at a time.
  windows   second and third windows, tear-off, window.open, popup window, private window
  leaks     closed windows are collected (weak references only)
  stress    40 tabs, rapid open / close / switch / move, Firefox-side tab operations, beforeunload
  keys      native AltGr layouts, IME in the address field, hung pages, hostile page in full screen
  panels    permission prompts and Firefox panels in every window state; Esc with a panel open
  session   restart with 40 tabs, pinned tabs, a second window; a content-process crash
  pages     PDF, error pages, view-source, about: pages, a load that never ends, odd URLs
  scale     1.5x and 1.25x scaling at run time
  reveal    auto-hide and F11 with the field, focus, element full screen, quick toggles
  console   every console error of an ordinary session (compare with --stock)
Expected FAIL lines document the findings of the review; see the structured report.
"""
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = {
    'windows': (240, []),
    'leaks': (180, []),
    'stress': (300, []),
    'keys': (300, []),
    'panels': (300, ['--url', 'https://example.com']),
    'session': (400, []),
    'pages': (300, []),
    'scale': (240, []),
    'reveal': (240, []),
    'console': (200, ['--url', 'https://example.com']),
}


def run(name, app):
    timeout, extra = SCRIPTS[name]
    out = os.path.join(HERE, 'out-robust', name)
    cmd = [sys.executable, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, 'robust-%s.js' % name),
           '--name', 'review-robust-' + name, '--out', out, '--timeout', str(timeout)] + extra
    if app:
        cmd += ['--app', app]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    text = r.stdout + r.stderr
    with open(os.path.join(out, 'run.txt'), 'w', encoding='utf-8') as f:
        f.write(text)
    passed = sum(1 for l in text.splitlines() if l.startswith('PASS '))
    failed = [l for l in text.splitlines() if l.startswith('FAIL ') or l.startswith('ERROR') or l.startswith('[run] timed out')]
    return name, r.returncode, passed, failed


def main():
    args = sys.argv[1:]
    app = None
    jobs = 3
    names = []
    i = 0
    while i < len(args):
        if args[i] == '--app':
            app = args[i + 1]
            i += 2
        elif args[i] == '-j':
            jobs = int(args[i + 1])
            i += 2
        else:
            names.append(args[i])
            i += 1
    names = names or list(SCRIPTS)
    for n in names:
        if n not in SCRIPTS:
            raise SystemExit('unknown script ' + n)
    os.makedirs(os.path.join(HERE, 'out-robust'), exist_ok=True)
    results = []
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for res in pool.map(lambda n: run(n, app), names):
            results.append(res)
            name, code, passed, failed = res
            print('%-8s exit %d  pass %d  fail %d' % (name, code, passed, len(failed)))
            for l in failed:
                print('    ' + l[:220])
    return 1 if any(r[1] for r in results) else 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
