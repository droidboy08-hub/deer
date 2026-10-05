"""A stand-in for yt-dlp in tests (vitre.tools.ytdlpCommand = [python, this file]).

Answers like yt-dlp for what Vitre asks:
  --version                      2026.08.19
  -J <url>                       JSON with formats: 1080p and 720p H.264 video-only, 360p with sound,
                                 M4A and Opus audio; a URL containing "unavailable" fails like yt-dlp
  -f <fmt> -o <path> ... <url>   prints --progress-template lines for each format, [Merger] when
                                 joining, then writes <path>; a URL containing "slow" takes ~6 s
Every call is recorded in %TEMP%\\vitre-fake-ytdlp.log (one JSON line per call).
"""
import json
import os
import sys
import tempfile
import time

args = sys.argv[1:]
with open(os.path.join(tempfile.gettempdir(), 'vitre-fake-ytdlp.log'), 'a', encoding='utf-8') as f:
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

if '-J' in args:
    print(json.dumps({'id': 'fake', 'title': 'A fake clip: glass in motion', 'duration': 19, 'webpage_url': url,
                      'live_status': 'not_live', 'is_live': False, 'formats': FORMATS}))
    sys.exit(0)

fmt = opt('-f') or ''
out = (opt('-o') or 'out.mp4').replace('%%', '%')
sizes = {f['format_id']: f.get('filesize', 100_000) for f in FORMATS}
steps = 12 if 'slow' in url else 4
for part in fmt.split('+'):
    total = sizes.get(part, 100_000)
    for i in range(1, steps + 1):
        got = total * i // steps
        status = 'finished' if i == steps else 'downloading'
        print(f'VITRE {status} {got} {total} NA', flush=True)
        time.sleep(0.5 if 'slow' in url else 0.05)
if '+' in fmt:
    print(f'[Merger] Merging formats into "{out}"', flush=True)
    time.sleep(0.2)
with open(out, 'wb') as f:
    f.write(b'\0' * sum(sizes.get(p, 100_000) for p in fmt.split('+')))
sys.exit(0)
