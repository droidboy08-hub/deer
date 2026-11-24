"""Run tests/downloads/mac-tools.js (macOS) against local stand-in releases (from gecko/):

  python3 tests/downloads/mac-tools.py [--app build] [--no-capture]

Builds stand-ins of the three macOS sources Deer downloads its video tools from in a fresh folder in
$TMPDIR, serves it on 127.0.0.1 (a free port) for the run, runs mac-tools.js with tools/run.py, then
stops the server and removes the folder. Nothing is downloaded from the internet.

  /ff/<case>/ffmpeg.zip            307 to /ff/<case>/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip, as
                                   Martin Riedl's server answers; beside it ffmpeg.zip.sha256
                                   ("<sha256>  ffmpeg.zip"). case good, bad (another fingerprint), or
                                   slow (an ffmpeg that never answers -version: Cancel during its first start)
  /yt/<case>/SHA2-256SUMS          yt-dlp's list (yt-dlp.exe, yt-dlp_macos and yt-dlp_macos.zip) and
  /yt/<case>/yt-dlp_macos.zip      the onedir build: yt-dlp_macos beside _internal/. case good, bad (another
                                   fingerprint), slip (a matching zip with an entry ../escape.txt)
  /deno/<case>/deno-<aarch64|x86_64>-apple-darwin.zip(.sha256sum)
                                   case good, bad (another fingerprint), broken (a deno that does not start);
                                   each processor's deno names its own (--version: <arch>-apple-darwin), so the
                                   test sees which one Deer took

The programs are /bin/sh stand-ins that answer their version (-version, --version), stored mode 0644 in
the zips, so the test sees Deer make them 0755. The yt-dlp stand-in refuses to answer without its
_internal folder beside it. The run gets PATH=/usr/bin:/bin:/usr/sbin:/sbin, so an ffmpeg Homebrew put on
PATH does not hide the Download ffmpeg row.
"""
import argparse
import functools
import hashlib
import http.server
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
FF_FINAL = 'download/macos/arm64/1789931890_9.0.2/ffmpeg.zip'

FFMPEG = b'''#!/bin/sh
# Deer test stand-in for ffmpeg (tests/downloads/mac-tools.py)
for a in "$@"; do
  if [ "$a" = "-version" ]; then
    echo "ffmpeg version 9.0.2-deer-test Copyright (c) 2000-2026 the FFmpeg developers"
    exit 0
  fi
done
exit 0
'''

YTDLP = b'''#!/bin/sh
# Deer test stand-in for yt-dlp's onedir build (tests/downloads/mac-tools.py)
here=$(cd "$(dirname "$0")" && pwd)
if [ ! -f "$here/_internal/base_library.zip" ]; then
  echo "ERROR: _internal is missing beside $0" >&2
  exit 3
fi
for a in "$@"; do
  if [ "$a" = "--version" ]; then
    echo "2026.10.26"
    exit 0
  fi
done
echo "ERROR: this stand-in only answers --version" >&2
exit 2
'''

DENO = b'''#!/bin/sh
# Deer test stand-in for Deno (tests/downloads/mac-tools.py)
if [ "$1" = "--version" ]; then
  echo "deno 2.9.8 (stable, release, aarch64-apple-darwin)"
  echo "v8 14.0.365.4-rusty"
  echo "typescript 5.9.2"
  exit 0
fi
exit 1
'''

FFMPEG_SLOW = b'''#!/bin/sh
# Deer test stand-in for an ffmpeg whose first start does not end (tests/downloads/mac-tools.py)
exec /bin/sleep 60
'''

DENO_BROKEN = b'''#!/bin/sh
# Deer test stand-in for a Deno that does not start (tests/downloads/mac-tools.py)
echo "dyld: Library not loaded" >&2
exit 134
'''


def put(z, name, data, mode=0o644):
    info = zipfile.ZipInfo(name, date_time=(2026, 10, 26, 18, 8, 0))
    info.create_system = 3  # Unix: external_attr carries the mode
    info.external_attr = ((0o040000 if name.endswith('/') else 0o100000) | mode) << 16
    info.compress_type = zipfile.ZIP_STORED if name.endswith('/') else zipfile.ZIP_DEFLATED
    z.writestr(info, data)


def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb' if isinstance(data, bytes) else 'w') as f:
        f.write(data)


def build(root):
    other = '0' * 64
    # ffmpeg (Martin Riedl's layout)
    for case in ('good', 'bad', 'slow'):
        zpath = os.path.join(root, 'ff', case, FF_FINAL)
        os.makedirs(os.path.dirname(zpath))
        with zipfile.ZipFile(zpath, 'w') as z:
            put(z, 'ffmpeg', FFMPEG_SLOW if case == 'slow' else FFMPEG)
        digest = sha(zpath) if case != 'bad' else 'f' * 64
        write(zpath + '.sha256', '%s  ffmpeg.zip\n\n' % digest)
    # yt-dlp (its GitHub release)
    for case in ('good', 'bad', 'slip'):
        zpath = os.path.join(root, 'yt', case, 'yt-dlp_macos.zip')
        os.makedirs(os.path.dirname(zpath))
        with zipfile.ZipFile(zpath, 'w') as z:
            put(z, '_internal/', b'', 0o755)
            put(z, '_internal/lib-dynload/', b'', 0o755)
            put(z, '_internal/Python', b'\xcf\xfa\xed\xfe stand-in', 0o755)
            put(z, '_internal/base_library.zip', b'PK stand-in')
            put(z, '_internal/lib-dynload/_heapq.cpython-314-darwin.so', b'\xcf\xfa\xed\xfe stand-in', 0o755)
            put(z, 'yt-dlp_macos', YTDLP)
            if case == 'slip':
                put(z, '../escape.txt', b'outside the folder')
        digest = sha(zpath) if case != 'bad' else 'f' * 64
        write(os.path.join(root, 'yt', case, 'SHA2-256SUMS'), '\n'.join([
            '%s  yt-dlp' % other,
            '%s  yt-dlp.exe' % other,
            '%s  yt-dlp_macos' % other,
            '%s  yt-dlp_macos.zip' % digest,
            '%s  yt-dlp_win.zip' % other,
        ]) + '\n')
    # Deno (its GitHub release), both processors
    for case in ('good', 'bad', 'broken'):
        for arch in ('aarch64', 'x86_64'):
            name = 'deno-%s-apple-darwin.zip' % arch
            zpath = os.path.join(root, 'deno', case, name)
            os.makedirs(os.path.dirname(zpath), exist_ok=True)
            own = DENO.replace(b'aarch64-apple-darwin', ('%s-apple-darwin' % arch).encode())
            with zipfile.ZipFile(zpath, 'w') as z:
                put(z, 'deno', DENO_BROKEN if case == 'broken' else own)
            digest = sha(zpath) if case != 'bad' else 'f' * 64
            write(zpath + '.sha256sum', '%s  %s\n' % (digest, name))


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parts = self.path.split('?')[0].strip('/').split('/')
        if len(parts) == 3 and parts[0] == 'ff' and parts[2] == 'ffmpeg.zip':
            self.send_response(307)
            self.send_header('Location', '/ff/%s/%s' % (parts[1], FF_FINAL))
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        super().do_GET()

    def log_message(self, *args):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--app', default='')
    ap.add_argument('--no-capture', action='store_true')
    a = ap.parse_args()
    work = tempfile.mkdtemp(prefix='deer-mac-tools-')
    try:
        build(work)
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=work))
        port = server.server_address[1]
        threading.Thread(target=server.serve_forever, daemon=True).start()
        print('stand-in releases on http://127.0.0.1:%d' % port, flush=True)
        cmd = [sys.executable, '-u', os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, 'mac-tools.js'),
               '--name', 'dl-mac-tools', '--url', 'about:blank', '--timeout', '300',
               '--out', os.path.join(HERE, 'out', 'mac-tools'),
               '--env', 'MACTOOLS_BASE=http://127.0.0.1:%d' % port,
               '--env', 'PATH=/usr/bin:/bin:/usr/sbin:/sbin']
        if a.app:
            cmd += ['--app', a.app]
        if a.no_capture:
            cmd += ['--no-capture']
        code = subprocess.run(cmd, cwd=ROOT).returncode
        server.shutdown()
    finally:
        shutil.rmtree(work, ignore_errors=True)
    sys.exit(code)


if __name__ == '__main__':
    main()
