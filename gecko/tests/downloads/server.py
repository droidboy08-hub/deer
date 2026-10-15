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
  /corrupt-once/<f>?k=KEY&block=N&bs=B&rate=
                            <f> with Range and If-Range (a strong ETag) and its Repr-Digest (sha-256 of the true
                            file) on every answer; the first answer per KEY whose bytes cover block N (of B bytes,
                            default 1 MiB) has one byte of that block wrong (the middle one, XOR 0xFF): a network
                            that delivered wrong bytes once (Phase 5 of RESUME-DESIGN.md, 4.3)
  /vary/<f>?val=none|lm|weak|etag&k=KEY&rate=&rate0=&full=1&size=N&swap=KEY2
                            <f> with Range, If-Range honoured for the validators sent (review of Phase 5): val picks
                            them (none: neither an ETag nor a Last-Modified; lm: Last-Modified only; weak: a weak
                            ETag and Last-Modified; etag: a strong ETag); rate0 (KB/s) throttles the answers that
                            start at byte 0 instead of rate (one segment faster than the others); size=N serves
                            the first N bytes as a file of N bytes. Once /flag?k=KEY was asked, or with full=1 once
                            the bytes sent for KEY covered the whole file (a link that allows one full download),
                            every request answers 403 "Request has expired"; once /flag?k=KEY2 was asked (swap),
                            other bytes of the same size (XOR 0xA5) under other validators
  /vsign/<f>?k=KEY&...      a 302 to /vary/<f> with a fresh key (KEY-<n>) and the rest of the query: a redirector
                            that mints a new signed address on every request (review of Phase 5)
  /loop/a                   a 302 to /loop/b and back, for ever (NS_ERROR_REDIRECT_LOOP) | /dupcl  a 200 with two Content-Length
                            headers that disagree (NS_ERROR_CORRUPTED_CONTENT): failures no wait fixes (review of Phase 4)
  Streams that expire or change (Phase 6 of RESUME-DESIGN.md; K is the test's key, segments are numbered from 0):
  /vod-sign/K/master.m3u8[?mt=T]
                            the HLS master (hls/master.m3u8) whose variant addresses carry a token minted on every
                            read: K/<tok>/v360/index.m3u8. Without mt it never expires (a stable master); with mt
                            (a master token /vod-page.html minted) it answers 403 once that token died
  /vod-sign/K/<tok>/<rend>/<file>
                            the variant playlist, its segments and its key (hls/<rend>/...) while <tok> lives; then 403
                            "Request has expired" (the variant and segment tokens expire together)
  /vod-expire?k=K           every token minted for K so far dies (variant, segment and master tokens)
  /vod-page.html?k=K&only=H a video page (the VIDEO template, title "Molten...") whose player fetched the master
                            /vod-sign/K/master.m3u8?mt=<a fresh master token>; with only=180 the master offers only
                            that rendition (the page's 360p is no longer offered); once /flag?k=K-twin (review of
                            Phase 7) the player then also fetches /vod-reenc/K-twin/hls/master.m3u8, another stream
                            of the same length and host (other bytes), the latest fetched
  /vod-reenc/K/<path>       /fx/<path> (hls/v360/...); once /flag?k=K the TS segments are other bytes of the same
                            size (every byte XOR 0xA5 but the 0x47 sync bytes): the same count, re-encoded
  /dash-rename/K/<path>     /fx/<path> (dash/...); once /flag?k=K the manifest names its representations v360 and a96
                            instead of 0 and 1 (their segment addresses follow, through $RepresentationID$), and the
                            old addresses answer 404
  /vod-html/K/<N>/<path>    /fx/<path> (hls/v360/...) whose segment N always answers 200 with a web page
  From the review of Phase 6:
  /vod-trap?k=K&from=N      /vod-sign/K: the tokens minted so far answer their variant playlist once more and then
                            403, and their segments N and later 403 at once; tokens minted after the trap give
                            re-encoded segments (every byte XOR 0xA5 but the 0x47 sync bytes), the same count and
                            durations (a proof of one playlist must never stand for another)
  /dash-rename/K/<path>     (above) once /flag?k=K-reenc too, the renamed video chunks are other bytes (XOR 0xA5
                            after their first 8): renamed AND re-encoded
  /vod-trunc/K/<path>       /fx/<path> (hls/v360/...); once /flag?k=K a media playlist lists only its first 6
                            segments (a shorter playlist of the same first segments): Repair must refuse it
  /vod-init/K/<path>        /fx/<path> (hlsfmp4/...); once /flag?k=K the init segments answer 404; segments hold
  /vod-asign/K/master.m3u8  the fMP4 master (hlsfmp4) whose variant AND audio rendition carry a token minted on every
                            read: K/<tok>/<video|audio>/<file> while the token lives (/vod-expire?k=K), then 403;
                            audio segments hold
  /vod-br/K/index.m3u8?be=stable|flap|edge  and  /vod-br/K/all.ts?be=
                            HLS byte ranges (EXT-X-BYTERANGE) over one file, the 12 360p segments joined. be=stable:
                            one ETag; flap: two backends taking turns, each with its own ETag and Last-Modified;
                            edge: a new ETag on every answer, one Last-Modified. If-Range is honoured against the
                            answering backend's validators (else a 200 with the whole file). Once /flag?k=K: other
                            bytes (XOR 0xA5 but the sync bytes) under other validators. A range that starts in
                            segment N holds (/vod-hold)
  /vod-hold?k=K&from=N      segments N and later of K's routes above wait until the hold changes (from=-1: none;
                            at most 90 s), so a test pauses a stream at a known segment
  The background page step (Phase 7 of RESUME-DESIGN.md: a download's page opened out of sight):
  /page/<id>.html?f=F&name=N&ttl=S&ttl2=S2&rate=R&rate2=R2&v=link|auto|click|login|elsewhere|twin|other|audio|popup|iframe&pc=1
                            a download page that mints a fresh signed address of fixture F (as N) on every load:
                            the first load or mint per id is valid for S seconds at R KB/s, later ones for S2
                            (default 600) at R2 (default 0). v=link: #dl is that address (/qsigned/), with an
                            unrelated #notes (/named) and #home; auto: no link, the page goes to the address by
                            itself 300 ms after it loads (a download the page starts); click: the address only
                            appears after a click on #go, which also asks /page/<id>/clicked (so a test sees a
                            click); login: a sign-in form with a password field and no address; elsewhere: a 302
                            to http://localhost:<port>/signin.html (another site). pc=1 (a cookie scoped to one
                            container): the first load sets pc_<id>, later loads never do, and the address is
                            /pfile/<id>/F, which answers only to that cookie. From the review of Phase 7:
                            login also asks /page/<id>/filled once its password field has a value (a saved
                            login filled in); twin: another file of the same name and size, other bytes
                            (/qsigned/ xor=1), listed above the address; other: that file alone; audio: no link,
                            a <video> of /media/clip that plays by itself (with sound) where the site may
                            autoplay, asking /page/<id>/played once it plays; popup: the address, plus
                            window.open while the page is read, on load and
                            sized, and a target=_blank link it clicks itself, each reported as
                            /page/<id>/opened?how=H&got=1|0 (got: window.open gave a window); iframe: no link,
                            a frame removed as soon as it is added, then the address loaded in a frame the page
                            removes 150 ms later
  /page/<id>.json?...       the same parameters: {"url": the address the page would show}, recorded as a mint, not
                            as a page load (a test starts the download from it)
  /page/<id>/clicked        recorded only: the page's #go was clicked
  /page/<id>/filled  /page/<id>/opened  /page/<id>/played
                            recorded only (with report=filled|opened|played): what the page reported about itself
  /pfile/<id>/<f>?tok=T&name=N&rate=
                            /qsigned/ that also needs the cookie /page/<id>.html?pc=1 set on its first load: 403
                            "no cookie" without it
  /signin.html              a sign-in service's page on another site (served as http://localhost:<port>)
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
import re
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
# /corrupt-once: the keys whose one wrong block was already sent.
CORRUPTED = set()
# /vary: per key, the [start, end) stretches already sent (full=1); /vsign's count of addresses minted.
SERVED = {}
MINTED = {'n': 0}
# /net: per key, until when its connections are reset (/drop) and until when it answers 503 (/busy, with
# its Retry-After).
DROP = {}
BUSY = {}
SLOW = {}
# The stream routes of Phase 6: tokens by name ({'k', 'dead', 'only'}), the count that names them, and each key's
# hold (segments from this number on wait; -1: none).
VOD = {'tokens': {}, 'n': 0, 'hold': {}, 'trap': {}, 'br': {}}
# /page/<id> (Phase 7): per id, whether its first load or mint happened and the cookie its first load set (pc=1).
PAGES = {}
RENAMED = {'0': 'v360', '1': 'a96'}
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
        if p == '/vod-hold':
            with LOCK:
                VOD['hold'][q.get('k', '')] = int(q.get('from', '-1'))
            return self.text(200, '{}', 'application/json')
        if p == '/vod-expire':
            key = q.get('k', '')
            with LOCK:
                for t in VOD['tokens'].values():
                    if t['k'] == key:
                        t['dead'] = True
            return self.text(200, '{}', 'application/json')
        if p == '/vod-page.html':
            key = q.get('k', 'vod')
            mt = self.vod_token(key, q.get('only', ''))
            self.record()
            script = "fetch('/vod-sign/%s/master.m3u8?mt=%s').then(r=>r.text())" % (key, mt)
            with LOCK:
                twin = (key + '-twin') in FLAGS
            if twin:
                # Review of Phase 7: once /flag?k=K-twin, the player then also fetches another stream of the same
                # length on the same host (/vod-reenc/K-twin/: other bytes, as the flag says), the latest fetched.
                script += ".then(() => fetch('/vod-reenc/%s-twin/hls/master.m3u8')).then(r=>r.text())" % key
            return self.text(200, VIDEO.replace('%STYLE%', STYLE).replace('%SCRIPT%', script).replace('%SRC%', 'src="/media/clip"'))
        if p.startswith('/vod-sign/'):
            return self.vod_sign(p[len('/vod-sign/'):], q, rate)
        if p.startswith('/vod-reenc/'):
            return self.vod_reenc(p[len('/vod-reenc/'):], rate)
        if p.startswith('/dash-rename/'):
            return self.dash_rename(p[len('/dash-rename/'):], rate)
        if p.startswith('/vod-html/'):
            return self.vod_html(p[len('/vod-html/'):], rate)
        if p == '/vod-trap':
            with LOCK:
                VOD['trap'][q.get('k', '')] = {'from': int(q.get('from', '6')), 'at': VOD['n'], 'reads': {}}
            return self.text(200, '{}', 'application/json')
        if p.startswith('/vod-trunc/'):
            return self.vod_trunc(p[len('/vod-trunc/'):], rate)
        if p.startswith('/vod-init/'):
            return self.vod_init(p[len('/vod-init/'):], rate)
        if p.startswith('/vod-asign/'):
            return self.vod_asign(p[len('/vod-asign/'):], rate)
        if p.startswith('/vod-br/'):
            return self.vod_br(p[len('/vod-br/'):], q)
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
        if p.startswith('/corrupt-once/'):
            return self.corrupt_once(p[len('/corrupt-once/'):], q, rate)
        if p.startswith('/vary/'):
            return self.vary(p[len('/vary/'):], q, rate)
        if p.startswith('/vsign/'):
            return self.vsign(p[len('/vsign/'):], q)
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
        if p.startswith('/page/'):
            return self.page_route(p[len('/page/'):], q)
        if p.startswith('/pfile/'):
            return self.pfile(p[len('/pfile/'):], q, rate)
        if p == '/signin.html':
            self.record(status=200)
            return self.text(200, '<!doctype html><meta charset=utf-8><title>Sign in · Accounts</title><style>%s</style>'
                             '<main><h1>Sign in to continue</h1><p>accounts.localhost</p></main>' % STYLE)
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
        """md5 (base64, as Content-MD5 carries it), the sha256 of the file (base64, as Repr-Digest carries it:
        'sha256') or the sha256 of the swapped bytes (hex; 'tail': swapped from TAIL on, as /tail sends them),
        once per file."""
        with LOCK:
            hit = DIGESTS.get((path, kind))
        if hit:
            return hit
        h = hashlib.md5() if kind == 'md5' else hashlib.sha256()
        with open(path, 'rb') as f:
            if kind == 'tail':
                h.update(f.read(TAIL))
            for b in iter(lambda: f.read(1 << 20), b''):
                h.update(b if kind in ('md5', 'sha256') else b.translate(XOR))
        out = base64.b64encode(h.digest()).decode() if kind in ('md5', 'sha256') else h.hexdigest()
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

    def corrupt_once(self, name, q, rate):
        """/corrupt-once/<f>: see the docstring. The wrong byte is only in the bytes sent, never in the file."""
        path = fixture(name)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        size = os.path.getsize(path)
        bs = int(q.get('bs', str(1 << 20)))
        block = int(q.get('block', '0'))
        etag = '"C-%x"' % size
        headers = [('Accept-Ranges', 'bytes'), ('ETag', etag), ('Repr-Digest', 'sha-256=:%s:' % self.digest(path, 'sha256'))]
        start, end, status = 0, size - 1, 200
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes=') and self.headers.get('If-Range') in (None, etag):
            a, _, b = rng[6:].partition('-')
            start = int(a) if a else max(0, size - int(b))
            end = min(size - 1, int(b)) if (a and b) else size - 1
            status = 206
            headers.append(('Content-Range', 'bytes %d-%d/%d' % (start, end, size)))
        headers.append(('Content-Length', str(end - start + 1)))
        at = block * bs + min(bs, size - block * bs) // 2
        flip = -1
        with LOCK:
            key = q.get('k', name)
            if key not in CORRUPTED and start <= at <= end:
                CORRUPTED.add(key)
                flip = at
        return self.send_part(path, status, start, end, rate, headers, flip=flip, corrupted=flip >= 0)

    def vary(self, name, q, rate):
        """/vary/<f>: see the docstring (review of Phase 5)."""
        path = fixture(name)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        size = os.path.getsize(path)
        if q.get('size'):
            size = min(size, int(q['size']))
        key = q.get('k', name)
        with LOCK:
            covered, top = 0, 0
            for a, b in sorted(SERVED.get(key, [])):
                if b > top:
                    covered += b - max(a, top)
                    top = b
            refused = key in FLAGS or (q.get('full') == '1' and covered >= size)
            swapped = bool(q.get('swap')) and q['swap'] in FLAGS
        if refused:
            self.record(status=403, expired='vary')
            return self.text(403, 'Request has expired', 'text/plain; charset=utf-8')
        val = q.get('val', 'etag')
        tag = ('B' if swapped else 'A') + '-%x' % size
        etag = {'etag': '"%s"' % tag, 'weak': 'W/"%s"' % tag}.get(val, '')
        lm = LM[swapped] if val in ('lm', 'weak') else ''
        headers = [('Accept-Ranges', 'bytes')]
        if etag:
            headers.append(('ETag', etag))
        if lm:
            headers.append(('Last-Modified', lm))
        start, end, status = 0, size - 1, 200
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes='):
            if_range = self.headers.get('If-Range')
            if if_range is None or (if_range == etag and not etag.startswith('W/')) or (lm and if_range == lm):
                a, _, b = rng[6:].partition('-')
                start = int(a) if a else max(0, size - int(b))
                end = min(size - 1, int(b)) if (a and b) else size - 1
                status = 206
                headers.append(('Content-Range', 'bytes %d-%d/%d' % (start, end, size)))
        headers.append(('Content-Length', str(end - start + 1)))
        if start == 0 and q.get('rate0'):
            rate = float(q['rate0']) * 1024

        def sent(n):
            with LOCK:
                SERVED.setdefault(key, []).append((start, start + n))

        return self.send_part(path, status, start, end, rate, headers, xor=0xA5 if swapped else 0, sent_to=sent, swapped=swapped)

    def vsign(self, name, q):
        """/vsign/<f>: a 302 to /vary/<f> under a fresh key (see the docstring)."""
        from urllib.parse import urlencode
        if not fixture(name):
            self.record(status=404)
            return self.text(404, 'not found')
        with LOCK:
            MINTED['n'] += 1
            n = MINTED['n']
        rest = [(k, v) for k, v in q.items() if k != 'k']
        where = '/vary/%s?%s' % (name, urlencode([('k', '%s-%d' % (q.get('k', name), n))] + rest))
        self.record(status=302, location=where)
        self.send_response(302)
        self.send_header('Location', where)
        self.send_header('Content-Length', '0')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        return None

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

    def page_route(self, rest, q):
        """/page/<id>.html, /page/<id>.json, /page/<id>/clicked: the background page step's pages (see the docstring)."""
        import base64 as b64
        from html import escape
        from urllib.parse import urlencode
        if rest.endswith('/clicked'):
            self.record(status=200, clicked=True)
            return self.text(200, 'clicked', 'text/plain; charset=utf-8')
        # What a page reports about itself (review of Phase 7): its sign-in form was filled in, it opened a pop-up,
        # its player played.
        if rest.endswith(('/filled', '/opened', '/played')):
            self.record(status=200, report=rest.rsplit('/', 1)[1])
            return self.text(200, 'ok', 'text/plain; charset=utf-8')
        m = re.match(r'^([\w-]+)\.(html|json)$', rest)
        if not m:
            self.record(status=404)
            return self.text(404, 'not found')
        pid, kind = m.group(1), m.group(2)
        v = q.get('v', 'link')
        port = self.server.server_address[1]
        if kind == 'html' and v == 'elsewhere':
            where = 'http://localhost:%d/signin.html?k=%s' % (port, pid)
            self.record(status=302, location=where, page=pid)
            self.send_response(302)
            self.send_header('Location', where)
            self.send_header('Content-Length', '0')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            return None
        f = q.get('f', 'medium')
        if not fixture(f):
            self.record(status=404)
            return self.text(404, 'not found')
        filename = q.get('name', 'song.mp3')
        with LOCK:
            first = pid not in PAGES
            st = PAGES.setdefault(pid, {'cookie': ''})
        ttl = float(q.get('ttl', '600')) if first else float(q.get('ttl2', '600'))
        rate = q.get('rate', '0') if first else q.get('rate2', '0')
        headers = []
        if q.get('pc') == '1':
            # The cookie is set by the first load only: a later load in another container never gets it.
            if first:
                st['cookie'] = os.urandom(6).hex()
                if kind == 'html':
                    headers.append(('Set-Cookie', 'pc_%s=%s; Path=/' % (pid, st['cookie'])))
            tok = os.urandom(8).hex()
            with LOCK:
                TOKENS[tok] = {'expires': time.time() + ttl, 'uses': 0, 'used': 0}
            link = '/pfile/%s/%s?%s' % (pid, f, urlencode([('tok', tok), ('Expires', '%d' % int(time.time() + ttl + 0.999)), ('name', filename), ('rate', rate)]))
        else:
            link = self.qtoken(f, ttl, filename, rate)
        if kind == 'json':
            self.record(status=200, minted=True, page=pid)
            return self.text(200, json.dumps({'url': link}), 'application/json')
        self.record(status=200, page=pid, v=v)
        title = escape(filename)
        if v == 'auto':
            body = ('<p>Your download of %s starts in a moment.</p>'
                    '<script>setTimeout(() => { location.href = %s; }, 300);</script>' % (title, json.dumps(link)))
        elif v == 'click':
            body = ('<p><button id="go">Get the download link</button></p>'
                    '<script>const t = atob(%s); document.getElementById("go").addEventListener("click", () => {'
                    ' fetch("/page/%s/clicked"); const a = document.createElement("a"); a.id = "dl"; a.href = t;'
                    ' a.textContent = "Download"; document.querySelector("main").append(a); });</script>'
                    % (json.dumps(b64.b64encode(link.encode()).decode()), pid))
        elif v == 'login':
            # The page tells the server when its password field gets a value (a saved login filled in).
            body = ('<form id="login" action="/page/%s/clicked"><p><input id="user" name="user" placeholder="Email"></p>'
                    '<p><input id="pw" name="pw" type="password" placeholder="Password"></p><p><button>Sign in</button></p></form>'
                    '<p><a id="notes" href="/named?name=notes.txt">Liner notes</a></p>'
                    '<script>const pw = document.getElementById("pw"); const t = setInterval(() => {'
                    ' if (pw.value) { clearInterval(t); fetch("/page/%s/filled"); } }, 100);</script>' % (pid, pid))
        elif v in ('twin', 'other'):
            # Another file of the same name and size, other bytes (xor=1), listed above the address (twin) or alone
            # (other): a 64-bit installer above the 32-bit one, or the 32-bit one gone from the page.
            twin = self.qtoken(f, 600, filename, rate, xor=True)
            items = '<li><a id="twin" href="%s">Download %s (64-bit)</a></li>' % (escape(twin), title)
            if v == 'twin':
                items += '<li><a id="dl" href="%s">Download %s</a></li>' % (escape(link), title)
            body = '<ul>%s<li><a id="notes" href="/named?name=notes.txt">Liner notes</a></li></ul>' % items
        elif v == 'audio':
            # A player that plays by itself (with sound) where the site may autoplay, telling the server once it
            # plays; no link to the file.
            body = ('<p><video id="v" autoplay loop src="/media/clip" style="width:320px"></video></p>'
                    '<script>document.getElementById("v").addEventListener("playing", () => fetch("/page/%s/played"), { once: true });</script>' % pid)
        elif v == 'popup':
            # A page that opens pop-ups by itself where the site may (window.open while it is read, on load, a sized
            # one, and a target=_blank link it clicks itself), telling the server whether each got a window.
            body = ('<ul><li><a id="dl" href="%s">Download %s</a></li><li><a id="blank" target="_blank" href="/links.html?popup=blank">Notes</a></li></ul>'
                    '<script>const tell = (how, w) => fetch("/page/%s/opened?how=" + how + "&got=" + (w ? 1 : 0));'
                    ' tell("parse", window.open("/links.html?popup=parse"));'
                    ' addEventListener("load", () => { tell("load", window.open("/links.html?popup=load", "_blank"));'
                    ' tell("sized", window.open("/links.html?popup=sized", "x", "width=300,height=300"));'
                    ' document.getElementById("blank").click(); });</script>' % (escape(link), title, pid))
        elif v == 'iframe':
            # No link: a frame that lives only a moment (removed as soon as it is added), then the address loaded in
            # a frame the page removes 150 ms later (the download it started outlives its frame).
            body = ('<p>Your download of %s starts in a moment.</p><script>addEventListener("load", () => setTimeout(() => {'
                    ' const g = document.createElement("iframe"); g.src = "/links.html?frame=blink"; document.body.append(g); g.remove();'
                    ' const f = document.createElement("iframe"); f.src = %s; document.body.append(f);'
                    ' setTimeout(() => f.remove(), 150); }, 300));</script>' % (title, json.dumps(link)))
        else:
            body = ('<ul><li><a id="dl" href="%s">Download %s</a></li>'
                    '<li><a id="notes" href="/named?name=notes.txt">Liner notes</a></li>'
                    '<li><a id="home" href="/">Tideline</a></li></ul>' % (escape(link), title))
        return self.text(200, '<!doctype html><meta charset=utf-8><title>Tideline · %s</title><style>%s</style>'
                         '<main><h1>%s</h1><p>tideline.fm</p>%s</main>' % (title, STYLE, title, body), headers=headers)

    def pfile(self, rest, q, rate):
        """/pfile/<id>/<f>?tok=: /qsigned/ that answers only to the cookie /page/<id>.html?pc=1 set (see the docstring)."""
        from urllib.parse import quote
        pid, _, name = rest.partition('/')
        path = fixture(name)
        with LOCK:
            want = PAGES.get(pid, {}).get('cookie', '')
            t = TOKENS.get(q.get('tok', ''))
            ok = bool(t) and bool(path) and time.time() < t['expires']
        cookie = 'pc_%s=%s' % (pid, want)
        if not want or cookie not in self.headers.get('Cookie', ''):
            self.record(status=403, expired='cookie')
            return self.text(403, 'no cookie', 'text/plain; charset=utf-8')
        if not ok:
            self.record(status=403, expired='token')
            return self.text(403, 'Request has expired', 'text/plain; charset=utf-8')
        extra = [('Content-Disposition', "attachment; filename*=UTF-8''" + quote(q['name'], safe=''))] if q.get('name') else []
        return self.send_file(path, rate, extra=extra, until=t['expires'])

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

    def send_part(self, path, status, start, end, rate, headers, xor=0, cut=0, xor_from=0, flip=-1, sent_to=None, **extra):
        """Bytes start..end of `path` (swapped when `xor`, from file offset `xor_from` on; the byte at file
        offset `flip` XOR 0xFF), with the headers given; logged like send_file (with `extra` in the log
        entry). With `cut`, only that many bytes are sent and the connection closes. `sent_to(n)` is told
        how many bytes went out, however the answer ended."""
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
                    if 0 <= flip - (start + sent) < len(b):
                        i = flip - (start + sent)
                        b = b[:i] + bytes([b[i] ^ 0xFF]) + b[i + 1:]
                    self.wfile.write(b)
                    sent += len(b)
                    if rate:
                        ahead = sent / rate - (time.time() - t0)
                        if ahead > 0:
                            time.sleep(ahead)
        finally:
            entry['sent'] = sent
            entry['secs'] = round(time.time() - t0, 3)
            if sent_to:
                sent_to(sent)

    # ---- streams that expire or change (Phase 6) ----

    def vod_token(self, key, only=''):
        with LOCK:
            VOD['n'] += 1
            tok = 't%d' % VOD['n']
            VOD['tokens'][tok] = {'k': key, 'dead': False, 'only': only}
        return tok

    def vod_alive(self, tok, key):
        with LOCK:
            t = VOD['tokens'].get(tok)
            return bool(t) and t['k'] == key and not t['dead']

    def vod_hold(self, key, index):
        """A segment at or after the key's hold waits while it holds (at most 90 s)."""
        t0 = time.time()
        while time.time() - t0 < 90:
            with LOCK:
                hold = VOD['hold'].get(key, -1)
            if hold < 0 or index < hold:
                return
            time.sleep(0.05)

    def vod_playlist(self, path):
        self.record(status=200)
        with open(path, encoding='utf-8') as f:
            return self.text(200, f.read(), MIME['.m3u8'])

    def vod_sign(self, rest, q, rate):
        """/vod-sign/K/master.m3u8 and /vod-sign/K/<tok>/<rend>/<file> (see the docstring)."""
        parts = rest.split('/')
        key = parts[0]
        if len(parts) == 2 and parts[1] == 'master.m3u8':
            only = ''
            mt = q.get('mt')
            if mt is not None:
                if not self.vod_alive(mt, key):
                    self.record(status=403, expired='master')
                    return self.text(403, EXPIRED_XML, 'application/xml')
                with LOCK:
                    only = VOD['tokens'][mt]['only']
            tok = self.vod_token(key)
            out = []
            skip = False
            with open(fixture('hls/master.m3u8'), encoding='utf-8') as f:
                for line in f.read().splitlines():
                    if line.startswith('#EXT-X-STREAM-INF') and only and ('x%s,' % only) not in line:
                        skip = True
                        continue
                    if skip:
                        skip = False
                        continue
                    out.append('%s/%s' % (tok, line) if line and not line.startswith('#') else line)
            self.record(status=200, master=tok)
            return self.text(200, '\n'.join(out) + '\n', MIME['.m3u8'])
        if len(parts) != 4:
            return self.text(404, 'not found')
        _, tok, rend, name = parts
        path = fixture('hls/%s/%s' % (rend, name))
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        m = re.match(r'seg(\d+)\.ts$', name)
        if m:
            self.vod_hold(key, int(m.group(1)))
        if not self.vod_alive(tok, key):
            self.record(status=403, expired=tok)
            return self.text(403, EXPIRED_XML, 'application/xml')
        with LOCK:
            trap = VOD['trap'].get(key)
        if trap is not None:
            n_tok = int(tok[1:]) if tok[1:].isdigit() else 0
            if n_tok <= trap['at']:
                # A token from before the trap: its playlist once more, then 403; its later segments 403.
                if name.endswith('.m3u8'):
                    with LOCK:
                        seen = trap['reads'].get(tok, 0)
                        trap['reads'][tok] = seen + 1
                    if seen >= 1:
                        self.record(status=403, expired=tok)
                        return self.text(403, EXPIRED_XML, 'application/xml')
                elif m and int(m.group(1)) >= trap['from']:
                    self.record(status=403, expired=tok)
                    return self.text(403, EXPIRED_XML, 'application/xml')
            elif m:
                return self.send_reenc(path)
        if name.endswith('.m3u8'):
            return self.vod_playlist(path)
        return self.send_file(path, rate, ctype=MIME.get(os.path.splitext(path)[1], 'application/octet-stream'))

    def send_reenc(self, path, keep=0):
        """A TS segment re-encoded: the same size, every byte XOR 0xA5 but the 0x47 sync bytes (with `keep`, the
        first `keep` bytes as they are and all others swapped: an fMP4 chunk)."""
        with open(path, 'rb') as f:
            raw = f.read()
        if keep:
            data = raw[:keep] + raw[keep:].translate(XOR)
        else:
            data = bytes(b if i % 188 == 0 else b ^ 0xA5 for i, b in enumerate(raw))
        entry = self.record(status=200, reenc=True, start=0, end=len(data) - 1)
        self.text(200, data, MIME.get(os.path.splitext(path)[1], 'application/octet-stream'))
        entry['sent'] = len(data)
        return None

    def vod_reenc(self, rest, rate):
        """/vod-reenc/K/<path>: the stream, re-encoded once K is flagged (other bytes, the same count)."""
        key, _, sub = rest.partition('/')
        path = fixture(sub)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        if path.endswith('.m3u8'):
            return self.vod_playlist(path)
        m = re.search(r'seg(\d+)\.ts$', path)
        if m:
            self.vod_hold(key, int(m.group(1)))
        with LOCK:
            changed = key in FLAGS
        if not changed or not path.endswith('.ts'):
            return self.send_file(path, rate, ctype=MIME.get(os.path.splitext(path)[1], 'application/octet-stream'))
        with open(path, 'rb') as f:
            raw = f.read()
        data = bytes(b if i % 188 == 0 else b ^ 0xA5 for i, b in enumerate(raw))
        entry = self.record(status=200, reenc=True, start=0, end=len(data) - 1)
        self.text(200, data, MIME['.ts'])
        entry['sent'] = len(data)
        return None

    def dash_rename(self, rest, rate):
        """/dash-rename/K/<path>: the DASH stream whose representations are renamed once K is flagged."""
        key, _, sub = rest.partition('/')
        with LOCK:
            renamed = key in FLAGS
        name = sub
        if renamed:
            if re.search(r'stream[01][-.]', sub):
                self.record(status=404, renamed=True)
                return self.text(404, 'not found')
            for old, new in RENAMED.items():
                name = name.replace('stream%s' % new, 'stream%s' % old)
        path = fixture(name)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        if path.endswith('.mpd'):
            with open(path, encoding='utf-8') as f:
                text = f.read()
            if renamed:
                for old, new in RENAMED.items():
                    text = text.replace('<Representation id="%s"' % old, '<Representation id="%s"' % new)
            self.record(status=200, renamed=renamed)
            return self.text(200, text, MIME['.mpd'])
        m = re.search(r'chunk-stream\w+-(\d+)\.m4s$', path)
        if m:
            self.vod_hold(key, int(m.group(1)) - 1)
        with LOCK:
            now = key in FLAGS
            reenc = (key + '-reenc') in FLAGS
        if now and not renamed and re.search(r'stream[01][-.]', sub):
            # Renamed while this request waited: its old address answers 404 now.
            self.record(status=404, renamed=True)
            return self.text(404, 'not found')
        if now and reenc and re.search(r'chunk-streamv360-\d+\.m4s$', sub):
            return self.send_reenc(path, keep=8)
        return self.send_file(path, rate, ctype=MIME.get(os.path.splitext(path)[1], 'application/octet-stream'))

    def vod_html(self, rest, rate):
        """/vod-html/K/<N>/<path>: segment N answers with a web page."""
        key, _, more = rest.partition('/')
        bad, _, sub = more.partition('/')
        path = fixture(sub)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        if path.endswith('.m3u8'):
            return self.vod_playlist(path)
        m = re.search(r'seg(\d+)\.ts$', path)
        if m:
            self.vod_hold(key, int(m.group(1)))
            if bad.isdigit() and int(m.group(1)) == int(bad):
                self.record(status=200, page=True)
                return self.text(200, EXPIRED_PAGE)
        return self.send_file(path, rate, ctype=MIME.get(os.path.splitext(path)[1], 'application/octet-stream'))

    def vod_trunc(self, rest, rate):
        """/vod-trunc/K/<path>: once K is flagged, a media playlist lists only its first 6 segments."""
        key, _, sub = rest.partition('/')
        path = fixture(sub)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        with LOCK:
            short = key in FLAGS
        if path.endswith('.m3u8'):
            with open(path, encoding='utf-8') as f:
                text = f.read()
            if short:
                out, n = [], 0
                for line in text.splitlines():
                    if line.startswith('#EXTINF') and n >= 6:
                        break
                    if line and not line.startswith('#'):
                        n += 1
                    out.append(line)
                text = '\n'.join(out) + '\n#EXT-X-ENDLIST\n'
            self.record(status=200, short=short)
            return self.text(200, text, MIME['.m3u8'])
        return self.send_file(path, rate, ctype=MIME.get(os.path.splitext(path)[1], 'application/octet-stream'))

    def vod_init(self, rest, rate):
        """/vod-init/K/<path>: the fMP4 stream whose init segments answer 404 once K is flagged."""
        key, _, sub = rest.partition('/')
        path = fixture(sub)
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        m = re.search(r'video/seg(\d+)\.m4s$', sub)
        if m:
            self.vod_hold(key, int(m.group(1)))
        with LOCK:
            gone = key in FLAGS
        if gone and re.search(r'init_\d\.mp4$', sub):
            self.record(status=404, init=True)
            return self.text(404, 'not found')
        if path.endswith('.m3u8'):
            return self.vod_playlist(path)
        return self.send_file(path, rate, ctype='video/mp4')

    def vod_asign(self, rest, rate):
        """/vod-asign/K/master.m3u8 and /vod-asign/K/<tok>/<video|audio>/<file> (see the docstring)."""
        parts = rest.split('/')
        key = parts[0]
        if len(parts) == 2 and parts[1] == 'master.m3u8':
            tok = self.vod_token(key)
            with open(fixture('hlsfmp4/master.m3u8'), encoding='utf-8') as f:
                text = f.read()
            text = text.replace('URI="audio/', 'URI="%s/audio/' % tok)
            text = '\n'.join(('%s/%s' % (tok, line) if line and not line.startswith('#') else line) for line in text.splitlines()) + '\n'
            self.record(status=200, master=tok)
            return self.text(200, text, MIME['.m3u8'])
        if len(parts) != 4:
            return self.text(404, 'not found')
        _, tok, rend, name = parts
        path = fixture('hlsfmp4/%s/%s' % (rend, name))
        if not path:
            self.record(status=404)
            return self.text(404, 'not found')
        m = re.match(r'seg(\d+)\.m4s$', name)
        if m and rend == 'audio':
            self.vod_hold(key, int(m.group(1)))
        if not self.vod_alive(tok, key):
            self.record(status=403, expired=tok)
            return self.text(403, EXPIRED_XML, 'application/xml')
        if name.endswith('.m3u8'):
            return self.vod_playlist(path)
        return self.send_file(path, rate, ctype='video/mp4')

    def vod_br(self, rest, q):
        """/vod-br/K/index.m3u8 and /vod-br/K/all.ts (see the docstring)."""
        key, _, name = rest.partition('/')
        be = q.get('be', 'stable')
        segs = []
        for i in range(12):
            with open(fixture('hls/v360/seg%03d.ts' % i), 'rb') as f:
                segs.append(f.read())
        if name == 'index.m3u8':
            lines = ['#EXTM3U', '#EXT-X-VERSION:4', '#EXT-X-TARGETDURATION:2', '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD']
            off = 0
            for s in segs:
                lines += ['#EXTINF:2.000000,', '#EXT-X-BYTERANGE:%d@%d' % (len(s), off), 'all.ts?be=' + be]
                off += len(s)
            lines.append('#EXT-X-ENDLIST')
            self.record(status=200)
            return self.text(200, '\n'.join(lines) + '\n', MIME['.m3u8'])
        if name != 'all.ts':
            return self.text(404, 'not found')
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes='):
            # A range that starts in segment N waits while N is held; what it gets is decided after.
            start_at = int(rng[6:].partition('-')[0] or 0)
            first, off = 0, 0
            for i, s in enumerate(segs):
                if off + len(s) > start_at:
                    first = i
                    break
                off += len(s)
            self.vod_hold(key, first)
        with LOCK:
            swapped = key in FLAGS
            n = VOD['br'][key] = VOD['br'].get(key, 0) + 1
        data = b''.join(segs)
        if swapped:
            data = bytes(b if i % 188 == 0 else b ^ 0xA5 for i, b in enumerate(data))
        size = len(data)
        mark = 'X' if swapped else ''
        if be == 'flap':
            backend = 'A' if n % 2 else 'B'
            etag, lm = '"%s%s-%x"' % (mark, backend, size), LM[backend == 'B']
        elif be == 'edge':
            backend, etag, lm = '', '"%sE%d"' % (mark, n), LM[swapped]
        else:
            backend, etag, lm = '', '"%sS-%x"' % (mark, size), LM[swapped]
        start, end, status = 0, size - 1, 200
        if rng.startswith('bytes='):
            a, _, b = rng[6:].partition('-')
            if_range = self.headers.get('If-Range')
            if if_range is None or if_range == etag or if_range == lm:
                start = int(a) if a else 0
                end = min(size - 1, int(b)) if b else size - 1
                status = 206
        body = data[start:end + 1]
        entry = self.record(status=status, start=start, end=end, etag=etag, backend=backend, swapped=swapped)
        self.send_response(status)
        self.send_header('Content-Type', 'video/mp2t')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('ETag', etag)
        self.send_header('Last-Modified', lm)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-store')
        if status == 206:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.end_headers()
        self.wfile.write(body)
        entry['sent'] = len(body)
        return None

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
