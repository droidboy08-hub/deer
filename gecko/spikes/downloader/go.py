"""Run one variant of the downloader spike: make the fixtures, start the test server, run the
Vitre Gecko runtime with boot-<variant>.js, stop the server.

  cd gecko
  python spikes/downloader/go.py ranged [--timeout 240] [--port 47811] [--keep-profile] [--url URL] [--phase N]
                                        [--pref k=v ...]

Output: spikes/downloader/out/<variant>/ (log.txt, *.png, requests.jsonl).
The boot script reads VITRE_DL_PORT, VITRE_DL_DIR (fixtures and download folder), VITRE_DL_PHASE and
VITRE_DL_FFMPEG from the environment.
"""
import argparse
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
GECKO = os.path.abspath(os.path.join(HERE, '..', '..'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('variant')
    ap.add_argument('--timeout', default='240')
    ap.add_argument('--port', type=int, default=47811)
    ap.add_argument('--keep-profile', action='store_true')
    ap.add_argument('--url')
    ap.add_argument('--phase', default='')
    ap.add_argument('--suffix', default='', help='appended to the output folder and profile name')
    ap.add_argument('--pref', action='append', default=[])
    a = ap.parse_args()

    data = os.path.join(tempfile.gettempdir(), 'vitre-dl-spike')
    out = os.path.join(HERE, 'out', a.variant + a.suffix)
    os.makedirs(out, exist_ok=True)
    made = subprocess.run([sys.executable, os.path.join(HERE, 'server', 'make_fixtures.py'), '--dir', data], capture_output=True, text=True)
    if made.returncode:
        print(made.stdout, made.stderr)
        return 1
    import json
    manifest = json.loads(made.stdout.strip().splitlines()[-1])

    server = subprocess.Popen([sys.executable, os.path.join(HERE, 'server', 'serve.py'), '--port', str(a.port), '--dir', data,
                               '--log', os.path.join(out, 'requests' + (('-' + a.phase) if a.phase else '') + '.jsonl')],
                              stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen('http://127.0.0.1:%d/stats' % a.port, timeout=1).read()
                break
            except Exception:
                time.sleep(0.1)
        env = dict(os.environ, VITRE_DL_PORT=str(a.port), VITRE_DL_DIR=data, VITRE_DL_PHASE=a.phase,
                   VITRE_DL_FFMPEG=manifest.get('ffmpeg', ''), VITRE_DL_BIG_SHA=manifest['big.bin']['sha256'],
                   VITRE_DL_MEDIUM_SHA=manifest['medium.bin']['sha256'], VITRE_DL_HERE=HERE)
        cmd = [sys.executable, os.path.join(GECKO, 'tools', 'run.py'), '--boot', os.path.join(HERE, 'boot-%s.js' % a.variant),
               '--name', 'downloader-' + a.variant + a.suffix, '--out', out, '--timeout', a.timeout,
               '--url', a.url or 'about:blank']
        if a.keep_profile:
            cmd.append('--keep-profile')
        for p in a.pref:
            cmd += ['--pref', p]
        code = subprocess.run(cmd, env=env, cwd=GECKO).returncode
        if a.phase:
            # tools/run.py truncates log.txt on every run: keep each phase's log.
            import shutil
            shutil.copyfile(os.path.join(out, 'log.txt'), os.path.join(out, 'log-phase%s.txt' % a.phase))
        return code
    finally:
        server.terminate()
        # Internet Download Manager (installed on this machine) hijacks some firefox.exe requests and
        # opens its own dialogs. Close the ones that are about this test server, and say so.
        guard = subprocess.run([sys.executable, os.path.join(HERE, 'server', 'idm_guard.py'), 'http://127.0.0.1:%d' % a.port],
                               capture_output=True, text=True)
        if guard.stdout.strip() not in ('', 'closed 0'):
            print('[idm-guard]', guard.stdout.strip())


if __name__ == '__main__':
    sys.exit(main())
