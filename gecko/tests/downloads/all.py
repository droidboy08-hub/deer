"""Run the downloader tests (from gecko/):  python tests/downloads/all.py [name ...] [--app build-downloads] [--port 47931] [--layout parts]

  engine     256 MiB on 8 connections (sha256), sockets per lane, pause/resume with If-Range,
             speed limit, panel and ring captures
  connections  a big file's .part is sparse; failures asked again as IDM does (a part's 500 on 4 s steps, a
             site that allows 3 connections, Retry-After, a challenge, an outage that keeps asking); a crawling
             connection is cut and asked again
  layout     the hybrid layout: in place on NTFS; IDM's part files and their join (forced, as on exFAT/FAT32),
             pause/resume, Keep partial, Cancel under parts; a FAT32 drive refuses a file over 4 GiB - 1
  restart    a download paused by a restart (the quit prompt confirmed) resumes from its segments; a paused
             download whose record is dirty with no seal and 3 MiB of zeros under its claims (what a power
             loss leaves): the zeros are found and fetched again (Phase 5)
  ytdlp      YouTube and other sites through yt-dlp (a stand-in script): install prompt, picker, download, errors;
             resuming (spikes/downloader/RESUME-DESIGN.md, Phase 8, on local pages): the picker's formats are recorded;
             an unchanged resume asks yt-dlp again and continues the same format (--continue); a format that is gone
             is re-picked by height, ext and kind and started over by itself (at most 1 MiB saved) or asked about
             ("this quality is no longer offered"), the old parts kept aside until the new file is complete; another
             filesize is File changed with the old parts kept; one format saved as the file itself is never
             continued over another version; a refused download is Link expired, Retry and the schedule ask yt-dlp
             again; the pill's Continue with another quality is File changed and Start over gets it; a page media file is renewed from yt-dlp's formats of its page before the page step (never for a
             private one or a file that is not media); no cookie options are ever passed. From the review of Phase 8:
             a format yt-dlp only estimates is compared by its estimate, bitrate and length (nothing to compare: asked
             above 1 MiB); a refused check asks yt-dlp once; Cancel removes only the row's own parts; -J runs out of
             sight are shared per page and two at a time, G1 step 2 six per site an hour; a selection the row's file
             type can't hold (and the pill's other kind) is saved as a type that holds it; a gone sound is named as
             the sound and follows the 1 MiB rule
  spa        a single-page site's next video (no reload): the old video's streams go, the new one is offered
  mark       the pill's download mark always answers: a picker for what the page loaded, or a note
  embed      an embedded player from another site whose CDN refuses any Referer but the player's:
             offered and downloaded as the player's frame; an ordinary embed goes out as before
  crosssite  a download another site's page starts is left to Firefox (no first-party cookies used)
  takeover   a real link click (Content-Disposition, cookie, Referer) taken over from Firefox's list;
             <a download>; Alt+click; Mark of the Web; Firefox's scratch folder stays empty
  streams    HLS (TS + AES-128), fMP4 HLS with separate audio, DASH (video + audio joined), all
             through ffmpeg from the settings path; the picker; the download mark; a segment refused with 403
             fetched from a refreshed playlist (/token); Phase 6: each finished stream's segment table (a line
             per segment hashed as the fixture's, the init segment's hash), and a merged stream damaged on disk
             repaired by running it again against that table
  noffmpeg   the "ffmpeg not found" state: picker line, two files kept, settings page
  faults     a disk write error mid-download (a locked byte range): stops at once, reads as a disk
             problem, keeps the bytes on disk, resumes intact; it seals the block hash record (Phase 5), every
             hash it kept matches the .part, and the finished file keeps its record and SHA-256
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
             loads from its .bak, a bad record loads settled, two unreadable copies are set aside (and the
             rows come back from their block hash records' journals, Phase 5);
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
             on its check continues by its wait); after a hard kill (run.py @@kill) the download with its
             block hash record is checked against it (Phase 5: claims above the last hashed block given back,
             the blocks hashed since the last seal hashed again), so only the damaged blocks below each mark are
             fetched again, and a try caught on its check still waits; a kill after a stream's
             merge completes from the output (also with a part left), one before ffmpeg merges the parts
             again, nothing fetched
  repair     the block hash record (spikes/downloader/RESUME-DESIGN.md, Phase 5): a download keeps its record in
             the profile and a pause seals it; bytes another program changed in block k during a pause: only
             block k is fetched again; a .part deleted during a pause starts over, saying so; one block the
             network delivered wrong (/corrupt-once, Repr-Digest): only that block is replaced; silent damage in
             a finished file: Check file finds 1 damaged part (Damaged), Space is Repair, which fetches 1 range
             and the sha256 equals the fixture; the site's file changed: Repair refuses; a file modified after
             it finished is Changed after download (never Damaged) and Restore original puts it back only when
             chosen; Check file on an intact file finds nothing; a journal with a torn last line is read
             without it. From the review of Phase 5: a link valid for one full download (no strong validator)
             completes; a small file that changed while it downloaded completes with the new file; a renewed
             link of a download whose first segment ran ahead continues; Repair never writes over a file
             edited after it was found Damaged; a repair cut short (a quit, a crash) is checked again, never
             "Changed after download"; Keep partial then Check file finds nothing; a refused Restore original
             leaves the file as it was, and one whose every block moved restores it; Remove or Cancel during
             a seal leaves no journal; Pause and Cancel before the rename are honoured; an older file's site
             compare keeps to 2 of 3 windows and the 5% rule
  stream-expiry streams that expire or change (spikes/downloader/RESUME-DESIGN.md, Phase 6, G2): a variant token
             that expired during a pause: the master is read again and the download continues at the next
             sequence (nothing written fetched again but the proof's one segment; the segment table's lines
             hash as the fixture's segments); the same count re-encoded is File changed, and Keep partial file
             merges the written segments ("Keeps 0:14 of 0:24"); renamed DASH representations continue; a
             segment that is a web page is never written (Link expired); a damaged middle segment: only it is
             fetched again; a stream whose every segment is written joins without asking its expired
             addresses; "Continue · N%" on the pill of the page opened again continues the row, and picking
             another quality when the row's is no longer offered makes it File changed. From the review of
             Phase 6: Repair refuses a shorter playlist; a DASH representation renamed mid-run continues only
             when its bytes prove it (renamed and re-encoded is File changed); a proof never stands for another
             playlist; byte ranges on farms whose validators differ complete, a swapped file is caught by its
             bytes; a refused init is never answered with a media segment; an audio rendition renews; a crash's
             saved place and lagging table lines; Continue never crosses containers; a refused first start
             asks three times and runs no yt-dlp
  resolve    the background page step (spikes/downloader/RESUME-DESIGN.md, Phase 7, G1 step 3, G2 step 4): a
             download whose signed address expired is renewed from a link on its page, opened out of sight,
             within 30 s (b.tabs never changed, no flight, the hidden tab gone, the closed-tab list as it was,
             only the missing ranges fetched); the page's visit is not in Places; a page that starts the download
             by itself is claimed (no row) and proven; one whose link needs a click falls back within 45 s and is
             never clicked; a password field or another site: "The page may need you to sign in."; the page opens
             in the download's container (its cookie reaches the server); the setting off: no page; the seventh
             expiry on one site within an hour waits; a private download resolves only in a private window and
             nothing is written; an HLS stream is renewed from its page's player. From the review of Phase 7:
             another file of the same name listed above the row's own never ends the search (and alone it asks,
             even under 1 MiB saved); a page that autoplays where the site may plays muted; pop-ups where the site
             allows them open nothing; a download from a frame removed at once is claimed; a saved login is never
             filled into the hidden page; Open page on a sign-in row reads Waiting for link; a window closed with its
             page open ends the step at once and keeps nothing of it; a step ending between two Ctrl+clicks leaves
             the related-tab order alone. attach, ui, expiry and stream-expiry run with the setting off: they test
             the manual path and the earlier steps

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
    'connections': (720, True),
    'layout': (600, True),
    'restart': (240, True),
    'takeover': (180, True),
    'crosssite': (120, True),
    'mark': (150, True),
    'embed': (150, True),
    'spa': (150, True),
    'ytdlp': (480, True),
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
    'repair': (600, True),
    'stream-expiry': (900, True),
    'resolve': (720, True),
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
    # --layout parts: every download takes the parts layout (parts.ts), as on an exFAT or FAT32 drive.
    ap.add_argument('--layout', choices=['parts', 'inplace'])
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
                   # The stand-in yt-dlp's call log, this run's own (a concurrent run of the other runner removed a shared one).
                   '--env', 'VITRE_FAKE_YTDLP_LOG=' + os.path.join(DATA, 'fake-ytdlp-%s.log' % name),
                   '--pref', 'vitre.downloadsFolder=' + dl,
                   *(['--pref', 'vitre.test.partLayout=' + a.layout] if a.layout else []),
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
