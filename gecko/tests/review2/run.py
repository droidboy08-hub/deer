"""Robustness review 2 (the integrated app, every feature module), from gecko/:

    python tests/review2/run.py [name ...] [--app build-x] [--no-build] [-j N] [--stock]

  allopen    every feature open at once in one window (peek + find in it + menu, Downloads, Settings,
             switcher, address field); the Esc and Ctrl+W ladders unwind; random rapid input over
             all of them; nothing left behind (root classes, layers, holds)
  windows    private and popup windows with each feature; closing windows mid-peek, mid-find, with
             a menu / Settings / Downloads / switcher open and a download running in it
  session    restart with 40 tabs, an open + a warm peek, find open, a download running, the switcher
             and Settings open, a second and a private window; then a content-process crash under a
             peek, under find and under a menu
  hung       a hung page (busy loop) and pages that never answer: every feature still works in the
             window; peek / find / switcher on them; closing them
  fullscreen element full screen and F11 with each feature open, and features opened in them
  scale      150 % scaling (devPixelsPerPx 1.5) with every feature open: captures + geometry
  leaks      windows that used every feature are collected; singleton listener counts stay flat
  edges      the quit prompt over the switcher / Settings / a peek; a peek's page crashing; a menu
             over a crashed page; the tab under a peek closed or torn off; a setting changed in
             another window while a surface is open; an extension popup when Vitre's surfaces open
  idle       idle CPU of every process with every feature installed (states: page, Home, after use,
             auto-hide, a finished download); --stock runs the same script on Firefox's own UI

Probes (run by file name, 180 s): probe-dlpanel.js (the Downloads panel and Settings at 7 window
sizes: overlapping or cut-off text), probe-busy-esc.js (focus and Esc when a panel opens over a hung
page), probe-popup.js (window.open with features under the product's restriction pref).

The default build is build-review2-robustness (every module), built first unless --no-build.
A local HTTP server (127.0.0.1 and localhost as a second site) serves generated pages:
  /p/<name>?bg=&n=        a page with "glass" text and n links (/p/<name>-<i>)
  /slow?ms=&name=         answers after ms
  /hang                   never answers (until the run ends)
  /busy?ms=               a page whose script then blocks its process for ms
  /file?size=&rate=&name= a file of `size` bytes at `rate` bytes/s per connection, with Range, ETag
  /opener?target=         a button (#pop) that window.open()s a popup window
Downloads go to %TEMP%/vitre-review2/<name> (vitre.downloadsFolder). Logs and captures:
tests/review2/out/<name>/ (log.txt, run.txt, *.png). A FAIL line documents a finding.
"""
import functools
import http.server
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PY = sys.executable
OUT = os.path.join(HERE, 'out')
EXT = os.path.join(ROOT, 'tests', 'extensions')
STOP = threading.Event()

TESTS = {
    'allopen': ('allopen.js', 420, []),
    'windows': ('windows.js', 420, []),
    'session': ('session.js', 600, []),
    'hung': ('hung.js', 420, []),
    'fullscreen': ('fullscreen.js', 420, ['--pref', 'full-screen-api.allow-trusted-requests-only=false',
                                          '--pref', 'full-screen-api.transition-duration.enter=0 0',
                                          '--pref', 'full-screen-api.transition-duration.leave=0 0',
                                          '--pref', 'full-screen-api.warning.timeout=0']),
    'scale': ('scale.js', 300, ['--pref', 'layout.css.devPixelsPerPx=1.5']),
    'leaks': ('leaks.js', 800, []),
    'idle': ('idle.js', 420, []),
    'edges': ('edges.js', 420, []),
}

BLOCK = bytes(((i * 7) + (i >> 8)) & 255 for i in range(65536))


def page(title, body, bg='#f4f1ea'):
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><title>%s</title>'
            '<body style="margin:0;background:%s;font:17px/1.6 Segoe UI,sans-serif;color:#1b1b1f">'
            '<main style="max-width:720px;margin:0 auto;padding:32px">%s</main></body></html>') % (title, bg, body)


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def log_message(self, *args):
        pass

    def send_body(self, body, ctype='text/html; charset=utf-8', code=200, extra=None):
        data = body.encode('utf-8') if isinstance(body, str) else body
        try:
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(data)
        except OSError:
            pass

    def do_HEAD(self):  # noqa: N802
        self.do_GET()

    def do_GET(self):  # noqa: N802
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        path = u.path
        if path == '/hang':
            # Never answer (the connection stays open until the run ends).
            while not STOP.is_set():
                time.sleep(0.25)
            return
        if path == '/slow':
            ms = int(q.get('ms', '3000'))
            end = time.time() + ms / 1000
            while time.time() < end and not STOP.is_set():
                time.sleep(0.05)
            name = q.get('name', 'Slow page')
            return self.send_body(page(name, '<h1>%s</h1><p>This glass page took %d ms to answer.</p>' % (name, ms)))
        if path == '/busy':
            ms = int(q.get('ms', '20000'))
            body = ('<h1>Busy page</h1><p id=s>glass glass glass</p><p><a id=l href="/p/after-busy">a link</a></p>'
                    '<script>addEventListener("load",()=>setTimeout(()=>{document.title="Busy now";'
                    'const end=Date.now()+%d;while(Date.now()<end){}document.title="Busy done"},400))</script>') % ms
            return self.send_body(page('Busy page', body))
        if path == '/file':
            return self.file(q)
        if path == '/opener':
            target = q.get('target', '/p/popup-page')
            body = ('<h1>Opener</h1><p><button id="pop" style="font-size:20px;padding:12px 24px" '
                    'onclick="window.open(%r, \'pop\', \'popup,width=560,height=460\')">Open a popup</button></p>'
                    '<p>glass glass</p>') % target
            return self.send_body(page('Opener', body))
        if path.startswith('/p/'):
            name = path[3:] or 'page'
            n = int(q.get('n', '6'))
            bg = q.get('bg', '#f4f1ea')
            links = ''.join('<li><a id="a%d" href="/p/%s-%d">Link %d to %s-%d</a></li>' % (i, name, i, i, name, i) for i in range(n))
            text = ''.join('<p>Paragraph %d of %s. The glass ribbon cools in the lehr; glass carries no stress.</p>' % (i, name) for i in range(int(q.get('paras', '12'))))
            body = ('<h1 id="title">%s</h1><ul id="links">%s</ul>'
                    '<p><a id="dl" href="/file?size=%s&rate=%s&name=%s.bin">Download %s.bin</a></p>%s'
                    '<p><input id="field" value="text field"></p>') % (
                name, links, q.get('size', '200000'), q.get('rate', '400000'), name, name, text)
            return self.send_body(page(name, body, bg))
        return self.send_body('not found', 'text/plain', 404)

    def file(self, q):
        size = int(q.get('size', '1000000'))
        rate = int(q.get('rate', '200000'))
        name = re.sub(r'[^\w.-]', '_', q.get('name', 'file.bin'))
        start, end = 0, size - 1
        code = 200
        rng = self.headers.get('Range')
        if rng:
            m = re.match(r'bytes=(\d*)-(\d*)', rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                elif m.group(2):
                    start = max(0, size - int(m.group(2)))
                code = 206
        if start > end or start >= size:
            try:
                self.send_response(416)
                self.send_header('Content-Range', 'bytes */%d' % size)
                self.send_header('Content-Length', '0')
                self.end_headers()
            except OSError:
                pass
            return
        length = end - start + 1
        try:
            self.send_response(code)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(length))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('ETag', '"r2-%d"' % size)
            self.send_header('Last-Modified', 'Wed, 01 Oct 2025 10:00:00 GMT')
            self.send_header('Content-Disposition', 'attachment; filename="%s"' % name)
            if code == 206:
                self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
            self.end_headers()
            if self.command == 'HEAD':
                return
            pos = start
            chunk = 16384
            t0 = time.time()
            sent = 0
            while pos <= end and not STOP.is_set():
                n = min(chunk, end - pos + 1)
                off = pos % 65536
                piece = (BLOCK[off:] + BLOCK)[:n] if off + n > 65536 else BLOCK[off:off + n]
                self.wfile.write(piece)
                pos += n
                sent += n
                due = t0 + sent / rate
                wait = due - time.time()
                if wait > 0:
                    time.sleep(wait)
        except OSError:
            pass


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def run(name, app, port, stock):
    if name.endswith('.js'):  # any other script of this folder (probes): 180 s, no extra options
        script, timeout, extra = name, 180, []
        name = name[:-3]
    else:
        script, timeout, extra = TESTS[name]
    label = name + ('-stock' if stock else '')
    out = os.path.join(OUT, label)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out, exist_ok=True)
    dl = os.path.join(tempfile.gettempdir(), 'vitre-review2', label)
    shutil.rmtree(dl, ignore_errors=True)
    os.makedirs(dl, exist_ok=True)
    cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, script),
           '--name', 'review2-robustness-' + label, '--out', out, '--timeout', str(timeout),
           '--env', 'R2_BASE=http://127.0.0.1:%d/' % port, '--env', 'R2_XSITE=http://localhost:%d/' % port,
           '--env', 'R2_DL=' + dl, '--env', 'R2_EXT=' + os.path.join(EXT, 'build', 'ext'),
           '--pref', 'vitre.downloadsFolder=' + dl,
           '--pref', 'media.gmp-manager.updateEnabled=false', '--pref', 'media.gmp-manager.url=http://127.0.0.1:9/none',
           # Slow-script notice after 10 s (Firefox's default); the hung test waits for it.
           '--pref', 'dom.max_script_run_time=10'] + extra
    if stock:
        cmd += ['--stock', '--env', 'R2_STOCK=1']
    else:
        cmd += ['--app', app]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    text = r.stdout + r.stderr
    with open(os.path.join(out, 'run.txt'), 'w', encoding='utf-8') as f:
        f.write(text)
    lines = text.splitlines()
    passed = sum(1 for line in lines if line.startswith('PASS '))
    bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', '[console.error]')) or 'no window found' in line]
    return label, r.returncode == 0 and not bad, passed, bad


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    args = sys.argv[1:]
    app = 'build-review2-robustness'
    jobs = 2
    build = True
    stock = False
    names = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == '--app':
            app = args[i + 1]
            i += 1
        elif a.startswith('--app='):
            app = a.split('=', 1)[1]
        elif a in ('-j', '--jobs'):
            jobs = int(args[i + 1])
            i += 1
        elif a == '--no-build':
            build = False
        elif a == '--stock':
            stock = True
        else:
            names.append(a)
        i += 1
    names = names or list(TESTS)
    for n in names:
        if n not in TESTS and not (n.endswith('.js') and os.path.exists(os.path.join(HERE, n))):
            sys.exit('unknown test %s (have: %s)' % (n, ', '.join(TESTS)))
    if build and app == 'build-review2-robustness' and not stock:
        subprocess.run(['node', os.path.join(ROOT, 'tools', 'build.mjs'), '--out=build-review2-robustness'], cwd=ROOT, check=True)
    if not os.path.exists(os.path.join(EXT, 'build', 'ext', 'popup')):
        subprocess.run([PY, os.path.join(EXT, 'make-extensions.py')], cwd=ROOT, check=True)
    os.makedirs(OUT, exist_ok=True)
    port = free_port()
    server = http.server.ThreadingHTTPServer(('', port), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    ok_all = True
    try:
        with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
            for label, ok, passed, bad in pool.map(functools.partial(lambda n: run(n, app, port, stock)), names):
                print('%-11s %s  (%d checks passed)' % (label, 'ok' if ok else 'FAILED', passed))
                for line in bad:
                    print('    ' + line[:700])
                ok_all &= ok
    finally:
        STOP.set()
        server.shutdown()
    print('ALL OK' if ok_all else 'SOME FAILED')
    sys.exit(0 if ok_all else 1)


if __name__ == '__main__':
    main()
