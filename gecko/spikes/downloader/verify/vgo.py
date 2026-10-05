"""Verifier's runner for the downloader spike. Same job as ../go.py, but:
  - output goes to verify/out/<variant><suffix>/ and the profile name is downloader-verify-<variant><suffix>
  - fixtures and downloads live in %TEMP%/vitre-dl-verify (regenerated when missing)
  - verify/vboot-<variant>.js is used when it exists (with verify/vserve.py and verify/engine, a
    patched copy of the spike's engine); otherwise the spike's own ../boot-<variant>.js, unmodified,
    with the spike's own server and engine

  cd gecko
  python spikes/downloader/verify/vgo.py <variant> [--timeout 240] [--port 47911] [--keep-profile] [--url URL]
         [--phase N] [--suffix=-x] [--pref k=v ...] [--arg firefox-arg ...] [--env K=V ...]

Reruns of the spike's own scripts (same arguments as ../go.py):
  ranged | engine | restart --phase 1, then 2 and 3 with --keep-profile | takeover --url http://127.0.0.1:<port>/page.html?rate=1024
  media | hls | lifecycle --phase refuse|background | h2

The verifier's own variants (each prints PASS/FAIL lines; logs in verify/out/<variant>/log.txt):
  probe, probe2   what an http channel exposes in 157; which switches change connectionInfoHashKey
  lanes           one network partition per connection (loadInfo.cookieJarSettings): 16 and 32
                  connections with the per-host pref untouched; cookies per jar; real HTTP/2 hosts
  enginelanes     the spike's whole engine suite on lanes        (--env VITRE_V_LANES=1)
  real            a real 24.6 MB file from an HTTP/2 CDN, checksum published by its owner
  takeover2       container tab, private window, second window, PDF, tiny file, one-time link,
                  POST, blob:  (--env VITRE_V_ONLY=A,B,C,D ; --env VITRE_V_FFDIR=1 gives Firefox a scratch folder)
  extdl           a local temporary WebExtension calling downloads.download()
  media2          Widevine request with no CDM, background tab in a second window, real pages,
                  child actor through a junction (--env VITRE_V_ACTOR=junction). Run with
                  --pref media.gmp-manager.updateEnabled=false --pref media.gmp-manager.url=http://127.0.0.1:9/none
  media3          a download click wipes the tab's media list and DRM mark (--env VITRE_V_MEDIAFIX=1: fixed)
  hlsreal         a real 64-segment HLS stream; hlsfmp4: real fMP4 HLS with a separate audio rendition
  faults          file changed between pause and resume; disk write errors mid-download
  lifecycle2      close the last window while downloading, then open a window again
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
SPIKE = os.path.abspath(os.path.join(HERE, '..'))
GECKO = os.path.abspath(os.path.join(SPIKE, '..', '..'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('variant')
    ap.add_argument('--timeout', default='240')
    ap.add_argument('--port', type=int, default=47911)
    ap.add_argument('--keep-profile', action='store_true')
    ap.add_argument('--url')
    ap.add_argument('--phase', default='')
    ap.add_argument('--suffix', default='')
    ap.add_argument('--pref', action='append', default=[])
    ap.add_argument('--arg', action='append', default=[])
    ap.add_argument('--env', action='append', default=[])
    a = ap.parse_args()

    data = os.path.join(tempfile.gettempdir(), 'vitre-dl-verify')
    out = os.path.join(HERE, 'out', a.variant + a.suffix)
    os.makedirs(out, exist_ok=True)
    made = subprocess.run([sys.executable, os.path.join(SPIKE, 'server', 'make_fixtures.py'), '--dir', data], capture_output=True, text=True)
    if made.returncode:
        print(made.stdout, made.stderr)
        return 1
    manifest = json.loads(made.stdout.strip().splitlines()[-1])

    own = os.path.join(HERE, 'vboot-%s.js' % a.variant)
    boot = own if os.path.isfile(own) else os.path.join(SPIKE, 'boot-%s.js' % a.variant)

    server = subprocess.Popen([sys.executable, os.path.join(HERE, 'vserve.py') if os.path.isfile(own) else os.path.join(SPIKE, 'server', 'serve.py'), '--port', str(a.port), '--dir', data,
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
                   VITRE_DL_MEDIUM_SHA=manifest['medium.bin']['sha256'], VITRE_DL_HERE=SPIKE, VITRE_VERIFY_HERE=HERE)
        for kv in a.env:
            k, v = kv.split('=', 1)
            env[k] = v
        cmd = [sys.executable, os.path.join(GECKO, 'tools', 'run.py'), '--boot', boot,
               '--name', 'downloader-verify-' + a.variant + a.suffix, '--out', out, '--timeout', a.timeout,
               '--url', a.url or 'about:blank']
        if a.keep_profile:
            cmd.append('--keep-profile')
        for p in a.pref:
            cmd += ['--pref', p]
        for x in a.arg:
            cmd += ['--arg', x]
        code = subprocess.run(cmd, env=env, cwd=GECKO).returncode
        if a.phase:
            shutil.copyfile(os.path.join(out, 'log.txt'), os.path.join(out, 'log-phase%s.txt' % a.phase))
        return code
    finally:
        server.terminate()
        guard = subprocess.run([sys.executable, os.path.join(SPIKE, 'server', 'idm_guard.py'), 'http://127.0.0.1:%d' % a.port],
                               capture_output=True, text=True)
        if guard.stdout.strip() not in ('', 'closed 0'):
            print('[idm-guard]', guard.stdout.strip())


if __name__ == '__main__':
    sys.exit(main())
