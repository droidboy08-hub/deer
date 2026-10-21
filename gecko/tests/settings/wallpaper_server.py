"""A local stand-in for the Deer wallpapers site (GitHub Pages), for tests/settings/wallpapers.js.

  python tests/settings/wallpaper_server.py [--port 47981]

Prints "ready <port>" and serves on 127.0.0.1 until it is killed. Nothing here touches the internet.
The pictures are made here with Pillow (deterministic, a few hundred KB each); the videos are the
clip live-wallpaper.mp4 next to this file (3 s, 320x180, H.264 yuv420p, faststart, no sound: made
once with ffmpeg), each made a file of its own by a 'free' box at its end (players skip it).

Every collection is an index.json of version 2 (the layout of the owner's plan of 2026-10-21):
wallpapers/<id>.jpg + wallpapers/thumbs/<id>.jpg (photos), live-wallpapers/<id>.mp4 +
live-wallpapers/thumbs/<id>.jpg (videos). Collections, by the first part of the path (the test points
vitre.wallpapers.base at one of them):
  /good/      photos   lake-at-dawn, hills, quiet-bay (the owner's own: no credit), red-rocks,
                       snow-field, city-lights, old-pier, odd-thumb (its thumbnail passes every check,
                       a frame header of 320x180 and no picture: it cannot be decoded)
              videos   night-river, surf (the owner's own), drift, long-take (three days long: there is
                       no length limit)
              skipped  an id with capitals, a path out of wallpapers/, another file name, an address
                       elsewhere, the v1 path full/<id>.jpg, 26 MB declared, a 600 KB thumbnail, a
                       colour name, an empty title, a title with a bidi override, a 100000 px width, a
                       string, an id listed twice (also across the lists), a retired id, a thumbnail
                       path out of thumbs/, half a credit; a video whose file is wallpapers/<id>.jpg,
                       a photo whose file is live-wallpapers/<id>.mp4, a duration of 0, none, a
                       string, a width of 4000, 101 MiB declared
  /good2/     the owner changed it: lake-at-dawn and hills gone (hills retired), new-dawn new (first),
              snow-field another picture under the same id; drift gone, new-wave new
  /bad/       /good/ plus downloads that do not check out: bad-thumb (its thumbnail is not the one
              listed), wrong-hash, short-file (fewer bytes than listed), long-file (more bytes than
              listed, no length sent), not-jpeg (a PNG, size and hash right), wrong-dims (a JPEG of
              another size), gone-file (404); not-mp4 (a JPEG, size and hash right), avif-picture (an
              ISO file whose 'ftyp' box names avif / mif1 / miaf, size and hash right),
              video-wrong-hash, video-endless (no length, bytes without end)
  /slow/      /good/ plus slow-a, slow-b, slow-c (photos sent in small pieces over about 3 s each) and
              slow-clip (a video with a 2.5 MiB 'free' box, sent over about 11 s)
  /legacy/    /good/ plus old-pick, the photo test-legacy.jpg (GET /__legacy) under that id
  /empty/     {"version": 2, "wallpapers": [], "live": [], "retired": []}
  /huge/      an index of 1.2 MB (over Deer's 1 MiB limit)
  /redirect/  index.json is a 302 to /good/index.json
  /v1/        index.json of version 1 (Deer 0.1.5's wallpapers.json), and wallpapers.json
Every answer carries Set-Cookie (wptrack=<n>) and a long Cache-Control max-age: Deer must store no
cookie, send none, and take nothing from its HTTP cache. Thumbnails are answered after 150 ms (so a
Get's progress can be watched).

Control (never logged):
  GET /__log               every request since the last reset: path, query, headers (as sent)
  GET /__reset             forget the log and the measurements
  GET /__stats             {"atOnce": the most file requests open at the same time}
  GET /__info              {id: {bytes, sha256, color}} of the good files as served (good2's own
                           snow-field as "snow-field@good2")
  GET /__legacy            the photo old-pick as served by /legacy/ (the test plants it as a file of
                           Deer 0.1.5-0.1.8), with {bytes, sha256} in /__info under "old-pick"
  GET /__drop?prefix=P     close every connection for a path starting with P without an answer (the
                           site down, the network failing); an empty prefix ends it
  GET /__file?path=P       a file as the collections serve it (P: wallpapers/<id>.jpg ...), unlogged:
                           the test plants it as a file of Deer 0.1.5-0.1.8
  GET /__entry?site=S&id=I the entry of I in collection S's index.json (to build that version's
                           wallpapers.json record from)
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
STATE = {'drop': '', 'open': 0, 'max': 0, 'cookie': 0}
FILES = {}       # 'wallpapers/x.jpg' -> bytes (shared by every collection)
SITE_FILES = {}  # ('good2', 'wallpapers/snow-field.jpg') -> bytes: a collection's own (asked first)
INDEXES = {}     # 'good' -> bytes
INFO = {}
SITES = ('good', 'good2', 'bad', 'slow', 'legacy', 'empty', 'huge', 'redirect', 'v1')


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


def mean(img):
    return '#%02x%02x%02x' % img.resize((1, 1), Image.BILINEAR).getpixel((0, 0))


PHOTOS = [
    # id, title, author, license, size, sky, ground, sun
    ('lake-at-dawn', 'Lake at dawn', 'Ada Park', 'CC0-1.0', (1600, 900), ((236, 168, 120), (120, 150, 190)), (52, 70, 92), (255, 226, 170)),
    ('hills', 'Hills after rain', 'Ben Ortiz', 'CC-BY-4.0', (1600, 1000), ((150, 180, 210), (215, 220, 215)), (70, 104, 70), (250, 250, 235)),
    # quiet-bay: the owner's own photo (no author or license), listed with no credit
    ('quiet-bay', 'Quiet bay', None, None, (1600, 900), ((40, 70, 120), (150, 170, 200)), (30, 60, 80), (240, 240, 220)),
    ('red-rocks', 'Red rocks', 'Dev Shah', 'CC-BY-4.0', (1600, 900), ((250, 200, 150), (210, 120, 90)), (150, 70, 50), (255, 240, 210)),
    ('snow-field', 'Snow field', 'Eva Lind', 'CC0-1.0', (1600, 900), ((200, 215, 235), (245, 248, 252)), (225, 232, 240), (255, 255, 250)),
    ('city-lights', 'City lights', 'Finn Moss', 'CC0-1.0', (1600, 900), ((10, 14, 40), (60, 40, 80)), (20, 20, 30), (250, 220, 120)),
    ('old-pier', 'Old pier', 'Gia Bell', 'CC-BY-4.0', (1600, 900), ((180, 190, 200), (120, 130, 140)), (60, 60, 64), (230, 230, 230)),
    ('odd-thumb', 'Odd thumbnail', 'Jo Kim', 'CC0-1.0', (1600, 900), ((200, 180, 150), (150, 130, 110)), (90, 80, 70), (240, 230, 210)),
]
NEW_PHOTO = ('new-dawn', 'New dawn', 'Kim Vale', 'CC0-1.0', (1600, 900), ((250, 190, 140), (140, 160, 200)), (60, 80, 100), (255, 235, 190))
SLOW_PHOTOS = [
    ('slow-a', 'Slow A', 'Ivy Cho', 'CC0-1.0', (2400, 1500), ((120, 160, 120), (40, 70, 50)), (20, 50, 30), (230, 240, 200)),
    ('slow-b', 'Slow B', 'Ivy Cho', 'CC0-1.0', (2400, 1500), ((160, 120, 120), (70, 40, 50)), (50, 20, 30), (240, 230, 200)),
    ('slow-c', 'Slow C', 'Ivy Cho', 'CC0-1.0', (2400, 1500), ((120, 120, 160), (40, 50, 70)), (20, 30, 50), (200, 230, 240)),
]
BAD_PHOTOS = [
    ('bad-thumb', 'Grey morning', ((160, 160, 165), (110, 115, 120))),
    ('wrong-hash', 'Wrong hash', ((120, 120, 200), (60, 60, 120))),
    ('short-file', 'Short file', ((200, 120, 120), (120, 60, 60))),
    ('long-file', 'Long file', ((120, 200, 120), (60, 120, 60))),
    ('not-jpeg', 'Not a JPEG', ((200, 200, 120), (120, 120, 60))),
    ('wrong-dims', 'Wrong size', ((120, 200, 200), (60, 120, 120))),
    ('gone-file', 'Gone', ((180, 140, 200), (90, 70, 120))),
]
# Bytes sent every 70 ms by a slow answer.
SLOW_PIECE = {'slow-a': 12 * 1024, 'slow-b': 12 * 1024, 'slow-c': 12 * 1024, 'slow-clip': 16 * 1024}
CLIP = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'live-wallpaper.mp4'), 'rb').read()
VIDEOS = [
    # id, title, author, license, poster sky, ground, sun, 'free' box padding, duration
    ('night-river', 'Night river', 'Kai Lund', 'CC-BY-4.0', ((20, 30, 60), (40, 60, 90)), (20, 30, 40), (230, 230, 200), 0, 3.0),
    ('surf', 'Surf', None, None, ((90, 150, 200), (200, 220, 230)), (40, 90, 120), (250, 250, 240), 0, 3.0),
    ('drift', 'Drift', 'Lea Moor', 'CC0-1.0', ((180, 120, 160), (90, 60, 110)), (50, 40, 70), (250, 220, 230), 0, 3.0),
    ('long-take', 'Long take', 'Ned Oak', 'CC0-1.0', ((40, 40, 70), (90, 90, 120)), (30, 30, 50), (220, 220, 240), 0, 3 * 86400),
]
NEW_VIDEO = ('new-wave', 'New wave', 'Ola Penn', 'CC0-1.0', ((60, 120, 170), (160, 200, 220)), (30, 70, 100), (250, 250, 240), 0, 3.0)
SLOW_VIDEO = ('slow-clip', 'Slow clip', 'Max Roe', 'CC0-1.0', ((100, 140, 100), (40, 70, 50)), (30, 50, 40), (230, 240, 200), 2560 * 1024, 3.0)
BAD_VIDEOS = [
    ('not-mp4', 'Not an MP4', ((200, 160, 120), (120, 90, 60))),
    ('avif-picture', 'An AVIF picture', ((160, 120, 200), (90, 60, 120))),
    ('video-wrong-hash', 'Video wrong hash', ((120, 160, 200), (60, 90, 120))),
    ('video-endless', 'Video endless', ((160, 200, 120), (90, 120, 60))),
]
SLOW = set(SLOW_PIECE)
ENDLESS = {'video-endless'}
NO_LENGTH = {'long-file', 'video-endless'}
# SOI, a baseline frame header (SOF0) of 320x180 with three components, EOI: Deer's checks pass (size,
# SHA-256, FF D8 FF, a frame within 2048 px), but there is no picture to decode.
ODD_THUMB = bytes([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xb4, 0x01, 0x40, 0x03,
                   0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9])


def photo_entry(wid, title, author, lic, full, th, color, w, h, **over):
    """A photo as the collection's Action lists it."""
    e = {
        'id': wid, 'title': title, 'added': '2026-10-21', 'color': color, 'width': w, 'height': h,
        'file': 'wallpapers/%s.jpg' % wid, 'bytes': len(full), 'sha256': sha(full),
        'thumb': 'wallpapers/thumbs/%s.jpg' % wid, 'thumbBytes': len(th), 'thumbSha256': sha(th),
        'originSha256': sha(full + b'origin'),
    }
    if author:
        e.update({'author': author, 'license': lic, 'source': 'https://example.org/%s' % wid})
    e.update(over)
    return e


def video_entry(wid, title, author, lic, full, th, color, duration=3.0, **over):
    """A live wallpaper as the Action lists it: live-wallpapers/<id>.mp4, the frame size and duration."""
    e = {
        'id': wid, 'title': title, 'added': '2026-10-21', 'color': color, 'width': 320, 'height': 180,
        'duration': duration, 'file': 'live-wallpapers/%s.mp4' % wid, 'bytes': len(full), 'sha256': sha(full),
        'thumb': 'live-wallpapers/thumbs/%s.jpg' % wid, 'thumbBytes': len(th), 'thumbSha256': sha(th),
        'originSha256': sha(full + b'origin'),
    }
    if author:
        e.update({'author': author, 'license': lic, 'source': 'https://example.org/%s' % wid})
    e.update(over)
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


def make_photo(seed, spec, files, grain=10, quality=86):
    wid, title, author, lic, (w, h), sky, ground, sun = spec
    img = landscape(seed, w, h, sky, ground, sun, grain=grain)
    full = jpeg(img, quality)
    th = ODD_THUMB if wid == 'odd-thumb' else jpeg(thumb_of(img), 80)
    files['wallpapers/%s.jpg' % wid] = full
    files['wallpapers/thumbs/%s.jpg' % wid] = th
    return photo_entry(wid, title, author, lic, full, th, mean(img), w, h), full


def make_video(seed, spec, files):
    wid, title, author, lic, sky, ground, sun, pad, duration = spec
    full = with_free_box(CLIP, wid, pad)
    poster = landscape(seed, 480, 270, sky, ground, sun)
    th = jpeg(poster, 80)
    files['live-wallpapers/%s.mp4' % wid] = full
    files['live-wallpapers/thumbs/%s.jpg' % wid] = th
    return video_entry(wid, title, author, lic, full, th, mean(poster), duration), full


def index(photos, videos, retired=()):
    return json.dumps({'version': 2, 'wallpapers': photos, 'live': videos, 'retired': list(retired)}, indent=2).encode()


def build():
    photos = []
    for i, spec in enumerate(PHOTOS):
        e, full = make_photo(i + 1, spec, FILES)
        photos.append(e)
        INFO[spec[0]] = {'bytes': len(full), 'sha256': sha(full), 'color': e['color']}
    videos = []
    for k, spec in enumerate(VIDEOS):
        e, full = make_video(200 + k, spec, FILES)
        videos.append(e)
        INFO[spec[0]] = {'bytes': len(full), 'sha256': sha(full), 'color': e['color']}
    by_id = {e['id']: e for e in photos + videos}
    good, river = photos[0], videos[0]
    skipped_photos = [
        dict(good, id='Bad_ID', file='wallpapers/Bad_ID.jpg', thumb='wallpapers/thumbs/Bad_ID.jpg'),
        dict(good, id='evil', file='wallpapers/../../evil.jpg', thumb='wallpapers/thumbs/evil.jpg'),
        dict(good, id='other', file='wallpapers/someone-else.jpg', thumb='wallpapers/thumbs/other.jpg'),
        dict(good, id='abs', file='https://evil.example/wallpapers/abs.jpg', thumb='wallpapers/thumbs/abs.jpg'),
        dict(good, id='v1-path', file='full/v1-path.jpg', thumb='thumbs/v1-path.jpg'),
        dict(good, id='huge', file='wallpapers/huge.jpg', thumb='wallpapers/thumbs/huge.jpg', bytes=26 * 1024 * 1024),
        dict(good, id='bigthumb', file='wallpapers/bigthumb.jpg', thumb='wallpapers/thumbs/bigthumb.jpg', thumbBytes=600 * 1024),
        dict(good, id='badcolor', file='wallpapers/badcolor.jpg', thumb='wallpapers/thumbs/badcolor.jpg', color='red'),
        dict(good, id='notitle', file='wallpapers/notitle.jpg', thumb='wallpapers/thumbs/notitle.jpg', title=''),
        dict(good, id='bidi', file='wallpapers/bidi.jpg', thumb='wallpapers/thumbs/bidi.jpg', title='Evil‮gpj.exe'),
        dict(good, id='hugewidth', file='wallpapers/hugewidth.jpg', thumb='wallpapers/thumbs/hugewidth.jpg', width=100000),
        'a string, not an entry',
        dict(by_id['hills'], title='Hills listed twice'),
        dict(good, id='retired-one', file='wallpapers/retired-one.jpg', thumb='wallpapers/thumbs/retired-one.jpg'),
        dict(good, id='thumbpath', file='wallpapers/thumbpath.jpg', thumb='wallpapers/thumbs/../thumbpath.jpg'),
        {k: v for k, v in dict(good, id='halfcredit', file='wallpapers/halfcredit.jpg', thumb='wallpapers/thumbs/halfcredit.jpg').items() if k != 'license'},
        dict(river, id='video-in-photos'),  # a video's file in the photos' list
    ]
    skipped_videos = [
        dict(river, id='photo-in-live', file='wallpapers/photo-in-live.jpg', thumb='wallpapers/thumbs/photo-in-live.jpg'),
        dict(river, id='as-jpg', file='live-wallpapers/as-jpg.jpg', thumb='live-wallpapers/thumbs/as-jpg.jpg'),
        dict(river, id='no-length', file='live-wallpapers/no-length.mp4', thumb='live-wallpapers/thumbs/no-length.jpg', duration=0),
        {k: v for k, v in dict(river, id='no-duration', file='live-wallpapers/no-duration.mp4', thumb='live-wallpapers/thumbs/no-duration.jpg').items() if k != 'duration'},
        dict(river, id='text-duration', file='live-wallpapers/text-duration.mp4', thumb='live-wallpapers/thumbs/text-duration.jpg', duration='3'),
        dict(river, id='wide-video', file='live-wallpapers/wide-video.mp4', thumb='live-wallpapers/thumbs/wide-video.jpg', width=4000),
        dict(river, id='huge-video', file='live-wallpapers/huge-video.mp4', thumb='live-wallpapers/thumbs/huge-video.jpg', bytes=101 * 1024 * 1024),
        dict(by_id['quiet-bay'], file='live-wallpapers/quiet-bay.mp4', thumb='live-wallpapers/thumbs/quiet-bay.jpg', duration=3.0),  # listed twice, across the lists
    ]
    good_photos = photos[:3] + skipped_photos[:8] + photos[3:] + skipped_photos[8:]
    good_videos = videos[:2] + skipped_videos[:4] + videos[2:] + skipped_videos[4:]
    INDEXES['good'] = index(good_photos, good_videos, ['retired-one'])

    # good2: the owner changed the collection.
    new_dawn, full = make_photo(50, NEW_PHOTO, FILES)
    INFO['new-dawn'] = {'bytes': len(full), 'sha256': sha(full), 'color': new_dawn['color']}
    own = {}
    snow2, full = make_photo(51, ('snow-field', 'Snow field', 'Eva Lind', 'CC0-1.0', (1600, 900), ((180, 200, 230), (235, 240, 250)), (210, 220, 235), (255, 255, 240)), own)
    for k, v in own.items():
        SITE_FILES[('good2', k)] = v
    INFO['snow-field@good2'] = {'bytes': len(full), 'sha256': sha(full), 'color': snow2['color']}
    new_wave, full = make_video(250, NEW_VIDEO, FILES)
    INFO['new-wave'] = {'bytes': len(full), 'sha256': sha(full), 'color': new_wave['color']}
    photos2 = [new_dawn] + [snow2 if e['id'] == 'snow-field' else e for e in photos if e['id'] not in ('lake-at-dawn', 'hills')]
    videos2 = [new_wave] + [e for e in videos if e['id'] != 'drift']
    INDEXES['good2'] = index(photos2, videos2, ['retired-one', 'hills'])

    # bad: downloads that do not check out.
    bad_photos = []
    for j, (wid, title, sky) in enumerate(BAD_PHOTOS):
        img = landscape(100 + j, 1600, 900, sky, (60, 60, 60), (240, 240, 240))
        full = jpeg(img)
        th = jpeg(thumb_of(img), 80)
        FILES['wallpapers/thumbs/%s.jpg' % wid] = th
        kw = {}
        listed = full
        if wid == 'bad-thumb':
            FILES['wallpapers/%s.jpg' % wid] = full
            kw = {'thumbSha256': sha(b'another thumbnail')}
        elif wid == 'wrong-hash':
            FILES['wallpapers/%s.jpg' % wid] = full
            kw = {'sha256': sha(full + b'x')}
        elif wid == 'short-file':
            listed = full + bytes(1000)       # listed 1000 bytes longer than what is served
            FILES['wallpapers/%s.jpg' % wid] = full
        elif wid == 'long-file':
            FILES['wallpapers/%s.jpg' % wid] = full + bytes(5000)  # 5000 bytes more than listed
        elif wid == 'not-jpeg':
            listed = png(img.resize((400, 225)))
            FILES['wallpapers/%s.jpg' % wid] = listed
        elif wid == 'wrong-dims':
            listed = jpeg(img.resize((1280, 720)))
            FILES['wallpapers/%s.jpg' % wid] = listed
        # gone-file: listed, never served
        bad_photos.append(photo_entry(wid, title, 'Test Person', 'CC0-1.0', listed, th, '#506070', 1600, 900, **kw))
    bad_videos = []
    for k, (wid, title, sky) in enumerate(BAD_VIDEOS):
        poster = landscape(300 + k, 480, 270, sky, (60, 60, 60), (240, 240, 240))
        th = jpeg(poster, 80)
        FILES['live-wallpapers/thumbs/%s.jpg' % wid] = th
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
        FILES['live-wallpapers/%s.mp4' % wid] = listed
        bad_videos.append(video_entry(wid, title, 'Test Person', 'CC0-1.0', listed, th, '#304050', **kw))
    INDEXES['bad'] = index(photos + bad_photos, videos + bad_videos, ['retired-one'])

    # slow: three slow photos and a slow video after the good ones.
    slow_photos = []
    for i, spec in enumerate(SLOW_PHOTOS):
        e, full = make_photo(60 + i, spec, FILES, grain=40, quality=92)
        slow_photos.append(e)
        INFO[spec[0]] = {'bytes': len(full), 'sha256': sha(full), 'color': e['color']}
    slow_clip, full = make_video(260, SLOW_VIDEO, FILES)
    INFO['slow-clip'] = {'bytes': len(full), 'sha256': sha(full), 'color': slow_clip['color']}
    INDEXES['slow'] = index(photos + slow_photos, videos + [slow_clip], ['retired-one'])

    # legacy: a photo Deer 0.1.5-0.1.8 downloaded, now in the new layout under the same id.
    old, full = make_photo(70, ('old-pick', 'Old pick', 'Pia Lund', 'CC0-1.0', (1600, 900), ((220, 200, 160), (130, 140, 170)), (70, 80, 90), (255, 240, 200)), FILES)
    INFO['old-pick'] = {'bytes': len(full), 'sha256': sha(full), 'color': old['color']}
    INDEXES['legacy'] = index([old] + photos, videos, ['retired-one'])

    INDEXES['empty'] = b'{\n  "version": 2,\n  "wallpapers": [],\n  "live": [],\n  "retired": []\n}\n'
    INDEXES['huge'] = json.dumps({'version': 2, 'wallpapers': photos[:1], 'live': [], 'padding': 'x' * (1200 * 1024)}).encode()
    v1 = {'version': 1, 'wallpapers': [dict(e, file='full/%s.jpg' % e['id'], thumb='thumbs/%s.jpg' % e['id']) for e in photos]}
    INDEXES['v1'] = json.dumps(v1, indent=2).encode()


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
        if rest == 'index.json':
            if site == 'redirect':
                return self.wfile.write(self.send(302, b'', 'text/plain', {'Location': '/good/index.json'}))
            try:
                self.wfile.write(self.send(200, INDEXES[site], 'application/json'))
            except OSError:
                pass  # Deer stopped reading
            return
        if rest == 'wallpapers.json' and site == 'v1':
            return self.wfile.write(self.send(200, INDEXES['v1'], 'application/json'))
        body = SITE_FILES.get((site, rest), FILES.get(rest))
        if body is None or site in ('empty', 'huge', 'redirect', 'v1'):
            return self.wfile.write(self.send(404, b'not here', 'text/plain'))
        with LOCK:
            STATE['open'] += 1
            STATE['max'] = max(STATE['max'], STATE['open'])
        try:
            self.serve_file(path, rest, body)
        except OSError:
            pass  # Deer stopped reading
        finally:
            with LOCK:
                STATE['open'] -= 1

    def serve_file(self, path, rest, body):
        if '/thumbs/' in rest:
            time.sleep(0.15)
            return self.wfile.write(self.send(200, body, 'image/jpeg'))
        wid = rest.rsplit('/', 1)[-1].rsplit('.', 1)[0]
        ctype = 'video/mp4' if rest.endswith('.mp4') else 'image/jpeg'
        # long-file and video-endless say nothing of their length (HTTP/1.0: the body ends when the
        # connection does), so Deer's limit is met while the bytes arrive, not from a header.
        self.send(200, body, ctype, length=wid not in NO_LENGTH)
        if wid in ENDLESS:
            self.wfile.write(body)
            for _ in range(64 * 16):  # never more than 64 MiB, should Deer not stop reading
                self.wfile.write(bytes(64 * 1024))
                self.wfile.flush()
        elif wid in SLOW:
            step = SLOW_PIECE[wid]
            for i in range(0, len(body), step):
                with LOCK:
                    drop = STATE['drop']
                if drop and path.startswith(drop):
                    self.connection.shutdown(2)  # the network failing mid-way
                    return
                self.wfile.write(body[i:i + step])
                self.wfile.flush()
                time.sleep(0.07)
        else:
            self.wfile.write(body)

    def control(self, path, q):
        if path == '/__log':
            with LOCK:
                body = json.dumps(LOG).encode()
            return self.wfile.write(self.send(200, body, 'application/json', cookie=False))
        if path == '/__reset':
            with LOCK:
                LOG.clear()
                STATE['max'] = 0
            return self.wfile.write(self.send(200, b'{}', 'application/json', cookie=False))
        if path == '/__stats':
            with LOCK:
                body = json.dumps({'atOnce': STATE['max']}).encode()
            return self.wfile.write(self.send(200, body, 'application/json', cookie=False))
        if path == '/__info':
            return self.wfile.write(self.send(200, json.dumps(INFO).encode(), 'application/json', cookie=False))
        if path == '/__legacy':
            return self.wfile.write(self.send(200, FILES['wallpapers/old-pick.jpg'], 'image/jpeg', cookie=False))
        if path == '/__file':
            body = FILES.get((q.get('path') or [''])[0])
            if body is None:
                return self.wfile.write(self.send(404, b'', 'text/plain', cookie=False))
            return self.wfile.write(self.send(200, body, 'application/octet-stream', cookie=False))
        if path == '/__entry':
            site, wid = (q.get('site') or [''])[0], (q.get('id') or [''])[0]
            idx = json.loads(INDEXES.get(site, b'{}'))
            found = [e for k in ('wallpapers', 'live') for e in idx.get(k, []) if isinstance(e, dict) and e.get('id') == wid]
            if not found:
                return self.wfile.write(self.send(404, b'', 'text/plain', cookie=False))
            return self.wfile.write(self.send(200, json.dumps(found[0]).encode(), 'application/json', cookie=False))
        if path == '/__drop':
            with LOCK:
                STATE['drop'] = (q.get('prefix') or [''])[0]
            return self.wfile.write(self.send(200, b'{}', 'application/json', cookie=False))
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
