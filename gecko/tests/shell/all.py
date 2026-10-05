"""Run the shell and glass tests (from gecko/):  python tests/shell/all.py [look] [states] [chrome] [--app build-x]

  look     the bar over a busy real page, a white page and a dark page with 1, 3 and 12 tabs at
           1280x800 and 900x700; geometry and tokens against the design; lens filters
  states   hover, tooltips, motion, favicon plates, many tabs, close-button setting, load line
  chrome   caption hit-testing and buttons, resize borders, window move from the bar, maximized,
           full screen, auto-hide, second / private / popup window, navigation, notification bars,
           popup anchors
Each script runs through tools/run.py; its output is kept as tests/shell/out/<name>.log and
check.py then measures the glass in the captures taken over striped pages (MEASURE lines).
A small local server gives the navigation test a page that takes 1.5 s to answer.
Afterwards montage.py writes contact sheets (sheet-*.png) and 3x crops (zoom-*.png) of the captures.
"""
import http.server
import os
import subprocess
import sys
import threading
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
PY = sys.executable

STRIPES = ("<!doctype html><meta charset=utf-8><title>Slow stripes</title>"
           "<body style='margin:0;height:3000px;background:repeating-linear-gradient(90deg,#113 0 3px,#dde 3px 6px)'>")
# Pixel checks (PASS lines of check.py) each script must produce: one per measured capture.
PIXEL_PASSES = {'look': 8, 'states': 3, 'chrome': 16}


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
            pass  # the test pressed Stop

    def log_message(self, *args):
        pass


def run(name, timeout, extra):
    cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, name + '.js'), '--name', 'shell-' + name,
           '--out', OUT, '--timeout', str(timeout)] + extra
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    text = r.stdout + r.stderr
    log = os.path.join(OUT, name + '.log')
    with open(log, 'w', encoding='utf-8') as f:
        f.write(text)
    lines = text.splitlines()
    passed = sum(1 for line in lines if line.startswith('PASS '))
    bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', '[console.error]')) or 'no window found' in line]
    pixels = subprocess.run([PY, os.path.join(HERE, 'check.py'), log], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    with open(log, 'a', encoding='utf-8') as f:
        f.write(pixels.stdout + pixels.stderr)
    plines = pixels.stdout.splitlines()
    pixel_passes = sum(1 for line in plines if line.startswith('PASS '))
    ok = r.returncode == 0 and pixels.returncode == 0
    # Every measured capture must have been checked: a run that measured fewer shapes than the script
    # writes (a capture missing, a stale frame) is a failure even when nothing it did measure failed.
    expected = PIXEL_PASSES.get(name)
    if expected is not None and pixel_passes != expected:
        ok = False
        bad.append('FAIL pixel checks: %d passed, the script writes %d measured captures' % (pixel_passes, expected))
    print('%-7s %s  (%d checks passed; %s)' % (name, 'ok' if ok else 'FAILED', passed, plines[-1] if plines else 'no pixel checks'))
    for line in bad + [line for line in plines if line.startswith('FAIL')] + pixels.stderr.splitlines():
        print('    ' + line)
    return ok


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    extra = []
    if '--app' in sys.argv:
        extra += ['--app', sys.argv[sys.argv.index('--app') + 1]]
        args = [a for a in args if a != extra[1]]
    names = args or ['look', 'states', 'chrome']
    os.makedirs(OUT, exist_ok=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    extra += ['--env', 'VITRE_TEST_SERVER=http://127.0.0.1:%d' % server.server_address[1]]
    timeouts = {'look': 300, 'states': 240, 'chrome': 300}
    ok = True
    for name in names:
        ok &= run(name, timeouts.get(name, 240), extra)
    server.shutdown()
    subprocess.run([PY, os.path.join(HERE, 'montage.py')], cwd=ROOT, capture_output=True)
    print('ALL OK' if ok else 'SOME FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
