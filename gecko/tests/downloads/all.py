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
             picker, live, quit prompt); the rows that need the person (Link expired, Waiting for link,
             File changed, Start it again from its page): wording, aria labels, the ring's dot, Space
             that never destroys bytes, access keys unique in every row's menu
  safety     names Firefox neutralises (.scf/.lnk/.url, bidi overrides); Safe Browsing verdicts (a
             stand-in reputation service: dangerous removed, uncommon kept aside with Keep file);
             the executable-launch prompt; page-derived downloads with the page's principal and
             referrer policy (no Referer for rel=noreferrer); the panel at small sizes (no overlap)
             and Ctrl+J from a popup window
  folders    where ffmpeg, yt-dlp and Deno are downloaded to (%LOCALAPPDATA%/Deer) and copies from
             before the rename (%LOCALAPPDATA%/Vitre) used where they are, on fake roots in %TEMP%
  integrity  never lose or mix bytes (spikes/downloader/RESUME-DESIGN.md, Phase 1): a file swapped during a
             pause is File changed with its .part untouched; the same bytes under a new ETag are
             proven by 64 KiB windows and complete; a download of unknown length whose server
             then ranges completes, one that then gives fewer bytes is File changed; an address
             that answers with a page, 403 or 410 is Link expired with its bytes kept; weak and
             dropped ETags; Content-MD5; an HLS segment that is a page is never written, and an
             encrypted stream a CDN labels text/html completes; Start over keeps "<name>.old.part" and never
             touches another file of that name or a .part it can't move; restarts: a corrupt store
             loads from its .bak, a bad record loads settled, two unreadable copies are set aside;
             the control: an unchanged resume makes as many requests as before
  expiry     same-file proof and renewal (spikes/downloader/RESUME-DESIGN.md, Phase 2): a signed address
             that expired during a pause is renewed from its original address before the first request
             and the download continues from its segments; expiry mid-run on 8 connections asks the
             original address once; /edge (a new ETag on every answer) completes; a swap with no
             validators is File changed; /signed-once is Link expired, and Use another address… tells a
             different file, a page and an unreachable address from a fresh signed one, which attaches
             (asked with no Referer); after a restart the attempt schedule carries on; the control. From
             the review of Phase 2: a farm whose backends differ in both validators (/flap) completes; a
             file that changed after its first 64 KiB is caught on a download paused early (/tail); a
             tiny file on a server that sends a 200 for a whole-file Range resumes in 2 requests
             (/whole); an attach whose run is refused carries the schedule on; Pause stops an attempt;
             Retry right after a failed renewal asks the original address again
  attach     starting a download again on its page (spikes/downloader/RESUME-DESIGN.md, Phase 3): a clicked
             download whose signed address expired is Link expired; Refresh address opens its page and arms
             the row (Waiting for link); a click there continues the same row (no new row or flight,
             Firefox's copy gone from the scratch folder, no " (1)", only the missing ranges fetched); so do
             Alt+click and Add link; an unrelated download makes its own row while the old one waits; the
             same name over other bytes makes the old row File changed (no new row), and Start over then
             gets that file, keeping "<name>.old.part" until it is done; Keep partial file saves the old
             prefix byte for byte; another container never attaches; a private window's row attaches there
             and is never written. From the review of Phase 3: the same name on another page, and another
             file behind the same script (/fetch?f=, with and without Content-Disposition), make rows of
             their own (Add link selects it); Add link keeps the row's page; the real file changed with
             under 1 MiB saved starts over without asking; a start again during a scheduled attempt
             attaches, one sent to a chosen folder does not; Resume during Keep partial starts nothing;
             a peek's click flies from the sheet
  network    network, sleep and restarts (spikes/downloader/RESUME-DESIGN.md, Phase 4): a network that goes
             away (/drop) gives Waiting for network with every count exact, tries 10 s then 30 s apart,
             Try now continues it; Firefox offline only counts tries and continues once online; 503 for
             90 s is Retrying, never Failed, a try asking once; Retry-After: 3600 stops at the first 503;
             503 and dropped connections share one count, and 24 h after the first 503 it fails; a blocked
             port, a redirect loop and a corrupted answer fail as before; sleep and wake (link-up or 10 s
             later); Pause all ends a wait; after a restart what the quit stopped continues and what the
             person paused stays paused (the setting off: both stay, the prompt says so, and a try caught
             on its check continues by its wait); after a hard kill (run.py @@kill) the last 8 MiB below
             each mark is fetched again and a try caught on its check still waits; a kill after a stream's
             merge completes from the output (also with a part left), one before ffmpeg merges the parts
             again, nothing fetched

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
    'integrity': (300, True),
    'expiry': (300, True),
    'attach': (480, True),
    'network': (900, True),
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
