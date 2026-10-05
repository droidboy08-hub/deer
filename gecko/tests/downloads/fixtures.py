"""Test fixtures for the downloader tests (idempotent): python tests/downloads/fixtures.py [--dir D] [--ffmpeg F]

Creates <dir>/fixtures (default %TEMP%/vitre-dl-tests/fixtures):
  big.bin       256 MiB of seeded pseudo-random bytes (the 8-connection checksum target)
  medium.bin    24 MiB (take-over, pause/resume, small runs)
  manifest.json sizes and sha256
  With ffmpeg (never downloaded: --ffmpeg, or the copy this machine already has):
  clip.mp4      24 s, 640x360, h264 + aac (~2.4 MB: the page's <video>)
  hls/          TS HLS: master + 360p + 180p (AES-128 encrypted, not DRM), drm.m3u8 (Widevine key: refused)
  hlsfmp4/      fMP4 HLS with a separate audio rendition (EXT-X-MAP, var_stream_map)
  dash/         DASH: SegmentTemplate + SegmentTimeline, one video and one audio adaptation set
  dash-drm.mpd  a DASH manifest with ContentProtection (refused)
  live/         a live HLS stream (no ENDLIST: "Live, can't be saved")
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
            for b in iter(lambda: f.read(1 << 20), b''):
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
    def run(args, cwd):
        subprocess.run([ff, '-y', '-hide_banner', '-loglevel', 'error', *args], check=True, cwd=cwd)

    src = ['-f', 'lavfi', '-i', 'testsrc2=duration=24:size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=24']
    enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '50', '-c:a', 'aac', '-b:a', '96k']
    clip = os.path.join(out, 'clip.mp4')
    if not os.path.exists(clip):
        run([*src, *enc, '-b:v', '800k', '-minrate', '800k', '-maxrate', '800k', '-bufsize', '400k', '-movflags', '+faststart', clip], out)

    hls = os.path.join(out, 'hls')
    os.makedirs(os.path.join(hls, 'v360'), exist_ok=True)
    os.makedirs(os.path.join(hls, 'v180'), exist_ok=True)
    if not os.path.exists(os.path.join(hls, 'v360', 'index.m3u8')):
        run([*src, *enc, '-b:v', '600k', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
             '-hls_segment_filename', 'v360/seg%03d.ts', 'v360/index.m3u8'], hls)
    if not os.path.exists(os.path.join(hls, 'v180', 'index.m3u8')):
        with open(os.path.join(hls, 'v180', 'enc.key'), 'wb') as f:
            f.write(bytes(range(16)))
        with open(os.path.join(hls, 'v180', 'keyinfo.txt'), 'w') as f:
            f.write('enc.key\n' + os.path.join(hls, 'v180', 'enc.key').replace('\\', '/') + '\n')
        run([*src, '-vf', 'scale=320:180', *enc, '-b:v', '250k', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod',
             '-hls_key_info_file', 'v180/keyinfo.txt', '-hls_segment_filename', 'v180/seg%03d.ts', 'v180/index.m3u8'], hls)
    with open(os.path.join(hls, 'master.m3u8'), 'w', newline='\n') as f:
        f.write('#EXTM3U\n#EXT-X-VERSION:3\n'
                '#EXT-X-STREAM-INF:BANDWIDTH=760000,AVERAGE-BANDWIDTH=700000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"\n'
                'v360/index.m3u8\n'
                '#EXT-X-STREAM-INF:BANDWIDTH=380000,AVERAGE-BANDWIDTH=350000,RESOLUTION=320x180,CODECS="avc1.64000d,mp4a.40.2"\n'
                'v180/index.m3u8\n')
    with open(os.path.join(hls, 'drm.m3u8'), 'w', newline='\n') as f:
        f.write('#EXTM3U\n#EXT-X-VERSION:5\n'
                '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,AAAA",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",KEYFORMATVERSIONS="1"\n'
                '#EXT-X-STREAM-INF:BANDWIDTH=760000,RESOLUTION=640x360\nv360/index.m3u8\n')

    # fMP4 HLS, video and audio in separate renditions (what Apple's bipbop and most players do).
    fm = os.path.join(out, 'hlsfmp4')
    os.makedirs(fm, exist_ok=True)
    if not os.path.exists(os.path.join(fm, 'master.m3u8')):
        run([*src, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '50', '-b:v', '600k',
             '-c:a', 'aac', '-b:a', '96k', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_segment_type', 'fmp4',
             '-hls_fmp4_init_filename', 'init.mp4', '-master_pl_name', 'master.m3u8',
             '-var_stream_map', 'v:0,agroup:aud,name:video a:0,agroup:aud,default:yes,name:audio',
             '-hls_segment_filename', '%v/seg%03d.m4s', '%v/index.m3u8'], fm)

    # DASH: SegmentTemplate with a SegmentTimeline, one adaptation set each for video and audio.
    dash = os.path.join(out, 'dash')
    os.makedirs(dash, exist_ok=True)
    if not os.path.exists(os.path.join(dash, 'manifest.mpd')):
        run([*src, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '50', '-b:v', '600k',
             '-c:a', 'aac', '-b:a', '96k', '-f', 'dash', '-seg_duration', '2', '-use_template', '1', '-use_timeline', '1',
             '-adaptation_sets', 'id=0,streams=v id=1,streams=a', 'manifest.mpd'], dash)
    with open(os.path.join(out, 'dash-drm.mpd'), 'w', newline='\n') as f:
        f.write('<?xml version="1.0"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT24S">\n'
                ' <Period><AdaptationSet mimeType="video/mp4">\n'
                '  <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>\n'
                '  <Representation id="v" bandwidth="800000" width="640" height="360"><BaseURL>clip.mp4</BaseURL></Representation>\n'
                ' </AdaptationSet></Period>\n</MPD>\n')

    # A live stream: the 360p segments in a playlist that never ends.
    live = os.path.join(out, 'live')
    os.makedirs(live, exist_ok=True)
    with open(os.path.join(live, 'index.m3u8'), 'w', newline='\n') as f:
        f.write('#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:3\n'
                + ''.join('#EXTINF:2.000000,\n../hls/v360/seg%03d.ts\n' % i for i in range(3, 6)))
    with open(os.path.join(live, 'master.m3u8'), 'w', newline='\n') as f:
        f.write('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=760000,RESOLUTION=640x360\nindex.m3u8\n')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=os.path.join(tempfile.gettempdir(), 'vitre-dl-tests'))
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
        manifest['ffprobe'] = os.path.join(os.path.dirname(ff), 'ffprobe.exe') if os.path.isfile(os.path.join(os.path.dirname(ff), 'ffprobe.exe')) else ''
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print(json.dumps(manifest))


if __name__ == '__main__':
    sys.exit(main())
