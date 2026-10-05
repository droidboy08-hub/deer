"""Reviewer's probe (review2-code; not a product test).

    python tests/review2-code/run.py [--app build-review2-code]

Starts a local HTTP server (127.0.0.1 and localhost as two sites), then runs probe.js (or $R2_PROBE) in Vitre.
The server records every request (path, Referer, Cookie, Range) at /log and serves:
  /page.html               links: a plain download, a rel=noreferrer cross-site download, Alt+click
  /file?name=N&tag=T       an attachment named N (UTF-8 filename*), 4096 bytes, Range aware
  /target.html             an ordinary page
Downloads go to %TEMP%/vitre-review2-code (vitre.downloadsFolder). Output: tests/review2-code/out.
"""
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PROBE = os.environ.get('R2_PROBE') or 'probe.js'
OUT = os.path.join(HERE, 'out', os.path.splitext(PROBE)[0])
LOG = []
BODY = bytes(range(256)) * 16

PAGE = """<!doctype html><meta charset=utf-8><title>review2 page</title>
<body style="font:16px sans-serif;padding:120px 40px">
<p><a id="plain" href="/file?name=report.bin&tag=plain">plain download</a></p>
<p><a id="noref" rel="noreferrer" href="%(xsite)sfile?name=noref.bin&tag=noref">rel=noreferrer cross-site download</a></p>
<p><a id="alt" href="/target.html?from=alt">Alt+click me</a></p>
<p><a id="blank" target="_blank" href="/target.html?from=blank">target blank</a></p>
"""


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_GET(self):  # noqa: N802
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        LOG.append({'path': self.path, 'host': self.headers.get('Host', ''), 'referer': self.headers.get('Referer', ''),
                    'cookie': self.headers.get('Cookie', ''), 'range': self.headers.get('Range', '')})
        if u.path == '/log':
            return self.send(200, 'application/json', json.dumps(LOG).encode())
        if u.path == '/page.html':
            xsite = 'http://localhost:%d/' % self.server.server_address[1]
            return self.send(200, 'text/html; charset=utf-8', (PAGE % {'xsite': xsite}).encode())
        if u.path == '/setcookie':
            body = b'<!doctype html><title>cookies set</title><p>cookies set'
            try:
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Set-Cookie', 'strict=s1; SameSite=Strict; Path=/')
                self.send_header('Set-Cookie', 'lax=l1; SameSite=Lax; Path=/')
                self.end_headers()
                self.wfile.write(body)
            except OSError:
                pass
            return
        if u.path == '/target.html':
            return self.send(200, 'text/html; charset=utf-8', b'<!doctype html><title>target</title><p>target')
        if u.path == '/file':
            name = q.get('name', ['x.bin'])[0]
            cd = "attachment; filename*=UTF-8''" + urllib.parse.quote(name, safe='')
            rng = self.headers.get('Range', '')
            if rng.startswith('bytes='):
                a, _, b = rng[6:].partition('-')
                a = int(a or 0)
                b = int(b) if b else len(BODY) - 1
                b = min(b, len(BODY) - 1)
                part = BODY[a:b + 1]
                return self.send(206, 'application/octet-stream', part, {'Content-Disposition': cd, 'Accept-Ranges': 'bytes',
                                                                          'Content-Range': 'bytes %d-%d/%d' % (a, b, len(BODY))})
            return self.send(200, 'application/octet-stream', BODY, {'Content-Disposition': cd, 'Accept-Ranges': 'bytes'})
        self.send(404, 'text/plain', b'no')

    def send(self, code, ctype, body, extra=None):
        try:
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass

    def log_message(self, *args):
        pass


def main():
    app = 'build-review2-code'
    if '--app' in sys.argv:
        app = sys.argv[sys.argv.index('--app') + 1]
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT, exist_ok=True)
    dl = os.path.join(tempfile.gettempdir(), 'vitre-review2-code')
    shutil.rmtree(dl, ignore_errors=True)
    os.makedirs(dl, exist_ok=True)
    cmd = [sys.executable, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, os.environ.get('R2_PROBE') or 'probe.js'), '--name', 'review2-code-probe',
           '--app', app, '--out', OUT, '--timeout', '240',
           '--env', 'R2_BASE=http://127.0.0.1:%d/' % port, '--env', 'R2_XSITE=http://localhost:%d/' % port, '--env', 'R2_DL=' + dl,
           '--pref', 'vitre.downloadsFolder=' + dl,
           '--pref', 'media.gmp-manager.updateEnabled=false', '--pref', 'media.gmp-manager.url=http://127.0.0.1:9/none']
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    text = r.stdout + r.stderr
    with open(os.path.join(OUT, 'run.txt'), 'w', encoding='utf-8') as f:
        f.write(text)
    with open(os.path.join(OUT, 'server-log.json'), 'w', encoding='utf-8') as f:
        json.dump(LOG, f, indent=1)
    print(text[-12000:].encode("ascii", "backslashreplace").decode())
    print("files in", dl, ascii(os.listdir(dl)))
    srv.shutdown()


if __name__ == '__main__':
    main()
