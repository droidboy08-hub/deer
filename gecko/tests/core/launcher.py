"""Launcher and launch-guard test (run from gecko/):  python tests/core/launcher.py

1. Guard: runtime/vitre.exe started on a profile WITHOUT the "vitre-profile" marker (and without the
   harness escape) must exit by itself, with no window. 1b: on a marker profile without the
   "vitre-harness" marker, VITRE_BOOT is ignored (the hook never runs in a real profile).
2. launcher/Deer.exe (built here if missing) with the profile override (VITRE_PROFILE and
   DEER_PROFILE) pointing at a throwaway profile: creates the folder and the marker, starts vitre.exe
   on it, Deer's window appears with the title and taskbar id Deer (captured as
   tests/core/out/launcher-1.png). The launch is refused, not attempted, when the launcher's source
   reads neither variable: it would then open the person's real profile.
3. A second launch through launcher/Deer.cmd with a URL hands the URL to the running instance:
   still one browser process tree, and the URL shows up as a tab.
Everything started here is stopped and both throwaway profiles (%TEMP%/vitre-gecko-launcher*,
%TEMP%/vitre-gecko-guard) are deleted. The real profile in %LOCALAPPDATA% is never touched.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import run as harness  # noqa: E402  (tools/run.py)

OUT = os.path.join(ROOT, 'tests', 'core', 'out')
failed = 0


def check(name, ok, detail=''):
    global failed
    failed += 0 if ok else 1
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(detail) if detail != '' else ''))


def clean_env():
    env = dict(os.environ, MOZ_CRASHREPORTER_DISABLE='1')
    for k in ('VITRE_BOOT', 'VITRE_LIB', 'VITRE_LOG', 'VITRE_OUT', 'VITRE_APP_DIR', 'VITRE_DISABLE', 'VITRE_ALLOW_ANY_PROFILE', 'VITRE_PROFILE', 'DEER_PROFILE', 'DEER_TEST_LOCALAPPDATA'):
        env.pop(k, None)
    return env


def roots(profile):
    """Browser (parent) processes on this profile: vitre.exe whose command line names it."""
    pids = harness.stale_pids(profile)
    rows = {pid: parent for pid, parent, image in harness.processes() if image == 'vitre.exe'}
    return [p for p in pids if rows.get(p) not in pids], pids


def start_menu():
    """(name, mtime) of the user's own Start Menu shortcuts: the stock runtime rewrites these on a fresh profile."""
    folder = os.path.join(os.environ.get('APPDATA', ''), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    try:
        return sorted((f, os.path.getmtime(os.path.join(folder, f))) for f in os.listdir(folder) if f.lower().endswith('.lnk'))
    except OSError:
        return []


def main():
    os.makedirs(OUT, exist_ok=True)
    tmp = tempfile.gettempdir()
    shortcuts = start_menu()

    # ---- 1. guard ----
    guard = os.path.join(tmp, 'vitre-gecko-guard')
    harness.kill(harness.stale_pids(guard))
    harness.remove_profile(guard)
    os.makedirs(guard)
    # Same prefs as a harness run, so a failing guard would at least not touch the Start Menu.
    with open(os.path.join(guard, 'user.js'), 'w') as f:
        f.write('user_pref("browser.shell.customIcon.enabled", false);\nuser_pref("browser.privacySegmentation.createdShortcut", true);\n')
    log = os.path.join(OUT, 'launcher-guard.log')
    open(log, 'w').close()
    env = dict(clean_env(), VITRE_LOG=log)
    p = subprocess.Popen([harness.VITRE, '-no-remote', '-profile', guard, 'about:blank'], env=env)
    code = None
    try:
        code = p.wait(timeout=30)
    except subprocess.TimeoutExpired:
        pass
    time.sleep(1.0)
    _roots, pids = roots(guard)
    window = harness.find_window(pids) if pids else None
    check('guard: a profile without the marker makes the runtime exit', code is not None and not pids, 'exit code %s, left running %s' % (code, sorted(pids)))
    check('guard: no window was shown', window is None)
    check('guard: config.js said why', 'not a Vitre profile' in open(log, encoding='utf-8', errors='replace').read(), open(log, encoding='utf-8', errors='replace').read().strip())
    harness.kill(pids)
    time.sleep(0.5)
    harness.remove_profile(guard)

    # ---- 1b. the test hook is ignored outside a harness profile ----
    # A marker profile (as the launcher makes) with VITRE_BOOT set but no "vitre-harness" marker:
    # Deer must start without running the script, and config.js must say so in the log.
    plain = os.path.join(tmp, 'vitre-gecko-launcher-plain')
    harness.kill(harness.stale_pids(plain))
    harness.remove_profile(plain)
    os.makedirs(plain)
    open(os.path.join(plain, 'vitre-profile'), 'w').close()
    with open(os.path.join(plain, 'user.js'), 'w') as f:
        f.write('user_pref("browser.shell.customIcon.enabled", false);\nuser_pref("browser.privacySegmentation.createdShortcut", true);\n')
    log = os.path.join(OUT, 'launcher-plain.log')
    open(log, 'w').close()
    env = dict(clean_env(), VITRE_LOG=log, VITRE_BOOT=os.path.join(ROOT, 'tests', 'core', 'launcher-probe.js'),
               VITRE_LIB=os.path.join(ROOT, 'tools', 'spike-lib.js'), VITRE_OUT=OUT)
    p = subprocess.Popen([harness.VITRE, '-no-remote', '-profile', plain, 'about:blank'], env=env)
    try:
        text = ''
        for _ in range(40):
            time.sleep(0.5)
            text = open(log, encoding='utf-8', errors='replace').read()
            if 'ignored' in text:
                break
        time.sleep(4)
        text = open(log, encoding='utf-8', errors='replace').read()
        _roots, pids = roots(plain)
        check('no harness marker: config.js ignores VITRE_BOOT and says so', 'VITRE_BOOT / VITRE_LIB ignored' in text and 'LAUNCHED' not in text, text.strip()[:300])
        check('no harness marker: Deer still started (window up)', bool(pids) and harness.find_window(pids) is not None)
    finally:
        _roots, pids = roots(plain)
        harness.kill(pids | {p.pid})
        time.sleep(1.0)
        harness.remove_profile(plain)

    # ---- 2. launcher ----
    exe = os.path.join(ROOT, 'launcher', 'Deer.exe')
    cmd = os.path.join(ROOT, 'launcher', 'Deer.cmd')
    if not os.path.exists(exe):
        subprocess.run(['node', os.path.join(ROOT, 'tools', 'build-launcher.mjs')], check=True)
    check('the launchers are called Deer (launcher\\Deer.exe, launcher\\Deer.cmd)', os.path.exists(exe) and os.path.exists(cmd))
    # The launch must land on the throwaway profile: refuse it when the launcher's source does not
    # read one of the override variables passed below.
    sources = ''
    for name in ('Launcher.cs', 'Deer.cmd'):
        try:
            sources += open(os.path.join(ROOT, 'launcher', name), encoding='utf-8', errors='replace').read()
        except OSError:
            pass
    overridable = os.path.exists(exe) and os.path.exists(cmd) and ('VITRE_PROFILE' in sources or 'DEER_PROFILE' in sources)
    check('the launcher reads a profile override (VITRE_PROFILE or DEER_PROFILE): safe to start', overridable)
    if not overridable:
        print('RESULT %d failed' % failed)
        return 1
    profile = os.path.join(tmp, 'vitre-gecko-launcher')
    harness.kill(harness.stale_pids(profile))
    harness.remove_profile(profile)
    log = os.path.join(OUT, 'launcher.log')
    open(log, 'w').close()
    # The test hook only reports; the launch itself goes through the real launcher and its marker.
    # config.js runs the hook only in a harness profile: make the folder carry that marker before the
    # launcher (which keeps an existing folder and adds its own "vitre-profile" marker) starts.
    os.makedirs(profile, exist_ok=True)
    open(os.path.join(profile, 'vitre-harness'), 'w').close()
    # DEER_TEST_LOCALAPPDATA (a folder in %TEMP%): even a launcher that ignored the override would
    # never reach the real %LOCALAPPDATA%\Deer or \Vitre profile.
    env = dict(clean_env(), VITRE_PROFILE=profile, DEER_PROFILE=profile, DEER_TEST_LOCALAPPDATA=os.path.join(tmp, 'vitre-gecko-launcher-lad'), VITRE_BOOT=os.path.join(ROOT, 'tests', 'core', 'launcher-probe.js'),
               VITRE_LIB=os.path.join(ROOT, 'tools', 'spike-lib.js'), VITRE_LOG=log, VITRE_OUT=OUT)
    try:
        r = subprocess.run([exe, 'https://example.com/'], env=env, timeout=30)
        check('Deer.exe returns 0 at once', r.returncode == 0, r.returncode)
        check('launcher created the profile and its marker', os.path.exists(os.path.join(profile, 'vitre-profile')))
        text = ''
        for _ in range(60):
            time.sleep(0.5)
            text = open(log, encoding='utf-8', errors='replace').read()
            if 'TABS' in text:
                break
        first = [line for line in text.splitlines() if line.startswith('LAUNCHED')]
        check('the runtime started on that profile with Deer loaded, guard on', bool(first) and 'marker=true' in first[0] and 'vitre=true' in first[0] and 'allowAny=unset' in first[0] and profile.lower() in first[0].lower(), first)
        parents, pids = roots(profile)
        images = {image for pid, _parent, image in harness.processes() if pid in pids}
        check('it runs as vitre.exe, one browser process', len(parents) == 1 and images == {'vitre.exe'}, '%d parent(s), %d processes, images %s' % (len(parents), len(pids), sorted(images)))
        time.sleep(3)
        text = open(log, encoding='utf-8', errors='replace').read()
        model = [line for line in text.splitlines() if line.startswith('MODEL')][-1:]
        check('the tab model mirrors the URL from the command line', bool(model) and '"https://example.com/","web"' in model[0], model)
        hwnd = harness.find_window(pids)
        check('its window is up', bool(hwnd))
        if hwnd:
            # This run has no harness prefs, so Gecko stops painting while the window is covered by
            # another one and a capture would show a stale frame: put it on top (without focus) first.
            harness.user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)  # HWND_TOPMOST, NOSIZE|NOMOVE|NOACTIVATE
            time.sleep(2)
            harness.shoot(hwnd, OUT, 'launcher-1', True)
            check('window title carries the brand Deer', harness.window_title(hwnd).endswith('Deer'), harness.window_title(hwnd))
            check('taskbar id is Deer.Browser (as the installer\'s shortcuts)', harness.window_aumid(hwnd) == 'Deer.Browser', harness.window_aumid(hwnd))

        # ---- 3. second launch hands its URL over ----
        r = subprocess.run(['cmd', '/c', cmd, 'https://example.org/?handed=over'], env=env, timeout=30)
        check('Deer.cmd returns 0', r.returncode == 0, r.returncode)
        handed = False
        for _ in range(40):
            time.sleep(0.5)
            text = open(log, encoding='utf-8', errors='replace').read()
            if 'example.org/?handed=over' in text:
                handed = True
                break
        check('the second launch opened its URL in the running instance', handed, [line for line in text.splitlines() if line.startswith('TABS')][-1:])
        parents2, _pids2 = roots(profile)
        check('still a single instance', parents2 == parents, '%s -> %s' % (parents, parents2))
        check('the test hook ran once (no second process loaded it)', text.count('LAUNCHED') == 1)
        # A fresh profile with no harness prefs at all: only the product defaults stand between the
        # runtime and the user's Start Menu. Give its idle tasks time to run before looking.
        time.sleep(12)
        prefs = open(os.path.join(profile, 'prefs.js'), encoding='utf-8', errors='replace').read() if os.path.exists(os.path.join(profile, 'prefs.js')) else ''
        check('product defaults: no Start Menu shortcut was created or rewritten', start_menu() == shortcuts and 'perUserStartMenuShortcutCreated' not in prefs,
              [n for n, _m in set(start_menu()) ^ set(shortcuts)])
    finally:
        _parents, pids = roots(profile)
        harness.kill(pids)
        time.sleep(1.0)
        harness.remove_profile(profile)
        shutil.rmtree(os.path.join(tmp, 'vitre-gecko-launcher-lad'), ignore_errors=True)

    print('RESULT %s' % ('ok' if not failed else '%d failed' % failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
