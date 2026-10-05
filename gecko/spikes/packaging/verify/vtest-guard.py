"""Verifier: a launch guard in config.js (verify/vconfig-guard.js).

  python spikes/packaging/verify/vtest-guard.py

Why: runtime\\firefox.exe started without -profile uses the stock identity's data root, which is the
user's real Firefox (%APPDATA%\\Mozilla\\Firefox). The test NEVER starts the runtime without -profile;
it uses profile directories with and without the marker file instead.

  G1  profile WITHOUT the marker file: the process ends by itself. What did Gecko already write
      into the profile directory before AutoConfig ran? (answers "does config.js run before the
      profile exists?")
  G2  profile WITH the marker: boot-prod.js passes as usual.
  G3  profile WITH the marker + in-place restart (bare command line afterwards): still allowed.
Restores the normal config.js at the end.
"""
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SPIKE = os.path.abspath(os.path.join(HERE, '..'))
RUNTIME = os.path.join(HERE, 'dist', 'Vitre', 'runtime')
OUT = os.path.join(HERE, 'out', 'guard')
PREFS = ['--pref', 'browser.shell.customIcon.enabled=false', '--pref', 'browser.privacySegmentation.createdShortcut=true']


def fresh(name, marker):
    p = os.path.join(OUT, name)
    shutil.rmtree(p, ignore_errors=True)
    os.makedirs(p)
    if marker:
        open(os.path.join(p, 'vitre-profile'), 'w').close()
    return p


def run_dist(name, profile, boot, extra=()):
    cmd = [sys.executable, os.path.join(SPIKE, 'run-dist.py'), '--name', 'packaging-verify-' + name, '--runtime', RUNTIME,
           '--out', os.path.join(OUT, name), '--profile', profile, '--keep-profile', '--boot', boot,
           '--url', 'https://example.com', '--timeout', '90', *PREFS, *extra]
    return subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace').stdout.splitlines()


def main():
    os.makedirs(OUT, exist_ok=True)
    subprocess.run([sys.executable, os.path.join(HERE, 'vstage.py'), '--link', '--config', os.path.join(HERE, 'vconfig-guard.js')], check=True, capture_output=True)
    try:
        # ---- G1 ----
        prof = fresh('profile-deny', marker=False)
        log = os.path.join(OUT, 'deny-log.txt')
        open(log, 'w').close()
        env = dict(os.environ, VITRE_LOG=log, MOZ_CRASHREPORTER_DISABLE='1')
        for k in ('VITRE_BOOT', 'VITRE_LIB', 'VITRE_APP', 'VITRE_ALLOW_ANY_PROFILE'):
            env.pop(k, None)
        t = time.time()
        subprocess.Popen([os.path.join(RUNTIME, 'firefox.exe'), '-no-remote', '-profile', prof, 'https://example.com/'], env=env)
        alive = '?'
        for _ in range(20):
            time.sleep(1)
            alive = subprocess.run(['powershell', '-NoProfile', '-Command',
                                    "(Get-CimInstance Win32_Process -Filter \"Name='firefox.exe'\" | Where-Object { $_.CommandLine -like '*profile-deny*' } | Measure-Object).Count"],
                                   capture_output=True, text=True).stdout.strip()
            if alive == '0':
                break
        left = sorted(os.listdir(prof))
        print('[G1] firefox.exe processes alive for this profile %.0fs after launch: %s' % (time.time() - t, alive))
        print('[G1] profile dir contents after the refused start:', left)
        print('[G1] %s process ended by itself, no window, nothing of Vitre ran' % ('PASS' if alive == '0' else 'FAIL'))
        print('[G1] NOTE profile was %s by Gecko before AutoConfig ran' % ('ALREADY TOUCHED (' + ', '.join(left) + ')' if left else 'not touched'))
        for line in open(log, encoding='utf-8', errors='replace').read().splitlines():
            print('[G1 log] ' + line[:300])
        # ---- G2 ----
        prof = fresh('profile-allow', marker=True)
        for line in run_dist('guard-allow', prof, os.path.join(SPIKE, 'boot-prod.js')):
            if line.startswith(('PASS', 'FAIL', '[guard]', 'ERROR')) or 'timed out' in line:
                print('[G2] ' + line[:200])
        # ---- G3 ----
        prof = fresh('profile-restart', marker=True)
        m = os.path.join(OUT, 'guard-restart', 'restart-cmdline-marker.json')
        if os.path.exists(m):
            os.remove(m)
        for line in run_dist('guard-restart', prof, os.path.join(HERE, 'vboot-restart-cmdline.js')):
            if line.startswith(('FIRST', 'AFTER', '  cmdline', '[guard]', 'ERROR')) or 'timed out' in line:
                print('[G3] ' + line[:260])
    finally:
        subprocess.run([sys.executable, os.path.join(HERE, 'vstage.py'), '--link'], check=True, capture_output=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
