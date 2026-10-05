"""Reviewer's run of the existing shell and input test scripts under its own profile names and
output folder (so it cannot collide with another run of tests/shell/all.py or tests/input/all.py).

  python tests/review/design_suites.py [shell] [input]
"""
import http.server
import os
import subprocess
import sys
import threading
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable

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


def run(folder, name, timeout, extra):
    out = os.path.join(HERE, 'out-design-' + folder)
    os.makedirs(out, exist_ok=True)
    cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(ROOT, 'tests', folder, name + '.js'),
           '--name', 'review-design-%s-%s' % (folder, name), '--app', 'build-review-design', '--out', out, '--timeout', str(timeout)] + extra
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    text = r.stdout + r.stderr
    log = os.path.join(out, name + '.log')
    with open(log, 'w', encoding='utf-8') as f:
        f.write(text)
    lines = text.splitlines()
    passed = sum(1 for line in lines if line.startswith('PASS '))
    bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback'))]
    extra_text = ''
    if folder == 'shell':
        pixels = subprocess.run([PY, os.path.join(ROOT, 'tests', 'shell', 'check.py'), log], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        plines = pixels.stdout.splitlines()
        extra_text = '; ' + (plines[-1] if plines else 'no pixel checks')
        bad += [line for line in plines if line.startswith('FAIL')]
    print('%s/%s rc=%d  %d checks passed%s' % (folder, name, r.returncode, passed, extra_text), flush=True)
    for line in bad:
        print('    ' + line[:400], flush=True)


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    which = sys.argv[1:] or ['shell', 'input']
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    extra = ['--env', 'VITRE_TEST_SERVER=http://127.0.0.1:%d' % server.server_address[1]]
    if 'shell' in which:
        for name, t in (('look', 300), ('states', 240), ('chrome', 300)):
            run('shell', name, t, extra)
    if 'input' in which:
        for name, t in (('keys', 420), ('actions', 300), ('omnibox', 400), ('home', 300)):
            run('input', name, t, [])
    server.shutdown()


if __name__ == '__main__':
    main()
