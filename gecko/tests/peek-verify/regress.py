"""Core and input regressions on a build (from gecko/), under this folder's profile names:

    python tests/peek-verify/regress.py [name ...] [--app=build-peek-verify] [--jobs=3]

  smoke api session          tests/core/<name>.js (smoke with VITRE_SELFTEST=1, as tests/core/all.py)
  keys actions inset edges   tests/input/<name>.js (edges = inset-edge.js)
Logs: tests/peek-verify/out/regress-<name>/.
"""
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PY = sys.executable
CORE = os.path.join(ROOT, 'tests', 'core')
INPUT = os.path.join(ROOT, 'tests', 'input')
WEB = ['--url', 'https://example.com']
TESTS = {
    'smoke': (os.path.join(CORE, 'smoke.js'), 150, ['--env', 'VITRE_SELFTEST=1'] + WEB),
    'api': (os.path.join(CORE, 'api.js'), 240, []),
    'session': (os.path.join(CORE, 'session.js'), 150, WEB),
    'keys': (os.path.join(INPUT, 'keys.js'), 420, []),
    'actions': (os.path.join(INPUT, 'actions.js'), 300, []),
    'inset': (os.path.join(INPUT, 'inset.js'), 300, []),
    'edges': (os.path.join(INPUT, 'inset-edge.js'), 400, []),
}


def main():
    names = [a for a in sys.argv[1:] if not a.startswith('--')] or list(TESTS)
    app = 'build-peek-verify'
    jobs = 3
    for a in sys.argv[1:]:
        if a.startswith('--app='):
            app = a.split('=', 1)[1]
        if a.startswith('--jobs='):
            jobs = int(a.split('=', 1)[1])

    def run(name):
        script, timeout, extra = TESTS[name]
        out = os.path.join(HERE, 'out', 'regress-' + name)
        os.makedirs(out, exist_ok=True)
        cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', script, '--name', 'pkvr-' + name + '-z', '--app', app,
               '--out', out, '--timeout', str(timeout)] + extra
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        text = r.stdout + r.stderr
        with open(os.path.join(out, 'run.txt'), 'w', encoding='utf-8') as f:
            f.write(text)
        return name, r.returncode, text

    failed = []
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for name, code, text in pool.map(run, names):
            lines = text.splitlines()
            passed = sum(1 for line in lines if line.startswith('PASS '))
            bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback'))]
            print('%-9s %s  (%d checks passed)' % (name, 'ok' if code == 0 else 'FAILED', passed), flush=True)
            for line in bad:
                print('    ' + line[:600], flush=True)
            if code:
                failed.append(name)
    print('FAILED: ' + ', '.join(failed) if failed else 'all passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
