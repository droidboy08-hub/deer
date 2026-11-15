"""Windows half of the test harness behind tools/run.py: the runtime's processes (Toolhelp,
taskkill), its windows and captures (user32/gdi32 PrintWindow), the taskbar id and window icon for
--identity, and the --app junction.

Everything from "RUNTIME =" to link_app() is tools/run.py's Win32 code as it was before the macOS
port, moved here unchanged. The adapters at the end are what harness/common.py's main() calls; they
hold the few Windows lines that used to sit inside main(). Imported only on Windows (harness.backend()),
so none of this runs anywhere else.
"""
import ctypes
import ctypes.wintypes as wt
import json
import os
import re
import shutil
import subprocess
import tempfile

from .common import PREFS, ROOT, png  # noqa: F401  (PREFS and png are re-exported by tools/run.py)

RUNTIME = os.path.join(ROOT, 'runtime')
VITRE = os.path.join(RUNTIME, 'vitre.exe')
# Images that belong to the runtime. Only these are ever followed or stopped; never firefox.exe.
IMAGES = {'vitre.exe', 'crashhelper.exe', 'plugin-container.exe', 'pingsender.exe', 'crashreporter.exe'}

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

    def adopt(self, pid):
        """A runtime process the script reported itself (@@pid): followed from now on, with its children."""
        try:
            self.known.add(int(pid))
        except ValueError:
            pass

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


# ---- adapters for harness/common.py main() ----------------------------------------------------
# The Windows lines of the old run.py main(), unchanged in what they do.

PLATFORM = 'win'
# The chrome package the runtime loads when --app is not given (a junction to build/).
PACKAGE = os.path.join(RUNTIME, 'vitre')
# Variables removed from the runtime's environment besides the harness's own: none on Windows.
CLEAR_ENV = ()


def engine(a):
    """The runtime to start for these arguments (--exe picks another image in runtime/)."""
    exe = os.path.join(RUNTIME, os.path.basename(a.exe))
    if not os.path.exists(exe) or not os.path.exists(os.path.join(RUNTIME, 'config.js')):
        raise SystemExit('the runtime is not wired for Vitre: run  python tools/setup-runtime.py')
    # A control run under another image name follows and stops that image too, and only then: it is
    # still limited to the processes that descend from the one started here.
    IMAGES.add(os.path.basename(exe).lower())
    return exe


def temp_dir():
    return tempfile.gettempdir()


def command(exe, profile, args, url):
    return [exe, '-no-remote', '-profile', profile, *args, url]


def preflight():
    """Nothing to check before a capture on Windows (macOS checks the Screen Recording permission)."""


def window_handle(text):
    """The window a @@capture line names: spike-lib sends the HWND in hex."""
    return int(text, 16)


def is_window(hwnd, tree):
    return user32.IsWindow(hwnd)


def crash(pids):
    """@@kill: every runtime process of the run ends at once, with no shutdown (taskkill /F)."""
    kill(pids)


def raise_window(hwnd):
    """Keep the window on top without activating it (a run without the harness prefs stops painting
    while covered): HWND_TOPMOST, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE."""
    user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
