"""Screen recorder for spike S6 (motion), run beside tools/run.py:

  /usr/bin/python3 spikes/mac-glass/recorder.py tests/menus/out/log.txt <video folder> [--timeout 400]

Waits for lines `MOTION-REC <tag> <x> <y> <w> <h> <seconds>` (screen points, from s6-motion.js) that
appear in the run's log after it starts, records that rectangle of the main display at 60 fps with
ffmpeg (avfoundation "Capture screen 0", no cursor) for <seconds>, and writes `motion-go-<tag>` next
to the log 1.5 s after ffmpeg started, so the test starts its animations while the recording runs.
Only the rectangle is kept (cropped while recording); the video goes to <video folder>/<tag>.mkv
(lossless). Python 3.9, standard library and /opt/homebrew/bin/ffmpeg.
"""
import os
import subprocess
import sys
import time

FFMPEG = '/opt/homebrew/bin/ffmpeg'
SCALE = 2


def main(argv):
    log, vids = argv[0], argv[1]
    timeout = float(argv[argv.index('--timeout') + 1]) if '--timeout' in argv else 400
    os.makedirs(vids, exist_ok=True)
    out_dir = os.path.dirname(os.path.abspath(log))
    seen = set()
    try:
        seen = set(open(log, encoding='utf-8', errors='replace').read().splitlines())
    except OSError:
        pass
    end = time.time() + timeout
    while time.time() < end:
        try:
            lines = open(log, encoding='utf-8', errors='replace').read().splitlines()
        except OSError:
            lines = []
        if any(l.startswith('@@quit') for l in lines if l not in seen) and len(lines) > 3:
            break
        for line in lines:
            if line in seen or not line.startswith('MOTION-REC '):
                continue
            seen.add(line)
            _, tag, x, y, w, h, secs = line.split()
            x, y, w, h = (int(float(v)) * SCALE for v in (x, y, w, h))
            w -= w % 2
            h -= h % 2
            path = os.path.join(vids, tag + '.mkv')
            if os.path.exists(path):
                os.remove(path)
            cmd = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-capture_cursor', '0',
                   '-framerate', '60', '-pixel_format', 'uyvy422', '-i', '1:none', '-t', secs,
                   '-vf', 'crop=%d:%d:%d:%d' % (w, h, x, y), '-c:v', 'ffv1', '-y', path]
            print('[recorder] %s: %s' % (tag, ' '.join(cmd)), flush=True)
            proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL)
            time.sleep(1.5)
            open(os.path.join(out_dir, 'motion-go-' + tag), 'w').close()
            proc.wait()
            print('[recorder] %s done (exit %s) -> %s' % (tag, proc.returncode, path), flush=True)
        time.sleep(0.1)


if __name__ == '__main__':
    main(sys.argv[1:])
