"""Adversarial verification of find in page (from gecko/):

    python tests/find-verify/all.py [name ...] [--app build-x] [--jobs N] [--tag t]

Runs the find feature's own suites (tests/find/*.js) under this folder's profile names, plus the
attack scripts in this folder:

  core contexts peek motion reduced   tests/find/<script>.js, unchanged (see tests/find/all.py)
  ladder     Esc and close ladders, keyboard-only use, rapid input, service misuse, Home and full screen
  windows    a second window, a private window and a popup window, each with its own find; leaks
             and the idle poll after windows and peeks close
  scale      150 % scaling (layout.css.devPixelsPerPx) and page zoom: the face, the ring, the guard
  pages      slow and hung pages, a page that keeps Ctrl+F, a dark page in a light window, frames
             that navigate, a page that removes the match
  restore    find state across a restart with session restore (find is not restored, nothing breaks)
  idle       CPU cost when idle with find open and parked (timers, polls, repaints)
  counts     the counter under bursts of Enter, held Enter, F3, match case flips and retyping on a page
             with a cross-site frame: it must settle on the true total every time
  mouse      clicks in the page and on the face, the favicon's URL tooltip, a right-click and the ring,
             and the face in forced colours

The local http server serves tests/find/pages and tests/find-verify/pages on 127.0.0.1 (localhost on
the same port is a second site); /slow?ms=N delays a response, /hang never answers. Profiles are named
fverify-[<tag>-]<name>-x; logs and captures go to tests/find-verify/out/[<tag>-]<name>/ (--tag runs two
builds side by side, e.g. --tag solo --app build-find-verify-solo for a build with find alone).
"""
import functools
import http.server
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
FIND = os.path.join(ROOT, 'tests', 'find')
OUT = os.path.join(HERE, 'out')
PY = sys.executable

TESTS = {
    'core': (FIND, 'core.js', 300),
    'contexts': (FIND, 'contexts.js', 300),
    'peek': (FIND, 'peek.js', 180),
    'motion': (FIND, 'motion.js', 120),
    'reduced': (FIND, 'motion.js', 120, ['--pref', 'ui.prefersReducedMotion=1']),
    'ladder': (HERE, 'ladder.js', 300),
    'windows': (HERE, 'windows.js', 300),
    'scale': (HERE, 'scale.js', 240),
    'pages': (HERE, 'pages.js', 300),
    'restore': (HERE, 'restore.js', 240),
    'idle': (HERE, 'idle.js', 180),
    'mouse': (HERE, 'mouse.js', 180),
    'counts': (HERE, 'counts.js', 300),
}


class Handler(http.server.SimpleHTTPRequestHandler):
    """Serves tests/find/pages, then tests/find-verify/pages; /slow?ms=N&page=x and /hang."""

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def translate_path(self, path):
        leaf = path.split('?', 1)[0].split('#', 1)[0].lstrip('/')
        mine = os.path.join(HERE, 'pages', leaf)
        if leaf and os.path.isfile(mine):
            return mine
        return os.path.join(FIND, 'pages', leaf)

    def do_GET(self):
        if self.path.split('?', 1)[0] == '/hang':
            # Never answer (the connection stays open until the browser gives up or quits).
            time.sleep(120)
            return
        if self.path.split('?', 1)[0] == '/slow':
            q = dict(p.split('=', 1) for p in self.path.split('?', 1)[-1].split('&') if '=' in p)
            ms = int(q.get('ms', '3000'))
            page = q.get('page', 'article.html')
            path = self.translate_path('/' + page)
            with open(path, 'rb') as f:
                body = f.read()
            # Send the first half, wait, then the rest: the page is "loading" meanwhile.
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
    args = sys.argv[1:]
    app = None
    jobs = 1
    if '--app' in args:
        i = args.index('--app')
        app = args[i + 1]
        del args[i:i + 2]
    tag = ''
    if '--tag' in args:
        i = args.index('--tag')
        tag = args[i + 1] + '-'
        del args[i:i + 2]
    if '--jobs' in args:
        i = args.index('--jobs')
        jobs = int(args[i + 1])
        del args[i:i + 2]
    names = args or list(TESTS)
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    def run(name):
        folder, script, timeout, *extra = TESTS[name]
        cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(folder, script), '--name', 'fverify-' + tag + name + '-x',
               '--out', os.path.join(OUT, tag + name), '--timeout', str(timeout), '--env', 'FIND_PORT=%d' % port,
               '--env', 'FIND_PAGES=' + os.path.join(FIND, 'pages'), '--env', 'FV_PAGES=' + os.path.join(HERE, 'pages')]
        if extra:
            cmd += extra[0]
        if app:
            cmd += ['--app', app]
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        return name, r.returncode, r.stdout + r.stderr

    failed = []
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        for name, code, text in pool.map(run, names):
            print('==', name, flush=True)
            print(text, flush=True)
            if code:
                failed.append(name)
    httpd.shutdown()
    print('FAILED: ' + ', '.join(failed) if failed else 'all passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
