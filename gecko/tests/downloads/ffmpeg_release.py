"""A local stand-in for BtbN's FFmpeg-Builds release, for tests/downloads/ffmpeg-install.js.

  python tests/downloads/ffmpeg_release.py <dir> [--port 47960]

Writes into <dir>:
  good/  checksums.sha256 listing a master build, n8.1 and n9.0 (the installer must pick n9.0)
         and ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip with <top>/bin/ffmpeg.exe (a copy of the
         ffmpeg already on this machine, so the installed one really runs), a DLL and LICENSE.txt
  bad/   the same zip, but checksums.sha256 gives it another fingerprint
then serves <dir> on 127.0.0.1:<port> until killed. Nothing is downloaded from the internet.
"""
import argparse
import functools
import hashlib
import http.server
import os
import shutil
import zipfile

LOCAL_FFMPEG = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'Monolist', 'tools', 'ffmpeg.exe')
NAME = 'ffmpeg-n9.0-latest-win64-lgpl-shared-9.0'


def build(root):
    shutil.rmtree(root, ignore_errors=True)
    good = os.path.join(root, 'good')
    bad = os.path.join(root, 'bad')
    os.makedirs(good)
    os.makedirs(bad)
    zpath = os.path.join(good, NAME + '.zip')
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(LOCAL_FFMPEG, NAME + '/bin/ffmpeg.exe')
        z.writestr(NAME + '/bin/avcodec-62.dll', b'MZ test dll')
        z.writestr(NAME + '/bin/ffplay.exe', b'MZ not wanted')
        z.writestr(NAME + '/LICENSE.txt', 'GNU LESSER GENERAL PUBLIC LICENSE (test copy)')
        z.writestr(NAME + '/doc/readme.txt', 'not wanted')
    digest = hashlib.sha256(open(zpath, 'rb').read()).hexdigest()
    other = '0' * 64
    lines = [
        f'{other}  ffmpeg-master-latest-win64-lgpl-shared.zip',
        f'{other}  ffmpeg-n8.1-latest-win64-lgpl-shared-8.1.zip',
        f'{other}  ffmpeg-n9.0-latest-win64-lgpl-9.0.zip',
        f'{digest}  {NAME}.zip',
        f'{other}  ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip',
    ]
    open(os.path.join(good, 'checksums.sha256'), 'w').write('\n'.join(lines) + '\n')
    shutil.copy(zpath, os.path.join(bad, NAME + '.zip'))
    open(os.path.join(bad, 'checksums.sha256'), 'w').write(f'{"f" * 64}  {NAME}.zip\n')
    return digest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dir')
    ap.add_argument('--port', type=int, default=47960)
    a = ap.parse_args()
    digest = build(a.dir)
    print('sha256', digest, flush=True)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=a.dir)
    http.server.ThreadingHTTPServer(('127.0.0.1', a.port), handler).serve_forever()


if __name__ == '__main__':
    main()
