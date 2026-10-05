"""Run the ffmpeg install test against a local stand-in release (from gecko/):

  python tests/downloads/ffmpeg-install.py [--app build]

Starts tests/downloads/ffmpeg_release.py in %TEMP%\\vitre-ffmpeg-test, runs ffmpeg-install.js with
tools/run.py, stops the server and removes the folder. Nothing is downloaded from the internet.
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PORT = 47960
LOCAL_FFMPEG = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'Monolist', 'tools', 'ffmpeg.exe')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--app', default='')
    a = ap.parse_args()
    work = os.path.join(tempfile.gettempdir(), 'vitre-ffmpeg-test')
    server = subprocess.Popen([sys.executable, os.path.join(HERE, 'ffmpeg_release.py'), work, '--port', str(PORT)],
                              stdout=subprocess.PIPE, text=True)
    try:
        print(server.stdout.readline().strip())
        time.sleep(0.5)
        cmd = [sys.executable, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, 'ffmpeg-install.js'),
               '--name', 'dl-ffmpeg-install', '--timeout', '180', '--out', os.path.join(HERE, 'out', 'ffmpeg-install'),
               '--env', f'FFTEST_BASE=http://127.0.0.1:{PORT}', '--env', f'FFTEST_DIR={work}',
               '--env', f'FFTEST_EXE_SIZE={os.path.getsize(LOCAL_FFMPEG)}']
        if a.app:
            cmd += ['--app', a.app]
        code = subprocess.run(cmd, cwd=ROOT).returncode
    finally:
        server.kill()
        server.wait()
        shutil.rmtree(work, ignore_errors=True)
    sys.exit(code)


if __name__ == '__main__':
    main()
