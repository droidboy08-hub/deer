"""Deer on Mozilla's unbranded engine (from gecko/):  python tests/engine/all.py [--control] [--size] [--no-setup] [--crash-on]

  setup    node tools/build.mjs --out=build-engine; python tools/setup-engine.py --app build-engine, then --check
  exe      deer.exe's version strings and signature next to the engine's own firefox.exe
  smoke    tests/core/smoke.js through tests/engine/run_engine.py (name engine-smoke)
  shell    tests/core/shell.js (engine-shell)
  look     tests/shell/look.js (engine-look) and tests/shell/check.py on its captures (8 pixel checks)
  probe    tests/engine/probe.js (engine-probe): identity, brand strings, AutoConfig, an unsigned add-on
           installed for good and still there after a restart, update, telemetry, crash reporter,
           default-browser agent, Mozilla endpoints, a media plug-in (ClearKey), process image names,
           the About window
  writes   what the engine runs left outside their profiles: values under HKCU\\Software\\Mozilla that
           name the engine folder, the per-install folder under C:\\ProgramData\\Mozilla-*\\updates, and
           whether anything changed at the top of %APPDATA% and %LOCALAPPDATA%\\Mozilla\\Firefox or in
           their Crash Reports folders (timestamps only, read only; inconclusive while the installed
           Firefox runs, which is then named)
--crash-on also runs the probe with MOZ_CRASHREPORTER_DISABLE unset (engine-crashon): starts without
           crashhelper.exe / crashreporter.exe. Off by default: with the stock identity
           (setup-engine.py --stock-identity) the reporter comes on and its data folder is the installed
           Firefox's %APPDATA%\\Mozilla\\Firefox\\Crash Reports. Deer's identity keeps the reporter off
           and its data root is %APPDATA%\\Deer
--control  also runs probe.js on the branded runtime (tools/run.py, name engine-ctl-probe) and prints
           the facts side by side
--size     writes a release-shaped folder (setup-engine.py --copy) to engines/deer-release, zips it
           (deflate and 7-Zip LZMA2 when 7-Zip is installed) and prints the sizes; the archives and
           the folder are removed afterwards (--keep-release keeps the folder)
--no-setup skips the build and setup-engine steps (runs on what engines/deer-runtime holds)
Logs and captures: tests/engine/out/<name>/. Every run here uses names starting with "engine-".
The engine's own identity (data root, remoting, registry names, user agent, what it writes outside its
profile and folder, single instance and URL hand-off) is tested by tests/engine/identity.py.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
PY = sys.executable
ENGINE = os.path.join(ROOT, 'engines', 'deer-runtime')
RUN = [PY, os.path.join(HERE, 'run_engine.py')]
APP = ['--app', 'build-engine']


def sh(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', **kw)


def run(label, name, cmd, expect_pixels=None):
    os.makedirs(os.path.join(OUT, name), exist_ok=True)
    t0 = time.time()
    r = sh(cmd + ['--out', os.path.join(OUT, name)])
    text = r.stdout + r.stderr
    log = os.path.join(OUT, name, name + '.log')
    with open(log, 'w', encoding='utf-8') as f:
        f.write(text)
    lines = text.splitlines()
    ok = r.returncode == 0
    bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', '[console.error]')) or 'no window found' in line]
    note = ''
    if expect_pixels is not None:
        p = sh([PY, os.path.join(ROOT, 'tests', 'shell', 'check.py'), log])
        with open(log, 'a', encoding='utf-8') as f:
            f.write(p.stdout + p.stderr)
        passes = sum(1 for line in p.stdout.splitlines() if line.startswith('PASS '))
        bad += [line for line in p.stdout.splitlines() if line.startswith('FAIL')] + p.stderr.splitlines()
        if p.returncode or passes != expect_pixels:
            ok = False
            bad.append('FAIL pixel checks: %d passed, %d expected' % (passes, expect_pixels))
        note = '; %d pixel checks' % passes
    passed = sum(1 for line in lines if line.startswith('PASS '))
    print('%-8s %s  (%d checks passed%s, %.0f s)' % (label, 'ok' if ok else 'FAILED', passed, note, time.time() - t0))
    for line in bad:
        print('    ' + line[:300])
    return ok, lines


def exe_facts():
    meta = json.load(open(os.path.join(ENGINE, 'deer-engine.json'), encoding='utf-8'))
    files = [(os.path.join(ROOT, meta['engine']['folder'], 'firefox.exe'), 'engine firefox.exe'),
             (os.path.join(ENGINE, 'deer.exe'), 'deer.exe'),
             (os.path.join(ENGINE, 'plugin-container.exe'), 'plugin-container.exe'),
             (os.path.join(ENGINE, 'firefox.exe'), 'placeholder firefox.exe')]
    ps = "; ".join(
        ("$p='%s'; if (Test-Path $p) { $v=(Get-Item $p).VersionInfo; $s=Get-AuthenticodeSignature $p; "
         "'%s: ProductName={0} | FileDescription={1} | CompanyName={2} | InternalName={3} | Version={4} | {5} bytes | signature={6}' -f "
         "$v.ProductName, $v.FileDescription, $v.CompanyName, $v.InternalName, $v.ProductVersion, (Get-Item $p).Length, $s.Status } else { '%s: absent' }")
        % (p.replace("'", "''"), label, label) for p, label in files)
    r = sh(['powershell', '-NoProfile', '-Command', ps])
    lines = r.stdout.strip().splitlines()
    for line in lines:
        print('    ' + line)
    deer = [line for line in lines if line.startswith('deer.exe')]
    ok = bool(deer) and 'FileDescription=Deer ' in deer[0] and 'ProductName=Deer ' in deer[0]
    print('exe      %s  (Task Manager shows the FileDescription)' % ('ok' if ok else 'FAILED'))
    return ok


# ---- what the engine leaves outside its profile ----------------------------------------------------

def registry_values():
    # HKCU\Software\Deer: the engine with Deer's identity (tools/setup-engine.py step 8); Mozilla: stock.
    ps = ("Get-ChildItem -Path 'HKCU:\\Software\\Mozilla','HKCU:\\Software\\Deer' -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $k=$_; "
          "foreach ($n in $k.GetValueNames()) { if ($n -like '*%s*') { '{0} :: {1}' -f $k.Name, $n } } }") % ENGINE.replace("'", "''")
    return set(sh(['powershell', '-NoProfile', '-Command', ps]).stdout.splitlines())


def programdata_dirs():
    out = set()
    root = os.environ.get('ProgramData', r'C:\ProgramData')
    for name in os.listdir(root):
        if name.startswith(('Mozilla-', 'Deer-Engine-')):
            upd = os.path.join(root, name, 'updates')
            if os.path.isdir(upd):
                out |= {os.path.join(upd, d) for d in os.listdir(upd)}
    return out


def appdata_top():
    """Timestamps (stat only, nothing is opened) of the engine's data roots, which are the installed
    Firefox's: the top level of %APPDATA%\\Mozilla\\Firefox and %LOCALAPPDATA%\\Mozilla\\Firefox, and
    everything under Crash Reports (the crash reporter's folder). Profiles are not looked into."""
    out = {}
    for env, label in (('APPDATA', 'Roaming'), ('LOCALAPPDATA', 'Local')):
        top = os.path.join(os.environ.get(env, ''), 'Mozilla', 'Firefox')
        if not os.path.isdir(top):
            continue
        for n in os.listdir(top):
            out[label + '\\' + n] = os.stat(os.path.join(top, n)).st_mtime
        crash = os.path.join(top, 'Crash Reports')
        for folder, dirs, names in os.walk(crash):
            for n in dirs + names:
                p = os.path.join(folder, n)
                out[label + '\\' + os.path.relpath(p, top)] = os.stat(p).st_mtime
    return out


def other_firefox_running():
    """Installed-Firefox processes (image firefox.exe outside gecko/): while one runs, a change in its
    data folders cannot be put down to the engine runs."""
    r = sh(['powershell', '-NoProfile', '-Command',
            "Get-Process firefox -ErrorAction SilentlyContinue | ForEach-Object { $_.Path } | Sort-Object -Unique"])
    return [p for p in r.stdout.splitlines() if p.strip() and not p.lower().startswith(ROOT.lower())]


# ---- probe comparison -----------------------------------------------------------------------------

def facts(lines):
    out = {}
    for line in lines:
        m = re.match(r'FACT (.+?) = (.*)$', line)
        if m:
            try:
                out[m.group(1)] = json.loads(m.group(2))
            except ValueError:
                out[m.group(1)] = m.group(2)
    return out


def compare(engine_lines, control_lines):
    a, b = facts(engine_lines), facts(control_lines)
    print('\nprobe facts, unbranded engine | branded runtime:')
    for key in a:
        if a.get(key) != b.get(key):
            print('  %s\n      engine : %s\n      branded: %s' % (key, json.dumps(a.get(key))[:600], json.dumps(b.get(key))[:600]))
    same = [k for k in a if a.get(k) == b.get(k)]
    print('  same on both: %s' % ', '.join(same))


# ---- size -----------------------------------------------------------------------------------------

def folder_size(path):
    total = 0
    for folder, _dirs, names in os.walk(path):
        for n in names:
            total += os.path.getsize(os.path.join(folder, n))
    return total


def size_report():
    rel = os.path.join(ROOT, 'engines', 'deer-release')
    r = sh([PY, os.path.join(ROOT, 'tools', 'setup-engine.py'), '--app', 'build-engine', '--copy', '--out', rel])
    if r.returncode:
        print('size     FAILED: ' + (r.stderr or r.stdout).strip()[-300:])
        return False
    raw = folder_size(rel)
    zpath = rel + '.zip'
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for folder, _dirs, names in os.walk(rel):
            for n in names:
                p = os.path.join(folder, n)
                z.write(p, os.path.join('Deer', os.path.relpath(p, rel)))
    zsize = os.path.getsize(zpath)
    line = 'size     release folder %.1f MB; zip (deflate 9) %.1f MB' % (raw / 1e6, zsize / 1e6)
    seven = os.path.join(os.environ.get('ProgramFiles', r'C:\Program Files'), '7-Zip', '7z.exe')
    if os.path.exists(seven):
        spath = rel + '.7z'
        s = subprocess.run([seven, 'a', '-t7z', '-mx=9', '-m0=lzma2', spath, rel + os.sep + '*'], capture_output=True, text=True)
        if s.returncode == 0:
            line += '; 7z (LZMA2 -mx=9, what an NSIS/7z installer gets close to) %.1f MB' % (os.path.getsize(spath) / 1e6)
        os.remove(spath) if os.path.exists(spath) else None
    os.remove(zpath)
    engine_zip = os.path.join(ROOT, 'engines', 'firefox-157.0-unbranded-win64.zip')
    if os.path.exists(engine_zip):
        line += '; Mozilla\'s own zip of the full engine %.1f MB' % (os.path.getsize(engine_zip) / 1e6)
    print(line)
    if '--keep-release' not in sys.argv:
        link = os.path.join(rel, 'vitre')
        if os.path.isjunction(link):  # never follow a junction into a build folder
            os.rmdir(link)
        shutil.rmtree(rel)
    return True


def main():
    args = sys.argv[1:]
    ok = True
    if '--no-setup' not in args:
        for cmd in (['node', os.path.join(ROOT, 'tools', 'build.mjs'), '--out=build-engine'],
                    [PY, os.path.join(ROOT, 'tools', 'setup-engine.py'), '--app', 'build-engine'],
                    [PY, os.path.join(ROOT, 'tools', 'setup-engine.py'), '--app', 'build-engine', '--check']):
            r = sh(cmd)
            if r.returncode:
                sys.exit('setup failed: %s\n%s' % (' '.join(cmd[1:]), (r.stdout + r.stderr)[-2000:]))
        print('setup    ok  (build-engine built; engines/deer-runtime written and checked)')
    ok &= exe_facts()

    reg0, pd0, ad0 = registry_values(), programdata_dirs(), appdata_top()
    web = ['--url', 'https://example.com']
    ok &= run('smoke', 'engine-smoke', RUN + ['--test', os.path.join(ROOT, 'tests', 'core', 'smoke.js'), '--name', 'engine-smoke', '--env', 'VITRE_SELFTEST=1', '--timeout', '150'] + APP + web)[0]
    ok &= run('shell', 'engine-shell', RUN + ['--test', os.path.join(ROOT, 'tests', 'core', 'shell.js'), '--name', 'engine-shell', '--timeout', '150'] + APP + web)[0]
    ok &= run('look', 'engine-look', RUN + ['--test', os.path.join(ROOT, 'tests', 'shell', 'look.js'), '--name', 'engine-look', '--timeout', '300'] + APP, expect_pixels=8)[0]
    good, probe = run('probe', 'engine-probe', RUN + ['--test', os.path.join(HERE, 'probe.js'), '--name', 'engine-probe', '--timeout', '180'] + APP)
    ok &= good
    f = facts(probe)
    print('    processes: %s' % ', '.join('%s=%s' % (p[1], p[2]) for p in f.get('processes', [])))
    print('    media plug-in: %s' % json.dumps(f.get('media plug-in (ClearKey)')))
    for line in probe:
        if line.startswith('GAP '):
            print('    ' + line[:400])
    # The launcher sets MOZ_CRASHREPORTER_DISABLE=1; a start without it (crashhelper.exe and
    # crashreporter.exe are not in the folder) must still work. Opt-in only: with the reporter on, its
    # data folder is the INSTALLED Firefox's %APPDATA%\Mozilla\Firefox\Crash Reports (the engine's
    # UAppData), which the project rules say never to touch.
    if '--crash-on' in args:
        ok &= run('crash-on', 'engine-crashon', RUN + ['--test', os.path.join(HERE, 'probe.js'), '--name', 'engine-crashon', '--timeout', '180',
                                                       '--env', 'MOZ_CRASHREPORTER_DISABLE=', '--env', 'DEER_PROBE_CRASH=on'] + APP)[0]

    reg1, pd1, ad1 = registry_values(), programdata_dirs(), appdata_top()
    print('writes   outside the profile (by any engine run so far, keyed by the engine path):')
    for line in sorted(reg1):
        print('    %s%s' % ('(new) ' if line not in reg0 else '', line))
    for d in sorted(pd1 - pd0):
        print('    (new) %s: %s' % (d, ', '.join(os.listdir(d))))
    changed = sorted(n for n in set(ad0) | set(ad1) if ad0.get(n) != ad1.get(n))
    print('    Mozilla\\Firefox data roots (top levels, Crash Reports): %s' % (
        'changed during these runs: ' + ', '.join(changed) if changed else 'unchanged during these runs'))
    others = other_firefox_running()
    if changed and others:
        print('    (the installed Firefox was running meanwhile, so these changes may be its own: %s)' % ', '.join(others))

    if '--control' in args:
        _good, control = run('control', 'engine-ctl-probe', [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, 'probe.js'), '--name', 'engine-ctl-probe', '--env', 'DEER_PROBE_MODE=control', '--timeout', '180'] + APP)
        compare(probe, control)
    if '--size' in args:
        ok &= size_report()
    print('ALL OK' if ok else 'SOME FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
