"""Code-review run of the product test set (reviewer's own; not part of the product tests).

  python tests/review/code_run.py [core] [shell] [input] [extra]

Runs the same scripts as tests/core/all.py, tests/shell/all.py and tests/input/all.py, but against
build-review-code, with profile names prefixed "rvcode-" and one output folder per script under
tests/review/out-code/, so it cannot collide with another reviewer running the stock runners
(tools/run.py keeps log.txt and *.done markers in the output folder, which two runs must not share).
"""
import http.server
import os
import subprocess
import sys
import threading
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out-code')
PY = sys.executable
APP = 'build-review-code'
RUN = [PY, os.path.join(ROOT, 'tools', 'run.py')]

STRIPES = ("<!doctype html><meta charset=utf-8><title>Slow stripes</title>"
           "<body style='margin:0;height:3000px;background:repeating-linear-gradient(90deg,#113 0 3px,#dde 3px 6px)'>")


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/slow'):
            time.sleep(1.5)
        body = STRIPES.encode()
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass

    def log_message(self, *args):
        pass


def run(suite, name, script, timeout, extra, pixels=False):
    out = os.path.join(OUT, '%s-%s' % (suite, name))
    os.makedirs(out, exist_ok=True)
    cmd = RUN + ['--name', 'rvcode-%s-%s' % (suite, name), '--out', out, '--timeout', str(timeout), '--app', APP] + extra
    if script:
        cmd += ['--test', os.path.join(ROOT, 'tests', suite, script)]
    started = time.time()
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    text = r.stdout + r.stderr
    log = os.path.join(out, 'run.log')
    with open(log, 'w', encoding='utf-8') as f:
        f.write(text)
    lines = text.splitlines()
    passed = sum(1 for line in lines if line.startswith('PASS '))
    bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', 'SKIP', 'NOTE', '[console.error]')) or 'no window found' in line]
    ok = r.returncode == 0
    tail = ''
    if pixels:
        p = subprocess.run([PY, os.path.join(ROOT, 'tests', 'shell', 'check.py'), log], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        plines = p.stdout.splitlines()
        ok = ok and p.returncode == 0
        tail = '; pixels: %s' % (plines[-1] if plines else 'none')
        bad += [line for line in plines if line.startswith('FAIL')] + p.stderr.splitlines()
    print('%-6s %-9s %s  (%d checks passed, %d s%s)' % (suite, name, 'ok' if ok else 'FAILED', passed, time.time() - started, tail), flush=True)
    for line in bad:
        print('    ' + line[:500], flush=True)
    return ok


def main():
    want = [a for a in sys.argv[1:] if not a.startswith('--')] or ['core', 'shell', 'input']
    os.makedirs(OUT, exist_ok=True)
    web = ['--url', 'https://example.com']
    ok = True
    if 'core' in want:
        ok &= run('core', 'smoke', 'smoke.js', 150, ['--env', 'VITRE_SELFTEST=1'] + web)
        ok &= run('core', 'shell', 'shell.js', 150, web)
        ok &= run('core', 'restart', 'restart.js', 120, [])
        ok &= run('core', 'session', 'session.js', 150, web)
        ok &= run('core', 'adopt', 'adopt.js', 90, ['--stock'] + web)
        ok &= run('core', 'noboot', None, 40, ['--shoot', 'noboot:9'] + web)
    if 'shell' in want:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        env = ['--env', 'VITRE_TEST_SERVER=http://127.0.0.1:%d' % server.server_address[1]]
        for name, timeout in (('look', 300), ('states', 240), ('chrome', 300)):
            ok &= run('shell', name, name + '.js', timeout, env, pixels=True)
        server.shutdown()
    if 'input' in want:
        for name, timeout in (('keys', 420), ('actions', 300), ('omnibox', 400), ('home', 300), ('restart', 200)):
            ok &= run('input', name, name + '.js', timeout, [])
    if 'extra' in want:
        for script in sys.argv[1:]:
            if script.endswith('.js'):
                ok &= run('review', script[:-3], script, 240, [])
    print('ALL OK' if ok else 'SOME FAILED', flush=True)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
