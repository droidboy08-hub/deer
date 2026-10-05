"""Edge-case server for the downloader verifier (tests/downloads-verify/all.py starts it next to the
builder's tests/downloads/server.py, on the next port):

  python tests/downloads-verify/vserve.py --port 47952 --main 47951

Routes (GET; no file extensions on purpose: Internet Download Manager watches firefox.exe on this machine):
  /hang              accepts the request and never answers (a hung server)
  /stall             answers 200 with Content-Length 32 MiB and Range support, sends 1 MiB, then stalls
  /zero              an empty attachment ("empty.txt", Content-Length 0)
  /chunked           3 MiB, chunked, no length and no Range support (one stream, size unknown)
  /missing           404 with an HTML body
  /evilname          an attachment whose name tries to leave the folder and carries reserved characters
  /unicode           an attachment named with RFC 5987 filename* (UTF-8)
  /redirect          302 to the main server's /blob/medium
  /hung-page         an HTML page with a <video> (the main server's clip) whose body never ends loading
  /stats             JSON: open connections and requests seen
"""
import argparse
import json
import select
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

LOCK = threading.Lock()
STATE = {'open': 0, 'requests': []}
ARGS = None
MIB = 1024 * 1024


def chunk(n, seed=7):
    return bytes((i * 31 + seed) & 0xFF for i in range(n))


BLOCK = chunk(64 * 1024)


class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *a):
        pass

    def head(self, status, headers):
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()

    def gone(self):
        """The client closed the connection (the hung routes wait on this, so /stats counts what is open)."""
        try:
            r, _, _ = select.select([self.connection], [], [], 0)
            return bool(r) and self.connection.recv(1, socket.MSG_PEEK) == b''
        except OSError:
            return True

    def wait(self, seconds=120):
        for _ in range(int(seconds * 10)):
            if self.gone():
                return
            time.sleep(0.1)

    def body(self, n):
        sent = 0
        while sent < n:
            part = BLOCK[: min(len(BLOCK), n - sent)]
            self.wfile.write(part)
            sent += len(part)

    def do_GET(self):
        p = urlparse(self.path).path
        with LOCK:
            STATE['open'] += 1
            STATE['requests'].append({'path': self.path, 'range': self.headers.get('Range', ''), 't': time.time()})
        try:
            self.route(p)
        except (ConnectionError, OSError):
            pass
        finally:
            with LOCK:
                STATE['open'] -= 1

    def route(self, p):
        if p == '/stats':
            data = json.dumps({'open': STATE['open'] - 1, 'requests': STATE['requests'][-200:]}).encode()
            self.head(200, {'Content-Type': 'application/json', 'Content-Length': str(len(data)), 'Cache-Control': 'no-store'})
            self.wfile.write(data)
            return
        if p == '/reset':
            STATE['requests'] = []
            self.head(204, {'Content-Length': '0'})
            return
        if p == '/hang':
            self.wait()
            return
        if p == '/stall':
            total = 32 * MIB
            rng = self.headers.get('Range', '')
            start, end = 0, total - 1
            if rng.startswith('bytes='):
                a, _, b = rng[6:].partition('-')
                start = int(a or 0)
                end = int(b) if b else total - 1
            n = end - start + 1
            status = 206 if rng else 200
            h = {'Content-Type': 'application/octet-stream', 'Content-Length': str(n), 'Accept-Ranges': 'bytes', 'ETag': '"stall-1"'}
            if rng:
                h['Content-Range'] = 'bytes %d-%d/%d' % (start, end, total)
            self.head(status, h)
            if n <= 1:
                self.body(n)
                return
            self.body(min(n, MIB))
            self.wfile.flush()
            self.wait()
            return
        if p == '/zero':
            self.head(200, {'Content-Type': 'text/plain', 'Content-Length': '0', 'Content-Disposition': 'attachment; filename="empty.txt"'})
            return
        if p == '/chunked':
            self.head(200, {'Content-Type': 'application/octet-stream', 'Transfer-Encoding': 'chunked'})
            for _ in range(48):
                self.wfile.write(b'%x\r\n' % len(BLOCK) + BLOCK + b'\r\n')
                self.wfile.flush()
                time.sleep(0.02)
            self.wfile.write(b'0\r\n\r\n')
            return
        if p == '/missing':
            data = b'<!doctype html><title>Not found</title><h1>Not found</h1>'
            self.head(404, {'Content-Type': 'text/html', 'Content-Length': str(len(data))})
            self.wfile.write(data)
            return
        if p in ('/evilname', '/unicode'):
            n = 300 * 1024
            disp = 'attachment; filename="..\\\\..\\\\con: evil<>|?*.bat"' if p == '/evilname' else "attachment; filename=\"report.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%E2%80%94%20final.pdf"
            self.head(200, {'Content-Type': 'application/octet-stream', 'Content-Length': str(n), 'Content-Disposition': disp})
            self.body(n)
            return
        if p == '/redirect':
            self.head(302, {'Location': 'http://127.0.0.1:%d/blob/medium' % ARGS.main, 'Content-Length': '0'})
            return
        if p == '/hung-page':
            self.head(200, {'Content-Type': 'text/html; charset=utf-8', 'Transfer-Encoding': 'chunked'})
            html = ('<!doctype html><meta charset=utf-8><title>A page that never finishes</title>'
                    '<style>body{font:15px Segoe UI;margin:0;background:#0e0f12;color:#e8e8ec}main{padding:96px 72px}</style>'
                    '<main><h1>Still loading</h1><video id="v" src="http://127.0.0.1:%d/media/clip" width="960" height="540" muted autoplay loop '
                    'style="display:block;background:#000;border-radius:12px"></video></main>' % ARGS.main).encode()
            self.wfile.write(b'%x\r\n' % len(html) + html + b'\r\n')
            self.wfile.flush()
            self.wait()
            return
        self.head(404, {'Content-Length': '0'})


def main():
    global ARGS
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=47952)
    ap.add_argument('--main', type=int, default=47951)
    ARGS = ap.parse_args()
    srv = ThreadingHTTPServer(('127.0.0.1', ARGS.port), H)
    srv.daemon_threads = True
    srv.serve_forever()


if __name__ == '__main__':
    main()
