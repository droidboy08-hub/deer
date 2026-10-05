"""The Vitre -> Deer profile copy of both launchers, and the development launcher (run from gecko/):

  python installer/tests/migration.py [--root <dir inside %TEMP%>] [--no-launcher]

1. probe: the copy itself (installer/ProfileMigration.cs, compiled into probe.exe, "probe migrate <folder>"
   with a fake %LOCALAPPDATA%): nothing to copy (no old profile; an old one without its marker; Deer's
   profile already there), a full copy (byte for byte; a path over 260 characters, non-ASCII names, a
   read-only and a hidden file; lock files, cache2, startupCache and a junction left out; the old profile
   unchanged), the old profile in use (parent.lock held as Gecko holds it: nothing copied, the old profile
   is the answer, the next run copies), a stale parent.lock (copied past), a file that cannot be read
   (nothing left half way, the old profile is the answer), a half copy left by a crash (removed), two
   copies started at once (one copies, the other waits and finds it done), a blank Deer profile (empty,
   or only the launcher's marker and build stamp: copied over; one with anything else is left alone),
   too little free space (refused before anything is written, recorded), a copy that keeps failing (the
   start after the first failure tries again, then once a day; the person is told once; a success clears
   the record), and the development profile (Deer Dev\\Profile) copied apart from the installed one.
2. the development launcher: launcher/Deer.exe (built here by node tools/build-launcher.mjs, with the
   gold Deer icon; launcher/Vitre.exe, for old pins, the same program), launcher/Deer.cmd and the
   launcher/Vitre.cmd forwarder, on the development runtime (gecko/runtime): the first start copies the
   old profile to the development profile (Deer Dev\\Profile; the installed Deer's Deer\\Profile is never
   touched) and starts on it; the next starts hand their pages to the running one;
   XUL_APP_FILE / XRE_PROFILE_PATH / XRE_PROFILE_LOCAL_PATH / MOZ_NEW_INSTANCE in the caller's environment
   change nothing (MOZ_NEW_INSTANCE would turn the hand-off off); while a browser runs on the old profile,
   the launcher hands its page to that browser and copies nothing, and the start after it closed copies;
   DEER_PROFILE and VITRE_PROFILE pick another profile and copy nothing.
The installed Deer.exe's copy is phase 3c of installer/test.py.

Everything happens under <root> (default %TEMP%\\deer-migration-test, deleted at the start and the end),
whose folders stand in for %LOCALAPPDATA% (DEER_TEST_LOCALAPPDATA). The person's %LOCALAPPDATA%\\Vitre
and %LOCALAPPDATA%\\Deer are never used. Only browser processes whose command line names <root> are
ever closed or stopped. Pages are local files (no network). Exit code 1 if any check fails.
"""
import argparse
import ctypes
import ctypes.wintypes as wt
import hashlib
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
INSTALLER = os.path.dirname(HERE)
GECKO = os.path.dirname(INSTALLER)
WORK = os.path.join(INSTALLER, 'work')
OUT = os.path.join(HERE, 'out', 'migration')
RUNTIME = os.path.join(GECKO, 'runtime')
LAUNCHER = os.path.join(GECKO, 'launcher')
ICON = os.path.join(GECKO, 'tools', 'runtime-overlay', 'browser', 'chrome', 'icons', 'default', 'vitre.ico')
ROOT = os.path.join(tempfile.gettempdir(), 'deer-migration-test')

kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
kernel32.CreateFileW.restype = wt.HANDLE
kernel32.CreateFileW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p, wt.DWORD, wt.DWORD, wt.HANDLE]
kernel32.CloseHandle.argtypes = [wt.HANDLE]
user32 = ctypes.windll.user32

failed = 0


def check(name, ok, detail=''):
    global failed
    failed += 0 if ok else 1
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(detail) if detail not in ('', None) else ''), flush=True)
    return ok


def section(title):
    print('\n---- ' + title, flush=True)


def long(path):
    return path if path.startswith('\\\\?\\') else '\\\\?\\' + os.path.abspath(path)


def rmtree(path):
    if os.path.lexists(path):
        for folder, dirs, _files in os.walk(long(path)):
            for d in dirs:  # unlink junctions first: never delete what they point at
                p = os.path.join(folder, d)
                if os.path.isjunction(p):
                    os.rmdir(p)
        shutil.rmtree(long(path), onexc=lambda f, p, e: (os.chmod(p, stat.S_IWRITE), f(p)))


def tree(root):
    """{relative path: (is dir, size, sha256)} of everything under root (\\\\?\\ paths; junctions listed, not followed)."""
    out = {}
    base = long(root)
    for folder, dirs, files in os.walk(base):
        for d in list(dirs):
            p = os.path.join(folder, d)
            out[os.path.relpath(p, base)] = ('junction' if os.path.isjunction(p) else 'dir', 0, '')
            if os.path.isjunction(p):
                dirs.remove(d)
        for f in files:
            p = os.path.join(folder, f)
            h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
            out[os.path.relpath(p, base)] = ('file', os.path.getsize(p), h)
    return out


def gecko_lock(path):
    """Opens `path` as Gecko locks a profile it runs on (nsProfileLock: no sharing, deleted on close)."""
    h = kernel32.CreateFileW(path, 0xC0000000, 0, None, 4, 0x04000000, None)  # GENERIC_READ|WRITE, OPEN_ALWAYS, DELETE_ON_CLOSE
    if h == wt.HANDLE(-1).value:
        raise OSError('could not lock %s: %d' % (path, ctypes.get_last_error()))
    return h


def busy(path):
    """Holds `path` open with no sharing (a file another program is writing)."""
    h = kernel32.CreateFileW(path, 0x80000000, 0, None, 3, 0, None)  # GENERIC_READ, OPEN_EXISTING
    if h == wt.HANDLE(-1).value:
        raise OSError('could not open %s: %d' % (path, ctypes.get_last_error()))
    return h


def build_probe():
    csc = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), r'Microsoft.NET\Framework64\v4.0.30319\csc.exe')
    out = os.path.join(WORK, 'probe.exe')
    os.makedirs(WORK, exist_ok=True)
    r = subprocess.run([csc, '/nologo', '/target:exe', '/optimize+', '/out:' + out, os.path.join(HERE, 'Probe.cs')] +
                       [os.path.join(INSTALLER, n) for n in ('Shell.cs', 'EngineTraces.cs', 'Lzma.cs', 'Package.cs', 'ProfileMigration.cs')],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit('probe build failed:\n' + r.stdout + r.stderr)
    return out


def migrate(probe, local, *options):
    r = subprocess.run([probe, 'migrate', local, *options], capture_output=True, encoding='utf-8', errors='replace', timeout=600)
    info = dict(line.split('=', 1) for line in r.stdout.splitlines() if '=' in line)
    info['code'] = r.returncode
    return info


def tell(probe, local):
    r = subprocess.run([probe, 'tell', local], capture_output=True, encoding='utf-8', errors='replace', timeout=60)
    return dict(line.split('=', 1) for line in r.stdout.splitlines() if '=' in line).get('tell', None)


def failure_record(local, app='Deer'):
    path = os.path.join(local, app, 'Profile.copy-failed')
    try:
        return dict(line.split('=', 1) for line in open(path, encoding='utf-8').read().splitlines() if '=' in line)
    except OSError:
        return None


def make_old(local, deep=True, user_js=False, harness=False):
    """A fake old profile <local>\\Vitre\\Profile; returns its path."""
    old = os.path.join(local, 'Vitre', 'Profile')
    os.makedirs(old)
    for name, data in (('vitre-profile', b''), ('prefs.js', b'user_pref("vitre.test", "old profile");\n'),
                       ('places.sqlite', os.urandom(3 << 20)), ('deer-migration-sentinel.txt', b'kept'),
                       ('caf\u00e9 \u65e5\u672c #2.txt', 'non-ASCII \u00e9'.encode('utf-8')),
                       ('lock', b'x'), ('.parentlock', b'x')):
        open(os.path.join(old, name), 'wb').write(data)
    if harness:
        open(os.path.join(old, 'vitre-harness'), 'wb').close()
    if user_js:
        # No harness prefs: the product defaults keep shortcuts and prompts away; these make starts quiet.
        open(os.path.join(old, 'user.js'), 'w').write('\n'.join('user_pref("%s", %s);' % (k, json.dumps(v)) for k, v in (
            ('browser.shell.checkDefaultBrowser', False), ('browser.shell.customIcon.enabled', False),
            ('browser.privacySegmentation.createdShortcut', True), ('browser.aboutwelcome.enabled', False),
            ('browser.startup.homepage_override.mstone', 'ignore'), ('browser.startup.page', 0),
            ('browser.sessionstore.resume_from_crash', False), ('widget.windows.window_occlusion_tracking.enabled', False))) + '\n')
    sub = os.path.join(old, 'storage', 'default', 'https+++example.test', 'idb')
    os.makedirs(sub)
    open(os.path.join(sub, 'data.sqlite'), 'wb').write(b'idb')
    ro = os.path.join(old, 'readonly.json')
    open(ro, 'w').write('{"read": "only"}')
    os.chmod(ro, stat.S_IREAD)
    hidden = os.path.join(old, 'hidden.txt')
    open(hidden, 'w').write('hidden')
    ctypes.windll.kernel32.SetFileAttributesW(hidden, 0x2)
    for cache in ('cache2', 'startupCache'):
        os.makedirs(os.path.join(old, cache, 'entries'))
        open(os.path.join(old, cache, 'entries', 'A1B2'), 'wb').write(b'cache')
    if deep:
        # A storage path well past MAX_PATH (Firefox makes such paths for long origins).
        d = long(old)
        for i in range(6):
            d = os.path.join(d, ('moz-extension+++%02d-' % i) + 'x' * 40)
        os.makedirs(d)
        open(os.path.join(d, 'deep.bin'), 'wb').write(b'deep')
        # A junction to a folder outside the profile: never followed.
        outside = os.path.join(local, 'outside')
        os.makedirs(outside)
        open(os.path.join(outside, 'not-copied.txt'), 'w').write('outside')
        subprocess.run(['cmd', '/c', 'mklink', '/J', os.path.join(old, 'linked'), outside], capture_output=True)
    return old


SKIPPED_TOP = {'lock', '.parentlock', 'parent.lock', 'cache2', 'startupCache', 'linked'}


def expected_copy(before):
    return {k: v for k, v in before.items() if k.split(os.sep)[0] not in SKIPPED_TOP}


def leftovers(local, app='Deer'):
    deer = os.path.join(local, app)
    return [n for n in os.listdir(deer) if n.startswith('Profile.migrating-')] if os.path.isdir(deer) else []


# ---- 1. the copy, through probe.exe ----------------------------------------------------------------

def phase_probe(probe):
    section('1. the profile copy (probe.exe migrate)')
    local = os.path.join(ROOT, 'p-none')
    os.makedirs(local)
    r = migrate(probe, local)
    check('no old profile: nothing to do, the answer is Deer\'s profile, nothing is created',
          r.get('outcome') == 'None' and os.path.normcase(r.get('profile', '')) == os.path.normcase(os.path.join(local, 'Deer', 'Profile')) and
          os.listdir(local) == [], r)
    old = os.path.join(local, 'Vitre', 'Profile')
    os.makedirs(old)
    open(os.path.join(old, 'prefs.js'), 'w').write('// no marker\n')
    r = migrate(probe, local)
    check('an old profile without its "vitre-profile" marker is not copied', r.get('outcome') == 'None' and not os.path.exists(os.path.join(local, 'Deer')), r)

    local = os.path.join(ROOT, 'p-copy')
    old = make_old(local)
    before = tree(old)
    r = migrate(probe, local)
    new = os.path.join(local, 'Deer', 'Profile')
    after_new = tree(new) if os.path.isdir(new) else {}
    want = expected_copy(before)
    check('first start: the old profile is copied (outcome Copied, the answer is Deer\'s profile, %s s)' % r.get('seconds'),
          r.get('outcome') == 'Copied' and os.path.normcase(r.get('profile', '')) == os.path.normcase(new), r)
    diff = sorted(set(want.items()) ^ set(after_new.items()))
    check('the copy is byte for byte the old profile (%d entries, SHA-256 of every file) minus lock files, cache2, startupCache '
          'and the junction' % len(want), after_new == want, diff[:6])
    deep = [k for k in after_new if len(os.path.join(new, k)) > 260]
    check('a path over 260 characters was copied (%d characters)' % max([len(os.path.join(new, k)) for k in after_new] + [0]), bool(deep))
    check('non-ASCII names, the read-only and the hidden file were copied with their attributes',
          os.path.exists(os.path.join(new, 'caf\u00e9 \u65e5\u672c #2.txt')) and
          not os.access(os.path.join(new, 'readonly.json'), os.W_OK) and
          ctypes.windll.kernel32.GetFileAttributesW(os.path.join(new, 'hidden.txt')) & 0x2)
    check('nothing outside the profile was followed through the junction', not os.path.exists(os.path.join(new, 'linked')))
    check('the old profile is unchanged (and holds no parent.lock afterwards)', tree(old) == before and not os.path.exists(os.path.join(old, 'parent.lock')))
    check('no half copy is left next to Deer\'s profile', not leftovers(local), leftovers(local))

    # A later start: Deer's profile exists, the old one is never looked at again.
    open(os.path.join(old, 'prefs.js'), 'a').write('// changed after the copy\n')
    open(os.path.join(new, 'deer-only.txt'), 'w').write('deer')
    snap = tree(new)
    r = migrate(probe, local)
    check('Deer\'s profile exists: nothing is copied again, it is left as it is', r.get('outcome') == 'None' and tree(new) == snap, r)

    # In use: a browser runs on the old profile (parent.lock held as Gecko holds it).
    local = os.path.join(ROOT, 'p-inuse')
    old = make_old(local, deep=False)
    before = tree(old)
    h = gecko_lock(os.path.join(old, 'parent.lock'))
    try:
        r = migrate(probe, local)
        check('old profile in use (parent.lock held): nothing copied, the answer is the old profile (outcome InUse)',
              r.get('outcome') == 'InUse' and os.path.normcase(r.get('profile', '')) == os.path.normcase(old) and
              not os.path.exists(os.path.join(local, 'Deer', 'Profile')) and not leftovers(local), r)
    finally:
        kernel32.CloseHandle(h)
    check('the browser\'s lock went with it (the old profile as before)', tree(old) == before)
    r = migrate(probe, local)
    check('the next start, with the old profile free: copied', r.get('outcome') == 'Copied' and os.path.isfile(os.path.join(local, 'Deer', 'Profile', 'prefs.js')), r)

    # A stale parent.lock (a browser that crashed): taken over and not copied.
    local = os.path.join(ROOT, 'p-stale')
    old = make_old(local, deep=False)
    open(os.path.join(old, 'parent.lock'), 'wb').close()
    r = migrate(probe, local)
    check('a stale parent.lock left by a crash: copied past it, the lock file not copied',
          r.get('outcome') == 'Copied' and not os.path.exists(os.path.join(local, 'Deer', 'Profile', 'parent.lock')) and
          os.path.isfile(os.path.join(local, 'Deer', 'Profile', 'prefs.js')), r)

    # A file that cannot be read: nothing is left half way, the old profile is the answer, the next start copies.
    local = os.path.join(ROOT, 'p-fail')
    old = make_old(local, deep=False)
    before = tree(old)
    h = busy(os.path.join(old, 'places.sqlite'))
    try:
        r = migrate(probe, local)
        check('a file another program holds open: the copy fails cleanly (outcome Failed, the answer is the old profile, no Deer profile, '
              'no half copy)', r.get('outcome') == 'Failed' and os.path.normcase(r.get('profile', '')) == os.path.normcase(old) and
              not os.path.exists(os.path.join(local, 'Deer', 'Profile')) and not leftovers(local), r)
    finally:
        kernel32.CloseHandle(h)
    check('the old profile is unchanged after the failed copy', tree(old) == before)
    r = migrate(probe, local)
    check('the next start copies', r.get('outcome') == 'Copied', r)

    # A half copy left by a crash or a power cut.
    local = os.path.join(ROOT, 'p-crash')
    make_old(local, deep=False)
    half = os.path.join(local, 'Deer', 'Profile.migrating-424242')
    os.makedirs(os.path.join(half, 'storage'))
    open(os.path.join(half, 'prefs.js'), 'w').write('half')
    r = migrate(probe, local)
    check('a half copy from an earlier start is deleted and the copy made again', r.get('outcome') == 'Copied' and not os.path.exists(half) and
          open(os.path.join(local, 'Deer', 'Profile', 'prefs.js')).read().startswith('user_pref'), r)

    # Two starts at once: one copies, the other waits for it and finds Deer's profile.
    local = os.path.join(ROOT, 'p-twice')
    make_old(local)
    procs = [subprocess.Popen([probe, 'migrate', local], stdout=subprocess.PIPE, encoding='utf-8') for _ in range(2)]
    outs = [dict(l.split('=', 1) for l in p.communicate(timeout=600)[0].splitlines() if '=' in l) for p in procs]
    new = os.path.join(local, 'Deer', 'Profile')
    check('two starts at once: one copies, the other finds it done; both answer Deer\'s profile',
          sorted(o.get('outcome') for o in outs) == ['Copied', 'None'] and all(os.path.normcase(o.get('profile', '')) == os.path.normcase(new) for o in outs)
          and not leftovers(local), outs)

    # A blank Deer profile (a start before the copy existed, or -profile pointed at it): copied over.
    for name, files in (('p-blank-empty', ()), ('p-blank-marker', ('vitre-profile', 'deer-build'))):
        local = os.path.join(ROOT, name)
        old = make_old(local, deep=False)
        new = os.path.join(local, 'Deer', 'Profile')
        os.makedirs(new)
        for f in files:
            open(os.path.join(new, f), 'w').write('0.1.0' if f == 'deer-build' else '')
        before = tree(old)
        r = migrate(probe, local)
        check('a blank Deer profile (%s) is copied over: Copied, byte for byte' % (' and '.join(files) or 'empty'),
              r.get('outcome') == 'Copied' and tree(new) == expected_copy(before) and not leftovers(local), r)
    local = os.path.join(ROOT, 'p-notblank')
    make_old(local, deep=False)
    new = os.path.join(local, 'Deer', 'Profile')
    os.makedirs(new)
    open(os.path.join(new, 'vitre-profile'), 'w').close()
    open(os.path.join(new, 'times.json'), 'w').write('{}')
    r = migrate(probe, local)
    check('a Deer profile a browser ran on (anything besides the marker and stamp) is left alone', r.get('outcome') == 'None' and
          sorted(os.listdir(new)) == ['times.json', 'vitre-profile'], r)

    # Too little free space: refused before anything is written; a copy that keeps failing backs off.
    local = os.path.join(ROOT, 'p-space')
    old = make_old(local, deep=False)
    new = os.path.join(local, 'Deer', 'Profile')
    r = migrate(probe, local, '--free-mb', '200')
    rec = failure_record(local)
    check('not enough free space (200 MB assumed for a copy that needs 256 MB more than the profile): Failed, nothing written, recorded once',
          r.get('outcome') == 'Failed' and 'not enough free space' in r.get('detail', '') and not os.path.exists(new) and not leftovers(local) and
          rec and rec.get('count') == '1' and 'not enough free space' in rec.get('reason', ''), (r, rec))
    check('after one failure: nothing to tell yet', tell(probe, local) == '')
    r = migrate(probe, local, '--free-mb', '200')
    rec = failure_record(local)
    check('the start after the first failure tries again (count 2)', r.get('outcome') == 'Failed' and 'not enough free space' in r.get('detail', '') and
          rec and rec.get('count') == '2', (r, rec))
    t0 = time.time()
    r = migrate(probe, local)
    rec = failure_record(local)
    check('after two failures: not tried again within a day, even with space now (the old profile is the answer, count stays 2)',
          r.get('outcome') == 'Failed' and r.get('detail', '').startswith('not tried again before') and rec.get('count') == '2' and
          os.path.normcase(r.get('profile', '')) == os.path.normcase(old) and not os.path.exists(new), (r, rec))
    said = tell(probe, local)
    check('the person is told once: what failed and that Deer uses the old profile where it is', said and 'not enough free space' in said and
          'uses it where it is' in said and old in said, said)
    check('... and not again', tell(probe, local) == '' and failure_record(local).get('told') == '1')
    rec_path = os.path.join(local, 'Deer', 'Profile.copy-failed')
    text = open(rec_path, encoding='utf-8').read()
    yesterday = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 25 * 3600))
    open(rec_path, 'w', encoding='utf-8').write('\n'.join('last=' + yesterday if l.startswith('last=') else l for l in text.splitlines()) + '\n')
    r = migrate(probe, local)
    check('a day after the last failure, with space: copied, the record removed', r.get('outcome') == 'Copied' and os.path.isfile(os.path.join(new, 'prefs.js')) and
          not os.path.exists(rec_path), (r, os.path.exists(rec_path)))

    # The development launcher's profile is another folder, copied on its own.
    local = os.path.join(ROOT, 'p-dev')
    old = make_old(local, deep=False)
    before = tree(old)
    r = migrate(probe, local, '--dev')
    dev = os.path.join(local, 'Deer Dev', 'Profile')
    check('the development profile: copied to Deer Dev\\Profile, the installed Deer\'s folder not made',
          r.get('outcome') == 'Copied' and os.path.normcase(r.get('profile', '')) == os.path.normcase(dev) and tree(dev) == expected_copy(before) and
          not os.path.exists(os.path.join(local, 'Deer')), r)
    r = migrate(probe, local)
    check('the installed Deer copies the old profile for itself too (Deer\\Profile), the development one untouched',
          r.get('outcome') == 'Copied' and tree(os.path.join(local, 'Deer', 'Profile')) == expected_copy(before) and tree(dev) == expected_copy(before), r)


# ---- 2. the development launcher --------------------------------------------------------------------

def browsers(marker):
    """{pid: (parent, command line)} of vitre.exe processes whose command line names `marker` (a path
    under ROOT), with their descendants. Never anything else."""
    script = ("[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter \"Name='vitre.exe'\" | "
              "Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress")
    raw = subprocess.run(['powershell', '-NoProfile', '-Command', script], capture_output=True, timeout=60).stdout.decode('utf-8', 'replace')
    try:
        rows = json.loads(raw) if raw.strip() else []
    except ValueError:
        rows = []
    if isinstance(rows, dict):
        rows = [rows]
    key = marker.lower()
    pids = {r['ProcessId']: (r['ParentProcessId'], r.get('CommandLine') or '') for r in rows if key in (r.get('CommandLine') or '').lower()}
    grew = True
    while grew:
        grew = False
        for r in rows:
            if r['ParentProcessId'] in pids and r['ProcessId'] not in pids:
                pids[r['ProcessId']] = (r['ParentProcessId'], r.get('CommandLine') or '')
                grew = True
    return pids


def parents(pids):
    return sorted(p for p, (parent, _c) in pids.items() if parent not in pids)


def windows_of(pids):
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(hwnd, _):
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(hwnd, cls, 64)
        if pid.value in pids and cls.value == 'MozillaWindowClass' and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True
    user32.EnumWindows(each, 0)
    return found


def wait_for(fn, timeout, step=0.5):
    end = time.time() + timeout
    while True:
        v = fn()
        if v or time.time() > end:
            return v
        time.sleep(step)


def close_browsers(marker):
    for h in windows_of(set(browsers(marker))):
        user32.PostMessageW(h, 0x0010, 0, 0)
    if wait_for(lambda: not browsers(marker), 45):
        return True
    for pid in browsers(marker):
        subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True)
    time.sleep(2)
    return False


def log_text(path):
    try:
        return open(path, encoding='utf-8', errors='replace').read()
    except OSError:
        return ''


def launched(path):
    line = next((l for l in log_text(path).splitlines() if l.startswith('LAUNCHED ')), '')
    return json.loads(line[len('LAUNCHED '):]) if line else {}


def page(name):
    p = os.path.join(ROOT, 'pages', name + '.html')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w').write('<!doctype html><title>%s</title><p>%s</p>' % (name, name))
    return p


def base_env(log):
    env = dict(os.environ)
    for k in [k for k in env if k.startswith('VITRE_') or k.startswith('DEER_') or k in ('XUL_APP_FILE', 'XRE_PROFILE_PATH', 'XRE_PROFILE_LOCAL_PATH')]:
        env.pop(k)
    env.update(VITRE_BOOT=os.path.join(HERE, 'launch-probe.js'), VITRE_LIB=os.path.join(GECKO, 'tools', 'spike-lib.js'), VITRE_LOG=log, VITRE_OUT=OUT,
               MOZ_CRASHREPORTER_DISABLE='1')
    open(log, 'w').close()
    return env


def icon_matches(exe, ico):
    spec = importlib.util.spec_from_file_location('setup_engine', os.path.join(GECKO, 'tools', 'setup-engine.py'))
    se = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(se)
    spec = importlib.util.spec_from_file_location('deer_build', os.path.join(INSTALLER, 'build.py'))
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    images = {d for _n, _l, d in se.read_resources(exe, se.RT_ICON)}
    want = build.ico_images(ico)
    return want and all(i in images for i in want), len(want)


def phase_launcher():
    section('2. the development launcher (launcher\\Deer.exe, Deer.cmd, Vitre.cmd) on the development runtime')
    if not (os.path.exists(os.path.join(RUNTIME, 'vitre.exe')) and os.path.exists(os.path.join(RUNTIME, 'vitre', 'chrome.manifest'))):
        check('gecko/runtime with vitre.exe and a chrome package (python tools/setup-runtime.py; node tools/build.mjs)', False)
        return
    exe = os.path.join(LAUNCHER, 'Deer.exe')
    r = subprocess.run(['node', os.path.join(GECKO, 'tools', 'build-launcher.mjs')], capture_output=True, text=True)
    check('node tools/build-launcher.mjs builds launcher\\Deer.exe', r.returncode == 0 and os.path.exists(exe), (r.stdout + r.stderr).strip())
    ok, n = icon_matches(exe, ICON)
    check('launcher\\Deer.exe carries the gold Deer icon (all %d images of tools\\runtime-overlay\\...\\vitre.ico)' % n, ok)
    old_exe = os.path.join(LAUNCHER, 'Vitre.exe')
    check('launcher\\Vitre.exe (old pins and scripts) is the same program as Deer.exe, so it opens the same profile',
          os.path.exists(old_exe) and open(old_exe, 'rb').read() == open(exe, 'rb').read())
    vitre_cmd = open(os.path.join(LAUNCHER, 'Vitre.cmd'), encoding='utf-8').read().strip().splitlines()
    check('launcher\\Vitre.cmd is a one-line forwarder to Deer.cmd', len(vitre_cmd) == 1 and 'Deer.cmd' in vitre_cmd[0], vitre_cmd)

    # ---- a first start copies the old profile ----
    local = os.path.join(ROOT, 'dev-local')
    old = make_old(local, deep=False, user_js=True, harness=True)
    before = tree(old)
    new = os.path.join(local, 'Deer Dev', 'Profile')
    log = os.path.join(OUT, 'dev-first.log')
    env = base_env(log)
    elsewhere = os.path.join(ROOT, 'xre-profile-elsewhere')
    # MOZ_NEW_INSTANCE turns Gecko's remoting off: the starts below would not hand their pages over.
    env.update(DEER_TEST_LOCALAPPDATA=local, XUL_APP_FILE=os.path.join(ROOT, 'no-such-application.ini'), XRE_PROFILE_PATH=elsewhere,
               XRE_PROFILE_LOCAL_PATH=elsewhere, MOZ_NEW_INSTANCE='1')
    try:
        t0 = time.time()
        code = subprocess.run([exe, page('deer-dev-first')], env=env, timeout=120).returncode
        took = time.time() - t0
        check('Deer.exe returns 0 (%.1f s, the copy included)' % took, code == 0, code)
        info = wait_for(lambda: launched(log), 60)
        check('the runtime started on the development profile (Deer Dev\\Profile), copied from the old one (the sentinel file came along)',
              info and os.path.normcase(info.get('profile', '')) == os.path.normcase(new) and
              os.path.exists(os.path.join(new, 'deer-migration-sentinel.txt')), info)
        check('the installed Deer\'s profile folder (Deer\\Profile) was not made', not os.path.exists(os.path.join(local, 'Deer')))
        check('the caller\'s XUL_APP_FILE, XRE_PROFILE_PATH and XRE_PROFILE_LOCAL_PATH were not passed on (it started, on -profile\'s '
              'folder, and the other folder was never made)', bool(info) and not os.path.exists(elsewhere))
        check('the old profile is unchanged', tree(old) == before)
        pids = browsers(local)
        roots = parents(pids)
        cmd = pids[roots[0]][1] if roots else ''
        check('one browser, vitre.exe -profile <Deer\'s profile>, without -no-remote', len(roots) == 1 and '-profile' in cmd and new.lower() in cmd.lower() and
              '-no-remote' not in cmd, cmd)
        wait_for(lambda: 'deer-dev-first' in log_text(log) and 'TABS' in log_text(log), 30)

        # ---- the next starts hand their page to the running one ----
        r = subprocess.run(['cmd', '/c', os.path.join(LAUNCHER, 'Deer.cmd'), page('deer-dev-second')], env=env, timeout=120)
        check('Deer.cmd returns 0', r.returncode == 0, r.returncode)
        check('Deer.cmd\'s page arrived in the running browser (MOZ_NEW_INSTANCE in the caller\'s environment was not passed on)',
              wait_for(lambda: 'deer-dev-second' in log_text(log), 30))
        r = subprocess.run(['cmd', '/c', os.path.join(LAUNCHER, 'Vitre.cmd'), page('deer-dev-third')], env=env, timeout=120)
        check('Vitre.cmd (forwarded to Deer.cmd) returns 0', r.returncode == 0, r.returncode)
        check('Vitre.cmd\'s page arrived in the running browser', wait_for(lambda: 'deer-dev-third' in log_text(log), 30))
        code = subprocess.run([exe, '-osint', '-url', page('deer-dev-fourth')], env=env, timeout=60).returncode
        check('Deer.exe -osint -url <page>: 0, and the page arrived', code == 0 and wait_for(lambda: 'deer-dev-fourth' in log_text(log), 30), code)
        for args in (['-osint', '-url', 'a', 'b'], ['-osint', '-profile', os.path.join(ROOT, 'bogus')], ['x', '-osint', '-url', 'y']):
            code = subprocess.run([exe] + args, env=env, timeout=60).returncode
            check('rejected: Deer.exe %s -> exit 1' % ' '.join(os.path.basename(a) for a in args), code == 1, code)
        check('still one browser, the test hook ran once', parents(browsers(local)) == roots and log_text(log).count('LAUNCHED') == 1,
              (roots, parents(browsers(local))))
    finally:
        check('the browser closes', close_browsers(local))

    # ---- a browser runs on the old profile: its page goes there, nothing is copied ----
    local = os.path.join(ROOT, 'dev-inuse')
    old = make_old(local, deep=False, user_js=True, harness=True)
    new = os.path.join(local, 'Deer Dev', 'Profile')
    log = os.path.join(OUT, 'dev-old-running.log')
    env = base_env(log)
    try:
        # What the person's own development browser looks like: the runtime on the old profile.
        subprocess.Popen([os.path.join(RUNTIME, 'vitre.exe'), '-profile', old, page('deer-old-running')], env=env)
        info = wait_for(lambda: launched(log), 60)
        check('a browser runs on the old profile', info and os.path.normcase(info.get('profile', '')) == os.path.normcase(old), info)
        roots = parents(browsers(local))
        env2 = dict(base_env(os.path.join(OUT, 'dev-old-running-2.log')), DEER_TEST_LOCALAPPDATA=local)
        code = subprocess.run([exe, page('deer-handed-to-old')], env=env2, timeout=120).returncode
        check('Deer.exe returns 0', code == 0, code)
        check('its page went to the browser on the old profile (Gecko remoting by profile path)', wait_for(lambda: 'deer-handed-to-old' in log_text(log), 30))
        check('nothing was copied: no development profile, no half copy, still one browser', not os.path.exists(new) and not leftovers(local, 'Deer Dev') and
              parents(browsers(local)) == roots, (os.path.exists(new), leftovers(local, 'Deer Dev'), roots, parents(browsers(local))))
    finally:
        check('the browser on the old profile closes', close_browsers(local))
    log = os.path.join(OUT, 'dev-after-close.log')
    env = dict(base_env(log), DEER_TEST_LOCALAPPDATA=local)
    try:
        code = subprocess.run([exe, page('deer-after-close')], env=env, timeout=120).returncode
        info = wait_for(lambda: launched(log), 60)
        check('the next start, the old browser closed: copied, started on Deer\'s profile', code == 0 and info and
              os.path.normcase(info.get('profile', '')) == os.path.normcase(new) and os.path.exists(os.path.join(new, 'deer-migration-sentinel.txt')), info)
    finally:
        check('the browser closes', close_browsers(local))

    # ---- DEER_PROFILE / VITRE_PROFILE: that profile, nothing copied ----
    local = os.path.join(ROOT, 'dev-override')
    make_old(local, deep=False, user_js=True, harness=True)
    for var in ('DEER_PROFILE', 'VITRE_PROFILE'):
        chosen = os.path.join(ROOT, 'dev-' + var.lower())
        os.makedirs(chosen)
        open(os.path.join(chosen, 'vitre-harness'), 'w').close()
        log = os.path.join(OUT, 'dev-%s.log' % var.lower())
        env = dict(base_env(log), DEER_TEST_LOCALAPPDATA=local)
        env[var] = chosen
        try:
            code = subprocess.run([exe, page('deer-' + var.lower())], env=env, timeout=120).returncode
            info = wait_for(lambda: launched(log), 60)
            check('%s: started on that folder (marker made), nothing copied' % var, code == 0 and info and
                  os.path.normcase(info.get('profile', '')) == os.path.normcase(chosen) and info.get('marker') and
                  not os.path.exists(os.path.join(local, 'Deer')) and not os.path.exists(os.path.join(local, 'Deer Dev')), info)
        finally:
            check('the browser closes', close_browsers(chosen))


def main():
    global ROOT
    ap = argparse.ArgumentParser()
    ap.add_argument('--root')
    ap.add_argument('--no-launcher', action='store_true', help='only the probe checks (no browser is started)')
    a = ap.parse_args()
    if a.root:
        ROOT = os.path.abspath(a.root)
    if not os.path.normcase(ROOT).startswith(os.path.normcase(tempfile.gettempdir()) + os.sep):
        sys.exit('--root must be inside %s' % tempfile.gettempdir())
    if browsers(ROOT):
        close_browsers(ROOT)
    rmtree(ROOT)
    os.makedirs(ROOT)
    os.makedirs(OUT, exist_ok=True)
    probe = build_probe()
    try:
        phase_probe(probe)
        if not a.no_launcher:
            phase_launcher()
    finally:
        if browsers(ROOT):
            close_browsers(ROOT)
        rmtree(ROOT)
    print('RESULT %s' % ('ok' if not failed else '%d failed' % failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
