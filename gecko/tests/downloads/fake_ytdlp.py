"""A stand-in for yt-dlp in tests (vitre.tools.ytdlpCommand = [python, this file]).

Answers like yt-dlp for what Vitre asks:
  --version                      2026.08.19
  -J <url>                       JSON with formats: 1080p and 720p H.264 video-only, 360p with sound,
                                 M4A and Opus audio; a URL containing "unavailable" fails like yt-dlp
  -f <fmt> -o <path> ... <url>   saves each format as yt-dlp does: joined formats ('137+140') as
                                 "<stem>.f<id>.<ext>" (written to "<that>.part", renamed when complete), then
                                 [Merger] joins them into <path> (here: one after the other) and removes them; one
                                 format straight to <path> through "<path>.part". With --continue (Deer always passes
                                 it) a .part is continued from its size and a finished format file is "already
                                 downloaded" (reported 'finished' with no downloaded bytes, as yt-dlp's
                                 FileDownloader does); --progress-template lines throughout. Each format's bytes are a
                                 pattern: byte i is (seed + i) & 255, seed = (7 * sum of the id's characters + 101 *
                                 its version) & 255, so another version has other bytes. A URL containing "slow"
                                 takes ~6 s per format
Phase 8 of spikes/downloader/RESUME-DESIGN.md: a test steers it per page through the JSON file "<log>.ctl.json"
(<log> as below): {"pages": {"<part of the page URL>": {...}}}, the first key the URL contains:
  formats   the -J formats (yt-dlp's fields: format_id, ext, vcodec, acodec, height, fps, tbr, abr, filesize,
            protocol, url) and the sizes it downloads; default: the formats above
  drop      format ids no longer offered; sizes {id: filesize} replace reported sizes (and what is downloaded)
  ver       {id: n}: the version of a format's bytes (default 0)
  rate      bytes per second a download writes (default: fast)
  refuse    an HTTP status: the download fails at once as yt-dlp does when the site refuses it
            ("ERROR: unable to download video data: HTTP Error 403: Forbidden"); -J still answers
  fail      a sentence: -J and downloads fail with it
  jdelay    seconds -J takes
  mint      a path on the page's own server answering {"url": ...} (tests/downloads/server.py /page/<id>.json):
            a format whose url is "@mint" gets that address (a page media file's fresh one, G1 step 2); one whose
            url is "@mint:<path>" gets the address that path answers (each file of a page its own)
  duration  the video's length -J reports (default 19)
A format's size as it is downloaded is its "_bytes" when given, else its filesize, else its filesize_approx (a
format yt-dlp only estimates, as YouTube's HLS ones), else 100000.
Every call is recorded in the file VITRE_FAKE_YTDLP_LOG names (one JSON line per call): the runners give each
run its own (tests/downloads/all.py, tests/downloads-verify/all.py), so two runs at the same time never share
it; %TEMP%\\vitre-fake-ytdlp.log when it is not set. Each format a download writes adds a line to "<log>.events":
{"page", "id", "from" (the bytes it continued from), "total", "file"}. Each -J adds a line to "<log>.jruns" when
it ends: {"page", "t0", "t1"} (seconds), so a test can tell how many ran at once.
"""
import json
import os
import sys
import tempfile
import time
import urllib.request
from urllib.parse import urlparse

args = sys.argv[1:]
LOG = os.environ.get('VITRE_FAKE_YTDLP_LOG') or os.path.join(tempfile.gettempdir(), 'vitre-fake-ytdlp.log')
with open(LOG, 'a', encoding='utf-8') as f:
    f.write(json.dumps(args) + '\n')


def opt(name):
    return args[args.index(name) + 1] if name in args else None


url = args[-1] if args else ''
if '--version' in args:
    print('2026.08.19')
    sys.exit(0)

if 'unavailable' in url:
    sys.stderr.write('ERROR: [youtube] unavailable: Video unavailable. This video has been removed by the uploader\n')
    sys.exit(1)

FORMATS = [
    {'format_id': '137', 'ext': 'mp4', 'vcodec': 'avc1.640028', 'acodec': 'none', 'height': 1080, 'fps': 30, 'tbr': 4000, 'filesize': 3_000_000, 'protocol': 'https'},
    {'format_id': '248', 'ext': 'webm', 'vcodec': 'vp9', 'acodec': 'none', 'height': 1080, 'fps': 30, 'tbr': 3000, 'filesize': 2_500_000, 'protocol': 'https'},
    {'format_id': '136', 'ext': 'mp4', 'vcodec': 'avc1.4d401f', 'acodec': 'none', 'height': 720, 'fps': 30, 'tbr': 2000, 'filesize': 1_500_000, 'protocol': 'https'},
    {'format_id': '18', 'ext': 'mp4', 'vcodec': 'avc1.42001E', 'acodec': 'mp4a.40.2', 'height': 360, 'fps': 30, 'tbr': 500, 'filesize': 600_000, 'protocol': 'https'},
    {'format_id': '140', 'ext': 'm4a', 'vcodec': 'none', 'acodec': 'mp4a.40.2', 'abr': 129, 'filesize': 300_000, 'protocol': 'https'},
    {'format_id': '251', 'ext': 'webm', 'vcodec': 'none', 'acodec': 'opus', 'abr': 135, 'filesize': 280_000, 'protocol': 'https'},
    {'format_id': 'sb0', 'ext': 'mhtml', 'vcodec': 'none', 'acodec': 'none', 'protocol': 'mhtml'},
]


def control():
    """The test's steering for this page ("<log>.ctl.json"), {} when there is none."""
    try:
        with open(LOG + '.ctl.json', encoding='utf-8') as f:
            pages = json.load(f).get('pages', {})
    except (OSError, ValueError):
        return {}
    for key, spec in pages.items():
        if key and key in url:
            return spec
    return {}


SPEC = control()
if SPEC.get('fail'):
    sys.stderr.write('ERROR: [generic] %s: %s\n' % (url.rsplit('/', 1)[-1], SPEC['fail']))
    sys.exit(1)


def minted(path=None):
    """A fresh address from the page's own server (spec mint, or `path`), absolute; '' when it can't be had."""
    path = path or SPEC.get('mint')
    if not path:
        return ''
    u = urlparse(url)
    origin = '%s://%s' % (u.scheme, u.netloc)
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(origin + path, timeout=10) as r:
            return origin + json.loads(r.read().decode('utf-8'))['url']
    except Exception as e:  # noqa: BLE001 - a stand-in: say why and give nothing
        sys.stderr.write('WARNING: mint failed: %s\n' % e)
        return ''


def formats():
    out = []
    drop = set(SPEC.get('drop', []))
    sizes = SPEC.get('sizes', {})
    fresh = None
    for f in SPEC.get('formats', FORMATS):
        if f['format_id'] in drop:
            continue
        f = dict(f)
        if f['format_id'] in sizes:
            f['filesize'] = sizes[f['format_id']]
        if f.get('url') == '@mint':
            if fresh is None:
                fresh = minted()
            f['url'] = fresh
        elif str(f.get('url', '')).startswith('@mint:'):
            f['url'] = minted(f['url'][len('@mint:'):])
        out.append(f)
    return out


if '-J' in args:
    t0 = time.time()
    time.sleep(float(SPEC.get('jdelay', 0)))
    print(json.dumps({'id': 'fake', 'title': SPEC.get('title', 'A fake clip: glass in motion'), 'duration': SPEC.get('duration', 19), 'webpage_url': url,
                      'live_status': 'not_live', 'is_live': False, 'formats': formats()}), flush=True)
    with open(LOG + '.jruns', 'a', encoding='utf-8') as ev:
        ev.write(json.dumps({'page': url, 't0': t0, 't1': time.time()}) + '\n')
    sys.exit(0)

if SPEC.get('refuse'):
    status = int(SPEC['refuse'])
    sys.stderr.write('ERROR: unable to download video data: HTTP Error %d: %s\n' % (status, 'Forbidden' if status == 403 else 'Gone'))
    sys.exit(1)


def seed(fid):
    return (7 * sum(fid.encode()) + 101 * int(SPEC.get('ver', {}).get(fid, 0))) & 255


def pattern(s, start, end):
    """Bytes [start, end) of a format whose byte i is (s + i) & 255."""
    if end <= start:
        return b''
    block = bytes((s + i) & 255 for i in range(256))
    off = start % 256
    rep = block * ((end - start + off) // 256 + 2)
    return rep[off:off + end - start]


fmt = opt('-f') or ''
out = (opt('-o') or 'out.mp4').replace('%%', '%')
known = {f['format_id']: f for f in formats()}
ids = [p for p in fmt.split('+') if p]
joined = len(ids) > 1
resume = '--no-continue' not in args
rate = int(SPEC.get('rate', 0))
slow = 'slow' in url
stem, _ = os.path.splitext(out)
done = []
for fid in ids:
    f = known.get(fid)
    if f is None:
        sys.stderr.write('ERROR: [youtube] fake: Requested format is not available. Use --list-formats for a list of available formats\n')
        sys.exit(1)
    total = int(f.get('_bytes') or f.get('filesize') or f.get('filesize_approx') or 100_000)
    name = '%s.f%s.%s' % (stem, fid, f.get('ext', 'mp4')) if joined else out
    part = name + '.part'
    done.append(name)
    if resume and os.path.isfile(name):
        print('[download] %s has already been downloaded' % name, flush=True)
        print('VITRE finished NA %d NA' % os.path.getsize(name), flush=True)
        continue
    start = os.path.getsize(part) if resume and os.path.isfile(part) else 0
    start = min(start, total)
    with open(LOG + '.events', 'a', encoding='utf-8') as ev:
        ev.write(json.dumps({'page': url, 'id': fid, 'from': start, 'total': total, 'file': os.path.basename(name)}) + '\n')
    s = seed(fid)
    with open(part, 'ab' if start else 'wb') as w:
        if slow:
            step, pause = max(1, total // 12), 0.5
        elif rate:
            step, pause = max(16384, rate // 10), max(16384, rate // 10) / rate
        else:
            step, pause = max(1, total // 4), 0.05
        got = start
        while got < total:
            nxt = min(total, got + step)
            w.write(pattern(s, got, nxt))
            w.flush()
            got = nxt
            if got < total:
                print('VITRE downloading %d %d NA' % (got, total), flush=True)
                time.sleep(pause)
    os.replace(part, name)
    print('VITRE finished %d %d NA' % (total, total), flush=True)
if joined:
    print('[Merger] Merging formats into "%s"' % out, flush=True)
    time.sleep(0.2)
    with open(out, 'wb') as w:
        for name in done:
            with open(name, 'rb') as r:
                w.write(r.read())
    for name in done:
        os.remove(name)
sys.exit(0)
