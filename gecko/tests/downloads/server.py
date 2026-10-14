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
  /expire/<f>?how=403|410|html200|302html|403xml&after=N&k=KEY&rate=
                            <f> (a fixture; "medium" means medium.bin) served normally until it expires: after N
                            requests counted per KEY (default <f>), or once /flag?k=KEY was asked. Then it answers
                            403, 410, a 200 web page, a 302 to a web page, or a 403 with S3's "Request has expired"
                            XML. A playlist (.m3u8) is never counted or expired: its addresses carry the same query,
                            so its segments expire instead (Phase 1 of spikes/downloader/RESUME-DESIGN.md)
  /swap/<f>?val=etag|lm|weak|drop|none&k=KEY&rate=&ifrange=ignore&cut=N&same=1
                            <f> with Range; once /flag?k=KEY was asked, other bytes of the same size (every byte
                            XOR 0xA5) with other validators: a strong ETag; Last-Modified only; a weak ETag and
                            Last-Modified; a strong ETag that is dropped while Last-Modified changes; none.
                            With same=1 the bytes stay the same and only the validators change (a redeploy).
                            If-Range is honoured (strong ETag or the exact date) unless ifrange=ignore; with cut,
                            every 206 stops after N bytes and the connection closes (a dropped connection)
  /morph/<f>?k=KEY&before=chunked|ranged&after=ranges|norange|star&short=N&xor=1&rate=
                            <f> whose server answers differently once /flag?k=KEY was asked, ETag "M1" throughout.
                            Before: chunked, a 200 without Content-Length that ignores Range; ranged, Range with
                            the total. After: the first N bytes only (short; every byte XOR 0xA5 with xor=1), and
                            ranges, Range with the total; norange, always a 200 with Content-Length; star, a 206
                            whose Content-Range gives no total ("/*"), a 200 without Range. rate (KB/s) applies
                            before the flag only
  /md5/<f>?good=0|1&rate=   <f> without Range support (always 200), with Content-MD5: right (1) or wrong (0)
  /sign/<f>?ttl=S&uses=N&k=KEY&ttl2=S2&uses2=N2&delay2=D&rate=
                            a 302 to a fresh signed address /signed/<tok>/<f>?Expires=<epoch>&rate=, as a
                            download?id= redirector or a presigning API answers (Phase 2 of RESUME-DESIGN.md).
                            The first token for KEY (default <f>) works for S seconds (ttl) and/or N requests
                            (uses; no Expires in the address then); later ones for S2 seconds (ttl2, default
                            600), so a renewal outlives the test, and N2 requests (uses2: a host whose new
                            address passes the proof's windows and then refuses the transfer), and are
                            answered after D seconds (delay2)
  /signed/<tok>/<f>?Expires=&rate=
                            <f> with Range and If-Range (the ETag of /fx/, the same for every token) while the
                            token works; then 403 "Request has expired". A transfer still running when its
                            token expires is cut (the connection closes), so every connection asks again
  /signed-once/<f>?ttl=S&k=KEY&hang=S2&rate=
                            /sign/ whose own address works once per KEY: afterwards it answers 403 too, so a
                            renewal from the original address finds nothing; once /flag?k=hang-KEY was asked,
                            that 403 comes only after S2 seconds (hang, default 60: an attempt that hangs);
                            once /flag?k=revive-KEY was asked, it works one more time (a site back up)
  /mint/<f>?ttl=S&rate=     JSON {"url": "/signed/<tok>/<f>?..."}: a fresh signed address to paste (ttl default 600)
  /edge/<f>?lm=0|1&rate=    <f> with Range, a new ETag on every answer over the same bytes (another CDN edge each
                            time) and a stable Last-Modified (unless lm=0); If-Range is honoured only when it
                            equals that answer's ETag (never) or the Last-Modified
  /flap/<f>?rate=           <f> from a farm of two backends taking turns (A, B, A...), each with its own ETag
                            AND Last-Modified over the same bytes (nginx or Apache behind a balancer, their file
                            times differing); If-Range is honoured against the answering backend's validators
  /tail/<f>?k=KEY&rate=     <f> with Range from a server that ignores If-Range; once /flag?k=KEY was asked, the
                            bytes from 64 KiB on are other bytes (XOR 0xA5) under another ETag, same size, at
                            full speed (rate applies before the flag only): a file that changed after its start
  /whole/<f>?size=N&rate=   the first N bytes of <f> as a file of N bytes, whose server answers a Range over the
                            whole file with the whole file (a 200) and any other Range with a 206; If-Range by
                            its ETag
  /flag?k=KEY[&f=F[&tail=1]] sets KEY's flag (/expire, /swap, /tail); with f, answers the sha256 of F's swapped
                            bytes (with tail=1: swapped from 64 KiB on, as /tail sends them)
  /attach.html?k=KEY&f=F&name=N&ttl=S&ttl2=S2&rate=&crate=
                            a download page (Phase 3 of RESUME-DESIGN.md: starting a download again on its page)
                            that sets the page's cookie and mints a fresh signed address on every load: #dl, F
                            as N (the first load per KEY valid for S seconds, later loads for S2, default 600);
                            #changed, the same name over other bytes (every byte XOR 0xA5, same size; at crate,
                            default rate); #other, an unrelated file (/named, other.bin); #once, a one-time link
                            (/onetime/)
  /fetch.html?k=KEY&ttl=S&rate=&anon=1
                            a page whose two files come from one script, as many sites serve them (review of
                            Phase 3): #a, medium.bin as a.bin (the first load per KEY valid for S seconds, later
                            loads for 600); #b, the first 3 MiB of big.bin as b.bin. With anon=1 neither has a
                            Content-Disposition name (both are named after the address: "fetch")
  /fetch?f=F&tok=T&name=N&cap=C&rate=
                            that script: fixture F (its first C bytes, a file of C bytes, with cap) with Range and
                            If-Range (an ETag per file) while the token works, then 403 "Request has expired";
                            name gives Content-Disposition
  /qsigned/<f>?tok=T&Expires=E&name=N&xor=1&rate=
                            /signed/ with the token in the query, so every address of the file has the same
                            path: <f> with Range and If-Range while the token works, then 403 "Request has
                            expired"; name gives Content-Disposition; xor=1 sends other bytes under another ETag
  /qmint/<f>?ttl=S&name=N&rate=
                            JSON {"url": "/qsigned/<f>?..."}: a fresh address to paste (Add link)
  /onetime/<f>?k=KEY&name=N&rate=
                            <f> once per KEY (the first request, a 200 with Content-Disposition N); after that a
                            410 page: a one-time link, which the take-over leaves to Firefox
  /net/<f>?k=KEY&rate=      <f> with Range and If-Range, from a network that can go away (Phase 4 of
                            RESUME-DESIGN.md): while /drop holds KEY, every connection that asks for it is
                            reset (an RST, no answer) and a transfer still running is cut the same way; while
                            /busy holds KEY, it answers 503 (with Retry-After when /busy gave ra)
  /drop?for=N&k=KEY         for N seconds (default 60), /net/ connections for KEY are refused (reset)
  /busy?for=N&k=KEY&ra=S    for N seconds (default 90), /net/ for KEY answers 503 (Retry-After: S with ra)
  /slow?for=N&k=KEY&ms=M    for N seconds (default 10), /net/ for KEY answers M ms late (default 1500): a resume's
                            check that takes a while (Checking)
  /loop/a                   a 302 to /loop/b and back, for ever (NS_ERROR_REDIRECT_LOOP) | /dupcl  a 200 with two Content-Length
                            headers that disagree (NS_ERROR_CORRUPTED_CONTENT): failures no wait fixes (review of Phase 4)
  /stats  /reset            JSON: every request seen and the peak number of concurrent body transfers
                            (/reset leaves the flags and counts of /expire and /swap alone)

Big-file addresses have no file extension: this machine runs Internet Download Manager, whose driver
watches firefox.exe (Vitre runs as vitre.exe, which it leaves alone; the habit is kept).
"""
import argparse
import base64
import hashlib
import json
import os
import socket
import struct
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

LOCK = threading.Lock()
STATE = {'active': 0, 'peak': 0, 'requests': [], 'ports': set(), 'hedged': set(), 'token': 1, 'rotated': False}
# /expire and /swap: flags set by /flag?k=, request counts per key, cached md5 and swapped sha256 per file.
FLAGS = set()
COUNTS = {}
DIGESTS = {}
# /sign, /signed-once, /mint: tokens of /signed/ ({'expires': time or 0, 'uses': n or 0, 'used': n}), the
# keys that have their first token, the /signed-once keys already used, and /edge's and /flap's answer counts.
TOKENS = {}
SIGNED_KEYS = set()
ONCE = set()
EDGE = {'n': 0}
FLAP = {'n': 0}
# /tail: its bytes from here on change once flagged.
TAIL = 65536
# /net: per key, until when its connections are reset (/drop) and until when it answers 503 (/busy, with
# its Retry-After).
DROP = {}
BUSY = {}
SLOW = {}
EXPIRED_PAGE = ('<!doctype html><meta charset=utf-8><title>Sign in</title><main style="padding:120px 80px;font:16px Segoe UI">'
                '<h1>This link has expired</h1><p>Sign in to download the file again.</p></main>')
EXPIRED_XML = ('<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>AccessDenied</Code><Message>Request has expired</Message>'
               '<X-Amz-Expires>60</X-Amz-Expires><Expires>2026-10-13T09:00:00Z</Expires><RequestId>VITRETEST</RequestId></Error>')
LM = {False: 'Mon, 12 Oct 2026 09:00:00 GMT', True: 'Tue, 13 Oct 2026 09:00:00 GMT'}
# The swapped bytes: every byte XOR 0xA5 (bytes.translate, fast enough for 24 MiB).
XOR = bytes(i ^ 0xA5 for i in range(256))
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
        if p == '/flag':
            key = q.get('k', '')
            with LOCK:
                FLAGS.add(key)
            out = {'flag': key}
            if q.get('f'):
                out['sha256'] = self.digest(fixture(q['f']), 'tail' if q.get('tail') == '1' else 'swapped')
            return self.text(200, json.dumps(out), 'application/json')
        if p == '/drop':
            key = q.get('k', '')
            with LOCK:
                DROP[key] = time.time() + float(q.get('for', '60'))
            return self.text(200, json.dumps({'drop': key, 'until': DROP[key]}), 'application/json')
        if p == '/busy':
            key = q.get('k', '')
            with LOCK:
                BUSY[key] = (time.time() + float(q.get('for', '90')), q.get('ra', ''))
            return self.text(200, json.dumps({'busy': key, 'until': BUSY[key][0]}), 'application/json')
        if p == '/slow':
            key = q.get('k', '')
            with LOCK:
                SLOW[key] = (time.time() + float(q.get('for', '10')), float(q.get('ms', '1500')) / 1000)
            return self.text(200, json.dumps({'slow': key, 'until': SLOW[key][0]}), 'application/json')
        if p.startswith('/net/'):
            return self.net(p[len('/net/'):], q, rate)
        if p.startswith('/loop/'):
            self.record(status=302)
            self.send_response(302)
            self.send_header('Location', '/loop/b' if p == '/loop/a' else '/loop/a')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if p == '/dupcl':
            self.record(status=200)
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', '4096')
            self.send_header('Content-Length', '9999')
            self.end_headers()
            self.wfile.write(b'x' * 4096)
            self.close_connection = True
            return
        if p == '/expired-page.html':
            self.record(status=200)
            return self.text(200, EXPIRED_PAGE)
        if p.startswith('/expire/'):
            return self.expire(p[len('/expire/'):], q, rate)
        if p.startswith('/swap/'):
            return self.swap(p[len('/swap/'):], q, rate)
        if p.startswith('/morph/'):
            return self.morph(p[len('/morph/'):], q, rate)
        if p.startswith('/sign/'):
            return self.sign(p[len('/sign/'):], q, once=False)
        if p.startswith('/signed-once/'):
            return self.sign(p[len('/signed-once/'):], q, once=True)
        if p.startswith('/signed/'):
            return self.signed(p[len('/signed/'):], q, rate)
        if p.startswith('/mint/'):
            name = p[len('/mint/'):]
            if not fixture(name):
                return self.text(404, 'not found')
            self.record(status=200, minted=True)
            return self.text(200, json.dumps({'url': self.token(name, float(q.get('ttl', '600')), 0, q.get('rate', '0'))}), 'application/json')
        if p == '/attach.html':
            return self.attach_page(q)
        if p.startswith('/qsigned/'):
            return self.qsigned(p[len('/qsigned/'):], q, rate)
        if p.startswith('/qmint/'):
            name = p[len('/qmint/'):]
            if not fixture(name):
                return self.text(404, 'not found')
            self.record(status=200, minted=True)
            return self.text(200, json.dumps({'url': self.qtoken(name, float(q.get('ttl', '600')), q.get('name', ''), q.get('rate', '0'))}), 'application/json')
        if p.startswith('/onetime/'):
            return self.onetime(p[len('/onetime/'):], q, rate)
        if p == '/fetch.html':
            return self.fetch_page(q)
        if p == '/fetch':
            return self.fetch(q, rate)
        if p.startswith('/edge/'):
            return self.edge(p[len('/edge/'):], q, rate)
        if p.startswith('/flap/'):
            return self.flap(p[len('/flap/'):], q, rate)
        if p.startswith('/tail/'):
            return self.tail(p[len('/tail/'):], q, rate)
        if p.startswith('/whole/'):
            return self.whole(p[len('/whole/'):], q, rate)
        if p.startswith('/md5/'):
            path = fixture(p[len('/md5/'):])
            if not path:
                return self.text(404, 'not found')
            md5 = self.digest(path, 'md5') if q.get('good', '1') == '1' else base64.b64encode(hashlib.md5(b'not this file').digest()).decode()
            size = os.path.getsize(path)
            return self.send_part(path, 200, 0, size - 1, rate, [('Content-Length', str(size)), ('Content-MD5', md5)])
        if p == '/blob/big':
            return self.send_file(os.path.join(FIX, 'big.bin'), rate)
        if p == '/blob/medium':
            # ctype: another Content-Type for the same bytes (integrity: a text file sniffed as binary).
            return self.send_file(os.path.join(FIX, 'medium.bin'), rate, ctype=q.get('ctype', 'application/octet-stream'))
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

    def digest(self, path, kind):
        """md5 (base64, as Content-MD5 carries it) or the sha256 of the swapped bytes (hex; 'tail': swapped
        from TAIL on, as /tail sends them), once per file."""
        with LOCK:
            hit = DIGESTS.get((path, kind))
        if hit:
            return hit
        h = hashlib.md5() if kind == 'md5' else hashlib.sha256()
        with open(path, 'rb') as f:
            if kind == 'tail':
                h.update(f.read(TAIL))
            for b in iter(lambda: f.read(1 << 20), b''):
                h.update(b if kind == 'md5' else b.translate(XOR))
        out = base64.b64encode(h.digest()).decode() if kind == 'md5' else h.hexdigest()
        with LOCK:
            DIGESTS[(path, kind)] = out
        return out

    def expire(self, name, q, rate):
        """/expire/<f>: the file until it expires (see the docstring), then what `how` says."""
        from urllib.parse import urlencode
        path = fixture(name)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        if path.endswith('.m3u8'):
            # Its segment addresses carry the same query, so they are the ones that expire.
            self.record(status=200)
            query = urlencode(q)
            with open(path, encoding='utf-8') as f:
                lines = [l if (l.startswith('#') or not l.strip()) else l.strip() + '?' + query for l in f.read().splitlines()]
            return self.text(200, chr(10).join(lines) + chr(10), MIME['.m3u8'])
        key = q.get('k', name)
        with LOCK:
            COUNTS[key] = COUNTS.get(key, 0) + 1
            expired = key in FLAGS or ('after' in q and COUNTS[key] > int(q['after']))
        if not expired:
            return self.send_file(path, rate, ctype=MIME.get(os.path.splitext(path)[1], 'application/octet-stream'))
        how = q.get('how', '403')
        self.record(status={'html200': 200, '302html': 302, '410': 410}.get(how, 403), expired=how)
        if how == 'html200':
            return self.text(200, EXPIRED_PAGE)
        if how == '302html':
            self.send_response(302)
            self.send_header('Location', '/expired-page.html')
            self.send_header('Content-Length', '0')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            return None
        if how == '410':
            return self.text(410, 'gone', 'text/plain; charset=utf-8')
        if how == '403xml':
            return self.text(403, EXPIRED_XML, 'application/xml')
        return self.text(403, 'forbidden', 'text/plain; charset=utf-8')

    def swap(self, name, q, rate):
        """/swap/<f>: Range and If-Range over the file, or over other bytes of the same size once flagged."""
        path = fixture(name)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        with LOCK:
            swapped = q.get('k', name) in FLAGS
        size = os.path.getsize(path)
        val = q.get('val', 'etag')
        tag = ('B' if swapped else 'A') + '-%x' % size
        etag = {'etag': '"%s"' % tag, 'weak': 'W/"%s"' % tag, 'drop': '' if swapped else '"%s"' % tag}.get(val, '')
        lm = LM[swapped] if val in ('lm', 'weak', 'drop') else ''
        headers = [('Accept-Ranges', 'bytes')]
        if etag:
            headers.append(('ETag', etag))
        if lm:
            headers.append(('Last-Modified', lm))
        start, end, status = 0, size - 1, 200
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes='):
            if_range = self.headers.get('If-Range')
            ok = q.get('ifrange') == 'ignore' or if_range is None or (if_range == etag and not etag.startswith('W/')) or (if_range == lm and lm != '')
            if ok:
                a, _, b = rng[6:].partition('-')
                start = int(a) if a else max(0, size - int(b))
                end = min(size - 1, int(b)) if (a and b) else size - 1
                status = 206
                headers.append(('Content-Range', 'bytes %d-%d/%d' % (start, end, size)))
        headers.append(('Content-Length', str(end - start + 1)))
        cut = int(q.get('cut', '0')) if status == 206 else 0
        return self.send_part(path, status, start, end, rate, headers, xor=0xA5 if swapped and q.get('same') != '1' else 0, cut=cut)

    def morph(self, name, q, rate):
        """/morph/<f>: answers that change once flagged (see the docstring): the review of Phase 1's
        downloads of unknown length, and totals that a resume answer no longer gives."""
        path = fixture(name)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        with LOCK:
            flagged = q.get('k', name) in FLAGS
        etag = '"M1"'
        if not flagged and q.get('before', 'chunked') == 'chunked':
            return self.send_chunked(path, rate, [('ETag', etag)])
        size = os.path.getsize(path)
        total = min(size, int(q['short'])) if flagged and q.get('short') else size
        after = q.get('after', 'ranges') if flagged else 'ranges'
        headers = [('Accept-Ranges', 'bytes'), ('ETag', etag)]
        start, end, status = 0, total - 1, 200
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes=') and after != 'norange':
            a, _, b = rng[6:].partition('-')
            start = int(a) if a else max(0, total - int(b))
            end = min(total - 1, int(b)) if (a and b) else total - 1
            status = 206
            headers.append(('Content-Range', 'bytes %d-%d/%s' % (start, end, '*' if after == 'star' else total)))
        headers.append(('Content-Length', str(end - start + 1)))
        xor = 0xA5 if flagged and q.get('xor') == '1' else 0
        return self.send_part(path, status, start, end, 0 if flagged else rate, headers, xor=xor)

    def token(self, name, ttl, uses, rate):
        """A fresh /signed/ address for fixture `name`: valid for ttl seconds (0: no limit) and/or uses requests."""
        tok = os.urandom(8).hex()
        expires = time.time() + ttl if ttl else 0
        with LOCK:
            TOKENS[tok] = {'expires': expires, 'uses': uses, 'used': 0}
        query = ('Expires=%d&' % int(expires + 0.999) if expires else '') + 'rate=' + rate
        return '/signed/%s/%s?%s' % (tok, name, query)

    def qtoken(self, name, ttl, filename, rate, xor=False):
        """A fresh /qsigned/ address for fixture `name`: the token in the query, valid for ttl seconds (0: no limit)."""
        from urllib.parse import urlencode
        tok = os.urandom(8).hex()
        expires = time.time() + ttl if ttl else 0
        with LOCK:
            TOKENS[tok] = {'expires': expires, 'uses': 0, 'used': 0}
        query = [('tok', tok)] + ([('Expires', '%d' % int(expires + 0.999))] if expires else []) + [('rate', rate)]
        if filename:
            query.append(('name', filename))
        if xor:
            query.append(('xor', '1'))
        return '/qsigned/%s?%s' % (name, urlencode(query))

    def attach_page(self, q):
        """/attach.html: a download page whose links carry fresh signed addresses on every load (see the docstring)."""
        from html import escape
        self.record()
        key = q.get('k', 'attach')
        name = q.get('f', 'medium')
        if not fixture(name):
            return self.text(404, 'not found')
        with LOCK:
            first = ('attach-' + key) not in SIGNED_KEYS
            SIGNED_KEYS.add('attach-' + key)
        ttl = float(q.get('ttl', '600')) if first else float(q.get('ttl2', '600'))
        filename = q.get('name', 'song.mp3')
        rate = q.get('rate', '0')
        dl = self.qtoken(name, ttl, filename, rate)
        changed = self.qtoken(name, 600, filename, q.get('crate', rate), xor=True)
        once = '/onetime/%s?k=%s&rate=%s&name=once.bin' % (name, os.urandom(6).hex(), rate)
        return self.text(200, '<!doctype html><meta charset=utf-8><title>Tideline · %s</title>'
                         '<style>%s</style><main><h1>%s</h1><p>tideline.fm</p><ul>'
                         '<li><a id="dl" href="%s">Download %s</a></li>'
                         '<li><a id="changed" href="%s">Download %s (remastered)</a></li>'
                         '<li><a id="other" href="/named?name=other.bin">Liner notes</a></li>'
                         '<li><a id="once" href="%s">A one-time link</a></li>'
                         '</ul></main>' % (escape(filename), STYLE, escape(filename), escape(dl), escape(filename), escape(changed), escape(filename), escape(once)),
                         headers=[('Set-Cookie', SID + '; Path=/')])

    def qsigned(self, name, q, rate):
        """/qsigned/<f>?tok=: the file while its token works (other bytes with xor=1), then 403; a running transfer is cut at expiry."""
        from urllib.parse import quote
        path = fixture(name)
        tok = q.get('tok', '')
        with LOCK:
            t = TOKENS.get(tok)
            ok = bool(t) and bool(path) and (not t['expires'] or time.time() < t['expires'])
        if not ok:
            self.record(status=403, expired='token')
            return self.text(403, 'Request has expired', 'text/plain; charset=utf-8')
        extra = [('Content-Disposition', "attachment; filename*=UTF-8''" + quote(q['name'], safe=''))] if q.get('name') else []
        if q.get('xor') != '1':
            return self.send_file(path, rate, extra=extra, until=t['expires'])
        size = os.path.getsize(path)
        etag = '"X%x"' % size
        headers = [('Accept-Ranges', 'bytes'), ('ETag', etag)] + extra
        start, end, status = 0, size - 1, 200
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes=') and self.headers.get('If-Range') in (None, etag):
            a, _, b = rng[6:].partition('-')
            start = int(a) if a else max(0, size - int(b))
            end = min(size - 1, int(b)) if (a and b) else size - 1
            status = 206
            headers.append(('Content-Range', 'bytes %d-%d/%d' % (start, end, size)))
        headers.append(('Content-Length', str(end - start + 1)))
        return self.send_part(path, status, start, end, rate, headers, xor=0xA5)

    def fetch_page(self, q):
        """/fetch.html: two files behind one script (/fetch?f=...), fresh tokens on every load (see the docstring)."""
        from html import escape
        from urllib.parse import urlencode
        self.record()
        key = q.get('k', 'fetch')
        with LOCK:
            first = ('fetch-' + key) not in SIGNED_KEYS
            SIGNED_KEYS.add('fetch-' + key)
        ttl = float(q.get('ttl', '600')) if first else 600.0
        anon = q.get('anon') == '1'

        def link(f, ttl, name, rate, cap=0):
            tok = os.urandom(8).hex()
            with LOCK:
                TOKENS[tok] = {'expires': time.time() + ttl, 'uses': 0, 'used': 0}
            query = [('f', f), ('tok', tok)] + ([('cap', str(cap))] if cap else []) + ([] if anon else [('name', name)]) + [('rate', rate)]
            return '/fetch?' + urlencode(query)

        a = link('medium', ttl, 'a.bin', q.get('rate', '0'))
        b = link('big', 600, 'b.bin', '0', cap=3 << 20)
        return self.text(200, '<!doctype html><meta charset=utf-8><title>Files</title><style>%s</style><main><h1>Files</h1><ul>'
                         '<li><a id="a" href="%s">a.bin</a></li><li><a id="b" href="%s">b.bin</a></li></ul></main>' % (STYLE, escape(a), escape(b)),
                         headers=[('Set-Cookie', SID + '; Path=/')])

    def fetch(self, q, rate):
        """/fetch?f=F&tok=T: fixture F (its first `cap` bytes) while the token works, then 403 (see the docstring)."""
        from urllib.parse import quote
        path = fixture(q.get('f', ''))
        with LOCK:
            t = TOKENS.get(q.get('tok', ''))
            ok = bool(t) and bool(path) and time.time() < t['expires']
        if not ok:
            self.record(status=403, expired='token')
            return self.text(403, 'Request has expired', 'text/plain; charset=utf-8')
        size = os.path.getsize(path)
        cap = int(q.get('cap', '0') or 0)
        if 0 < cap < size:
            size = cap
        etag = '"F%s-%x"' % (q.get('f', ''), size)
        headers = [('Accept-Ranges', 'bytes'), ('ETag', etag)]
        if q.get('name'):
            headers.append(('Content-Disposition', "attachment; filename*=UTF-8''" + quote(q['name'], safe='')))
        start, end, status = 0, size - 1, 200
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes=') and self.headers.get('If-Range') in (None, etag):
            a, _, b = rng[6:].partition('-')
            start = int(a) if a else max(0, size - int(b))
            end = min(size - 1, int(b)) if (a and b) else size - 1
            if start >= size:
                self.record(status=416)
                return self.text(416, '', headers=[('Content-Range', 'bytes */%d' % size)])
            status = 206
            headers.append(('Content-Range', 'bytes %d-%d/%d' % (start, end, size)))
        headers.append(('Content-Length', str(end - start + 1)))
        return self.send_part(path, status, start, end, rate, headers)

    def onetime(self, name, q, rate):
        """/onetime/<f>?k=: the file for the first request per KEY, then a 410 page (a one-time link)."""
        from urllib.parse import quote
        path = fixture(name)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        key = 'onetime-' + q.get('k', name)
        with LOCK:
            used = key in ONCE
            ONCE.add(key)
        if used:
            self.record(status=410, expired='onetime')
            return self.text(410, EXPIRED_PAGE)
        extra = [('Content-Disposition', "attachment; filename*=UTF-8''" + quote(q.get('name', 'once.bin'), safe=''))]
        return self.send_file(path, rate, extra=extra)

    def sign(self, name, q, once):
        """/sign/<f> and /signed-once/<f>: a 302 to a fresh signed address (see the docstring)."""
        if not fixture(name):
            self.record(status=404)
            return self.text(404, 'not found')
        key = q.get('k', name)
        with LOCK:
            used = once and key in ONCE
            if once:
                ONCE.add(key)
            first = key not in SIGNED_KEYS
            SIGNED_KEYS.add(key)
        if used:
            with LOCK:
                if ('revive-' + key) in FLAGS:
                    FLAGS.discard('revive-' + key)
                    used = False
        if used:
            with LOCK:
                hang = ('hang-' + key) in FLAGS
            self.record(status=403, expired='once', hang=hang)
            if hang:
                time.sleep(float(q.get('hang', '60')))
            return self.text(403, 'Request has expired', 'text/plain; charset=utf-8')
        ttl = float(q.get('ttl', '0')) if first else float(q.get('ttl2', '600'))
        if not first and q.get('delay2'):
            time.sleep(float(q['delay2']))
        uses = int(q.get('uses', '0')) if first else int(q.get('uses2', '0'))
        where = self.token(name, ttl, uses, q.get('rate', '0'))
        self.record(status=302, location=where)
        self.send_response(302)
        self.send_header('Location', where)
        self.send_header('Content-Length', '0')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        return None

    def signed(self, rest, q, rate):
        """/signed/<tok>/<f>: the file while its token works, then 403; a running transfer is cut at expiry."""
        tok, _, name = rest.partition('/')
        path = fixture(name)
        with LOCK:
            t = TOKENS.get(tok)
            ok = bool(t) and bool(path) and (not t['expires'] or time.time() < t['expires']) and (not t['uses'] or t['used'] < t['uses'])
            if ok:
                t['used'] += 1
        if not ok:
            self.record(status=403, expired='token')
            return self.text(403, 'Request has expired', 'text/plain; charset=utf-8')
        return self.send_file(path, rate, ctype=MIME.get(os.path.splitext(path)[1], 'application/octet-stream'), until=t['expires'])

    def edge(self, name, q, rate):
        """/edge/<f>: the same bytes under a new ETag on every answer, If-Range by that ETag (never) or Last-Modified."""
        path = fixture(name)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        with LOCK:
            EDGE['n'] += 1
            etag = '"E%d"' % EDGE['n']
        lm = LM[False] if q.get('lm', '1') != '0' else ''
        size = os.path.getsize(path)
        headers = [('Accept-Ranges', 'bytes'), ('ETag', etag)] + ([('Last-Modified', lm)] if lm else [])
        start, end, status = 0, size - 1, 200
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes='):
            if_range = self.headers.get('If-Range')
            if if_range is None or if_range == etag or (lm and if_range == lm):
                a, _, b = rng[6:].partition('-')
                start = int(a) if a else max(0, size - int(b))
                end = min(size - 1, int(b)) if (a and b) else size - 1
                status = 206
                headers.append(('Content-Range', 'bytes %d-%d/%d' % (start, end, size)))
        headers.append(('Content-Length', str(end - start + 1)))
        return self.send_part(path, status, start, end, rate, headers, etag=etag)

    def flap(self, name, q, rate):
        """/flap/<f>: two backends taking turns, each with its own ETag and Last-Modified over the same bytes."""
        path = fixture(name)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        with LOCK:
            FLAP['n'] += 1
            backend = 'A' if FLAP['n'] % 2 else 'B'
        size = os.path.getsize(path)
        etag = '"%s-%x"' % (backend, size)
        lm = LM[backend == 'B']
        headers = [('Accept-Ranges', 'bytes'), ('ETag', etag), ('Last-Modified', lm)]
        start, end, status = 0, size - 1, 200
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes='):
            if_range = self.headers.get('If-Range')
            if if_range is None or if_range == etag or if_range == lm:
                a, _, b = rng[6:].partition('-')
                start = int(a) if a else max(0, size - int(b))
                end = min(size - 1, int(b)) if (a and b) else size - 1
                status = 206
                headers.append(('Content-Range', 'bytes %d-%d/%d' % (start, end, size)))
        headers.append(('Content-Length', str(end - start + 1)))
        return self.send_part(path, status, start, end, rate, headers, backend=backend)

    def tail(self, name, q, rate):
        """/tail/<f>: Range, If-Range ignored; once flagged, other bytes from TAIL on under another ETag."""
        path = fixture(name)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        with LOCK:
            swapped = q.get('k', name) in FLAGS
        size = os.path.getsize(path)
        headers = [('Accept-Ranges', 'bytes'), ('ETag', '"T2"' if swapped else '"T1"')]
        start, end, status = 0, size - 1, 200
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes='):
            a, _, b = rng[6:].partition('-')
            start = int(a) if a else max(0, size - int(b))
            end = min(size - 1, int(b)) if (a and b) else size - 1
            status = 206
            headers.append(('Content-Range', 'bytes %d-%d/%d' % (start, end, size)))
        headers.append(('Content-Length', str(end - start + 1)))
        return self.send_part(path, status, start, end, 0 if swapped else rate, headers, xor=0xA5 if swapped else 0, xor_from=TAIL, swapped=swapped)

    def whole(self, name, q, rate):
        """/whole/<f>?size=N: N bytes of <f>; a Range over all of them is answered with the whole file (a 200)."""
        path = fixture(name)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        size = min(os.path.getsize(path), int(q.get('size', '40960')))
        etag = '"W1-%x"' % size
        headers = [('Accept-Ranges', 'bytes'), ('ETag', etag)]
        start, end, status = 0, size - 1, 200
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes=') and self.headers.get('If-Range') in (None, etag):
            a, _, b = rng[6:].partition('-')
            start = int(a) if a else max(0, size - int(b))
            end = min(size - 1, int(b)) if (a and b) else size - 1
            if start == 0 and end == size - 1:
                status = 200
            else:
                status = 206
                headers.append(('Content-Range', 'bytes %d-%d/%d' % (start, end, size)))
        headers.append(('Content-Length', str(end - start + 1)))
        return self.send_part(path, status, start, end, rate, headers)

    def send_chunked(self, path, rate, headers):
        """All of `path` as a chunked 200 (no Content-Length) whatever Range asked; logged like send_file."""
        entry = self.record(status=200, chunked=True)
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Transfer-Encoding', 'chunked')
        self.send_header('Cache-Control', 'no-store')
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        sent = 0
        t0 = time.time()
        try:
            with open(path, 'rb') as f:
                while True:
                    b = f.read(16384)
                    if not b:
                        break
                    self.wfile.write(b'%x\r\n' % len(b) + b + b'\r\n')
                    sent += len(b)
                    if rate:
                        ahead = sent / rate - (time.time() - t0)
                        if ahead > 0:
                            time.sleep(ahead)
            self.wfile.write(b'0\r\n\r\n')
        finally:
            entry['sent'] = sent
            entry['secs'] = round(time.time() - t0, 3)

    def send_part(self, path, status, start, end, rate, headers, xor=0, cut=0, xor_from=0, **extra):
        """Bytes start..end of `path` (swapped when `xor`, from file offset `xor_from` on), with the headers
        given; logged like send_file (with `extra` in the log entry). With `cut`, only that many bytes are
        sent and the connection closes."""
        length = end - start + 1
        entry = self.record(status=status, start=start, end=end, **extra)
        self.send_response(status)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Cache-Control', 'no-store')
        for k, v in headers:
            self.send_header(k, v)
        self.end_headers()
        sent = 0
        t0 = time.time()
        try:
            with open(path, 'rb') as f:
                f.seek(start)
                chunk = 16384 if rate else 262144
                while sent < length:
                    if cut and sent >= cut:
                        self.close_connection = True
                        break
                    b = f.read(min(chunk, length - sent, cut - sent if cut else length))
                    if not b:
                        break
                    if xor:
                        keep = max(0, min(len(b), xor_from - (start + sent)))
                        b = b[:keep] + b[keep:].translate(XOR)
                    self.wfile.write(b)
                    sent += len(b)
                    if rate:
                        ahead = sent / rate - (time.time() - t0)
                        if ahead > 0:
                            time.sleep(ahead)
        finally:
            entry['sent'] = sent
            entry['secs'] = round(time.time() - t0, 3)

    def dropping(self, key):
        with LOCK:
            return time.time() < DROP.get(key, 0)

    def reset(self):
        """The connection goes away with a reset (an RST: SO_LINGER 0) and no answer, as when the network
        drops: the socket is really closed once the handler's files are (finish())."""
        self.close_connection = True
        try:
            self.connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
            self.connection.close()
        except OSError:
            pass

    def net(self, name, q, rate):
        """/net/<f>: <f> while its network is there (see the docstring)."""
        path = fixture(name)
        if not path:
            return self.text(404, 'not found')
        key = q.get('k', '')
        if self.dropping(key):
            self.record(status=0, dropped=True)
            return self.reset()
        with LOCK:
            busy = BUSY.get(key)
            slow = SLOW.get(key)
        if slow and time.time() < slow[0]:
            time.sleep(slow[1])
        if busy and time.time() < busy[0]:
            self.record(status=503)
            return self.text(503, 'busy', 'text/plain; charset=utf-8', headers=[('Retry-After', busy[1])] if busy[1] else ())
        return self.send_file(path, rate, cut=lambda: self.dropping(key))

    def send_file(self, path, rate, extra=(), ctype='application/octet-stream', until=0, cut=None):
        """`path` with Range and If-Range (ETag size-mtime); with `until` (a time), a transfer still running
        then is cut: the connection closes, as a signed address that expired mid-transfer. With `cut` (a
        function), a transfer still running when it says so is reset (/net's /drop)."""
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
                    if until and time.time() >= until:
                        entry['cut'] = True
                        self.close_connection = True
                        break
                    if cut and cut():
                        entry['dropped'] = True
                        self.reset()
                        break
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


def fixture(name):
    """A fixture by its address name ("medium" is medium.bin), or None outside the fixtures or when missing."""
    path = os.path.normpath(os.path.join(FIX, name))
    if not path.startswith(FIX):
        return None
    if not os.path.isfile(path) and os.path.isfile(path + '.bin'):
        path += '.bin'
    return path if os.path.isfile(path) else None


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
