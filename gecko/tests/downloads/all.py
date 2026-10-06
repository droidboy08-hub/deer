"""Run the downloader tests (from gecko/):  python tests/downloads/all.py [name ...] [--app build-downloads] [--port 47931]

  engine     256 MiB on 8 connections (sha256), sockets per lane, pause/resume with If-Range,
             speed limit, panel and ring captures
  restart    a download paused by a restart (the quit prompt confirmed) resumes from its segments
  ytdlp      YouTube and other sites through yt-dlp (a stand-in script): install prompt, picker, download, errors
  spa        a single-page site's next video (no reload): the old video's streams go, the new one is offered
  mark       the pill's download mark always answers: a picker for what the page loaded, or a note
  embed      an embedded player from another site whose CDN refuses any Referer but the player's:
             offered and downloaded as the player's frame; an ordinary embed goes out as before
  crosssite  a download another site's page starts is left to Firefox (no first-party cookies used)
  takeover   a real link click (Content-Disposition, cookie, Referer) taken over from Firefox's list;
             <a download>; Alt+click; Mark of the Web; Firefox's scratch folder stays empty
  streams    HLS (TS + AES-128), fMP4 HLS with separate audio, DASH (video + audio joined), all
             through ffmpeg from the settings path; the picker; the download mark
  noffmpeg   the "ffmpeg not found" state: picker line, two files kept, settings page
  faults     a disk write error mid-download (a locked byte range): stops at once, reads as a disk
             problem, keeps the bytes on disk, resumes intact
  drm        a ClearKey page is protected: no offer, "Protected video" pill, DRM HLS/DASH refused
  ui         every surface against the boards (panel states, popover, ring menu, pill states,
             picker, live, quit prompt)
  safety     names Firefox neutralises (.scf/.lnk/.url, bidi overrides); Safe Browsing verdicts (a
             stand-in reputation service: dangerous removed, uncommon kept aside with Keep file);
             the executable-launch prompt; page-derived downloads with the page's principal and
             referrer policy (no Referer for rel=noreferrer); the panel at small sizes (no overlap)
             and Ctrl+J from a popup window
  folders    where ffmpeg, yt-dlp and Deno are downloaded to (%LOCALAPPDATA%/Deer) and copies from
             before the rename (%LOCALAPPDATA%/Vitre) used where they are, on fake roots in %TEMP%

Each run uses its own profile (dl-<name>) and downloads folder (%TEMP%/vitre-dl-tests/downloads/<name>).
The local server is tests/downloads/server.py; fixtures come from tests/downloads/fixtures.py (ffmpeg
is never downloaded: the copy already on this machine is used, through vitre.ffmpegPath).
After each run, spikes/downloader/server/idm_guard.py closes any Internet Download Manager dialog
that names the test server (and nothing else) and its output is printed.
Logs and captures: tests/downloads/out/<name>/.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PY = sys.executable
DATA = os.path.join(tempfile.gettempdir(), 'vitre-dl-tests')
IDM_GUARD = os.path.join(ROOT, 'spikes', 'downloader', 'server', 'idm_guard.py')

TESTS = {
    # name: (timeout s, with ffmpeg)
    'engine': (240, True),
    'restart': (240, True),
    'takeover': (180, True),
    'crosssite': (120, True),
    'mark': (150, True),
    'embed': (150, True),
    'spa': (150, True),
    'ytdlp': (240, True),
    'streams': (240, True),
    'noffmpeg': (150, False),
    'faults': (200, True),
    'drm': (150, True),
    'ui': (240, True),
    'safety': (240, False),
    'folders': (120, False),
    # A diagnostic, not part of the default set: throughput and main-thread stalls.
    'perf': (300, True),
    # Real GitHub and YouTube: installs yt-dlp + Deno to %TEMP% and saves a 19 s video. Not in the default set.
    'ytdlp-real': (420, True),
}


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    ap = argparse.ArgumentParser()
    ap.add_argument('names', nargs='*')
    ap.add_argument('--app', default='build-downloads')
    ap.add_argument('--port', type=int, default=47931)
    ap.add_argument('--keep-going', action='store_true')
    a = ap.parse_args()
    names = a.names or [n for n in TESTS if n not in ('perf', 'ytdlp-real')]

    made = subprocess.run([PY, os.path.join(HERE, 'fixtures.py'), '--dir', DATA], capture_output=True, text=True)
    if made.returncode:
        print(made.stdout, made.stderr)
        return 1
    manifest = json.loads(made.stdout.strip().splitlines()[-1])
    fix = os.path.join(DATA, 'fixtures')

    try:
        urllib.request.urlopen('http://127.0.0.1:%d/stats' % a.port, timeout=1).read()
        print('port %d is already serving (a stale test server?): stop it first' % a.port)
        return 1
    except Exception:
        pass
    server = subprocess.Popen([PY, os.path.join(HERE, 'server.py'), '--port', str(a.port), '--dir', DATA,
                               '--log', os.path.join(DATA, 'requests.jsonl')], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    ok_all = True
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen('http://127.0.0.1:%d/stats' % a.port, timeout=1).read()
                break
            except Exception:
                time.sleep(0.1)
        for name in names:
            timeout, with_ff = TESTS[name]
            out = os.path.join(HERE, 'out', name)
            os.makedirs(out, exist_ok=True)
            dl = os.path.join(DATA, 'downloads', name)
            shutil.rmtree(dl, ignore_errors=True)
            os.makedirs(dl, exist_ok=True)
            cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, name + '.js'), '--name', 'dl-' + name,
                   '--app', a.app, '--timeout', str(timeout), '--out', out,
                   '--env', 'VITRE_DL_PORT=%d' % a.port, '--env', 'VITRE_DL_FIX=' + fix, '--env', 'VITRE_DL_DIR=' + dl,
                   '--env', 'VITRE_DL_PY=' + PY, '--env', 'VITRE_DL_LOCK=' + os.path.join(ROOT, 'spikes', 'downloader', 'verify', 'lock_region.py'),
                   '--pref', 'vitre.downloadsFolder=' + dl,
                   # Widevine is never fetched in tests (Firefox would download its CDM on a request).
                   '--pref', 'media.gmp-manager.updateEnabled=false', '--pref', 'media.gmp-manager.url=http://127.0.0.1:9/none']
            if with_ff and manifest.get('ffmpeg'):
                cmd += ['--pref', 'vitre.ffmpegPath=' + manifest['ffmpeg']]
            started = time.time()
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
            lines = (r.stdout + r.stderr).splitlines()
            passed = sum(1 for line in lines if line.startswith('PASS '))
            bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', '[console.error]'))]
            ok = r.returncode == 0
            ok_all &= ok
            print('%-9s %s  (%d checks passed, %.0f s)' % (name, 'ok' if ok else 'FAILED', passed, time.time() - started))
            for line in bad:
                print('    ' + line[:400])
            with open(os.path.join(out, 'run.txt'), 'w', encoding='utf-8') as f:
                f.write('\n'.join(lines))
            guard = subprocess.run([PY, IDM_GUARD, 'http://127.0.0.1:%d' % a.port], capture_output=True, text=True)
            closed = guard.stdout.strip()
            if closed and closed != 'closed 0':
                print('    [IDM] Internet Download Manager dialogs about the test server were closed: ' + closed)
            if not ok and not a.keep_going and len(names) > 1:
                pass
    finally:
        server.terminate()
    return 0 if ok_all else 1


if __name__ == '__main__':
    sys.exit(main())
