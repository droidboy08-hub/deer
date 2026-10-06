"""Local test server for the downloader tests: Range and ETag support, per-connection throttling,
cookie/Referer checks, request log, and the test pages. Extended from spikes/downloader/server/serve.py.

  python tests/downloads/server.py --port 47931 [--dir %TEMP%/vitre-dl-tests] [--log requests.jsonl]

Routes (GET):
  /blob/big?rate=KBps       big.bin (256 MiB) with Range/ETag; rate throttles EACH connection (0 = none)
  /blob/medium?rate=        medium.bin (24 MiB)
  /dl/report?rate=          medium.bin as an attachment ("Quarterly report (final).dat"); needs the page's cookie
  /page.html?rate=          sets the cookie; links: attachment, plain, download attribute
  /video.html               a playing <video> (clip.mp4) whose page also fetched an HLS master (an MSE player)
  /video-file.html          a playing <video> with a plain mp4 file
  /video-dash.html          a <video> whose page fetched a DASH manifest
  /video-live.html          a <video> whose page fetched a live HLS stream
  /drm.html                 ClearKey EME (navigator.requestMediaKeySystemAccess + setMediaKeys)
  /fx/<path>                static fixtures (m3u8, ts, m4s, mpd, mp4) with Range support
  /slow<N>/fx/<path>        the same throttled to N KB/s per connection (segments of a playlist inherit it)
  /hedge/fx/<path>          the first request for a seg005 crawls at 8 KB/s (racing a slow segment)
  /token/fx/<path>          playlists hand out ?t=<token> segment addresses; the first seg003 request expires
                            the token (403): only a fresh playlist has working addresses (playlist refresh)
  /named?name=N             a small attachment (64 KiB of medium.bin) named N (Content-Disposition
                            filename*=UTF-8''N): the safety test's server-chosen names
  /links.html               links to /named (one rel=noreferrer) for the safety test's page-derived downloads,
                            and a button (#pop) that window.open()s a 560x460 popup window
  /embed-top.html?hot=1     opened as http://localhost:<port>/: a page whose player is an iframe from another
                            site (http://127.0.0.1:<port>/embed-player.html); with hot=1 the player's HLS comes
                            from /hot/fx/, else from /fx/
  /hot/fx/<path>            /fx/ with hotlink rules, as embed CDNs have: 403 unless the Referer is the player's
                            site (127.0.0.1); segments are labelled image/jpeg, as such CDNs do
  /stats  /reset            JSON: every request seen and the peak number of concurrent body transfers

Big-file addresses have no file extension: this machine runs Internet Download Manager, whose driver
watches firefox.exe (Vitre runs as vitre.exe, which it leaves alone; the habit is kept).
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
STATE = {'active': 0, 'peak': 0, 'requests': [], 'ports': set(), 'hedged': set(), 'token': 1, 'rotated': False}
ARGS = None
FIX = None
SID = 'sid=vitre-secret'

MIME = {'.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.mp4': 'video/mp4', '.m4s': 'video/iso.segment',
        '.mpd': 'application/dash+xml', '.key': 'application/octet-stream', '.bin': 'application/octet-stream',
        '.html': 'text/html; charset=utf-8'}

STYLE = 'body{font:15px "Segoe UI",system-ui;margin:0;background:#0e0f12;color:#e8e8ec}main{padding:96px 72px}h1{font-size:24px;font-weight:600;margin:0 0 6px}p{color:#9a9ca6;margin:0 0 20px}a{color:#9fe3ff}'

PAGE = """<!doctype html><meta charset=utf-8><title>Field Notes · downloads</title>
<style>body{font:16px "Segoe UI",system-ui;margin:0;background:#f4f1ea;color:#1d1b17}main{padding:110px 80px}h1{font:600 30px "Segoe UI";margin:0 0 18px}li{margin:10px 0}a{color:#005fb8}</style>
<main><h1>Issue 14 downloads</h1><ul>
<li><a id="dl" href="/dl/report?rate=%RATE%">Quarterly report (attachment)</a></li>
<li><a id="plain" href="/blob/medium?rate=%RATE%">A plain link to a 24 MB file</a></li>
<li><a id="named" href="/blob/medium?rate=%RATE%" download="chosen-name.dat">A link with the download attribute</a></li>
<li><a id="big" href="/blob/big?rate=%RATE%">The 256 MB archive</a></li>
<li><a id="blobdl" download="field-note.txt" href="#">A note the page makes itself (blob:)</a></li>
<li><a id="handled" href="/blob/medium?handled=1">A link whose page handles Alt+click itself</a></li>
</ul></main>
<script>document.getElementById('handled').addEventListener('click', (e) => { if (e.altKey) { e.preventDefault(); document.title = 'handled by the page'; } });
document.getElementById('blobdl').href = URL.createObjectURL(new Blob(['A note from the page itself. '.repeat(64)], { type: 'text/plain' }));</script>"""

VIDEO = """<!doctype html><meta charset=utf-8><title>Molten: a 4K study of glass in motion</title>
<meta property="og:title" content="Molten: a 4K study of glass in motion">
<style>%STYLE%</style>
<main><h1>Molten: a 4K study of glass in motion</h1><p>tideline.fm · 18:42</p>
<video id="v" %SRC% width="960" height="540" muted autoplay loop playsinline style="display:block;background:#000;border-radius:12px"></video></main>
<script>%SCRIPT%</script>"""

DRM = """<!doctype html><meta charset=utf-8><title>Protected film</title><style>%STYLE%</style>
<main><h1>Protected film</h1><p id="log">starting</p>
<video id="v" src="/media/clip" width="960" height="540" muted autoplay loop style="display:block;background:#000;border-radius:12px"></video></main>
<script>
(async () => {
  const log = (m) => { document.getElementById('log').textContent += ' · ' + m; };
  try {
    const cfg = [{ initDataTypes: ['cenc', 'keyids', 'webm'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }, { contentType: 'video/webm; codecs="vp8"' }] }];
    const access = await navigator.requestMediaKeySystemAccess('org.w3.clearkey', cfg);
    log('access ' + access.keySystem);
    const keys = await access.createMediaKeys();
    await document.getElementById('v').setMediaKeys(keys);
    log('mediaKeys set');
  } catch (e) { log('error ' + e); }
})();
</script>"""

# A button that opens a real popup window (window.open with features): the safety test's popup.
POPUP_BUTTON = "<p><button id=\"pop\" onclick=\"window.open('/links.html?popup=1', 'pop', 'popup,width=560,height=460')\">popup</button></p>"

SCRIPTS = {
    '/video.html': "fetch('/fx/hls/master.m3u8').then(r=>r.text()).then(()=>fetch('/fx/hls/v360/index.m3u8'))",
    '/video-slow.html': "fetch('/slow64/fx/hls/master.m3u8').then(r=>r.text()).then(()=>fetch('/slow64/fx/hls/v360/index.m3u8'))",
    '/video-file.html': '',
    '/video-dash.html': "fetch('/fx/dash/manifest.mpd')",
    '/video-fmp4.html': "fetch('/fx/hlsfmp4/master.m3u8')",
    '/video-live.html': "fetch('/fx/live/master.m3u8').then(()=>fetch('/fx/live/index.m3u8'))",
    # A player that loaded a playlist Vitre cannot read (the mark lights, nothing can be saved).
    '/video-bad.html': "fetch('/bad/broken.m3u8')",
    # A single-page site: video 1, then the next video without a new document (pushState).
    '/video-spa.html': "fetch('/fx/hls/master.m3u8').then(r=>r.text()).then(()=>fetch('/fx/hls/v360/index.m3u8'));"
                       "const n=document.createElement('button');n.id='next';n.textContent='Next video';document.querySelector('main').append(n);"
                       "n.onclick=()=>{fetch('/fx/hlsfmp4/master.m3u8');history.pushState({},'','/video-spa.html?v=2');document.title='Second video';};",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'VitreTest/1'

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
        try:
            self.route(u.path, q)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True

    def route(self, p, q):
        if p == '/stats':
            with LOCK:
                body = json.dumps({'peak': STATE['peak'], 'active': STATE['active'], 'connections': len(STATE['ports']), 'requests': STATE['requests']})
            return self.text(200, body, 'application/json')
        if p == '/reset':
            with LOCK:
                STATE.update(active=0, peak=0, requests=[], ports=set(), hedged=set(), token=1, rotated=False)
            return self.text(200, '{}', 'application/json')
        if p == '/cross.html':
            # Served as http://localhost:<port>: its link is on another site (127.0.0.1).
            self.record()
            port = self.server.server_address[1]
            return self.text(200, '<!doctype html><meta charset=utf-8><title>Cross-site link</title>'
                             '<a id="x" href="http://127.0.0.1:%d/blob/medium?rate=0">A file on another site</a>' % port)
        if p == '/links.html':
            self.record()
            return self.text(200, '<!doctype html><meta charset=utf-8><title>Links</title><main style="padding:120px 80px;font:16px Segoe UI">'
                             '<p><a id="plain" href="/named?name=plain.bin">plain</a></p>'
                             '<p><a id="noref" rel="noreferrer" href="/named?name=noref.bin">no referrer</a></p>'
                             + POPUP_BUTTON + '</main>')
        if p == '/named':
            from urllib.parse import quote
            name = q.get('name', 'file.bin')
            path = os.path.join(FIX, 'medium.bin')
            body = open(path, 'rb').read(65536)
            self.record(status=200, name=name)
            return self.text(200, body, 'application/octet-stream', headers=[('Content-Disposition', "attachment; filename*=UTF-8''" + quote(name, safe=''))])
        if p == '/page.html':
            self.record()
            return self.text(200, PAGE.replace('%RATE%', q.get('rate', '0')), headers=[('Set-Cookie', SID + '; Path=/'), ('Set-Cookie', 'strict=vitre-strict; Path=/; SameSite=Strict')])
        if p in SCRIPTS:
            self.record()
            # An MSE player's <video> has a blob: source: pages that fetch a DASH or fMP4 stream get no src.
            src = '' if p in ('/video-dash.html', '/video-fmp4.html', '/video-bad.html', '/video-spa.html') else 'src="/media/clip"'
            return self.text(200, VIDEO.replace('%STYLE%', STYLE).replace('%SCRIPT%', SCRIPTS[p]).replace('%SRC%', src))
        if p == '/embed-top.html':
            self.record()
            port = self.server.server_address[1]
            hot = '1' if q.get('hot') == '1' else '0'
            return self.text(200, '<!doctype html><meta charset=utf-8><title>Episode 1 · Field Notes TV</title>'
                             '<style>%s</style><main><h1>Episode 1</h1><p>Watch below</p>'
                             '<iframe id="player" src="http://127.0.0.1:%d/embed-player.html?hot=%s" width="960" height="540" '
                             'style="border:0;border-radius:12px;background:#000" allowfullscreen></iframe></main>' % (STYLE, port, hot))
        if p == '/embed-player.html':
            self.record()
            root = '/hot/fx' if q.get('hot') == '1' else '/fx'
            script = "fetch('%s/hls/master.m3u8').then(r=>r.text()).then(()=>fetch('%s/hls/v360/index.m3u8'))" % (root, root)
            return self.text(200, '<!doctype html><meta charset=utf-8><title>Player</title><style>body{margin:0;background:#000}</style>'
                             '<video id="v" width="960" height="540" muted playsinline style="display:block"></video><script>%s</script>' % script)
        if p.startswith('/hot/fx/'):
            port = self.server.server_address[1]
            if not self.headers.get('Referer', '').startswith('http://127.0.0.1:%d/' % port):
                self.record(status=403)
                return self.text(403, 'forbidden', 'text/plain; charset=utf-8')
            path = os.path.normpath(os.path.join(FIX, p[len('/hot/fx/'):]))
            if not path.startswith(FIX) or not os.path.isfile(path):
                self.record(status=404)
                return self.text(404, 'not found')
            ext = os.path.splitext(path)[1]
            return self.send_file(path, 0, ctype='image/jpeg' if ext == '.ts' else MIME.get(ext, 'application/octet-stream'))
        if p == '/bad/broken.m3u8':
            self.record()
            return self.text(200, 'this is not a playlist', 'application/vnd.apple.mpegurl')
        if p == '/drm.html':
            self.record()
            return self.text(200, DRM.replace('%STYLE%', STYLE))
        rate = float(q.get('rate', '0')) * 1024
        if p == '/blob/big':
            return self.send_file(os.path.join(FIX, 'big.bin'), rate)
        if p == '/blob/medium':
            return self.send_file(os.path.join(FIX, 'medium.bin'), rate)
        if p == '/dl/report':
            ok = SID in self.headers.get('Cookie', '') and '/page.html' in self.headers.get('Referer', '')
            if not ok:
                self.record(status=403)
                return self.text(403, 'forbidden: no cookie or no referer')
            extra = [('Content-Disposition', 'attachment; filename="Quarterly report (final).dat"'), ('Content-Type', 'application/x-vitre-test')]
            return self.send_file(os.path.join(FIX, 'medium.bin'), rate, extra=extra)
        if p == '/media/clip':
            return self.send_file(os.path.join(FIX, 'clip.mp4'), rate, ctype='video/mp4')
        # /hedge/fx/...: the first request for segment 5 crawls (8 KB/s); a second request is fast.
        if p.startswith('/hedge/fx/'):
            with LOCK:
                first = p not in STATE['hedged']
                STATE['hedged'].add(p)
            path = os.path.normpath(os.path.join(FIX, p[len('/hedge/fx/'):]))
            if not path.startswith(FIX) or not os.path.isfile(path):
                return self.text(404, 'not found')
            crawl = 8 * 1024 if (first and 'seg005' in p) else 0
            return self.send_file(path, crawl, ctype=MIME.get(os.path.splitext(path)[1], 'application/octet-stream'))
        # /token/fx/...: segment addresses carry ?t=<token>; the first request for segment 3 "expires"
        # the token (403 and a new one), as CDNs do: only a fresh copy of the playlist has working addresses.
        if p.startswith('/token/fx/'):
            path = os.path.normpath(os.path.join(FIX, p[len('/token/fx/'):]))
            if not path.startswith(FIX) or not os.path.isfile(path):
                return self.text(404, 'not found')
            if path.endswith('.m3u8'):
                self.record(status=200, token=STATE['token'])
                with open(path, encoding='utf-8') as f:
                    lines = [l if (l.startswith('#') or not l.strip()) else l.strip() + '?t=%d' % STATE['token'] for l in f.read().splitlines()]
                return self.text(200, chr(10).join(lines) + chr(10), MIME['.m3u8'])
            with LOCK:
                ok = q.get('t') == str(STATE['token'])
                if ok and 'seg003' in p and not STATE['rotated']:
                    STATE['rotated'] = True
                    STATE['token'] += 1
                    ok = False
            if not ok:
                self.record(status=403)
                return self.text(403, 'token expired')
            return self.send_file(path, 0, ctype=MIME.get(os.path.splitext(path)[1], 'application/octet-stream'))
        slow = 0
        if p.startswith('/slow'):
            head, _, rest = p[5:].partition('/')
            slow = float(head or '0') * 1024
            p = '/' + rest
        if p.startswith('/fx/'):
            path = os.path.normpath(os.path.join(FIX, p[4:]))
            if not path.startswith(FIX) or not os.path.isfile(path):
                self.record(status=404)
                return self.text(404, 'not found')
            return self.send_file(path, slow or rate, ctype=MIME.get(os.path.splitext(path)[1], 'application/octet-stream'))
        self.text(404, 'not found')

    def send_file(self, path, rate, extra=(), ctype='application/octet-stream'):
        size = os.path.getsize(path)
        etag = '"%x-%x"' % (size, int(os.path.getmtime(path)))
        start, end, status = 0, size - 1, 200
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes='):
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
        entry = self.record(status=status, start=start, end=end)
        self.send_response(status)
        if not any(k.lower() == 'content-type' for k, _ in extra):
            self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(length))
        self.send_header('ETag', etag)
        self.send_header('Cache-Control', 'no-store')
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


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 256


def main():
    global ARGS, FIX
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=47931)
    ap.add_argument('--dir', default=os.path.join(tempfile.gettempdir(), 'vitre-dl-tests'))
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
