"""Single instance + "open this URL in the running Vitre" through Gecko's own remoting.

  python spikes/packaging/test-remote.py [--app-ini]     (--app-ini: renamed identity via XUL_APP_FILE)

Builds dist/Vitre/Vitre.exe from launcher/Launcher.cs (in-box csc.exe), copies Vitre.cmd / Vitre.ps1,
starts instance A through Vitre.exe with a throwaway profile, then launches again four different
ways and checks that every URL arrives in instance A and that no second browser stays running.
"""
import ctypes
import ctypes.wintypes as wt
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

VERIFY = os.path.dirname(os.path.abspath(__file__))
HERE = os.path.abspath(os.path.join(VERIFY, '..'))  # the spike folder (sources are read from it)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
spec = importlib.util.spec_from_file_location('vitre_run', os.path.join(ROOT, 'tools', 'run.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
spec2 = importlib.util.spec_from_file_location('run_dist', os.path.join(HERE, 'run-dist.py'))
rd = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(rd)

DIST = os.path.join(VERIFY, 'dist', 'Vitre')
CSC = r'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
user32 = ctypes.windll.user32


def build_launcher():
    out = os.path.join(DIST, 'Vitre.exe')
    r = subprocess.run([CSC, '/nologo', '/target:winexe', '/optimize+', '/win32icon:' + os.path.join(HERE, 'dist-files', 'vitre.ico'),
                        '/out:' + out, os.path.join(HERE, 'launcher', 'Launcher.cs')], capture_output=True, text=True)
    print('[build] Vitre.exe', 'ok' if r.returncode == 0 else 'FAILED ' + r.stdout + r.stderr, os.path.getsize(out) if os.path.exists(out) else 0, 'bytes')
    for f in ('Vitre.cmd', 'Vitre.ps1'):
        shutil.copyfile(os.path.join(HERE, 'launcher', f), os.path.join(DIST, f))


def message_windows(pids):
    """Hidden message-only windows of the browser: the remoting server window is one of them."""
    out = []
    user32.FindWindowExW.restype = wt.HWND
    user32.FindWindowExW.argtypes = [wt.HWND, wt.HWND, wt.LPCWSTR, wt.LPCWSTR]
    hwnd = None
    while True:
        hwnd = user32.FindWindowExW(wt.HWND(-3), hwnd, None, None)  # HWND_MESSAGE
        if not hwnd:
            break
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids:
            cls = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(hwnd, cls, 256)
            out.append(cls.value)
    return sorted(set(out))


def top_level_classes(pids):
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(hwnd, _):
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids:
            cls = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(hwnd, cls, 256)
            found.append(cls.value)
        return True

    user32.EnumWindows(each, 0)
    return sorted(set(found))


def parents(profile):
    """Main (parent) browser processes for this profile: firefox.exe without -contentproc."""
    ps = ("Get-CimInstance Win32_Process -Filter \"Name='firefox.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress")
    raw = subprocess.run(['powershell', '-NoProfile', '-Command', ps], capture_output=True, text=True, timeout=30).stdout
    rows = json.loads(raw) if raw.strip() else []
    if isinstance(rows, dict):
        rows = [rows]
    key = os.path.basename(profile).lower()
    mine = [r for r in rows if r.get('CommandLine') and key in r['CommandLine'].lower() and '-contentproc' not in r['CommandLine'].lower()]
    others = [r for r in rows if r.get('CommandLine') and 'vitre-gecko-' not in r['CommandLine'].lower() and '-contentproc' not in r['CommandLine'].lower()
              and 'windows browser project' not in r['CommandLine'].lower()]
    return mine, others


def main():
    app_ini = '--app-ini' in sys.argv
    name = 'packaging-verify-remote' + ('-appini' if app_ini else '')
    out = os.path.join(VERIFY, 'out', 'remote' + ('-appini' if app_ini else ''))
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    profile = os.path.join(tempfile.gettempdir(), 'vitre-gecko-' + name + ' with space')
    shutil.rmtree(profile, ignore_errors=True)
    os.makedirs(profile)
    with open(os.path.join(profile, 'user.js'), 'w', encoding='utf-8') as f:
        prefs = dict(base.PREFS)
        prefs['browser.shell.customIcon.enabled'] = False  # verifier: no Start Menu shortcut writes
        prefs['browser.privacySegmentation.createdShortcut'] = True
        if app_ini:
            prefs['general.useragent.override'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:157.0) Gecko/20100101 Firefox/157.0'
        for k, v in prefs.items():
            f.write('user_pref(%s, %s);\n' % (json.dumps(k), json.dumps(v)))
    build_launcher()

    log = os.path.join(out, 'log.txt')
    open(log, 'w').close()
    env = dict(os.environ, VITRE_PROFILE=profile, VITRE_LOG=log, VITRE_OUT=out, VITRE_BOOT=os.path.join(HERE, 'boot-remote.js'),
               VITRE_LIB=os.path.join(ROOT, 'tools', 'spike-lib.js'), VITRE_REMOTE_SECONDS='150', MOZ_DISABLE_AUTO_SAFE_MODE='1')
    env.pop('VITRE_APP', None)
    if app_ini:
        env['VITRE_APP_INI'] = os.path.join(DIST, 'runtime', 'browser', 'application.ini')
    plain = {k: v for k, v in env.items() if k not in ('VITRE_BOOT', 'VITRE_LIB')}  # later launches: no test hook

    def read_log():
        with open(log, encoding='utf-8', errors='replace') as f:
            return f.read().split('\n')[:-1]

    def wait_for(pred, seconds):
        end = time.time() + seconds
        while time.time() < end:
            if any(pred(l) for l in read_log()):
                return True
            time.sleep(0.2)
        return False

    try:
        t0 = time.time()
        subprocess.Popen([os.path.join(DIST, 'Vitre.exe'), 'https://example.com/'], env=env)
        print('[A] Vitre.exe https://example.com/  -> READY:', wait_for(lambda l: l.startswith('READY'), 40), 'after %.1fs' % (time.time() - t0))
        pids = base.firefox_pids(profile)
        mine, others = parents(profile)
        print('[A] parent processes for this profile:', len(mine), '| other firefox.exe parents running on this machine (other spikes / user Firefox):', len(others))
        for r in mine:
            print('[A] command line:', r['CommandLine'])
        print('[A] message-only window classes:', message_windows(pids))
        print('[A] top-level window classes:', top_level_classes(pids))

        launches = [
            ('B Vitre.exe <url>', [os.path.join(DIST, 'Vitre.exe'), 'https://www.iana.org/help/example-domains'], 'iana.org'),
            ('C Vitre.cmd -new-window <url>', ['cmd', '/c', os.path.join(DIST, 'Vitre.cmd'), '-new-window', 'https://example.org/'], 'example.org'),
            ('D Vitre.ps1 -private-window <url>', ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', os.path.join(DIST, 'Vitre.ps1'), '-private-window', 'https://example.net/'], 'example.net'),
            ('E Vitre.exe -osint -url <url> (how the Windows shell calls a default browser)', [os.path.join(DIST, 'Vitre.exe'), '-osint', '-url', 'https://www.wikipedia.org/'], 'wikipedia.org'),
            # verifier additions: URLs with shell-special characters, and an injection attempt through -osint
            ('F Vitre.exe <url with & %20 and quotes-free query>', [os.path.join(DIST, 'Vitre.exe'), 'https://example.com/?f=1&g=a%20b&h=x'], 'f=1&g=a%20b&h=x'),
            ('G Vitre.cmd "<url with &>" (cmd %* re-parsing)', 'cmd /c ""' + os.path.join(DIST, 'Vitre.cmd') + '" "https://example.org/?c=1&d=2""', 'c=1&d=2'),
            ('H Vitre.ps1 <url with &>', ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', os.path.join(DIST, 'Vitre.ps1'), 'https://example.net/?p=1&q=2'], 'p=1&q=2'),
            ('I Vitre.exe -osint -url "<url> -new-window <evil>" (argument injection must NOT open evil)', [os.path.join(DIST, 'Vitre.exe'), '-osint', '-url', 'https://example.com/?inj=1 -new-window https://evil.invalid/'], 'inj=1'),
            ('J Vitre.exe (no arguments, while running): a new window in the same instance', [os.path.join(DIST, 'Vitre.exe')], None),
        ]
        for label, cmd, needle in launches:
            t = time.time()
            subprocess.Popen(cmd, env=plain, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            before = len(read_log())
            if needle is None:
                time.sleep(6)
                ok = 'n/a'
            else:
                ok = wait_for(lambda l, n=needle: l.startswith('TAB ') and n in l, 20)
            took = time.time() - t
            time.sleep(1.5)
            mine, _ = parents(profile)
            print('[%s] arrived in instance A: %s (%.1fs) | parent processes now: %d' % (label, ok, took, len(mine)))
        open(os.path.join(out, 'stop'), 'w').close()
        seen = 0
        end = time.time() + 30
        done = False
        while time.time() < end and not done:
            time.sleep(0.1)
            lines = read_log()
            for line in lines[seen:]:
                if line.startswith('@@capture '):
                    n = line[10:].strip()
                    hwnd = base.find_window(base.firefox_pids(profile))
                    if hwnd:
                        ok, w, h = base.capture(hwnd, os.path.join(out, n + '.png'))
                        print('[capture] %s.png %dx%d %s' % (n, w, h, rd.identity(hwnd, out, n)))
                    open(os.path.join(out, n + '.png.done'), 'w').close()
                elif line.startswith('@@quit'):
                    done = True
                else:
                    print(line)
            seen = len(lines)
    finally:
        time.sleep(0.5)
        for pid in base.firefox_pids(profile):
            subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
