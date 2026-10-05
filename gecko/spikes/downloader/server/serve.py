"""Local test HTTP server for the downloader spike: Range support, per-connection throttling,
failure injection, cookie/referer checks, request log.

  python serve.py --port 47811 [--dir %TEMP%/vitre-dl-spike] [--log requests.jsonl]

Routes (all GET):
  /blob/big?rate=KBps        big.bin with Range/ETag; rate throttles EACH connection (0 = unthrottled)
  /blob/medium?rate=         medium.bin, same rules
  /blob/norange?rate=        medium.bin, ignores Range (always 200, no Accept-Ranges)
  /blob/flaky?rate=&drop=N   medium.bin; the first 3 ranged body requests are cut after N bytes
  /blob/limit2?rate=         medium.bin; a third concurrent connection is answered 503
  /auth/medium               medium.bin; 403 unless Cookie has sid=<expected> (and Referer when ?ref=1)
  /redir/big                 302 -> /blob/big (query kept)
  /dl/report                 medium.bin as an attachment: Content-Disposition filename, needs the cookie

The paths have no file extension on purpose: this machine runs Internet Download Manager, whose
network driver hijacks firefox.exe requests for .bin/.zip/.mp4... addresses (it answers 204 and
pops up its own dialog).
  /page.html                 sets the cookie, links to /dl/report
  /media.html                <video src=/fx/clip.mp4>, XHR of /fx/hls/master.m3u8 and /fx/manifest.mpd
  /drm.html                  calls navigator.requestMediaKeySystemAccess('org.w3.clearkey')
  /fx/<path>                 static fixtures (m3u8, ts, mp4, mpd) with Range support
  /stats  /reset             JSON: every request seen and the peak number of concurrent body transfers
"""
import argparse
import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

LOCK = threading.Lock()
STATE = {'active': 0, 'peak': 0, 'requests': [], 'flaky': 0, 'limit2': 0, 'ports': set()}
ARGS = None
FIX = None
SID = 'sid=vitre-secret'

MIME = {'.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.mp4': 'video/mp4', '.mpd': 'application/dash+xml',
        '.key': 'application/octet-stream', '.bin': 'application/octet-stream', '.html': 'text/html; charset=utf-8'}

PAGE = """<!doctype html><meta charset=utf-8><title>Download test page</title>
<body style="font:16px system-ui;margin:40px">
<h1>Download test page</h1>
<p><a id="dl" href="/dl/report?rate=%RATE%">Download the report (attachment)</a></p>
<p><a id="plain" href="/blob/medium">A plain link</a></p>
<p><a id="named" href="/blob/medium?rate=%RATE%" download="chosen-name.dat">A link with the download attribute</a></p>
</body>"""

MEDIA = """<!doctype html><meta charset=utf-8><title>Media test page</title>
<body style="font:16px system-ui;margin:40px;background:#111;color:#eee">
<h1>Media test page</h1>
<video id="v" src="/media/clip" width="480" controls muted autoplay loop></video>
<script>
  // What an MSE player does: fetch the playlist and the manifest by XHR/fetch.
  fetch('/fx/hls/master.m3u8').then(r => r.text()).then(t => fetch('/fx/hls/v360/index.m3u8')).then(() => fetch('/fx/hls/v360/seg000.ts'));
  fetch('/fx/manifest.mpd');
</script>
<iframe src="/frame.html" width="300" height="80"></iframe>
</body>"""

FRAME = """<!doctype html><meta charset=utf-8><body style="color:#eee">frame
<script>fetch('/fx/hls/v180/index.m3u8?from=frame')</script></body>"""

DRM = """<!doctype html><meta charset=utf-8><title>EME test page</title>
<body style="font:16px system-ui;margin:40px">
<h1>EME test page</h1><video id="v" width="320" controls></video><pre id="log">starting</pre>
<script>
(async () => {
  const log = (m) => { document.getElementById('log').textContent += '\\n' + m; };
  try {
    const cfg = [{ initDataTypes: ['cenc', 'keyids', 'webm'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }, { contentType: 'video/webm; codecs="vp8"' }] }];
    const access = await navigator.requestMediaKeySystemAccess('org.w3.clearkey', cfg);
    log('access ' + access.keySystem);
    const keys = await access.createMediaKeys();
    await document.getElementById('v').setMediaKeys(keys);
    log('mediaKeys set');
  } catch (e) { log('error ' + e); }
})();
</script></body>"""


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'VitreSpike/1'

    def log_message(self, *a):
        pass

    def record(self, **kw):
        entry = {'t': round(time.time(), 3), 'path': self.path, 'port': self.client_address[1],
                 'range': self.headers.get('Range', ''), 'ifrange': self.headers.get('If-Range', ''),
                 'cookie': self.headers.get('Cookie', ''), 'referer': self.headers.get('Referer', ''),
                 'origin': self.headers.get('Origin', ''), 'ae': self.headers.get('Accept-Encoding', ''),
                 'ua': self.headers.get('User-Agent', '')[:40], **kw}
        with LOCK:
            STATE['requests'].append(entry)
            STATE['ports'].add(self.client_address[1])
        if ARGS.log:
            with LOCK, open(ARGS.log, 'a') as f:
                f.write(json.dumps(entry) + '\n')
        return entry

    def text(self, status, body, ctype='text/html; charset=utf-8', headers=()):
        data = body.encode() if isinstance(body, str) else body
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        p = u.path
        try:
            self.route(p, q)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def route(self, p, q):
        if p == '/stats':
            with LOCK:
                body = json.dumps({'peak': STATE['peak'], 'active': STATE['active'], 'connections': len(STATE['ports']),
                                   'requests': STATE['requests']})
            return self.text(200, body, 'application/json')
        if p == '/reset':
            with LOCK:
                STATE.update(active=0, peak=0, requests=[], flaky=0, limit2=0, ports=set())
            return self.text(200, '{}', 'application/json')
        if p == '/page.html':
            self.record()
            return self.text(200, PAGE.replace('%RATE%', q.get('rate', '0')), headers=[('Set-Cookie', SID + '; Path=/')])
        if p == '/media.html':
            self.record()
            return self.text(200, MEDIA)
        if p == '/frame.html':
            return self.text(200, FRAME)
        if p == '/drm.html':
            self.record()
            return self.text(200, DRM)
        if p == '/redir/big':
            self.record(status=302)
            return self.text(302, '', headers=[('Location', '/blob/big' + ('?' + urlparse(self.path).query if urlparse(self.path).query else ''))])
        rate = float(q.get('rate', '0')) * 1024
        if p == '/blob/big':
            return self.send_file(os.path.join(FIX, 'big.bin'), rate)
        if p == '/blob/medium':
            return self.send_file(os.path.join(FIX, 'medium.bin'), rate)
        if p == '/blob/norange':
            return self.send_file(os.path.join(FIX, 'medium.bin'), rate, ranges=False)
        if p == '/blob/flaky':
            return self.send_file(os.path.join(FIX, 'medium.bin'), rate, flaky=int(q.get('drop', '1000000')))
        if p == '/blob/limit2':
            return self.send_file(os.path.join(FIX, 'medium.bin'), rate, limit=2)
        if p in ('/auth/medium', '/dl/report'):
            ok = SID in self.headers.get('Cookie', '') and (q.get('ref') != '1' or '/page.html' in self.headers.get('Referer', ''))
            if not ok:
                self.record(status=403)
                return self.text(403, 'forbidden: no cookie')
            extra = []
            if p == '/dl/report':
                extra = [('Content-Disposition', 'attachment; filename="Quarterly report (final).dat"'), ('Content-Type', 'application/x-vitre-test')]
            return self.send_file(os.path.join(FIX, 'medium.bin'), rate, extra=extra)
        if p == '/media/clip':
            return self.send_file(os.path.join(FIX, 'clip.mp4'), rate, ctype='video/mp4')
        if p.startswith('/fx/'):
            path = os.path.normpath(os.path.join(FIX, p[4:]))
            if not path.startswith(FIX) or not os.path.isfile(path):
                return self.text(404, 'not found')
            return self.send_file(path, rate, ctype=MIME.get(os.path.splitext(path)[1], 'application/octet-stream'))
        self.text(404, 'not found')

    def send_file(self, path, rate, ranges=True, flaky=0, limit=0, extra=(), ctype='application/octet-stream'):
        size = os.path.getsize(path)
        etag = '"%x-%x"' % (size, int(os.path.getmtime(path)))
        start, end, status = 0, size - 1, 200
        rng = self.headers.get('Range', '')
        if ranges and rng.startswith('bytes='):
            a, _, b = rng[6:].partition('-')
            if_range = self.headers.get('If-Range')
            if if_range is None or if_range == etag:
                start = int(a) if a else max(0, size - int(b))
                end = min(size - 1, int(b)) if (a and b) else size - 1
                if start >= size:
                    self.record(status=416)
                    return self.text(416, '', headers=[('Content-Range', 'bytes */%d' % size)])
                status = 206
        length = end - start + 1
        probe = length <= 1
        if limit and not probe:
            with LOCK:
                busy = STATE['limit2'] >= limit
                if not busy:
                    STATE['limit2'] += 1
            if busy:
                self.record(status=503)
                return self.text(503, 'busy', headers=[('Retry-After', '1')])
        cut = 0
        if flaky and not probe:
            with LOCK:
                STATE['flaky'] += 1
                if STATE['flaky'] <= 3:
                    cut = flaky
        entry = self.record(status=status, start=start, end=end, cut=cut)
        self.send_response(status)
        has_type = any(k.lower() == 'content-type' for k, _ in extra)
        if not has_type:
            self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(length))
        self.send_header('ETag', etag)
        self.send_header('Cache-Control', 'no-store')
        if ranges:
            self.send_header('Accept-Ranges', 'bytes')
        if status == 206:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        if not probe:
            with LOCK:
                STATE['active'] += 1
                STATE['peak'] = max(STATE['peak'], STATE['active'])
        sent = 0
        t0 = time.time()
        try:
            with open(path, 'rb') as f:
                f.seek(start)
                chunk = 16384 if rate else 262144
                while sent < length:
                    b = f.read(min(chunk, length - sent))
                    if not b:
                        break
                    if cut and sent + len(b) > cut:
                        # Injected failure: reset the connection in the middle of the body.
                        self.wfile.write(b[:max(0, cut - sent)])
                        self.wfile.flush()
                        self.close_connection = True
                        try:
                            self.connection.shutdown(2)
                        except OSError:
                            pass
                        return
                    self.wfile.write(b)
                    sent += len(b)
                    if rate:
                        ahead = sent / rate - (time.time() - t0)
                        if ahead > 0:
                            time.sleep(ahead)
        finally:
            entry['sent'] = sent
            entry['secs'] = round(time.time() - t0, 3)
            if not probe:
                with LOCK:
                    STATE['active'] -= 1
            if limit and not probe:
                with LOCK:
                    STATE['limit2'] -= 1


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 128


def main():
    global ARGS, FIX
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=47811)
    ap.add_argument('--dir', default=os.path.join(tempfile.gettempdir(), 'vitre-dl-spike'))
    ap.add_argument('--log')
    ARGS = ap.parse_args()
    FIX = os.path.normpath(os.path.join(ARGS.dir, 'fixtures'))
    if ARGS.log:
        open(ARGS.log, 'w').close()
    srv = Server(('127.0.0.1', ARGS.port), Handler)
    print('serving', FIX, 'on', ARGS.port, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.exit(main())
