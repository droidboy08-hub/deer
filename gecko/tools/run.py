"""Run Vitre (the Gecko runtime with Vitre's chrome package) with a test script, capture real window
screenshots, print the script's log, then stop it.

  python tools/run.py --test tests/x/smoke.js --name x [--url https://example.com] [--timeout 90]
                      [--app build-x] [--pref key=value ...] [--env KEY=VALUE ...] [--arg -private-window]
                      [--keep-profile] [--out tests/x/out] [--shoot name:seconds ...] [--stock] [--identity]

  --test SCRIPT     (alias --boot) runs in every browser window once Vitre has booted there, with the
                    `spike` helpers from tools/spike-lib.js. spike.main() runs its body in the first
                    window only. Without --test, give --shoot: Vitre starts with no test hook at all.
  --name NAME       the throwaway profile %TEMP%/vitre-gecko-NAME (deleted afterwards). Runs with
                    different names are independent and can run at the same time.
  --app build-x     use another build output (node tools/build.mjs --out=build-x) instead of
                    runtime/vitre: it is linked into the profile's chrome folder, which sandboxed
                    content processes can read, and passed as VITRE_APP_DIR.
  --shoot N:SECS    screenshot the window SECS seconds after start, from outside (no script needed).
  --stock           VITRE_DISABLE=1: plain Firefox interface (to compare against).
  --exe NAME        start runtime/NAME instead of vitre.exe (only for control runs that need the
                    process to be called firefox.exe; Vitre itself always runs as vitre.exe).
  --identity        with every capture also print the window title and taskbar id and save its icon.
  --until-exit      the run also ends, normally, when the runtime quits by itself after the script
                    started (a test of something that quits Deer: tests/update/apply.js).
  Exit code: 0 when the script finished and logged no FAIL or ERROR line, 1 otherwise.

Script protocol (lines the script writes to the log; spike-lib does it):
  @@capture NAME [HWND]   screenshot that window (PrintWindow: the composited picture) to OUT/NAME.png
  @@modules TEXT          print the DLLs loaded in this run's processes whose name contains TEXT
  @@quit                  the script is done
Anything else is printed. Panels and menus are separate OS windows and are not in a window capture.

The runtime is started as runtime/vitre.exe with -profile and -no-remote, focusmanager.testmode=true
and VITRE_ALLOW_ANY_PROFILE=1, on a profile carrying the "vitre-harness" marker (config.js honours
the test hook and VITRE_APP_DIR only there). Processes are followed by parent/child from the one
started here, so an in-place restart (whose command line no longer names the profile) is still
captured and stopped.
"""
import argparse
import ctypes
import ctypes.wintypes as wt
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import zlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
RUNTIME = os.path.join(ROOT, 'runtime')
VITRE = os.path.join(RUNTIME, 'vitre.exe')
# Images that belong to the runtime. Only these are ever followed or stopped; never firefox.exe.
IMAGES = {'vitre.exe', 'crashhelper.exe', 'plugin-container.exe', 'pingsender.exe', 'crashreporter.exe'}

# Test-only prefs. Product defaults live in runtime/defaults/pref/vitre-prefs.js.
PREFS = {
    # Deterministic start: one blank tab, no restored session, no crash-recovery page after a kill.
    'browser.startup.page': 0,
    'browser.startup.homepage': 'about:blank',
    'browser.sessionstore.resume_from_crash': False,
    # Gecko treats the window as active without OS focus (other windows are open on this desktop).
    'focusmanager.testmode': True,
    # Pages render in the light colour scheme whatever the desktop theme is (1 = light): tests that
    # sample the glass theme over a real site (example.com follows the system scheme) compare colours.
    'layout.css.prefers-color-scheme.content-override': 1,
    # Parallel runs overlap on screen; keep rendering when covered so captures stay real.
    'widget.windows.window_occlusion_tracking.enabled': False,
    'browser.dom.window.dump.enabled': True,
    'devtools.chrome.enabled': True,
    'devtools.debugger.remote-enabled': True,
    'browser.tabs.remote.warmup.enabled': True,
    # Local test extensions.
    'extensions.autoDisableScopes': 0,
    'xpinstall.signatures.required': False,
    # Belt and braces for the stock interface (--stock, old spikes): the product defaults set these too.
    'browser.shell.checkDefaultBrowser': False,
    'browser.shell.customIcon.enabled': False,
    'browser.privacySegmentation.createdShortcut': True,
    'browser.aboutwelcome.enabled': False,
    'browser.startup.homepage_override.mstone': 'ignore',
    'datareporting.policy.dataSubmissionEnabled': False,
    'termsofuse.bypassNotification': True,
    # Safe Browsing's remote download lookup (a request to Google for every finished program) would
    # make download tests wait on the network; the local lists are still checked
    # (src/modules/downloads/reputation.ts).
    'browser.safebrowsing.downloads.remote.enabled': False,
}

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
kernel32 = ctypes.windll.kernel32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass


# ---- processes ----------------------------------------------------------------------------------

class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [('dwSize', wt.DWORD), ('cntUsage', wt.DWORD), ('th32ProcessID', wt.DWORD),
                ('th32DefaultHeapID', ctypes.c_size_t), ('th32ModuleID', wt.DWORD), ('cntThreads', wt.DWORD),
                ('th32ParentProcessID', wt.DWORD), ('pcPriClassBase', wt.LONG), ('dwFlags', wt.DWORD),
                ('szExeFile', wt.WCHAR * 260)]


def processes():
    """[(pid, parent pid, image name lower-case)] for every process (Toolhelp snapshot, a few ms)."""
    kernel32.CreateToolhelp32Snapshot.restype = wt.HANDLE
    snap = kernel32.CreateToolhelp32Snapshot(0x2, 0)
    out = []
    entry = PROCESSENTRY32W()
    entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
    kernel32.Process32FirstW.argtypes = [wt.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    kernel32.Process32NextW.argtypes = [wt.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
    ok = kernel32.Process32FirstW(snap, ctypes.byref(entry))
    while ok:
        out.append((entry.th32ProcessID, entry.th32ParentProcessID, entry.szExeFile.lower()))
        ok = kernel32.Process32NextW(snap, ctypes.byref(entry))
    kernel32.CloseHandle.argtypes = [wt.HANDLE]
    kernel32.CloseHandle(snap)
    return out


class Tree:
    """The runtime processes that descend from the one this run started. `known` only grows, so a
    process started by one that has already exited (an in-place restart) is still recognised."""

    def __init__(self, root_pid):
        self.known = {root_pid}

    def alive(self):
        rows = processes()
        grew = True
        while grew:
            grew = False
            for pid, parent, image in rows:
                if pid not in self.known and parent in self.known and image in IMAGES:
                    self.known.add(pid)
                    grew = True
        # A recycled pid could belong to anything by now: only runtime images count.
        return {pid for pid, _parent, image in rows if pid in self.known and image in IMAGES}


def stale_pids(profile):
    """Runtime processes left by an earlier run on this profile (matched by the whole profile name
    on the command line, so 'x' never matches the profile of a run named 'x-verify')."""
    if not any(image == 'vitre.exe' for _pid, _parent, image in processes()):
        return set()
    ps = ("Get-CimInstance Win32_Process -Filter \"Name='vitre.exe'\" | "
          "Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress")
    try:
        raw = subprocess.run(['powershell', '-NoProfile', '-Command', ps], capture_output=True, text=True, timeout=30).stdout
        rows = json.loads(raw) if raw.strip() else []
    except Exception:
        return set()
    if isinstance(rows, dict):
        rows = [rows]
    key = re.compile(re.escape(os.path.basename(profile).lower()) + r'(?![\w.-])')
    pids = {r['ProcessId'] for r in rows if r.get('CommandLine') and key.search(r['CommandLine'].lower())}
    grew = True
    while grew:
        grew = False
        for r in rows:
            if r['ParentProcessId'] in pids and r['ProcessId'] not in pids:
                pids.add(r['ProcessId'])
                grew = True
    return pids


def kill(pids):
    for pid in pids:
        subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True)


def loaded_modules(pids, text, image='vitre.exe'):
    """{dll name: [pids]} for modules whose name contains `text`, from `tasklist /m`."""
    found = {}
    try:
        raw = subprocess.run(['tasklist', '/m', '/fo', 'csv', '/nh', '/fi', 'IMAGENAME eq ' + image],
                             capture_output=True, text=True, timeout=60).stdout
    except Exception as e:
        return {'(tasklist failed: %s)' % e: []}
    for line in raw.splitlines():
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) < 3 or not parts[1].isdigit() or int(parts[1]) not in pids:
            continue
        for dll in parts[2].split(','):
            if text.lower() in dll.lower():
                found.setdefault(dll, []).append(int(parts[1]))
    return found


# ---- windows and captures -----------------------------------------------------------------------

def find_window(pids):
    """The largest visible browser window of these processes."""
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value not in pids:
            return True
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(hwnd, cls, 64)
        if cls.value != 'MozillaWindowClass':
            return True
        r = wt.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(r))
        found.append((hwnd, (r.right - r.left) * (r.bottom - r.top)))
        return True

    user32.EnumWindows(each, 0)
    found.sort(key=lambda f: -f[1])
    return found[0][0] if found else None


def png(path, w, h, bgra):
    rows = bytearray()
    stride = w * 4
    for y in range(h):
        row = bytearray(bgra[y * stride:(y + 1) * stride])
        row[0::4], row[2::4] = row[2::4], row[0::4]
        row[3::4] = b'\xff' * w
        rows += b'\x00' + row

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(bytes(rows), 6)) + chunk(b'IEND', b''))


class BMI(ctypes.Structure):
    _fields_ = [('biSize', wt.DWORD), ('biWidth', wt.LONG), ('biHeight', wt.LONG), ('biPlanes', wt.WORD),
                ('biBitCount', wt.WORD), ('biCompression', wt.DWORD), ('biSizeImage', wt.DWORD),
                ('biXPelsPerMeter', wt.LONG), ('biYPelsPerMeter', wt.LONG), ('biClrUsed', wt.DWORD),
                ('biClrImportant', wt.DWORD)]


def capture(hwnd, path):
    r = wt.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    w, h = r.right - r.left, r.bottom - r.top
    if w <= 0 or h <= 0:
        return False, w, h
    hdc = user32.GetWindowDC(hwnd)
    mem = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    gdi32.SelectObject(mem, bmp)
    ok = user32.PrintWindow(hwnd, mem, 2)  # PW_RENDERFULLCONTENT: the composited (GPU) content
    bmi = BMI(ctypes.sizeof(BMI), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bmi), 0)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(hwnd, hdc)
    png(path, w, h, buf.raw)
    return ok, w, h


class GUID(ctypes.Structure):
    _fields_ = [('d1', wt.DWORD), ('d2', wt.WORD), ('d3', wt.WORD), ('d4', ctypes.c_ubyte * 8)]


class PROPERTYKEY(ctypes.Structure):
    _fields_ = [('fmtid', GUID), ('pid', wt.DWORD)]


class PROPVARIANT(ctypes.Structure):
    _fields_ = [('vt', ctypes.c_ushort), ('r1', ctypes.c_ushort), ('r2', ctypes.c_ushort), ('r3', ctypes.c_ushort),
                ('p', ctypes.c_void_p), ('p2', ctypes.c_void_p)]


def window_aumid(hwnd):
    """System.AppUserModel.ID set on the window (what the taskbar groups by), or a note if unset."""
    try:
        iid = GUID(0x886D8EEB, 0x8CF2, 0x4446, (ctypes.c_ubyte * 8)(0x8D, 0x02, 0xCD, 0xBA, 0x1D, 0xBD, 0xCF, 0x99))
        key = PROPERTYKEY(GUID(0x9F4C2855, 0x9F79, 0x4B39, (ctypes.c_ubyte * 8)(0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3)), 5)
        ps = ctypes.c_void_p()
        fn = ctypes.windll.shell32.SHGetPropertyStoreForWindow
        fn.argtypes = [wt.HWND, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)]
        fn.restype = ctypes.c_long
        if fn(hwnd, ctypes.byref(iid), ctypes.byref(ps)) != 0 or not ps:
            return '(no property store)'
        vtbl = ctypes.cast(ctypes.cast(ps, ctypes.POINTER(ctypes.c_void_p))[0], ctypes.POINTER(ctypes.c_void_p))
        get_value = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(PROPERTYKEY), ctypes.POINTER(PROPVARIANT))(vtbl[5])
        release = ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtbl[2])
        pv = PROPVARIANT()
        hr = get_value(ps, ctypes.byref(key), ctypes.byref(pv))
        val = '(unset)'
        if hr in (0, 1) and pv.vt == 31 and pv.p:  # VT_LPWSTR (cross-process reads return S_FALSE)
            val = ctypes.wstring_at(pv.p)
        release(ps)
        return val
    except Exception as e:
        return '(error %s)' % e


def window_title(hwnd):
    buf = ctypes.create_unicode_buffer(512)
    user32.GetWindowTextW(hwnd, buf, 512)
    return buf.value


def dump_window_icon(hwnd, path, size=64):
    """Draw the window's big icon (WM_GETICON, else the class icon) into a PNG. Returns its source."""
    user32.SendMessageW.restype = ctypes.c_void_p
    user32.SendMessageW.argtypes = [wt.HWND, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
    hicon = user32.SendMessageW(hwnd, 0x7F, 1, 0)  # WM_GETICON, ICON_BIG
    src = 'window icon'
    if not hicon:
        user32.GetClassLongPtrW.restype = ctypes.c_void_p
        user32.GetClassLongPtrW.argtypes = [wt.HWND, ctypes.c_int]
        hicon = user32.GetClassLongPtrW(hwnd, -14)  # GCLP_HICON
        src = 'class icon'
    if not hicon:
        return 'no icon'
    hdc = user32.GetDC(0)
    mem = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, size, size)
    gdi32.SelectObject(mem, bmp)
    brush = gdi32.CreateSolidBrush(0x00FFFFFF)
    rect = wt.RECT(0, 0, size, size)
    user32.FillRect(mem, ctypes.byref(rect), brush)
    user32.DrawIconEx.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_int,
                                  ctypes.c_int, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
    user32.DrawIconEx(mem, 0, 0, hicon, size, size, 0, None, 3)
    bmi = BMI(ctypes.sizeof(BMI), size, -size, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(size * size * 4)
    gdi32.GetDIBits(mem, bmp, 0, size, buf, ctypes.byref(bmi), 0)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteObject(brush)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(0, hdc)
    png(path, size, size, buf.raw)
    return src


def shoot(hwnd, out, name, identity):
    ok, w, h = capture(hwnd, os.path.join(out, name + '.png'))
    line = '[capture] %s.png %dx%d ok=%s' % (name, w, h, bool(ok))
    if identity:
        src = dump_window_icon(hwnd, os.path.join(out, name + '.icon.png'))
        line += ' title=%r taskbar-id=%r %s -> %s.icon.png' % (window_title(hwnd), window_aumid(hwnd), src, name)
    print(line)


# ---- profile ------------------------------------------------------------------------------------

def is_junction(path):
    try:
        return os.path.isjunction(path)
    except AttributeError:  # Python < 3.12
        return bool(os.path.isdir(path) and os.lstat(path).st_file_attributes & 0x400)


def remove_profile(profile):
    """Delete a throwaway profile. The --app junction inside it is unlinked first so the build
    folder it points at is never touched."""
    link = os.path.join(profile, 'chrome', 'vitre-app')
    if is_junction(link):
        os.rmdir(link)
    if os.path.lexists(link):
        raise SystemExit('refusing to delete %s: %s is not a junction' % (profile, link))
    shutil.rmtree(profile, ignore_errors=True)


def link_app(profile, build):
    link = os.path.join(profile, 'chrome', 'vitre-app')
    os.makedirs(os.path.dirname(link), exist_ok=True)
    if is_junction(link):
        os.rmdir(link)
    r = subprocess.run(['cmd', '/c', 'mklink', '/J', link, build], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit('mklink failed: ' + (r.stderr or r.stdout))
    return link


def pref_value(text):
    if text in ('true', 'false'):
        return text == 'true'
    if re.fullmatch(r'-?\d+', text):
        return int(text)
    return text  # includes decimals: Gecko has no float prefs, they are strings (layout.css.devPixelsPerPx)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--test', '--boot', dest='test')
    ap.add_argument('--name', required=True)
    ap.add_argument('--url', default='about:blank')
    ap.add_argument('--out')
    ap.add_argument('--app')
    ap.add_argument('--timeout', type=float, default=90)
    ap.add_argument('--pref', action='append', default=[])
    ap.add_argument('--env', action='append', default=[])
    ap.add_argument('--arg', action='append', default=[], help='extra runtime argument')
    ap.add_argument('--shoot', action='append', default=[], help='NAME:SECONDS')
    ap.add_argument('--keep-profile', action='store_true')
    ap.add_argument('--stock', action='store_true')
    ap.add_argument('--identity', action='store_true')
    ap.add_argument('--until-exit', action='store_true')
    ap.add_argument('--exe', default='vitre.exe')
    a = ap.parse_args()

    if not re.fullmatch(r'[\w.-]+', a.name):
        raise SystemExit('--name may only contain letters, digits, ".", "_" and "-"')
    if not a.test and not a.shoot:
        raise SystemExit('give --test SCRIPT, or --shoot NAME:SECONDS to run without a script')
    exe = os.path.join(RUNTIME, os.path.basename(a.exe))
    if not os.path.exists(exe) or not os.path.exists(os.path.join(RUNTIME, 'config.js')):
        raise SystemExit('the runtime is not wired for Vitre: run  python tools/setup-runtime.py')
    # A control run under another image name follows and stops that image too, and only then: it is
    # still limited to the processes that descend from the one started here.
    IMAGES.add(os.path.basename(exe).lower())

    test = os.path.abspath(a.test) if a.test else None
    if test and not os.path.exists(test):
        raise SystemExit('no such test script: ' + test)
    out = os.path.abspath(a.out or os.path.join(os.path.dirname(test) if test else ROOT, 'out'))
    os.makedirs(out, exist_ok=True)
    profile = os.path.join(tempfile.gettempdir(), 'vitre-gecko-' + a.name)

    kill(stale_pids(profile))
    if not a.keep_profile and os.path.exists(profile):
        remove_profile(profile)
    os.makedirs(profile, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith('.done'):
            os.remove(os.path.join(out, f))

    prefs = dict(PREFS)
    # What Deer downloads for the person (ffmpeg, yt-dlp, Deno) lives in %LOCALAPPDATA%\Deer, older
    # copies in %LOCALAPPDATA%\Vitre: a test looks in a folder inside its own profile instead, so it
    # never reads the person's real copies (src/modules/downloads/ffmpeg-install.ts).
    prefs['vitre.localAppData'] = os.path.join(profile, 'LocalAppData')
    for p in a.pref:
        k, v = p.split('=', 1)
        prefs[k] = pref_value(v)
    with open(os.path.join(profile, 'user.js'), 'w', encoding='utf-8') as f:
        for k, v in prefs.items():
            f.write('user_pref(%s, %s);\n' % (json.dumps(k), json.dumps(v)))
    # config.js honours VITRE_BOOT / VITRE_LIB / VITRE_APP_DIR only in a profile that carries this marker.
    open(os.path.join(profile, 'vitre-harness'), 'w').close()

    log = os.path.join(out, 'log.txt')
    open(log, 'w').close()
    env = dict(os.environ, VITRE_LOG=log, VITRE_OUT=out, VITRE_ALLOW_ANY_PROFILE='1',
               MOZ_CRASHREPORTER_DISABLE='1', MOZ_DISABLE_AUTO_SAFE_MODE='1')
    for name in ('VITRE_BOOT', 'VITRE_LIB', 'VITRE_APP_DIR', 'VITRE_DISABLE'):
        env.pop(name, None)
    if test:
        env.update(VITRE_BOOT=test, VITRE_LIB=os.path.join(ROOT, 'tools', 'spike-lib.js'))
    if a.stock:
        env['VITRE_DISABLE'] = '1'
    if a.app:
        build = os.path.abspath(os.path.join(ROOT, a.app))
        if not os.path.exists(os.path.join(build, 'chrome.manifest')):
            raise SystemExit('no chrome.manifest in %s (run: node tools/build.mjs --out=%s)' % (build, a.app))
        env['VITRE_APP_DIR'] = link_app(profile, build)
    elif not a.stock and not os.path.exists(os.path.join(RUNTIME, 'vitre', 'chrome.manifest')):
        raise SystemExit('nothing built: run  node tools/build.mjs')
    for e in a.env:
        k, v = e.split('=', 1)
        env[k] = v

    shots = sorted(((float(s.rsplit(':', 1)[1]), s.rsplit(':', 1)[0]) for s in a.shoot))
    started = time.time()
    proc = subprocess.Popen([exe, '-no-remote', '-profile', profile, *a.arg, a.url], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tree = Tree(proc.pid)
    seen = 0
    failed = 0
    deadline = started + a.timeout
    quit_seen = False
    last_poll = 0.0
    try:
        while time.time() < deadline and not quit_seen:
            time.sleep(0.1)
            now = time.time()
            if now - last_poll > 0.5:
                last_poll = now
                tree.alive()
            while shots and now - started >= shots[0][0]:
                _at, name = shots.pop(0)
                hwnd = find_window(tree.alive())
                if hwnd:
                    shoot(hwnd, out, name, a.identity)
                else:
                    print('[capture] %s: no window found' % name)
                    failed += 1
            if not test:
                if not shots:
                    quit_seen = True
                continue
            with open(log, encoding='utf-8', errors='replace') as f:
                lines = f.read().split('\n')[:-1]
            for line in lines[seen:]:
                if line.startswith('@@capture '):
                    parts = line[10:].split()
                    name = parts[0]
                    hwnd = int(parts[1], 16) if len(parts) > 1 else None
                    if not hwnd or not user32.IsWindow(hwnd):
                        hwnd = find_window(tree.alive())
                    if hwnd:
                        shoot(hwnd, out, name, a.identity)
                    else:
                        print('[capture] %s: no window found' % name)
                        failed += 1
                    open(os.path.join(out, name + '.png.done'), 'w').close()
                elif line.startswith('@@modules '):
                    text = line[10:].strip()
                    pids = tree.alive()
                    found = loaded_modules(pids, text, os.path.basename(exe))
                    print('[modules] "%s" in %d %s processes: %s' % (
                        text, len(pids), os.path.basename(exe), ', '.join('%s (pid %s)' % (d, '/'.join(map(str, p))) for d, p in sorted(found.items())) or 'none loaded'))
                    open(os.path.join(out, 'modules.done'), 'w').close()
                elif line.startswith('@@quit'):
                    quit_seen = True
                else:
                    if re.match(r'(FAIL|ERROR)\b', line):
                        failed += 1
                    print(line)
            seen = len(lines)
            if a.until_exit and seen and not quit_seen and not tree.alive():
                # Lines written just before the exit, after the read above.
                with open(log, encoding='utf-8', errors='replace') as f:
                    rest = f.read().split('\n')[:-1][seen:]
                for line in rest:
                    if re.match(r'(FAIL|ERROR)\b', line):
                        failed += 1
                    if not line.startswith('@@'):
                        print(line)
                print('[run] the runtime exited by itself')
                quit_seen = True
        if not quit_seen:
            print('[run] timed out after %ss' % a.timeout)
            failed += 1
    finally:
        time.sleep(0.5)
        kill(tree.alive())
        proc.poll()
        if not a.keep_profile:
            # A used profile is about 280 MB; hundreds of runs fill the disk.
            time.sleep(0.5)
            remove_profile(profile)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
