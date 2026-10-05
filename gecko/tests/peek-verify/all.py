"""Adversarial verification of Peek (from gecko/):

    python tests/peek-verify/all.py [name ...] [--app=build-x] [--jobs=N]

Runs the feature's own suite (tests/peek/<name>.js, unchanged) under this folder's profile names,
plus the attack scripts in this folder:

  open hop promote esc real permission fullscreen session extras
             tests/peek/<name>.js (see tests/peek/all.py)
  ladder     Esc / Esc Esc / Ctrl+W ladders against find, menus, the address field and a panel;
             keyboard-only use (Ctrl+Q, Shift+Enter, F6, Tab into the header); rapid repeated input
             (Shift+click storms, Esc storms, promote during open/close); service misuse
  windows    a second window, a private window and a popup window; leaks when a window with an
             open and a warm peek closes (hidden tabs, inset switch list, listeners)
  scale      150 % scaling (layout.css.devPixelsPerPx at runtime): sheet geometry, header, motion
             end states, page zoom on the source tab
  pages      slow and hung pages in a peek (cover, load line, Esc, promote while loading), a dark
             page under and inside the sheet, a page that preventDefaults Shift+click
  core       interplay with the core: auto-hide bar (stays shown under a peek), F11, element full
             screen, the address field opened over a peek, page inset on promote
  idle       CPU cost when idle with a peek open and with a warm peek (timers, rAF, repaints);
             console errors over a whole open/hop/close/promote cycle
  reduced    reduced motion (ui.prefersReducedMotion=1): in place, no flight, nothing half-way
  motion     the motion at real speed, frame by frame: open 400 / close 280 / Open as tab 380 ms
  actions    page actions on a focused peek: print preview and alert() in the sheet (their Esc),
             view source, zoom, back / forward, F12
  restore    restart with a warm peek, restart right after Open as tab
Debugging: any other <name>.js in this folder runs the same way (python tests/peek-verify/all.py dbg-x).
Core and input regressions under this folder's names: python tests/peek-verify/regress.py

The local http server serves tests/peek/pages, then tests/peek-verify/pages, on 127.0.0.1 (localhost
on the same port is a second site); /slow?ms=N&page=x answers half the page, waits, then the rest;
/hang never answers. Profiles are named pkv-<name>-z; logs and captures go to
tests/peek-verify/out/<name>/.
"""
import functools
import http.server
import os
import subprocess
import sys
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PEEK = os.path.join(ROOT, 'tests', 'peek')
OUT = os.path.join(HERE, 'out')
PY = sys.executable

# name: (folder, script, timeout, extra run.py args)
TESTS = {
    'open': (PEEK, 'open.js', 240, []),
    'hop': (PEEK, 'hop.js', 180, []),
    'promote': (PEEK, 'promote.js', 240, []),
    'esc': (PEEK, 'esc.js', 200, []),
    'real': (PEEK, 'real.js', 200, []),
    'permission': (PEEK, 'permission.js', 180, []),
    'fullscreen': (PEEK, 'fullscreen.js', 180, []),
    'session': (PEEK, 'session.js', 240, []),
    'extras': (PEEK, 'extras.js', 240, []),
    'ladder': (HERE, 'ladder.js', 300, []),
    'windows': (HERE, 'windows.js', 300, []),
    'scale': (HERE, 'scale.js', 240, []),
    'pages': (HERE, 'pages.js', 300, []),
    'core': (HERE, 'core.js', 300, []),
    'idle': (HERE, 'idle.js', 240, []),
    'reduced': (HERE, 'reduced.js', 180, ['--pref', 'ui.prefersReducedMotion=1']),
    'motion': (HERE, 'motion.js', 150, []),
    'actions': (HERE, 'actions.js', 240, []),
    'restore': (HERE, 'restore.js', 300, []),
}


class Handler(http.server.SimpleHTTPRequestHandler):
    """tests/peek-verify/pages first, then tests/peek/pages; /slow and /hang."""

    def log_message(self, *args):
        pass

    def end_headers(self):
        # no-cache (revalidate), not no-store: no-store pages are kept out of the bfcache.
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def translate_path(self, path):
        leaf = path.split('?', 1)[0].split('#', 1)[0].lstrip('/')
        mine = os.path.join(HERE, 'pages', leaf)
        if leaf and os.path.isfile(mine):
            return mine
        return os.path.join(PEEK, 'pages', leaf)

    def do_GET(self):
        if self.path.startswith('/hang'):
            time.sleep(150)
            return
        if self.path.startswith('/slow'):
            q = dict(p.split('=', 1) for p in self.path.split('?', 1)[-1].split('&') if '=' in p)
            ms = int(q.get('ms', '3000'))
            path = self.translate_path('/' + urllib.parse.unquote(q.get('page', 'issue.html')))
            with open(path, 'rb') as f:
                body = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            half = len(body) // 2
            try:
                self.wfile.write(body[:half])
                self.wfile.flush()
                time.sleep(ms / 1000)
                self.wfile.write(body[half:])
            except OSError:
                pass
            return
        super().do_GET()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    app = 'build-peek-verify'
    jobs = 1
    for a in sys.argv[1:]:
        if a.startswith('--app='):
            app = a.split('=', 1)[1]
        if a.startswith('--jobs='):
            jobs = int(a.split('=', 1)[1])
    names = args or list(TESTS)
    for n in names:
        if n not in TESTS:
            # A one-off script in this folder (debugging): run it the same way.
            if os.path.isfile(os.path.join(HERE, n + '.js')):
                TESTS[n] = (HERE, n + '.js', 300, [])
            else:
                sys.exit('unknown test ' + n)
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:%d/' % port
    xsite = 'http://localhost:%d/' % port

    def run(name):
        folder, script, timeout, extra = TESTS[name]
        out = os.path.join(OUT, name)
        os.makedirs(out, exist_ok=True)
        cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(folder, script), '--name', 'pkv-' + name + '-z',
               '--app', app, '--url', base + 'issues.html', '--out', out, '--timeout', str(timeout),
               '--env', 'VITRE_PEEK_BASE=' + base, '--env', 'VITRE_PEEK_XSITE=' + xsite] + extra
        t0 = time.time()
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        text = r.stdout + r.stderr
        with open(os.path.join(out, 'run.txt'), 'w', encoding='utf-8') as f:
            f.write(text)
        return name, r.returncode, text, time.time() - t0

    failed = []
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for name, code, text, secs in pool.map(run, names):
            lines = text.splitlines()
            passed = sum(1 for line in lines if line.startswith('PASS '))
            bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', '[console.error]'))]
            print('%-11s %s  (%d checks passed, %ds)' % (name, 'ok' if code == 0 else 'FAILED', passed, secs), flush=True)
            for line in bad:
                print('    ' + line[:700], flush=True)
            if code:
                failed.append(name)
    httpd.shutdown()
    print('FAILED: ' + ', '.join(failed) if failed else 'all passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
