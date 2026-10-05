"""Deer's updater tests (from gecko/):

  python tests/update/all.py [name ...] [--app build-x] [--no-build] [--port N] [--name-prefix P]

  check     the release cases against a local stand-in for GitHub (release_server.py): same, older,
            prerelease, draft, newer (downloaded through GitHub's redirect, verified, staged, reused),
            a newer one than the staged one, a capital-V tag, missing asset, missing or mismatched
            checksum, GitHub's digest disagreeing, wrong size, truncated then resumed with Range,
            Range ignored, 403 rate limit, 429, 500, 404, broken JSON, an API answer that stalls
            after its headers (the check ends, the next one runs), answers over their size limit,
            download links on another host, outside the repository or redirected to another host
            (refused, nothing downloaded), server down, no write access, stale files, setup.log
            results (3 kept and said; 4 dropped and said; 0 and 6 with the install still older: the
            release's setup is another version, dropped and never offered again), the install
            catching up, the hold on the setup (no write, rename or delete while held), signed
            releases (with a test release key: unsigned, signed by another key, signed; without a
            key no signature is needed), and the installs that never update; the requests carry no
            query, cookie or credentials
  key       tools/release-key.mjs (release_key.py): the key pair, signing, verifying, refusals, and
            Gecko's WebCrypto accepting Node's signature (no key is ever written into the repository)
  about     Settings › About in each state, captured (development, idle, checking, up to date,
            downloading, ready, ready for all users, failed: offline, rate limit, checksum, no write
            access), the automatic-check switch, the note "Deer <v> is ready" once per version, and
            "Restart to update" in the + circle's menu only while an update waits
  dev       a development run: updates off, About says so, a check never contacts the server, no
            automatic check is scheduled even with automatic checks on
  schedule  the automatic check: at most once a day (vitre.update.lastCheck), the first one
            vitre.update.firstDelay after start, none when switched off, none while one ran today
  refuse    "Restart to update" with a page that asks before it is left: staying on the page stops
            the quit and the update at once (ready again, the session flag cleared)
  apply     "Restart to update" (the real button): the staged setup is started with exactly
            /update /installdir:<install> /wait:180 /launch /log:<updates>\\setup.log /sha256:<hex>
            through a stand-in (fake_setup.py, via vitre.update.testCommand), Deer quits by itself,
            the stand-in was started while Deer was quitting and outlives it, and the next start
            restores the session
  prompt    the same while a download runs: the downloads quit prompt holds the restart back; "Keep
            downloading" keeps everything; another restart asked for meanwhile drops the held one
            (its "Restart" is an ordinary one); the prompt of the update's own restart quits Deer for
            the update (not in place)
  toctou    the staged setup replaced on disk: while the downloads prompt holds the restart back
            (its "Restart" refuses it: failed, Deer stays), and after Deer granted the quit (nothing
            is started at quit-application, the file is removed)

Builds build-updater (every module) unless --app or --no-build is given. Starts release_server.py
on 127.0.0.1:<port> (default 47971; nothing listens on <port>+1: "server down"). Profiles are named
<prefix><test> (default prefix "update-"), so two runs at once need their own --port and
--name-prefix. Nothing goes to the internet and the real setup is never started. Captures and logs
are in tests/update/out/ (out/<prefix>... when the prefix is not the default).
"""
import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PY = sys.executable
PYW = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
TESTS = [('check', 330), ('key', 120), ('about', 240), ('dev', 120), ('schedule', 180), ('refuse', 120), ('apply', 150), ('prompt', 180),
         ('toctou', 180)]
CFG = {'port': 47971, 'prefix': 'update-', 'out': os.path.join(HERE, 'out')}


def summary(name, out, code, extra_bad=()):
    lines = out.splitlines()
    passed = sum(1 for line in lines if line.startswith('PASS '))
    bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run] timed out', 'Traceback', '[console.error]'))] + list(extra_bad)
    good = code == 0 and not extra_bad
    print('%-9s %s  (%d checks passed)' % (name, 'ok' if good else 'FAILED', passed), flush=True)
    for line in bad:
        print('    ' + line)
    return good


def run(app, name, timeout, *extra, log_name=None):
    port = CFG['port']
    cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--app', app, '--test', os.path.join(HERE, name + '.js'), '--name', CFG['prefix'] + name,
           '--timeout', str(timeout), '--out', CFG['out'], '--env', 'UPTEST_BASE=http://127.0.0.1:%d' % port,
           '--env', 'UPTEST_DOWN=http://127.0.0.1:%d' % (port + 1), *extra]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    out = r.stdout + r.stderr
    with open(os.path.join(CFG['out'], (log_name or name) + '.log'), 'w', encoding='utf-8') as f:
        f.write(out)
    return r.returncode, out


def remove_profile(name):
    """Delete a profile kept with --keep-profile the way run.py does (its app junction unlinked first)."""
    spec = importlib.util.spec_from_file_location('deer_run', os.path.join(ROOT, 'tools', 'run.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    profile = os.path.join(tempfile.gettempdir(), 'vitre-gecko-' + name)
    if os.path.exists(profile):
        mod.remove_profile(profile)


def quit_test(app, name, timeout, second_start, expect_lines=(), expect_setup=True):
    """A start that quits Deer for the update (run.py --until-exit), then optionally the next start
    on the same profile. The stand-in setup's result is compared with what the script expected
    (or, with expect_setup=False, it must never have been started)."""
    work = os.path.join(tempfile.gettempdir(), 'deer-' + CFG['prefix'] + name)
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    result = os.path.join(work, 'setup-args.json')
    expected = os.path.join(CFG['out'], name + '-expected.json')
    if os.path.exists(expected):
        os.remove(expected)
    env = ['--env', 'UPTEST_SETUP_RESULT=' + result, '--env', 'UPTEST_PYTHONW=' + PYW, '--env', 'UPTEST_FAKE_SETUP=' + os.path.join(HERE, 'fake_setup.py')]
    profile = CFG['prefix'] + name
    remove_profile(profile)
    bad = []
    out2 = ''
    code2 = 0
    try:
        code1, out1 = run(app, name, timeout, '--keep-profile', '--until-exit', *env, log_name=name + '-1')
        checks = [('Deer quit by itself', '[run] the runtime exited by itself' in out1, '')]
        for line in expect_lines:
            checks.append(('the run log says "%s"' % line, line in out1.splitlines(), ''))
        if expect_setup:
            # The stand-in setup writes once at start and again when Deer's process is gone.
            data = None
            for _ in range(120):
                try:
                    with open(result, encoding='utf-8') as f:
                        data = json.load(f)
                    if data.get('endedAt'):
                        break
                except (OSError, ValueError):
                    pass
                time.sleep(0.25)
            try:
                with open(expected, encoding='utf-8') as f:
                    want = json.load(f)
            except (OSError, ValueError):
                want = None
            checks.append(('the stand-in setup was started', data is not None, ''))
            if data:
                checks.append(('it got exactly the setup path and /update /installdir /wait /launch /log /sha256', want is not None and data['argv'] == want, {'got': data['argv'], 'want': want}))
                checks.append(('it was started while Deer was still running (at quit-application)', data.get('parentAliveAtStart') is True, data))
                checks.append(('it outlived Deer: Deer exited while it waited', data.get('parentExited') is True, data))
        else:
            time.sleep(3)
            checks.append(('the stand-in setup was never started', not os.path.exists(result), result))
        for label, ok, detail in checks:
            line = ('PASS ' if ok else 'FAIL ') + label + ('' if ok or not detail else '  ' + json.dumps(detail))
            out1 += '\n' + line
            if not ok:
                bad.append(line)
        if second_start:
            code2, out2 = run(app, name, timeout, '--keep-profile', *env, log_name=name + '-2')
    finally:
        remove_profile(profile)
        shutil.rmtree(work, ignore_errors=True)
    with open(os.path.join(CFG['out'], name + '.log'), 'w', encoding='utf-8') as f:
        f.write('==== first start\n' + out1 + ('\n==== second start\n' + out2 if second_start else ''))
    return summary(name, out1 + '\n' + out2, code1 or code2, bad)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('names', nargs='*')
    ap.add_argument('--app')
    ap.add_argument('--no-build', action='store_true')
    ap.add_argument('--port', type=int, default=47971)
    ap.add_argument('--name-prefix', default='update-')
    a = ap.parse_args()
    CFG['port'] = a.port
    CFG['prefix'] = a.name_prefix
    if a.name_prefix != 'update-':
        CFG['out'] = os.path.join(HERE, 'out', a.name_prefix.rstrip('-_'))
    unknown = [n for n in a.names if n not in dict(TESTS)]
    if unknown:
        print('unknown test(s): ' + ', '.join(unknown))
        return 2
    app = a.app or 'build-updater'
    if not a.app and not a.no_build:
        r = subprocess.run('node tools/build.mjs --out=build-updater', cwd=ROOT, shell=True, capture_output=True, text=True)
        print(((r.stdout + r.stderr).strip().splitlines() or ['build: no output'])[-1][:200])
        if r.returncode != 0:
            print(r.stdout + r.stderr)
            return 1
    os.makedirs(CFG['out'], exist_ok=True)
    server = subprocess.Popen([PY, os.path.join(HERE, 'release_server.py'), '--port', str(a.port)], stdout=subprocess.PIPE, text=True)
    ok = True
    try:
        line = server.stdout.readline().strip()
        if not line.startswith('ready'):
            print('the stand-in server did not start: ' + line)
            return 1
        for name, timeout in TESTS:
            if a.names and name not in a.names:
                continue
            if name == 'apply':
                ok &= quit_test(app, name, timeout, second_start=True)
            elif name == 'prompt':
                ok &= quit_test(app, name, timeout, second_start=False, expect_lines=('quit-application: shutdown',))
            elif name == 'toctou':
                ok &= quit_test(app, name, timeout, second_start=False, expect_lines=('quit-application: shutdown',), expect_setup=False)
            elif name == 'key':
                r = subprocess.run([PY, os.path.join(HERE, 'release_key.py'), '--app', app, '--name', CFG['prefix'] + 'key', '--out', CFG['out']],
                                   cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
                with open(os.path.join(CFG['out'], 'key.log'), 'w', encoding='utf-8') as f:
                    f.write(r.stdout + r.stderr)
                ok &= summary(name, r.stdout + r.stderr, r.returncode)
            else:
                code, out = run(app, name, timeout)
                ok &= summary(name, out, code)
    finally:
        server.kill()
        server.wait()
    print('all ok' if ok else 'FAILURES')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
