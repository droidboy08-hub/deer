"""Generate the test fixtures for the downloader spike (idempotent).

  python make_fixtures.py [--dir %TEMP%/vitre-dl-spike] [--ffmpeg path/to/ffmpeg.exe]

Creates, in <dir>/fixtures:
  big.bin      256 MiB of deterministic pseudo-random bytes (seeded), the ranged-download target
  medium.bin   24 MiB, used by the take-over test
  manifest.json  sizes and sha256 of both
  hls/         a small VOD HLS stream (master + 2 renditions, one AES-128 encrypted) and clip.mp4,
               only when ffmpeg is available (it is never downloaded: pass --ffmpeg or have it on PATH)
"""
import argparse
import hashlib
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile

DEFAULT_FFMPEG = os.path.expandvars(r'%LOCALAPPDATA%\Programs\Monolist\tools\ffmpeg.exe')


def make_bin(path, size, seed):
    if os.path.exists(path) and os.path.getsize(path) == size:
        h = hashlib.sha256()
        with open(path, 'rb') as f:
            while True:
                b = f.read(1 << 20)
                if not b:
                    break
                h.update(b)
        return h.hexdigest()
    rnd = random.Random(seed)
    h = hashlib.sha256()
    with open(path, 'wb') as f:
        left = size
        while left > 0:
            b = rnd.randbytes(min(1 << 20, left))
            f.write(b)
            h.update(b)
            left -= len(b)
    return h.hexdigest()


def find_ffmpeg(arg):
    for c in (arg, shutil.which('ffmpeg'), DEFAULT_FFMPEG):
        if c and os.path.isfile(c):
            return c
    return None


def make_media(ff, out):
    hls = os.path.join(out, 'hls')
    os.makedirs(hls, exist_ok=True)
    clip = os.path.join(out, 'clip.mp4')
    run = lambda args: subprocess.run([ff, '-y', '-hide_banner', '-loglevel', 'error', *args], check=True, cwd=hls)
    src = ['-f', 'lavfi', '-i', 'testsrc2=duration=24:size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=24']
    enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '50', '-c:a', 'aac', '-b:a', '96k']
    if not os.path.exists(clip):
        # ~2.4 MB so the media watcher (which ignores media under 500 kB) sees it.
        run([*src, *enc, '-b:v', '800k', '-minrate', '800k', '-maxrate', '800k', '-bufsize', '400k', '-movflags', '+faststart', clip])
    if not os.path.exists(os.path.join(hls, 'v360', 'index.m3u8')):
        os.makedirs(os.path.join(hls, 'v360'), exist_ok=True)
        run([*src, *enc, '-b:v', '600k', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
             '-hls_segment_filename', 'v360/seg%03d.ts', 'v360/index.m3u8'])
    if not os.path.exists(os.path.join(hls, 'v180', 'index.m3u8')):
        os.makedirs(os.path.join(hls, 'v180'), exist_ok=True)
        # The low rendition is AES-128 encrypted (plain HLS encryption, not DRM): the engine must decrypt it.
        key = bytes(range(16))
        with open(os.path.join(hls, 'v180', 'enc.key'), 'wb') as f:
            f.write(key)
        with open(os.path.join(hls, 'v180', 'keyinfo.txt'), 'w') as f:
            f.write('enc.key\n' + os.path.join(hls, 'v180', 'enc.key').replace('\\', '/') + '\n')
        run([*src, '-vf', 'scale=320:180', *enc, '-b:v', '250k', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
             '-hls_key_info_file', 'v180/keyinfo.txt', '-hls_segment_filename', 'v180/seg%03d.ts', 'v180/index.m3u8'])
        # Reference: the same rendition decrypted by ffmpeg itself, to compare against the engine's output.
        run(['-allowed_extensions', 'ALL', '-i', 'v180/index.m3u8', '-c', 'copy', '-f', 'mpegts', 'v180/reference.ts'])
    with open(os.path.join(hls, 'master.m3u8'), 'w', newline='\n') as f:
        f.write('#EXTM3U\n#EXT-X-VERSION:3\n'
                '#EXT-X-STREAM-INF:BANDWIDTH=760000,AVERAGE-BANDWIDTH=700000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"\n'
                'v360/index.m3u8\n'
                '#EXT-X-STREAM-INF:BANDWIDTH=380000,AVERAGE-BANDWIDTH=350000,RESOLUTION=320x180,CODECS="avc1.64000d,mp4a.40.2"\n'
                'v180/index.m3u8\n')
    # A DRM master (Widevine session key) and a DASH manifest with ContentProtection, for the refusal tests.
    with open(os.path.join(hls, 'drm.m3u8'), 'w', newline='\n') as f:
        f.write('#EXTM3U\n#EXT-X-VERSION:5\n'
                '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,AAAA",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",KEYFORMATVERSIONS="1"\n'
                '#EXT-X-STREAM-INF:BANDWIDTH=760000,RESOLUTION=640x360\nv360/index.m3u8\n')
    with open(os.path.join(out, 'manifest.mpd'), 'w', newline='\n') as f:
        f.write('<?xml version="1.0"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT24S">\n'
                ' <Period><AdaptationSet mimeType="video/mp4">\n'
                '  <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>\n'
                '  <Representation id="v" bandwidth="800000" width="640" height="360"><BaseURL>clip.mp4</BaseURL></Representation>\n'
                ' </AdaptationSet></Period>\n</MPD>\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=os.path.join(tempfile.gettempdir(), 'vitre-dl-spike'))
    ap.add_argument('--ffmpeg')
    a = ap.parse_args()
    out = os.path.join(a.dir, 'fixtures')
    os.makedirs(out, exist_ok=True)
    manifest = {}
    for name, size, seed in (('big.bin', 256 << 20, 1157), ('medium.bin', 24 << 20, 2026)):
        manifest[name] = {'size': size, 'sha256': make_bin(os.path.join(out, name), size, seed)}
    ff = find_ffmpeg(a.ffmpeg)
    manifest['ffmpeg'] = ff or ''
    if ff:
        make_media(ff, out)
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print(json.dumps(manifest))


if __name__ == '__main__':
    sys.exit(main())
