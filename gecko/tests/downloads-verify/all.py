"""The downloader verifier's runner (from gecko/):

  python tests/downloads-verify/all.py [name ...] [--app build-downloads-verify] [--port 47951]

Runs the builder's suites (tests/downloads/<name>.js) and the verifier's own (tests/downloads-verify/<name>.js)
under the verifier's names: profile downloads-verify-<name>, captures and logs in
tests/downloads-verify/out/<name>/, its own fixtures and downloads folders under %TEMP%/vitre-dl-verify,
its own server port, so it can run next to the builder's tests/downloads/all.py.

Names:
  builder's  engine restart takeover crosssite mark spa ytdlp streams noffmpeg faults drm ui (and perf, not in
             the default set; ytdlp-real and ffmpeg-install reach GitHub and are never run here)
  verifier's v-keys       keyboard-only panel, quick view, ring menu, picker; the Esc and close ladders
             v-windows    a second window, a private window (its own list, prompt on closing the last
                          private window), a popup window; leaks when windows close
             v-core       the ring and pill with the core: page inset, auto-hide, F11, element full
                          screen, the address field open, find open (the mark hides)
             v-scale      150% scaling (layout.css.devPixelsPerPx at runtime): panel, ring, pill, picker
             v-pages      dark and light pages, a page that never finishes loading, a hung server
             v-rapid      rapid repeated input (Ctrl+J, pause/resume, Ctrl+Shift+D), idle CPU cost,
                          console errors (Services.console) during the whole run
             v-restore    restart with downloads paused, completed and failed; session restore keeps them
             v-measure    every surface measured against its board (sizes, radii, colours, copy)
Default: every name above except perf.

The edge-case server (tests/downloads-verify/vserve.py: hung, stalled, empty, chunked, missing, odd names,
redirect, a page that never finishes) runs on the next port (VITRE_DLV_EDGE).
Each test gets VITRE_DL_PORT / VITRE_DL_FIX / VITRE_DL_DIR / VITRE_DL_PY / VITRE_DL_LOCK as the builder's
runner gives them (tests/downloads/lib.js), plus VITRE_DLV_LIB (the builder's lib.js, for the verifier's
scripts, which load it with loadSubScript through resource://vitre-boot/ after this runner copies it
next to them as _dl-lib.js).
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
BUILDER = os.path.join(ROOT, 'tests', 'downloads')
PY = sys.executable
DATA = os.path.join(tempfile.gettempdir(), 'vitre-dl-verify')
IDM_GUARD = os.path.join(ROOT, 'spikes', 'downloader', 'server', 'idm_guard.py')

TESTS = {
    # name: (folder, timeout s, with ffmpeg)
    'engine': (BUILDER, 240, True),
    'restart': (BUILDER, 240, True),
    'takeover': (BUILDER, 180, True),
    'crosssite': (BUILDER, 120, True),
    'mark': (BUILDER, 150, True),
    'spa': (BUILDER, 150, True),
    'ytdlp': (BUILDER, 240, True),
    'streams': (BUILDER, 240, True),
    'noffmpeg': (BUILDER, 150, False),
    'faults': (BUILDER, 200, True),
    'drm': (BUILDER, 150, True),
    'ui': (BUILDER, 240, True),
    'v-keys': (HERE, 200, True),
    'v-windows': (HERE, 220, True),
    'v-core': (HERE, 200, True),
    'v-scale': (HERE, 200, True),
    'v-pages': (HERE, 200, True),
    'v-rapid': (HERE, 220, True),
    'v-restore': (HERE, 240, True),
    'v-measure': (HERE, 200, True),
    'perf': (BUILDER, 300, True),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('names', nargs='*')
    ap.add_argument('--app', default='build-downloads-verify')
    ap.add_argument('--port', type=int, default=47951)
    a = ap.parse_args()
    names = a.names or [n for n in TESTS if n != 'perf']
    for n in names:
        if n not in TESTS:
            print('unknown test %r; known: %s' % (n, ' '.join(TESTS)))
            return 2

    made = subprocess.run([PY, os.path.join(BUILDER, 'fixtures.py'), '--dir', DATA], capture_output=True, text=True)
    if made.returncode:
        print(made.stdout, made.stderr)
        return 1
    manifest = json.loads(made.stdout.strip().splitlines()[-1])
    fix = os.path.join(DATA, 'fixtures')
    # The verifier's scripts load the builder's helpers from next to themselves (resource://vitre-boot/).
    shutil.copyfile(os.path.join(BUILDER, 'lib.js'), os.path.join(HERE, '_dl-lib.js'))

    try:
        urllib.request.urlopen('http://127.0.0.1:%d/stats' % a.port, timeout=1).read()
        print('port %d is already serving (a stale test server?): stop it first' % a.port)
        return 1
    except Exception:
        pass
    server = subprocess.Popen([PY, os.path.join(BUILDER, 'server.py'), '--port', str(a.port), '--dir', DATA,
                               '--log', os.path.join(DATA, 'requests.jsonl')], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    edge = subprocess.Popen([PY, os.path.join(HERE, 'vserve.py'), '--port', str(a.port + 1), '--main', str(a.port)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    ok_all = True
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen('http://127.0.0.1:%d/stats' % a.port, timeout=1).read()
                break
            except Exception:
                time.sleep(0.1)
        for name in names:
            folder, timeout, with_ff = TESTS[name]
            out = os.path.join(HERE, 'out', name)
            os.makedirs(out, exist_ok=True)
            for f in os.listdir(out):
                if f.endswith('.png'):
                    os.remove(os.path.join(out, f))
            dl = os.path.join(DATA, 'downloads', name)
            shutil.rmtree(dl, ignore_errors=True)
            os.makedirs(dl, exist_ok=True)
            script = name if folder == BUILDER else name
            cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(folder, script + '.js'),
                   '--name', 'downloads-verify-' + ('b-' + name if folder == BUILDER else name),
                   '--app', a.app, '--timeout', str(timeout), '--out', out,
                   '--env', 'VITRE_DL_PORT=%d' % a.port, '--env', 'VITRE_DL_FIX=' + fix, '--env', 'VITRE_DL_DIR=' + dl,
                   '--env', 'VITRE_DL_PY=' + PY, '--env', 'VITRE_DLV_EDGE=%d' % (a.port + 1), '--env', 'VITRE_DL_LOCK=' + os.path.join(ROOT, 'spikes', 'downloader', 'verify', 'lock_region.py'),
                   '--pref', 'vitre.downloadsFolder=' + dl,
                   '--pref', 'media.gmp-manager.updateEnabled=false', '--pref', 'media.gmp-manager.url=http://127.0.0.1:9/none']
            if with_ff and manifest.get('ffmpeg'):
                cmd += ['--pref', 'vitre.ffmpegPath=' + manifest['ffmpeg']]
            started = time.time()
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
            lines = (r.stdout + r.stderr).splitlines()
            passed = sum(1 for line in lines if line.startswith('PASS '))
            bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', '[console.error]'))]
            ok = r.returncode == 0 and not any(line.startswith('[console.error]') for line in lines)
            ok_all &= ok
            print('%-10s %s  (%d checks passed, %.0f s)' % (name, 'ok' if ok else 'FAILED', passed, time.time() - started))
            for line in bad:
                print('    ' + line[:400])
            with open(os.path.join(out, 'run.txt'), 'w', encoding='utf-8') as f:
                f.write('\n'.join(lines))
            guard = subprocess.run([PY, IDM_GUARD, 'http://127.0.0.1:%d' % a.port], capture_output=True, text=True)
            closed = guard.stdout.strip()
            if closed and closed != 'closed 0':
                print('    [IDM] Internet Download Manager dialogs about the test server were closed: ' + closed)
    finally:
        server.terminate()
        edge.terminate()
    return 0 if ok_all else 1


if __name__ == '__main__':
    sys.exit(main())
