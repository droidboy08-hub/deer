"""A local stand-in for the Deer wallpapers site (GitHub Pages), for tests/settings/wallpapers.js.

  python tests/settings/wallpaper_server.py [--port 47981]

Prints "ready <port>" and serves on 127.0.0.1 until it is killed. Nothing here touches the internet.
The pictures are made here with Pillow (deterministic, a few hundred KB each); the videos are the
clip live-wallpaper.mp4 next to this file (3 s, 320x180, H.264 yuv420p, faststart, no sound: made
once with ffmpeg), each made a file of its own by a 'free' box at its end (players skip it).

Collections, by the first part of the path (the test points vitre.wallpapers.base at one of them):
  /main/      wallpapers.json as add.py writes it (Deer 0.1.5's format: photos, no "kind"), with
                good pictures   lake-at-dawn, hills, quiet-bay, red-rocks, snow-field, city-lights,
                                old-pier, bad-thumb (its thumbnail is not the one listed), odd-thumb
                                (its thumbnail passes every check, a frame header of 320x180 and no
                                picture: it cannot be decoded), slow-forest (sent in small pieces over
                                about 4 s)
                bad downloads   wrong-hash, short-file (fewer bytes than listed), long-file (more
                                bytes than listed), not-jpeg (a PNG, size and hash right), wrong-dims
                                (a JPEG of another size), gone-file (404)
                bad entries     an id with capitals, a path out of full/, another file name, an address
                                elsewhere, 26 MB declared, a 600 KB thumbnail, a colour name, an empty
                                title, a title with a bidi override, a 100000 px width, a string, an id
                                listed twice, a retired id, a thumbnail path out of thumbs/
  /main2/     the same without lake-at-dawn (taken out of the collection)
  /live/      photos and videos mixed (live wallpapers):
                photos          lake-at-dawn, hills ("kind": "photo"), quiet-bay (the files of /main/)
                good videos     night-river, surf (the owner's own: no credit), drift, slow-clip (a 1.5 MiB
                                'free' box, sent in small pieces over about 7 s); long-take (three days,
                                100 MiB declared: listed, never downloaded; there is no length limit)
                bad downloads   not-mp4 (a JPEG, size and hash right), avif-picture (an AVIF picture: an
                                ISO file whose 'ftyp' box names avif / mif1 / miaf, size and hash right),
                                video-wrong-hash, video-endless (no length, bytes without end)
                bad entries     "kind": "gif" (full/<id>.gif, and full/<id>.mp4), "kind": "Video", a video
                                whose file is full/<id>.jpg, a duration of 0, none, a string, a width of
                                4000, 101 MiB declared
  /live2/     the same without drift (taken out of the collection)
  /kswap1/    one wallpaper, "shift", a photo (full/shift.jpg)
  /kswap2/    "shift" again, now a video (full/shift.mp4, another thumbnail): an id reused for the
              other kind
  /kswap3/    /kswap1/ again (the photo)
  /empty/     {"version": 1, "wallpapers": []}
  /huge/      a manifest of 1.2 MB (over Deer's 1 MiB limit)
  /redirect/  wallpapers.json is a 302 to /main/wallpapers.json
  /slow/      the empty collection, answered after 3 s
Every answer carries Set-Cookie (wptrack=<n>) and a long Cache-Control max-age: Deer must store no
cookie, send none, and take nothing from its HTTP cache. Thumbnails are answered after 150 ms, so the
number of them asked at once can be measured.

Control (never logged):
  GET /__log               every request since the last reset: path, query, headers (as sent)
  GET /__reset             forget the log and the measurements
  GET /__stats             {"thumbsAtOnce": the most thumbnail requests open at the same time}
  GET /__info              {id: {bytes, sha256}} of the good pictures and videos as served (videos: color too)
  GET /__drop?prefix=P     close every connection for a path starting with P without an answer (the
                           site down); an empty prefix ends it
  GET /__plant             answers with Set-Cookie: planted=1 (a cookie the jar really holds)
"""
import argparse
import hashlib
import http.server
import io
import json
import os
import random
import struct
import sys
import threading
import time
import urllib.parse

from PIL import Image, ImageDraw, ImageFilter

LOCK = threading.Lock()
LOG = []
STATE = {'drop': '', 'thumbs_open': 0, 'thumbs_max': 0, 'cookie': 0}
FILES = {}      # 'full/x.jpg' -> bytes (shared by every collection)
SITE_FILES = {}  # ('kswap1', 'thumbs/shift.jpg') -> bytes: a collection's own (asked first)
MANIFESTS = {}  # 'main' -> bytes
INFO = {}
SITES = ('main', 'main2', 'live', 'live2', 'kswap1', 'kswap2', 'kswap3', 'empty', 'huge', 'redirect', 'slow')


def sha(b):
    return hashlib.sha256(b).hexdigest()


def jpeg(img, quality=86):
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=quality, optimize=True, progressive=True)
    return buf.getvalue()


def png(img):
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    return buf.getvalue()


def landscape(seed, w, h, sky, ground, sun, grain=10):
    """A plausible photo: a sky gradient, a sun, hills, some grain (so sizes are not tiny)."""
    rnd = random.Random(seed)
    img = Image.new('RGB', (w, h))
    px = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        c = tuple(int(sky[0][i] + (sky[1][i] - sky[0][i]) * t) for i in range(3))
        px.line([(0, y), (w, y)], fill=c)
    px.ellipse([w * 0.68, h * 0.18, w * 0.68 + h * 0.16, h * 0.34], fill=sun)
    for layer in range(3):
        pts = [(0, h)]
        base = h * (0.55 + 0.12 * layer)
        for x in range(0, w + 40, 40):
            pts.append((x, base - rnd.random() * h * 0.08 - 30 * (layer == 0)))
        pts.append((w, h))
        shade = tuple(max(0, min(255, int(ground[i] * (1 - 0.18 * layer)))) for i in range(3))
        px.polygon(pts, fill=shade)
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    noise = Image.effect_noise((w, h), grain).convert('RGB')
    return Image.blend(img, noise, 0.06)


def thumb_of(img):
    tw = min(480, img.width)
    return img.resize((tw, max(1, round(img.height * tw / img.width))), Image.LANCZOS)


GOOD = [
    # id, title, author, license, size, sky, ground, sun
    ('lake-at-dawn', 'Lake at dawn', 'Ada Park', 'CC0-1.0', (1600, 900), ((236, 168, 120), (120, 150, 190)), (52, 70, 92), (255, 226, 170)),
    ('hills', 'Hills after rain', 'Ben Ortiz', 'CC-BY-4.0', (1600, 1000), ((150, 180, 210), (215, 220, 215)), (70, 104, 70), (250, 250, 235)),
    # quiet-bay: the owner's own photo (no author or license), listed with no credit
    ('quiet-bay', 'Quiet bay', None, None, (1600, 900), ((40, 70, 120), (150, 170, 200)), (30, 60, 80), (240, 240, 220)),
    ('red-rocks', 'Red rocks', 'Dev Shah', 'CC-BY-4.0', (1600, 900), ((250, 200, 150), (210, 120, 90)), (150, 70, 50), (255, 240, 210)),
    ('snow-field', 'Snow field', 'Eva Lind', 'CC0-1.0', (1600, 900), ((200, 215, 235), (245, 248, 252)), (225, 232, 240), (255, 255, 250)),
    ('city-lights', 'City lights', 'Finn Moss', 'CC0-1.0', (1600, 900), ((10, 14, 40), (60, 40, 80)), (20, 20, 30), (250, 220, 120)),
    ('old-pier', 'Old pier', 'Gia Bell', 'CC-BY-4.0', (1600, 900), ((180, 190, 200), (120, 130, 140)), (60, 60, 64), (230, 230, 230)),
    ('bad-thumb', 'Grey morning', 'Hal Ito', 'CC0-1.0', (1600, 900), ((160, 160, 165), (110, 115, 120)), (70, 72, 76), (210, 210, 210)),
    ('odd-thumb', 'Odd thumbnail', 'Jo Kim', 'CC0-1.0', (1600, 900), ((200, 180, 150), (150, 130, 110)), (90, 80, 70), (240, 230, 210)),
    ('slow-forest', 'Slow forest', 'Ivy Cho', 'CC0-1.0', (2400, 1500), ((120, 160, 120), (40, 70, 50)), (20, 50, 30), (230, 240, 200)),
]
BAD = [
    ('wrong-hash', 'Wrong hash', ((120, 120, 200), (60, 60, 120))),
    ('short-file', 'Short file', ((200, 120, 120), (120, 60, 60))),
    ('long-file', 'Long file', ((120, 200, 120), (60, 120, 60))),
    ('not-jpeg', 'Not a JPEG', ((200, 200, 120), (120, 120, 60))),
    ('wrong-dims', 'Wrong size', ((120, 200, 200), (60, 120, 120))),
    ('gone-file', 'Gone', ((180, 140, 200), (90, 70, 120))),
]
SLOW = {'slow-forest', 'slow-clip'}
# Bytes sent every 70 ms by a slow answer.
SLOW_PIECE = {'slow-forest': 8 * 1024, 'slow-clip': 16 * 1024}
CLIP = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'live-wallpaper.mp4'), 'rb').read()
GOOD_VIDEOS = [
    # id, title, author, license, poster sky, ground, sun, 'free' box padding
    ('night-river', 'Night river', 'Kai Lund', 'CC-BY-4.0', ((20, 30, 60), (40, 60, 90)), (20, 30, 40), (230, 230, 200), 0),
    ('surf', 'Surf', None, None, ((90, 150, 200), (200, 220, 230)), (40, 90, 120), (250, 250, 240), 0),
    ('drift', 'Drift', 'Lea Moor', 'CC0-1.0', ((180, 120, 160), (90, 60, 110)), (50, 40, 70), (250, 220, 230), 0),
    ('slow-clip', 'Slow clip', 'Max Roe', 'CC0-1.0', ((100, 140, 100), (40, 70, 50)), (30, 50, 40), (230, 240, 200), 1536 * 1024),
]
BAD_VIDEOS = [
    ('not-mp4', 'Not an MP4', ((200, 160, 120), (120, 90, 60))),
    ('avif-picture', 'An AVIF picture', ((160, 120, 200), (90, 60, 120))),
    ('video-wrong-hash', 'Video wrong hash', ((120, 160, 200), (60, 90, 120))),
    ('video-endless', 'Video endless', ((160, 200, 120), (90, 120, 60))),
]
ENDLESS = {'video-endless'}
# SOI, a baseline frame header (SOF0) of 320x180 with three components, EOI: Deer's checks pass (size,
# SHA-256, FF D8 FF, a frame within 2048 px), but there is no picture to decode.
ODD_THUMB = bytes([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xb4, 0x01, 0x40, 0x03,
                   0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9])
SLOW_MANIFEST_S = 3


def entry(wid, title, author, lic, full, th, color=None, w=None, h=None, **over):
    e = {
        'id': wid, 'title': title, 'author': author, 'license': lic, 'added': '2026-10-16',
        'color': color or '#405060', 'width': w, 'height': h,
        'file': 'full/%s.jpg' % wid, 'bytes': len(full), 'sha256': sha(full),
        'thumb': 'thumbs/%s.jpg' % wid, 'thumbBytes': len(th), 'thumbSha256': sha(th),
    }
    e.update(over)
    for k in ('author', 'license'):
        if e[k] is None:
            del e[k]
    return e


def box(kind, payload):
    """An ISO base media file box: its size, its type, its payload."""
    return struct.pack('>I', 8 + len(payload)) + kind + payload


def with_free_box(clip, tag, pad):
    """The clip with a top-level 'free' box at its end: a file of its own that plays the same."""
    return clip + box(b'free', tag.encode() + bytes(pad))


def avif_like(tag):
    """The start of an AVIF picture: an 'ftyp' box as an MP4 has, whose brands are a picture's."""
    return box(b'ftyp', b'avif' + struct.pack('>I', 0) + b'avifmif1miaf') + box(b'meta', bytes(4) + tag.encode() + bytes(4000))


def video_entry(wid, title, author, lic, full, th, color, **over):
    """A live wallpaper as add.py writes it: kind, full/<id>.mp4, the frame size and duration."""
    e = entry(wid, title, author, lic, full, th, color, 320, 180)
    e.update({'kind': 'video', 'file': 'full/%s.mp4' % wid, 'duration': 3.0})
    e.update(over)
    return e


def build_live(photos):
    """/live/ and /live2/: photos and videos mixed, with bad video downloads and bad video entries."""
    videos = []
    for k, (wid, title, author, lic, sky, ground, sun, pad) in enumerate(GOOD_VIDEOS):
        full = with_free_box(CLIP, wid, pad)
        poster = landscape(200 + k, 480, 270, sky, ground, sun)
        th = jpeg(poster, 80)
        color = '#%02x%02x%02x' % poster.resize((1, 1), Image.BILINEAR).getpixel((0, 0))
        FILES['full/%s.mp4' % wid] = full
        FILES['thumbs/%s.jpg' % wid] = th
        videos.append(video_entry(wid, title, author, lic, full, th, color))
        INFO[wid] = {'bytes': len(full), 'sha256': sha(full), 'color': color}
    for k, (wid, title, sky) in enumerate(BAD_VIDEOS):
        poster = landscape(300 + k, 480, 270, sky, (60, 60, 60), (240, 240, 240))
        th = jpeg(poster, 80)
        FILES['thumbs/%s.jpg' % wid] = th
        kw = {}
        if wid == 'not-mp4':
            listed = jpeg(poster, 90)  # a JPEG where an MP4 is listed, size and hash right
        elif wid == 'avif-picture':
            listed = avif_like(wid)  # an 'ftyp' box, but a picture's brands; size and hash right
        elif wid == 'video-wrong-hash':
            listed = with_free_box(CLIP, wid, 0)
            kw = {'sha256': sha(listed + b'x')}
        else:  # video-endless: the listed bytes, then more without end (do_GET)
            listed = with_free_box(CLIP, wid, 0)
        FILES['full/%s.mp4' % wid] = listed
        videos.append(video_entry(wid, title, 'Test Person', 'CC0-1.0', listed, th, '#304050', **kw))
    river = videos[0]
    # long-take: three days, 100 MiB declared (both allowed: there is no length limit); never downloaded.
    FILES['thumbs/long-take.jpg'] = FILES['thumbs/night-river.jpg']
    long_take = dict(river, id='long-take', title='Long take', file='full/long-take.mp4', thumb='thumbs/long-take.jpg', duration=3 * 86400, bytes=100 * 1024 * 1024)
    bad = [
        dict(river, id='gif-one', kind='gif', file='full/gif-one.gif', thumb='thumbs/gif-one.jpg'),
        dict(river, id='gif-two', kind='gif', file='full/gif-two.mp4', thumb='thumbs/gif-two.jpg'),
        dict(river, id='capital-kind', kind='Video', file='full/capital-kind.mp4', thumb='thumbs/capital-kind.jpg'),
        dict(river, id='video-as-jpg', file='full/video-as-jpg.jpg', thumb='thumbs/video-as-jpg.jpg'),
        dict(river, id='no-length', file='full/no-length.mp4', thumb='thumbs/no-length.jpg', duration=0),
        {k: v for k, v in dict(river, id='no-duration', file='full/no-duration.mp4', thumb='thumbs/no-duration.jpg').items() if k != 'duration'},
        dict(river, id='text-duration', file='full/text-duration.mp4', thumb='thumbs/text-duration.jpg', duration='3'),
        dict(river, id='wide-video', file='full/wide-video.mp4', thumb='thumbs/wide-video.jpg', width=4000),
        dict(river, id='huge-video', file='full/huge-video.mp4', thumb='thumbs/huge-video.jpg', bytes=101 * 1024 * 1024),
    ]
    by_id = {e['id']: e for e in photos}
    lake, quiet = by_id['lake-at-dawn'], by_id['quiet-bay']
    hills = dict(by_id['hills'], kind='photo')
    v = {e['id']: e for e in videos}
    listed = ([v['night-river'], lake, v['surf'], hills] + bad[:4] + [v['drift'], quiet, long_take] + bad[4:]
              + [v['slow-clip'], v['not-mp4'], v['avif-picture'], v['video-wrong-hash'], v['video-endless']])
    MANIFESTS['live'] = json.dumps({'version': 1, 'wallpapers': listed}, indent=2).encode()
    MANIFESTS['live2'] = json.dumps({'version': 1, 'wallpapers': [e for e in listed if e['id'] != 'drift']}, indent=2).encode()


def build_kswap():
    """/kswap1/ to /kswap3/: the id "shift" listed as a photo, then as a video, then as the photo again."""
    img = landscape(400, 1600, 900, ((210, 170, 120), (110, 120, 160)), (60, 70, 80), (255, 230, 180))
    photo, photo_th = jpeg(img), jpeg(thumb_of(img), 80)
    photo_color = '#%02x%02x%02x' % img.resize((1, 1), Image.BILINEAR).getpixel((0, 0))
    poster = landscape(401, 480, 270, ((30, 50, 90), (70, 90, 130)), (20, 40, 60), (230, 230, 240))
    video, video_th = with_free_box(CLIP, 'shift', 0), jpeg(poster, 80)
    video_color = '#%02x%02x%02x' % poster.resize((1, 1), Image.BILINEAR).getpixel((0, 0))
    as_photo = entry('shift', 'Shift', 'Nia Shore', 'CC0-1.0', photo, photo_th, photo_color, 1600, 900)
    as_video = video_entry('shift', 'Shift', 'Nia Shore', 'CC0-1.0', video, video_th, video_color)
    for site in ('kswap1', 'kswap3'):
        SITE_FILES[(site, 'full/shift.jpg')] = photo
        SITE_FILES[(site, 'thumbs/shift.jpg')] = photo_th
        MANIFESTS[site] = json.dumps({'version': 1, 'wallpapers': [as_photo]}, indent=2).encode()
    SITE_FILES[('kswap2', 'full/shift.mp4')] = video
    SITE_FILES[('kswap2', 'thumbs/shift.jpg')] = video_th
    MANIFESTS['kswap2'] = json.dumps({'version': 1, 'wallpapers': [as_video]}, indent=2).encode()
    INFO['shift'] = {'photo': {'bytes': len(photo), 'sha256': sha(photo)}, 'video': {'bytes': len(video), 'sha256': sha(video), 'color': video_color}}


def build():
    entries = []
    for i, (wid, title, author, lic, (w, h), sky, ground, sun) in enumerate(GOOD):
        img = landscape(i + 1, w, h, sky, ground, sun, grain=40 if wid in SLOW else 10)
        full = jpeg(img, 92 if wid in SLOW else 86)
        th = ODD_THUMB if wid == 'odd-thumb' else jpeg(thumb_of(img), 80)
        mean = img.resize((1, 1), Image.BILINEAR).getpixel((0, 0))
        color = '#%02x%02x%02x' % mean
        FILES['full/%s.jpg' % wid] = full
        if wid == 'bad-thumb':
            FILES['thumbs/%s.jpg' % wid] = th
            entries.append(entry(wid, title, author, lic, full, th, color, w, h, thumbSha256=sha(b'another thumbnail')))
        else:
            FILES['thumbs/%s.jpg' % wid] = th
            entries.append(entry(wid, title, author, lic, full, th, color, w, h))
        INFO[wid] = {'bytes': len(full), 'sha256': sha(full)}
    for j, (wid, title, sky) in enumerate(BAD):
        img = landscape(100 + j, 1600, 900, sky, (60, 60, 60), (240, 240, 240))
        full = jpeg(img)
        th = jpeg(thumb_of(img), 80)
        FILES['thumbs/%s.jpg' % wid] = th
        kw = {}
        if wid == 'wrong-hash':
            FILES['full/%s.jpg' % wid] = full
            kw = {'sha256': sha(full + b'x')}
            listed = full
        elif wid == 'short-file':
            listed = full + bytes(1000)       # listed 1000 bytes longer than what is served
            FILES['full/%s.jpg' % wid] = full
        elif wid == 'long-file':
            listed = full
            FILES['full/%s.jpg' % wid] = full + bytes(5000)  # 5000 bytes more than listed
        elif wid == 'not-jpeg':
            listed = png(img.resize((400, 225)))
            FILES['full/%s.jpg' % wid] = listed
        elif wid == 'wrong-dims':
            listed = jpeg(img.resize((1280, 720)))
            FILES['full/%s.jpg' % wid] = listed
        else:  # gone-file: listed, never served
            listed = full
        entries.append(entry(wid, title, 'Test Person', 'CC0-1.0', listed, th, '#506070', 1600, 900, **kw))
    good = entries[0]
    hills = next(e for e in entries if e['id'] == 'hills')
    bad = [
        dict(good, id='Bad_ID', file='full/Bad_ID.jpg', thumb='thumbs/Bad_ID.jpg'),
        dict(good, id='evil', file='full/../../evil.jpg', thumb='thumbs/evil.jpg'),
        dict(good, id='other', file='full/someone-else.jpg', thumb='thumbs/other.jpg'),
        dict(good, id='abs', file='https://evil.example/full/abs.jpg', thumb='thumbs/abs.jpg'),
        dict(good, id='huge', file='full/huge.jpg', thumb='thumbs/huge.jpg', bytes=26 * 1024 * 1024),
        dict(good, id='bigthumb', file='full/bigthumb.jpg', thumb='thumbs/bigthumb.jpg', thumbBytes=600 * 1024),
        dict(good, id='badcolor', file='full/badcolor.jpg', thumb='thumbs/badcolor.jpg', color='red'),
        dict(good, id='notitle', file='full/notitle.jpg', thumb='thumbs/notitle.jpg', title=''),
        dict(good, id='bidi', file='full/bidi.jpg', thumb='thumbs/bidi.jpg', title='Evil‮gpj.exe'),
        dict(good, id='hugewidth', file='full/hugewidth.jpg', thumb='thumbs/hugewidth.jpg', width=100000),
        'a string, not an entry',
        dict(hills, title='Hills listed twice'),
        dict(good, id='retired-one', file='full/retired-one.jpg', thumb='thumbs/retired-one.jpg'),
        dict(good, id='thumbpath', file='full/thumbpath.jpg', thumb='thumbs/../thumbpath.jpg'),
        {k: v for k, v in dict(good, id='halfcredit', file='full/halfcredit.jpg', thumb='thumbs/halfcredit.jpg').items() if k != 'license'},
    ]
    main = {'version': 1, 'wallpapers': entries[:3] + bad[:7] + entries[3:] + bad[7:], 'retired': ['retired-one']}
    MANIFESTS['main'] = json.dumps(main, indent=2).encode()
    main2 = dict(main, wallpapers=[e for e in main['wallpapers'] if not (isinstance(e, dict) and e.get('id') == 'lake-at-dawn')])
    MANIFESTS['main2'] = json.dumps(main2, indent=2).encode()
    MANIFESTS['empty'] = b'{\n  "version": 1,\n  "wallpapers": []\n}\n'
    MANIFESTS['slow'] = MANIFESTS['empty']
    MANIFESTS['huge'] = json.dumps({'version': 1, 'wallpapers': entries[:1], 'padding': 'x' * (1200 * 1024)}).encode()
    build_live(entries)
    build_kswap()


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def log_message(self, *a):
        pass

    def send(self, code, body=b'', ctype='application/octet-stream', extra=None, cookie=True, length=True):
        """Write the status and headers; return the body for the caller to write."""
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        if length:
            self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'public, max-age=86400')
        if cookie:
            with LOCK:
                STATE['cookie'] += 1
                n = STATE['cookie']
            self.send_header('Set-Cookie', 'wptrack=%d; Path=/; Max-Age=86400' % n)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        return body

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        path = url.path
        if path.startswith('/__'):
            return self.control(path, urllib.parse.parse_qs(url.query))
        with LOCK:
            LOG.append({'path': path, 'query': url.query, 'headers': {k: v for k, v in self.headers.items()}, 'at': time.time()})
            drop = STATE['drop']
        if drop and path.startswith(drop):
            try:
                self.connection.shutdown(2)
            except OSError:
                pass
            self.close_connection = True
            return
        parts = path.split('/', 2)
        if len(parts) < 3:
            return self.wfile.write(self.send(404, b'not here', 'text/plain'))
        site, rest = parts[1], parts[2]
        if site not in SITES:
            return self.wfile.write(self.send(404, b'not here', 'text/plain'))
        if rest == 'wallpapers.json':
            if site == 'redirect':
                return self.wfile.write(self.send(302, b'', 'text/plain', {'Location': '/main/wallpapers.json'}))
            if site == 'slow':
                time.sleep(SLOW_MANIFEST_S)
            try:
                self.wfile.write(self.send(200, MANIFESTS[site], 'application/json'))
            except OSError:
                pass  # Deer stopped reading
            return
        body = SITE_FILES.get((site, rest)) if site.startswith('kswap') else FILES.get(rest)
        if body is None or site in ('empty', 'huge', 'redirect', 'slow'):
            return self.wfile.write(self.send(404, b'not here', 'text/plain'))
        if rest.startswith('thumbs/'):
            with LOCK:
                STATE['thumbs_open'] += 1
                STATE['thumbs_max'] = max(STATE['thumbs_max'], STATE['thumbs_open'])
            try:
                time.sleep(0.15)
                self.wfile.write(self.send(200, body, 'image/jpeg'))
            except OSError:
                pass  # Deer stopped reading
            finally:
                with LOCK:
                    STATE['thumbs_open'] -= 1
            return
        wid = rest[len('full/'):-len('.jpg')]
        ctype = 'video/mp4' if rest.endswith('.mp4') else 'image/jpeg'
        # long-file and video-endless say nothing of their length (HTTP/1.0: the body ends when the
        # connection does), so Deer's limit is met while the bytes arrive, not from a header.
        try:
            self.send(200, body, ctype, length=wid not in ('long-file', 'video-endless'))
            if wid in ENDLESS:
                self.wfile.write(body)
                for _ in range(64 * 16):  # never more than 64 MiB, should Deer not stop reading
                    self.wfile.write(bytes(64 * 1024))
                    self.wfile.flush()
            elif wid in SLOW:
                step = SLOW_PIECE[wid]
                for i in range(0, len(body), step):
                    self.wfile.write(body[i:i + step])
                    self.wfile.flush()
                    time.sleep(0.07)
            else:
                self.wfile.write(body)
        except OSError:
            pass  # Deer stopped reading

    def control(self, path, q):
        if path == '/__log':
            with LOCK:
                body = json.dumps(LOG).encode()
            return self.wfile.write(self.send(200, body, 'application/json', cookie=False))
        if path == '/__reset':
            with LOCK:
                LOG.clear()
                STATE['thumbs_max'] = 0
            return self.wfile.write(self.send(200, b'{}', 'application/json', cookie=False))
        if path == '/__stats':
            with LOCK:
                body = json.dumps({'thumbsAtOnce': STATE['thumbs_max']}).encode()
            return self.wfile.write(self.send(200, body, 'application/json', cookie=False))
        if path == '/__info':
            return self.wfile.write(self.send(200, json.dumps(INFO).encode(), 'application/json', cookie=False))
        if path == '/__drop':
            with LOCK:
                STATE['drop'] = (q.get('prefix') or [''])[0]
            return self.wfile.write(self.send(200, b'{}', 'application/json', cookie=False))
        if path == '/__plant':
            return self.wfile.write(self.send(200, b'{}', 'application/json', {'Set-Cookie': 'planted=1; Path=/; Max-Age=86400'}, cookie=False))
        return self.wfile.write(self.send(404, b'', 'text/plain', cookie=False))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=47981)
    a = ap.parse_args()
    build()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    server.daemon_threads = True
    print('ready %d' % a.port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.exit(main())
