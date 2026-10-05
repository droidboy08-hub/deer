"""End-to-end test of Deer's installer, launcher and uninstaller, safe to run on a developer machine.

  python installer/test.py [--setup <Deer-Setup*.exe>] [--keep] [--no-gui] [--root <dir inside %TEMP%>]

Uses the setup named in installer/out/build.json (python installer/build.py --dev-engine makes one;
a release build from --engine works too).
Everything happens in test mode: the install goes to <root>\\Programs\\Deer, registry entries under
HKCU\\Software\\DeerTest, shortcuts into <root>\\Shortcuts, the data folder is <root>\\Data and Deer runs
on the throwaway profile Data\\Profile. <root> is %TEMP%\\deer-installer-test unless --root names another
folder inside %TEMP% (for example one with spaces, an apostrophe, parentheses, "&", "!" and non-ASCII
letters, as user names and folder names can have).
<root>\\Roaming, <root>\\Local and <root>\\Temp stand in for %APPDATA%, %LOCALAPPDATA% and %TEMP% wherever
the installed Deer.exe and the uninstaller would use the person's own folders (DEER_TEST_APPDATA,
DEER_TEST_LOCALAPPDATA, DEER_TEST_TEMP: honoured only by a test install). Pages are local files.
Nothing is registered as a browser in the real keys, the default browser is not touched, no shortcut
is made in the real Start menu or on the real desktop, %LOCALAPPDATA%\\Deer, %APPDATA%\\Deer and
%LOCALAPPDATA%\\Vitre are never used.

Phases
  0. snapshots of what must not change: the real Deer keys (HKCU and, read only, HKLM), the real Start
     menu and desktop (the person's and the common ones), the user's .html OpenWithProgids,
     HKCU\\Software\\Mozilla, %APPDATA%\\Mozilla (and the content of Firefox's profiles.ini /
     installs.ini), %LOCALAPPDATA%\\Mozilla, %ProgramData%\\Mozilla-*, %LOCALAPPDATA%\\Deer,
     %LOCALAPPDATA%\\Programs\\Deer, %ProgramFiles%\\Deer, the per-user AppUserModelId and CLSID keys,
     Windows' notification settings and the \\Mozilla\\ scheduled tasks
  0b. the payload decoder (tests/lzma_roundtrip.py): synthetic LZMA / BCJ streams, damaged input, and
     the real payload (installer/work/payload.bin) unpacked by the C# decoder against the release folder
  1. wizard install and wizard uninstall, driven through their buttons (screenshots in tests/out/)
  2. refusals (relative folder, outside %TEMP%, folder path too long, damaged payload, a setup mutex
     this account may not open: exit 9, not a crash), then a
     silent install with a desktop shortcut: files, every registry value, shortcuts (target,
     arguments, AppUserModelID), version resource and icon of Deer.exe
  3. the installed Deer.exe on the throwaway profile: engine and chrome package loaded from the install,
     marker and build stamp, -purgecaches once, window, URL hand-off through -osint, rejected -osint
     shapes, the "files missing" message; setup and uninstall refuse while Deer runs
  3c. the installed Deer.exe's default profile: a test install without a stand-in starts on its own
     test data profile; with <root>\\Local as %LOCALAPPDATA% the old profile Local\\Vitre\\Profile is
     copied to Local\\Deer\\Profile, but not while a browser runs on it (the page goes to that browser,
     nothing is copied) and on the next start once it closed; XUL_APP_FILE, XRE_PROFILE_PATH and
     XRE_PROFILE_LOCAL_PATH in the caller's environment change nothing, and with MOZ_NEW_INSTANCE there
     too a second start still hands its page over. The copy rules themselves: tests/migration.py (run
     as phase 0c)
  4. update over an older version (stale files go, the desktop shortcut stays), downgrade refused and
     allowed, unusable folders, /testkeys refusing to remove a normal install
  5. silent uninstall keeping the data: nothing left (files, shortcuts, registry, Deer's updater's
     downloads in Local\\Deer\\updates (a file of another kind there stays), the engine's own
     per-install traces under HKCU\\Software\\Mozilla, HKCU\\Software\\Deer and %ProgramData%, its
     toast-notification registration, which this test plants because the engine writes it only once it
     shows a toast, and, planted the same way in the stand-ins: the file the "|Blocklist" value names,
     %TEMP%\\MozillaBackgroundTask-<hash>-*, stale SkeletonUILock-*, a bare start's installs.ini /
     profiles.ini sections and the profile they name), while other installs' entries, a profile Deer
     used and a busy deerapp-temp-files stay
  6. install, update with /wait while Deer runs (a second setup meanwhile is refused; the setup mutex
     grants Administrators wait and release), then Deer-Setup.exe /uninstall /removedata: the data
     folder goes too, and so does every Deer folder in the stand-ins once nothing else is in them
  7. /update (what Deer's updater runs): nothing installed (exit 10), Deer closed (installs, does not
     start Deer), Deer running (waits, installs, starts Deer again on the same profile, data kept),
     /norestart, /launch with Deer already closed (starts it), a newer version installed (exit 6), and
     "Restart to update" stopping early with /launch: Deer is started again after exit 4 (a setup file
     whose SHA-256 is not /sha256's; with the right one it installs), 6 (a newer version installed) and
     9 (another setup kept running past /wait); /update waits for another setup instead of exiting 9 at
     once, and installs nothing when that setup installed this version meanwhile
  8. install for all users in test mode: the step that needs administrator rights runs as a plain
     child process (never UAC), registry under HKCU\\Software\\DeerTestMachine (standing in for
     HKLM\\Software), "All Users" shortcuts; a just-for-me install is refused meanwhile; /update of it
     with /sha256 (restarts Deer as the person; while the elevated step runs, the setup file it was
     started from cannot be renamed or written); its uninstaller hands over to an elevated copy too; the wizard's
     "All users of this computer" choice. Nothing is written to HKLM or %ProgramFiles%.
  9. the snapshots of phase 0 are unchanged
Exit code 1 if any check fails.
"""
import argparse
import ctypes
import ctypes.wintypes as wt
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.parse
import uuid
import winreg
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
GECKO = os.path.dirname(HERE)
OUT = os.path.join(HERE, 'tests', 'out')
WORK = os.path.join(HERE, 'work')
DEFAULT_ROOT = os.path.join(tempfile.gettempdir(), 'deer-installer-test')
# What a test root may already contain: only what an earlier (aborted) run of this test leaves there.
ROOT_ENTRIES = {'Programs', 'ProgramFiles', 'Shortcuts', 'Data', 'Broken', 'NotEmpty', 'NormalInstall', 'bogus-profile', 'Elsewhere', 'damaged',
                'Roaming', 'Local', 'Temp', 'Pages', 'xre-elsewhere'}
TEST = INSTALL = LINKS = DATA = PROFILE = START_LNK = DESKTOP_LNK = ROAMING = LOCAL_STAND = TEMP_STAND = PAGES = None


def set_root(root):
    global TEST, INSTALL, LINKS, DATA, PROFILE, START_LNK, DESKTOP_LNK, ROAMING, LOCAL_STAND, TEMP_STAND, PAGES
    TEST = root
    INSTALL = os.path.join(TEST, 'Programs', 'Deer')
    LINKS = os.path.join(TEST, 'Shortcuts')
    DATA = os.path.join(TEST, 'Data')
    PROFILE = os.path.join(DATA, 'Profile')
    START_LNK = os.path.join(LINKS, 'Start Menu', 'Programs', 'Deer.lnk')
    DESKTOP_LNK = os.path.join(LINKS, 'Desktop', 'Deer.lnk')
    # Stand-ins for the person's %APPDATA%, %LOCALAPPDATA% and %TEMP% (see the docstring).
    ROAMING = os.path.join(TEST, 'Roaming')
    LOCAL_STAND = os.path.join(TEST, 'Local')
    TEMP_STAND = os.path.join(TEST, 'Temp')
    PAGES = os.path.join(TEST, 'Pages')


def page(name):
    """A local page (no network) whose name shows up in the launch probe's TABS lines."""
    p = os.path.join(PAGES, name + '.html')
    os.makedirs(PAGES, exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write('<!doctype html><title>%s</title><p>%s</p>' % (name, name))
    return p


set_root(DEFAULT_ROOT)
TEST_ROOT = r'Software\DeerTest'
TEST_MACHINE_ROOT = r'Software\DeerTestMachine'  # the all-users test root (stands in for HKLM\Software)
AUMID_ROOT = r'Software\Classes\AppUserModelId'
CLSID_ROOT = r'Software\Classes\CLSID'
NOTIFY_ROOT = r'Software\Microsoft\Windows\CurrentVersion\Notifications\Settings'
planted = []  # registry keys this test created outside HKCU\Software\DeerTest (removed at the end in any case)
planted_values = []  # (key, value name) planted in keys that are not the test's own
planted_files = []  # files planted outside the test folder
LOCAL = os.environ['LOCALAPPDATA']
UPDATE_ROOT = os.path.join(os.environ.get('ProgramData', r'C:\ProgramData'), 'Mozilla-1de4eec8-1241-4177-a864-e594e8d1fb38')
DEER_UPDATE_ROOT = os.path.join(os.environ.get('ProgramData', r'C:\ProgramData'), 'Deer-Engine-1de4eec8-1241-4177-a864-e594fb38')

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
kernel32 = ctypes.windll.kernel32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass

failed = 0
notes = []


def check(name, ok, detail=''):
    global failed
    failed += 0 if ok else 1
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(detail) if detail not in ('', None) else ''), flush=True)
    return ok


def note(text):
    notes.append(text)
    print('NOTE ' + text, flush=True)


def section(title):
    print('\n---- ' + title, flush=True)


# ---- registry -------------------------------------------------------------------------------------

def reg_open(path):
    try:
        return winreg.OpenKey(winreg.HKEY_CURRENT_USER, path)
    except OSError:
        return None


def reg_exists(path):
    k = reg_open(path)
    if k:
        winreg.CloseKey(k)
    return k is not None


def reg_values(path):
    k = reg_open(path)
    if not k:
        return None
    out = {}
    i = 0
    while True:
        try:
            name, value, kind = winreg.EnumValue(k, i)
        except OSError:
            break
        out[name] = (value, kind)
        i += 1
    winreg.CloseKey(k)
    return out


def reg_tree(path):
    """{relative key path: {value: (data, type)}} for the key and everything under it, or None."""
    k = reg_open(path)
    if not k:
        return None
    out = {'': reg_values(path)}
    i = 0
    subs = []
    while True:
        try:
            subs.append(winreg.EnumKey(k, i))
        except OSError:
            break
        i += 1
    winreg.CloseKey(k)
    for s in subs:
        for rel, vals in (reg_tree(path + '\\' + s) or {}).items():
            out[s + ('\\' + rel if rel else '')] = vals
    return out


def reg_delete_tree(path):
    k = reg_open(path)
    if not k:
        return
    subs = []
    i = 0
    while True:
        try:
            subs.append(winreg.EnumKey(k, i))
        except OSError:
            break
        i += 1
    winreg.CloseKey(k)
    for s in subs:
        reg_delete_tree(path + '\\' + s)
    winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path)


def hklm_tree(path):
    """Like reg_tree, for HKLM (64-bit view), read only."""
    try:
        k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path, 0, winreg.KEY_READ | winreg.KEY_WOW64_64KEY)
    except OSError:
        return None
    out, i, subs = {'': {}}, 0, []
    while True:
        try:
            name, value, kind = winreg.EnumValue(k, i)
        except OSError:
            break
        out[''][name] = (value, kind)
        i += 1
    i = 0
    while True:
        try:
            subs.append(winreg.EnumKey(k, i))
        except OSError:
            break
        i += 1
    winreg.CloseKey(k)
    for sub in subs:
        for rel, vals in (hklm_tree(path + '\\' + sub) or {}).items():
            out[sub + ('\\' + rel if rel else '')] = vals
    return out


def reg_set(path, name, value):
    k = winreg.CreateKey(winreg.HKEY_CURRENT_USER, path)
    winreg.SetValueEx(k, name, 0, winreg.REG_SZ, value)
    winreg.CloseKey(k)


def reg_names(path):
    """The names of the subkeys of `path` (a set; empty when the key is absent)."""
    k = reg_open(path)
    if not k:
        return set()
    out, i = set(), 0
    while True:
        try:
            out.add(winreg.EnumKey(k, i))
        except OSError:
            break
        i += 1
    winreg.CloseKey(k)
    return out


def ps(script, timeout=60):
    """Runs a PowerShell snippet; its output is read as UTF-8 (paths may hold any letter)."""
    r = subprocess.run(['powershell', '-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + script],
                       capture_output=True, timeout=timeout)
    return r.stdout.decode('utf-8', 'replace')


def ps_quote(text):
    return "'" + text.replace("'", "''") + "'"


# ---- setup's "one setup at a time" mutex ------------------------------------------------------------

GATE = 'Local\\Deer.Setup'


class _SecurityAttributes(ctypes.Structure):
    _fields_ = [('nLength', wt.DWORD), ('lpSecurityDescriptor', ctypes.c_void_p), ('bInheritHandle', wt.BOOL)]


def foreign_gate():
    """Creates setup's mutex with a DACL that gives this account nothing: how a gate made by an elevated
    copy running under ANOTHER account (UAC with an administrator's password) looks to the person's own
    setup. Returns (handle, whether the mutex existed already); close the handle with gate_close."""
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    adv = ctypes.WinDLL('advapi32', use_last_error=True)
    k32.CreateMutexW.restype = wt.HANDLE
    k32.CreateMutexW.argtypes = [ctypes.c_void_p, wt.BOOL, wt.LPCWSTR]
    sd = ctypes.c_void_p()
    if not adv.ConvertStringSecurityDescriptorToSecurityDescriptorW('D:(A;;GA;;;SY)', 1, ctypes.byref(sd), None):
        return None, False
    try:
        sa = _SecurityAttributes(ctypes.sizeof(_SecurityAttributes), sd, False)
        h = k32.CreateMutexW(ctypes.byref(sa), False, GATE)
        return h, ctypes.get_last_error() == 183  # ERROR_ALREADY_EXISTS
    finally:
        k32.LocalFree(sd)


def gate_close(h):
    if h:
        ctypes.windll.kernel32.CloseHandle(wt.HANDLE(h))


def gate_sddl():
    """The DACL of the mutex a running setup holds, as SDDL ('' when none is held)."""
    return ps("try { [System.Threading.Mutex]::OpenExisting('%s', [System.Security.AccessControl.MutexRights]::ReadPermissions)"
              ".GetAccessControl().GetSecurityDescriptorSddlForm('Access') } catch { '' }" % GATE).strip()


# ---- files ----------------------------------------------------------------------------------------

def listing(root, depth):
    """{relative path: (is dir, size, mtime)} down to `depth` levels, or {} when absent. Metadata only."""
    out = {}
    if not os.path.isdir(root):
        return out

    def walk(folder, level):
        try:
            entries = list(os.scandir(folder))
        except OSError:
            return
        for e in entries:
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            rel = os.path.relpath(e.path, root)
            out[rel] = (e.is_dir(follow_symlinks=False), 0 if e.is_dir(follow_symlinks=False) else st.st_size, int(st.st_mtime))
            if e.is_dir(follow_symlinks=False) and level < depth:
                walk(e.path, level + 1)
    walk(root, 1)
    return out


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def rmtree(path):
    if os.path.exists(path):
        shutil.rmtree(path, ignore_errors=True)


def read_ini(path):
    d = {}
    try:
        for line in open(path, encoding='utf-8-sig', errors='replace'):
            if '=' in line and not line.lstrip().startswith((';', '[')):
                k, v = line.split('=', 1)
                d[k.strip()] = v.strip()
    except OSError:
        pass
    return d


def set_ini(path, key, value):
    lines = open(path, encoding='utf-8').read().splitlines()
    lines = [key + '=' + value if l.startswith(key + '=') else l for l in lines]
    open(path, 'w', encoding='utf-8').write('\r\n'.join(lines) + '\r\n')


# ---- processes and windows ------------------------------------------------------------------------

class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [('dwSize', wt.DWORD), ('cntUsage', wt.DWORD), ('th32ProcessID', wt.DWORD),
                ('th32DefaultHeapID', ctypes.c_size_t), ('th32ModuleID', wt.DWORD), ('cntThreads', wt.DWORD),
                ('th32ParentProcessID', wt.DWORD), ('pcPriClassBase', wt.LONG), ('dwFlags', wt.DWORD),
                ('szExeFile', wt.WCHAR * 260)]


def processes():
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


def image_path(pid):
    kernel32.OpenProcess.restype = wt.HANDLE
    h = kernel32.OpenProcess(0x1000, False, pid)
    if not h:
        return ''
    try:
        buf = ctypes.create_unicode_buffer(1024)
        size = wt.DWORD(1024)
        if kernel32.QueryFullProcessImageNameW(wt.HANDLE(h), 0, buf, ctypes.byref(size)):
            return buf.value
        return ''
    finally:
        kernel32.CloseHandle(wt.HANDLE(h))


def pids_from(folder):
    """{pid: image path} of processes whose program lies inside `folder`."""
    prefix = os.path.normcase(os.path.abspath(folder)) + os.sep
    out = {}
    for pid, _ppid, _name in processes():
        p = image_path(pid)
        if p and os.path.normcase(p).startswith(prefix):
            out[pid] = p
    return out


def command_lines(image):
    script = ("Get-CimInstance Win32_Process -Filter \"Name='%s'\" | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress" % image)
    try:
        raw = ps(script)
        rows = json.loads(raw) if raw.strip() else []
    except Exception:
        return {}
    if isinstance(rows, dict):
        rows = [rows]
    return {r['ProcessId']: (r.get('ParentProcessId'), r.get('CommandLine') or '') for r in rows}


def kill_tree(pids):
    for pid in pids:
        subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True)


EnumProc = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)


def window_text(hwnd):
    buf = ctypes.create_unicode_buffer(1024)
    user32.GetWindowTextW(hwnd, buf, 1024)
    return buf.value


def window_class(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def top_windows(pids):
    found = []

    @EnumProc
    def each(hwnd, _):
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True
    user32.EnumWindows(each, 0)
    return found


def children(hwnd):
    found = []

    @EnumProc
    def each(h, _):
        found.append(h)
        return True
    user32.EnumChildWindows(hwnd, each, 0)
    return found


def wait_for(fn, timeout, step=0.25):
    end = time.time() + timeout
    while True:
        v = fn()
        if v:
            return v
        if time.time() > end:
            return v
        time.sleep(step)


def wizard_window(pid, timeout=30):
    return wait_for(lambda: next((h for h in top_windows({pid}) if window_class(h).startswith('WindowsForms10.Window')), None), timeout)


def control(hwnd, text):
    for h in children(hwnd):
        if window_text(h) == text and user32.IsWindowVisible(h):
            return h
    return None


def press(button):
    """Click a native (FlatStyle.System) button or checkbox: the BN_CLICKED its parent would get."""
    user32.PostMessageW.argtypes = [wt.HWND, ctypes.c_uint, wt.WPARAM, wt.LPARAM]
    parent = user32.GetParent(button)
    ident = user32.GetDlgCtrlID(button)
    user32.PostMessageW(parent, 0x0111, ident & 0xFFFF, button)  # WM_COMMAND, BN_CLICKED (0) << 16


def checked(box):
    user32.SendMessageW.restype = ctypes.c_ssize_t
    user32.SendMessageW.argtypes = [wt.HWND, ctypes.c_uint, wt.WPARAM, wt.LPARAM]
    return user32.SendMessageW(box, 0x00F0, 0, 0) == 1  # BM_GETCHECK


def body_text(hwnd):
    return ' | '.join(t for t in (window_text(h) for h in children(hwnd)) if t)


class BMI(ctypes.Structure):
    _fields_ = [('biSize', wt.DWORD), ('biWidth', wt.LONG), ('biHeight', wt.LONG), ('biPlanes', wt.WORD),
                ('biBitCount', wt.WORD), ('biCompression', wt.DWORD), ('biSizeImage', wt.DWORD),
                ('biXPelsPerMeter', wt.LONG), ('biYPelsPerMeter', wt.LONG), ('biClrUsed', wt.DWORD),
                ('biClrImportant', wt.DWORD)]


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


def capture(hwnd, name):
    r = wt.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    w, h = r.right - r.left, r.bottom - r.top
    if w <= 0 or h <= 0:
        return
    hdc = user32.GetWindowDC(hwnd)
    mem = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    gdi32.SelectObject(mem, bmp)
    user32.PrintWindow(hwnd, mem, 2)
    bmi = BMI(ctypes.sizeof(BMI), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bmi), 0)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(hwnd, hdc)
    path = os.path.join(OUT, name + '.png')
    png(path, w, h, buf.raw)
    print('     [capture] %s (%dx%d)' % (os.path.relpath(path, HERE), w, h), flush=True)


class GUID(ctypes.Structure):
    _fields_ = [('d1', wt.DWORD), ('d2', wt.WORD), ('d3', wt.WORD), ('d4', ctypes.c_ubyte * 8)]


class PROPERTYKEY(ctypes.Structure):
    _fields_ = [('fmtid', GUID), ('pid', wt.DWORD)]


class PROPVARIANT(ctypes.Structure):
    _fields_ = [('vt', ctypes.c_ushort), ('r1', ctypes.c_ushort), ('r2', ctypes.c_ushort), ('r3', ctypes.c_ushort),
                ('p', ctypes.c_void_p), ('p2', ctypes.c_void_p)]


def window_aumid(hwnd):
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
    if hr in (0, 1) and pv.vt == 31 and pv.p:
        val = ctypes.wstring_at(pv.p)
    release(ps)
    return val


def shell_folder(csidl):
    buf = ctypes.create_unicode_buffer(1024)
    ctypes.windll.shell32.SHGetFolderPathW(None, csidl, None, 0, buf)
    return buf.value


def icon_count(path):
    fn = ctypes.windll.shell32.ExtractIconExW
    fn.argtypes = [wt.LPCWSTR, ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, wt.UINT]
    fn.restype = wt.UINT
    return fn(path, -1, None, None, 0)


# ---- the test -------------------------------------------------------------------------------------

def run(args, timeout=300, env=None):
    r = subprocess.run(args, timeout=timeout, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return r.returncode


def run_piped(args, env=None, timeout=120):
    """Runs `args` with its output in a pipe. Returns (exit code, seconds until it exited, whether the
    pipe reached EOF within 10 s after that): a child that inherited the pipe keeps it open."""
    import threading
    start = time.time()
    p = subprocess.Popen(args, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    eof = threading.Event()

    def drain():
        p.stdout.read()
        eof.set()
    threading.Thread(target=drain, daemon=True).start()
    try:
        code = p.wait(timeout)
    except subprocess.TimeoutExpired:
        p.kill()
        code = None
    took = time.time() - start
    return code, took, eof.wait(10)


def setup_args(extra=()):
    return ['/testkeys', '/installdir:' + INSTALL, '/shortcutdir:' + LINKS, '/datadir:' + DATA] + list(extra)


def mozilla_traces(engine):
    """Registry values the engine keyed to this engine folder: under Mozilla's names (the stock
    identity) and under Deer's (an engine with Deer's identity, tools/setup-engine.py step 8)."""
    found = []
    for base in (r'Software\Mozilla\Firefox', r'Software\Deer\EngineData'):
        for sub in ('Launcher', 'DllPrefetchExperiment', 'PreXULSkeletonUISettings', 'Default Browser Agent', 'TaskBarIDs'):
            for name in (reg_values(base + '\\' + sub) or {}):
                if name.lower().startswith(engine.lower() + '\\') or name.lower().startswith(engine.lower() + '|') or name.lower() == engine.lower():
                    found.append('HKCU\\%s\\%s : %s' % (base, sub, name))
    return found


def hash_traces(h):
    """Entries named after the engine folder's install hash (registry, %ProgramData%, %APPDATA%), under
    Mozilla's names and Deer's."""
    found = []
    for key in (r'Software\Mozilla\Firefox\Installer\%s' % h, r'Software\Deer\firefox\Installer\%s' % h, r'Software\Deer\EngineData\Installer\%s' % h):
        if reg_exists(key):
            found.append('HKCU\\' + key)
    for root in (UPDATE_ROOT, DEER_UPDATE_ROOT):
        for rel in (os.path.join('updates', h), 'UpdateLock-' + h, 'profile_count_%s.json' % h):
            if os.path.exists(os.path.join(root, rel)):
                found.append(os.path.join(root, rel))
    for folder in (os.path.join(os.environ['APPDATA'], 'Mozilla', 'Firefox'), os.path.join(os.environ['APPDATA'], 'Deer', 'EngineData'),
                   os.path.join(ROAMING, 'Deer', 'EngineData')):
        for name in ('blocklist-' + h, 'SkeletonUILock-' + h):
            if os.path.exists(os.path.join(folder, name)):
                found.append(os.path.join(folder, name))
    return found


def snapshots():
    real = {}
    for path in (r'Software\Clients\StartMenuInternet\Deer', r'Software\Classes\DeerHTML', r'Software\Classes\DeerPDF',
                 r'Software\Classes\DeerURL', r'Software\Microsoft\Windows\CurrentVersion\Uninstall\Deer',
                 r'Software\Microsoft\Windows\CurrentVersion\App Paths\Deer.exe', r'Software\Classes\.html\OpenWithProgids',
                 r'Software\Classes\.htm\OpenWithProgids', r'Software\Classes\.pdf\OpenWithProgids'):
        real[path] = reg_tree(path)
    real['RegisteredApplications'] = (reg_values(r'Software\RegisteredApplications') or {}).get('Deer')
    appdata = os.environ['APPDATA']
    firefox_ini = {}
    for name in ('profiles.ini', 'installs.ini'):  # the user's Firefox profile list: content, not only presence
        p = os.path.join(appdata, 'Mozilla', 'Firefox', name)
        firefox_ini[name] = sha256(p) if os.path.exists(p) else None
    # The engine could register Firefox's "Background Update <hash>" / "Default Browser Agent <hash>"
    # tasks (policies.json and the removed agent should stop it): the \Mozilla\ task names must not change.
    tasks = sorted(l.strip() for l in ps("Get-ScheduledTask -TaskPath '\\Mozilla\\' -ErrorAction SilentlyContinue | "
                                         "ForEach-Object { $_.TaskName }").splitlines() if l.strip())
    machine = {}
    for path in (r'SOFTWARE\Clients\StartMenuInternet\Deer', r'SOFTWARE\Classes\DeerHTML', r'SOFTWARE\Classes\DeerPDF',
                 r'SOFTWARE\Classes\DeerURL', r'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Deer',
                 r'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Deer.exe'):
        machine[path] = hklm_tree(path)
    machine['RegisteredApplications'] = ((hklm_tree(r'SOFTWARE\RegisteredApplications') or {}).get('') or {}).get('Deer')
    program_files = os.environ.get('ProgramW6432') or os.environ.get('ProgramFiles', r'C:\Program Files')
    return {
        'hklm-deer': machine,
        'programfiles-deer': listing(os.path.join(program_files, 'Deer'), 1),
        'scheduled-tasks-mozilla': tasks,
        'firefox-profiles-ini': firefox_ini,
        'classes-appusermodelid': reg_names(AUMID_ROOT),
        'classes-clsid': reg_names(CLSID_ROOT),
        'notification-settings': reg_names(NOTIFY_ROOT),
        'registry': real,
        'mozilla-registry': reg_tree(r'Software\Mozilla'),
        'start-menu': listing(shell_folder(0x02), 1),          # CSIDL_PROGRAMS
        'desktop': listing(shell_folder(0x10), 1),             # CSIDL_DESKTOPDIRECTORY
        'public-desktop': listing(shell_folder(0x19), 1),      # CSIDL_COMMON_DESKTOPDIRECTORY
        'common-start-menu': listing(shell_folder(0x17), 1),   # CSIDL_COMMON_PROGRAMS
        'appdata-mozilla': listing(os.path.join(appdata, 'Mozilla'), 3),
        'localappdata-mozilla': listing(os.path.join(LOCAL, 'Mozilla'), 3),
        'programdata-mozilla': listing(UPDATE_ROOT, 2),
        'localappdata-deer': listing(os.path.join(LOCAL, 'Deer'), 2),
        'appdata-deer': listing(os.path.join(appdata, 'Deer'), 2),
        # The development build's profile folder, names only (a running development browser changes its files).
        'localappdata-vitre': sorted(os.listdir(os.path.join(LOCAL, 'Vitre'))) if os.path.isdir(os.path.join(LOCAL, 'Vitre')) else None,
        'programs-deer': listing(os.path.join(LOCAL, 'Programs', 'Deer'), 1),
    }


def phase_gui(setup):
    section('1. wizard install and wizard uninstall')
    log = os.path.join(OUT, 'gui-setup.log')
    p = subprocess.Popen([setup] + setup_args(['/log:' + log]))
    try:
        hwnd = wizard_window(p.pid)
        if not check('wizard window opens', hwnd):
            return
        user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)  # topmost, no focus change
        time.sleep(0.8)
        capture(hwnd, 'gui-1-options')
        text = body_text(hwnd)
        check('options page: title, version, folder, desktop box', 'Install Deer' in text and 'Version ' in text and INSTALL in text and 'Create a desktop shortcut' in text, text[:300])
        if build_info.get('devEngine', True):
            check('options page says it is a local test build', 'must not be distributed' in text)
        else:
            check('options page of a release build carries no local-test warning', 'must not be distributed' not in text)
        field = next((h for h in children(hwnd) if window_class(h).startswith('WindowsForms10.EDIT')), None)
        check('install folder field shows the test folder and is read-only in test mode',
              field and window_text(field) == INSTALL and user32.GetWindowLongW(field, -16) & 0x0800, window_text(field) if field else None)  # ES_READONLY
        desktop = control(hwnd, 'Create a desktop shortcut')
        check('desktop shortcut is ticked by default', desktop and checked(desktop))
        press(desktop)  # untick: the wizard install makes no desktop shortcut
        time.sleep(0.3)
        check('desktop box can be unticked', desktop and not checked(desktop))
        press(control(hwnd, 'Install'))
        done = wait_for(lambda: control(hwnd, 'Finish'), 180)
        if not check('install runs to the finish page', done, body_text(hwnd)[:300]):
            return
        time.sleep(0.5)
        capture(hwnd, 'gui-2-done')
        default = control(hwnd, 'Make Deer your default browser\u2026')
        check('finish page offers Default apps (disabled in test mode)', default and not user32.IsWindowEnabled(default))
        start = control(hwnd, 'Start Deer now')
        check('"Start Deer now" is unticked in test mode', start and not checked(start))
        press(done)
        p.wait(30)
        check('wizard exits with 0 after Finish', p.returncode == 0, p.returncode)
    finally:
        if p.poll() is None:
            p.kill()
    check('wizard install: files and Start menu shortcut, no desktop shortcut', os.path.exists(os.path.join(INSTALL, 'engine', 'deer.exe'))
          and os.path.exists(START_LNK) and not os.path.exists(DESKTOP_LNK))
    check('wizard install: Apps & features entry (test keys)', reg_exists(TEST_ROOT + r'\Microsoft\Windows\CurrentVersion\Uninstall\Deer'))

    p = subprocess.Popen([os.path.join(INSTALL, 'Uninstall.exe'), '/log:' + os.path.join(OUT, 'gui-uninstall.log')])
    try:
        hwnd = wizard_window(p.pid)
        if not check('uninstall wizard opens', hwnd):
            return
        user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
        time.sleep(0.8)
        capture(hwnd, 'gui-3-uninstall')
        text = body_text(hwnd)
        check('uninstall page: data folder shown, data kept by default', DATA in text and 'Uninstall' in text)
        box = next((h for h in children(hwnd) if window_text(h).startswith('Also delete my Deer data')), None)
        check('"delete my data" is unticked by default', box and not checked(box))
        press(control(hwnd, 'Uninstall'))
        close = wait_for(lambda: control(hwnd, 'Close'), 120)
        if not check('uninstall runs to its last page', close, body_text(hwnd)[:300]):
            return
        time.sleep(0.5)
        capture(hwnd, 'gui-4-uninstalled')
        check('last page says the data was kept', 'was kept' in body_text(hwnd))
        press(close)
        p.wait(30)
        check('uninstall wizard exits with 0', p.returncode == 0, p.returncode)
    finally:
        if p.poll() is None:
            p.kill()
    gone = wait_for(lambda: not os.path.exists(INSTALL), 15)
    check('Uninstall.exe removed itself and the install folder', gone, os.listdir(INSTALL) if os.path.exists(INSTALL) else '')
    check('test registry root removed', not reg_exists(TEST_ROOT), reg_tree(TEST_ROOT))
    check('Start menu shortcut removed', not os.path.exists(START_LNK))


def phase_silent_install(setup, release):
    section('2. silent install with a desktop shortcut')
    # Refusals first, while nothing is installed (so no other rule could be the reason).
    code = run([setup, '/S', '/testkeys', '/installdir:Deer', '/shortcutdir:' + LINKS, '/datadir:' + DATA, '/log:' + os.path.join(OUT, 'relative.log')],
               env=dict(os.environ))
    check('a relative install folder is refused (exit 8)', code == 8 and not os.path.exists(os.path.join(os.getcwd(), 'Deer')), code)
    outside = os.path.join(WORK, 'not-in-temp')
    code = run([setup, '/S', '/testkeys', '/installdir:' + outside, '/shortcutdir:' + LINKS, '/datadir:' + DATA, '/log:' + os.path.join(OUT, 'outside-temp.log')])
    check('a test install outside %TEMP% is refused (exit 8)', code == 8 and not os.path.exists(outside), code)
    deep_top = os.path.join(TEST, 'p' * 60)
    deep = os.path.join(deep_top, 'q' * 60, 'r' * 60, 'Deer')
    code = run([setup, '/S', '/testkeys', '/installdir:' + deep, '/shortcutdir:' + LINKS, '/datadir:' + DATA, '/log:' + os.path.join(OUT, 'too-long.log')])
    check('a folder path too long for the deepest file is refused politely (exit 8, %d characters)' % len(deep),
          code == 8 and not os.path.exists(deep_top) and 'too long' in open(os.path.join(OUT, 'too-long.log'), encoding='utf-8', errors='replace').read(), code)
    damaged_dir = os.path.join(TEST, 'damaged')
    os.makedirs(damaged_dir, exist_ok=True)
    damaged = os.path.join(damaged_dir, 'Deer-Setup-damaged.exe')
    shutil.copyfile(setup, damaged)
    with open(damaged, 'r+b') as f:  # one byte in the middle of the file, which is inside the payload
        f.seek(os.path.getsize(damaged) // 2)
        byte = f.read(1)
        f.seek(-1, 1)
        f.write(bytes([byte[0] ^ 0xFF]))
    code = run([damaged, '/S', '/log:' + os.path.join(OUT, 'damaged.log')] + setup_args())
    check('a damaged setup (one payload byte changed) is refused before anything is written (exit 4)',
          code == 4 and not os.path.exists(INSTALL) and not os.path.exists(START_LNK) and
          'checksum mismatch' in open(os.path.join(OUT, 'damaged.log'), encoding='utf-8', errors='replace').read(), code)
    rmtree(damaged_dir)
    # A gate this account may not open (made by an elevated copy under another account) means another
    # setup is running: exit 9 with a log, not a crash on an unhandled UnauthorizedAccessException.
    gate, existed = foreign_gate()
    try:
        glog = os.path.join(OUT, 'foreign-gate.log')
        try:
            code = run([setup, '/S', '/log:' + glog] + setup_args(), timeout=60)
        except subprocess.TimeoutExpired:
            code = 'timeout'
        text = open(glog, encoding='utf-8', errors='replace').read() if os.path.exists(glog) else ''
        check('a setup mutex this account may not open (as an elevated copy under another account leaves it) is "another setup '
              'is running" (exit 9), not a crash', gate and not existed and code == 9 and 'cannot be opened' in text and
              text.strip().endswith('RESULT 9') and not os.path.exists(INSTALL), (code, existed, text[-300:]))
    finally:
        gate_close(gate)
    check('nothing registered by the refused runs', not reg_exists(TEST_ROOT))
    log = os.path.join(OUT, 'silent-install.log')
    t0 = time.time()
    code = run([setup, '/S', '/desktop', '/log:' + log] + setup_args())
    check('silent install exits 0', code == 0, '%s in %.1f s; log %s' % (code, time.time() - t0, log))
    check('log ends with RESULT 0', open(log, encoding='utf-8', errors='replace').read().strip().endswith('RESULT 0'))
    expected = ['Deer.exe', 'Uninstall.exe', 'release.ini', 'deer-version.json', 'install.ini', r'engine\deer.exe',
                r'engine\vitre\chrome.manifest', r'engine\vitre\modules\VitreStartup.sys.mjs', r'engine\config.js',
                r'engine\defaults\pref\vitre-prefs.js', r'engine\defaults\pref\config-prefs.js', r'engine\distribution\policies.json',
                r'engine\browser\chrome\icons\default\vitre.ico', r'engine\browser\chrome\icons\default\deer-orange.ico',
                r'engine\xul.dll', r'engine\browser\omni.ja', 'LICENSE.txt', 'THIRD-PARTY-NOTICES.txt']
    if build_info.get('engineSigFiles', True):
        expected.append(r'engine\deer.exe.sig')  # the engine's firefox.exe.sig under the exe's new name
    for rel in expected:
        if not os.path.exists(os.path.join(INSTALL, rel)):
            check('installed: ' + rel, False)
    check('every release file is installed, byte for byte (sizes)',
          {k: v[1] for k, v in listing(release, 9).items()} == {k: v[1] for k, v in listing(INSTALL, 9).items() if k != 'install.ini'},
          sorted(set(listing(release, 9)) ^ set(k for k in listing(INSTALL, 9) if k != 'install.ini'))[:10])
    different = [k for k, v in listing(release, 9).items() if not v[0] and sha256(os.path.join(release, k)) != sha256(os.path.join(INSTALL, k))]
    check('every installed file is byte for byte the release one (SHA-256 of all %d files)' % sum(1 for v in listing(release, 9).values() if not v[0]),
          not different, different[:10])
    ok, detail = version_file_ok(INSTALL)
    check('deer-version.json: product, version, build, build date, channel, engine version and build id of this build', ok, detail)
    left_out = [n for n in ('updater.exe', 'maintenanceservice.exe', 'default-browser-agent.exe', 'pingsender.exe',
                            'crashreporter.exe', 'private_browsing.exe', 'nmhproxy.exe', 'uninstall', 'vitre.exe')
                if os.path.exists(os.path.join(INSTALL, 'engine', n))]
    check('engine ships without the updater, agents, crash reporter, private_browsing.exe', not left_out, left_out)
    placeholder = os.path.join(INSTALL, 'engine', 'firefox.exe')
    if build_info.get('mediaPlaceholder'):
        check('engine\\firefox.exe is the Deer engine\'s small placeholder for media plug-ins, not Mozilla\'s program',
              os.path.exists(placeholder) and 0 < os.path.getsize(placeholder) <= 64 * 1024, os.path.getsize(placeholder) if os.path.exists(placeholder) else 'absent')
    else:
        check('engine ships without firefox.exe (engine\\deer.exe is its copy)', not os.path.exists(placeholder))
    check('chrome package is a real folder, not a junction', not os.path.islink(os.path.join(INSTALL, 'engine', 'vitre')) and
          not (os.lstat(os.path.join(INSTALL, 'engine', 'vitre')).st_file_attributes & 0x400))
    check('no staging leftovers', not os.path.exists(os.path.join(INSTALL, '.deer-new')) and not os.path.exists(os.path.join(INSTALL, '.deer-old')))
    rec = read_ini(os.path.join(INSTALL, 'install.ini'))
    check('install record: test mode, test keys, shortcuts, data folder', rec.get('Mode') == 'test' and rec.get('RegistryRoot') == TEST_ROOT and
          rec.get('StartMenuShortcut') == START_LNK and rec.get('DesktopShortcut') == DESKTOP_LNK and rec.get('DataDir') == DATA, rec)

    exe = os.path.join(INSTALL, 'Deer.exe')
    unin = os.path.join(INSTALL, 'Uninstall.exe')
    open_cmd = '"%s" -osint -url "%%1"' % exe
    icon = exe + ',0'
    version = json.load(open(os.path.join(HERE, 'out', 'build.json')))['version']
    u = reg_values(TEST_ROOT + r'\Microsoft\Windows\CurrentVersion\Uninstall\Deer') or {}
    want = {'DisplayName': 'Deer', 'DisplayVersion': version, 'Publisher': 'Deer', 'DisplayIcon': icon, 'InstallLocation': INSTALL,
            'UninstallString': '"%s"' % unin, 'QuietUninstallString': '"%s" /S' % unin, 'NoModify': 1, 'NoRepair': 1}
    url = build_info.get('url')
    if url:
        want.update(URLInfoAbout=url, HelpLink=url, URLUpdateInfo=url + '/releases')
    bad = {k: u.get(k, (None,))[0] for k, v in want.items() if u.get(k, (None,))[0] != v}
    check('Apps & features entry: name, version, publisher, icon, location, uninstall strings, project links (%s)' % (url or 'none'), not bad, bad)
    size = u.get('EstimatedSize', (0,))[0]
    check('Apps & features size is the installed size', 300000 < size < 600000, '%s KB' % size)
    client = TEST_ROOT + r'\Clients\StartMenuInternet\Deer'
    cap = client + r'\Capabilities'
    checks = [
        (client, '', 'Deer'), (client + r'\DefaultIcon', '', icon), (client + r'\shell\open\command', '', '"%s"' % exe),
        (cap, 'ApplicationName', 'Deer'), (cap, 'ApplicationIcon', icon), (cap + r'\StartMenu', 'StartMenuInternet', 'Deer'),
        (cap + r'\URLAssociations', 'http', 'DeerURL'), (cap + r'\URLAssociations', 'https', 'DeerURL'),
        (cap + r'\FileAssociations', '.htm', 'DeerHTML'), (cap + r'\FileAssociations', '.html', 'DeerHTML'),
        (cap + r'\FileAssociations', '.xhtml', 'DeerHTML'), (cap + r'\FileAssociations', '.svg', 'DeerHTML'),
        (cap + r'\FileAssociations', '.webp', 'DeerHTML'), (cap + r'\FileAssociations', '.avif', 'DeerHTML'),
        (cap + r'\FileAssociations', '.pdf', 'DeerPDF'),
        (TEST_ROOT + r'\RegisteredApplications', 'Deer', TEST_ROOT + r'\Clients\StartMenuInternet\Deer\Capabilities'),
        (TEST_ROOT + r'\Microsoft\Windows\CurrentVersion\App Paths\Deer.exe', '', exe),
    ]
    for prog, name in (('DeerHTML', 'Deer HTML Document'), ('DeerPDF', 'Deer PDF Document'), ('DeerURL', 'Deer URL')):
        k = TEST_ROOT + r'\Classes' + '\\' + prog
        checks += [(k, '', name), (k, 'AppUserModelId', 'Deer.Browser'), (k + r'\shell\open\command', '', open_cmd),
                   (k + r'\DefaultIcon', '', icon), (k + r'\Application', 'AppUserModelId', 'Deer.Browser'),
                   (k + r'\Application', 'ApplicationName', 'Deer')]
    checks += [(TEST_ROOT + r'\Classes\DeerURL', 'URL Protocol', ''), (TEST_ROOT + r'\Classes\DeerURL', 'EditFlags', 2)]
    wrong = []
    for key, name, value in checks:
        got = (reg_values(key) or {}).get(name, (None,))[0]
        if got != value:
            wrong.append('%s : %s = %r (want %r)' % (key, name or '(default)', got, value))
    check('browser registration (%d values): StartMenuInternet, Capabilities, ProgIDs, RegisteredApplications, App Paths' % len(checks), not wrong, wrong)
    owp = reg_values(TEST_ROOT + r'\Classes\.html\OpenWithProgids') or {}
    check('"Open with" entries: .html -> DeerHTML (REG_NONE), .pdf -> DeerPDF', owp.get('DeerHTML', (None, None))[1] == winreg.REG_NONE and
          'DeerPDF' in (reg_values(TEST_ROOT + r'\Classes\.pdf\OpenWithProgids') or {}), owp)
    print('     ProgID command: ' + open_cmd)

    probe = os.path.join(WORK, 'probe.exe')
    for lnk in (START_LNK, DESKTOP_LNK):
        r = subprocess.run([probe, 'lnk', lnk], capture_output=True, text=True, encoding='utf-8')
        info = dict(line.split('=', 1) for line in r.stdout.splitlines() if '=' in line)
        check('shortcut %s: target Deer.exe, AppUserModelID Deer.Browser, test profile argument, icon' % os.path.relpath(lnk, LINKS),
              info.get('target') == exe and info.get('aumid') == 'Deer.Browser' and info.get('arguments') == '-profile "%s"' % PROFILE
              and info.get('icon') == exe + ',0' and info.get('workdir') == INSTALL, info)

    script = "(Get-Item -LiteralPath %s).VersionInfo | Select-Object FileDescription,ProductName,FileVersion,ProductVersion,CompanyName,LegalCopyright | ConvertTo-Json -Compress"
    for path, desc in ((exe, 'Deer'), (unin, 'Deer Uninstaller'), (setup_path, 'Deer Setup')):
        raw = ps(script % ps_quote(path))
        vi = json.loads(raw) if raw.strip() else {}
        check('%s: version resource (%s, Deer, %s) and an icon' % (os.path.basename(path), desc, version),
              vi.get('FileDescription') == desc and vi.get('ProductName') == 'Deer' and (vi.get('FileVersion') or '').startswith(version)
              and icon_count(path) >= 1, '%s; icons %d' % (vi, icon_count(path)))


def launcher_env(log):
    env = dict(os.environ)
    for k in ('VITRE_BOOT', 'VITRE_LIB', 'VITRE_LOG', 'VITRE_OUT', 'VITRE_APP_DIR', 'VITRE_DISABLE', 'VITRE_ALLOW_ANY_PROFILE', 'VITRE_PROFILE', 'DEER_PROFILE'):
        env.pop(k, None)
    env.update(VITRE_BOOT=os.path.join(HERE, 'tests', 'launch-probe.js'), VITRE_LIB=os.path.join(GECKO, 'tools', 'spike-lib.js'),
               VITRE_LOG=log, VITRE_OUT=OUT)
    return env


def wizard_while_running(program, button, name):
    """The wizard's answer when Deer runs: a "Deer is running ... Retry" box; Cancel keeps the wizard
    on its first page, and cancelling the wizard then changes nothing (exit 2)."""
    args = [program] + (setup_args() if button != 'Uninstall' else []) + ['/log:' + os.path.join(OUT, name + '.log')]
    p = subprocess.Popen(args)
    try:
        hwnd = wizard_window(p.pid)
        if not check('%s wizard opens while Deer runs' % name, hwnd):
            return
        user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
        time.sleep(0.8)
        press(control(hwnd, button))
        box = wait_for(lambda: next((h for h in top_windows({p.pid}) if window_class(h) == '#32770'), None), 20)
        text = body_text(box) if box else ''
        check('%s: "%s" says Deer is running and offers Retry / Cancel' % (name, button),
              box and 'Deer is running' in text and control(box, '&Retry') and control(box, 'Cancel'), text[:200])
        if box:
            capture(box, name + '-box')
            press(control(box, 'Cancel'))
        time.sleep(1)
        check('%s: after Cancel the wizard is still on its first page' % name, control(hwnd, button) and control(hwnd, 'Cancel'), body_text(hwnd)[:200])
        press(control(hwnd, 'Cancel'))
        p.wait(30)
        check('%s: cancelling the wizard exits with 2' % name, p.returncode == 2, p.returncode)
    finally:
        if p.poll() is None:
            p.kill()


def phase_launch(setup, gui=True):
    section('3. the installed Deer on a throwaway profile')
    exe = os.path.join(INSTALL, 'Deer.exe')
    engine = os.path.join(INSTALL, 'engine')
    log = os.path.join(OUT, 'launch.log')
    open(log, 'w').close()
    # The test hook in engine\config.js runs only in a profile that carries "vitre-harness".
    os.makedirs(PROFILE, exist_ok=True)
    open(os.path.join(PROFILE, 'vitre-harness'), 'w').close()
    env = launcher_env(log)
    code, took, eof = run_piped([exe, '-profile', PROFILE, page('deer-first-page')], env=env, timeout=60)
    check('Deer.exe returns 0 at once', code == 0 and took < 10, '%s after %.1f s' % (code, took))
    check('the engine inherits no handle from Deer.exe (the caller\'s output pipe closes with Deer.exe)', eof)
    check('launcher created the profile marker "vitre-profile"', os.path.exists(os.path.join(PROFILE, 'vitre-profile')))
    build = read_ini(os.path.join(INSTALL, 'release.ini')).get('Build')
    stamp = os.path.join(PROFILE, 'deer-build')
    check('launcher recorded the release build in the profile', os.path.exists(stamp) and open(stamp).read().strip() == build, build)
    text = wait_for(lambda: (lambda t: t if 'LAUNCHED' in t and 'deer-first-page' in t else '')(open(log, encoding='utf-8', errors='replace').read()), 60)
    launched = next((l for l in text.splitlines() if l.startswith('LAUNCHED')), '')
    info = json.loads(launched[len('LAUNCHED '):]) if launched else {}
    check('Deer started: Vitre layer loaded, profile and marker are the test ones', info.get('vitre') and info.get('marker') and
          os.path.normcase(info.get('profile', '')) == os.path.normcase(PROFILE) and info.get('allowAny') == 'unset', launched)
    check('engine runs from the install: engine\\deer.exe', os.path.normcase(info.get('exe', '')) == os.path.normcase(os.path.join(engine, 'deer.exe')), info.get('exe'))
    pkg = urllib.parse.unquote(urllib.parse.urlparse(info.get('pkg', '')).path).lstrip('/').replace('/', '\\')
    check('chrome package loaded from engine\\vitre of the install',
          os.path.normcase(pkg) == os.path.normcase(os.path.join(engine, 'vitre', 'chrome.manifest')), info.get('pkg'))
    running = pids_from(INSTALL)
    cmds = command_lines('deer.exe')
    parents = [pid for pid in running if cmds.get(pid, (None, ''))[0] not in running]
    check('one browser process tree, all deer.exe from the install', len(parents) == 1 and all(p.lower().endswith('\\engine\\deer.exe') for p in running.values()),
          '%d parent(s): %s' % (len(parents), sorted(set(running.values()))))
    first_cmd = cmds.get(parents[0], (None, ''))[1] if parents else ''
    check('first start of this build on the profile passes -profile and -purgecaches', '-profile' in first_cmd and PROFILE in first_cmd and '-purgecaches' in first_cmd, first_cmd)
    hwnd = wait_for(lambda: next((h for h in top_windows(set(running)) if window_class(h) == 'MozillaWindowClass'), None), 20)
    if check('a browser window is up', hwnd):
        time.sleep(3)
        user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
        time.sleep(1.5)
        capture(hwnd, 'deer-window')
        title, aumid = window_text(hwnd), window_aumid(hwnd)
        print('     window title %r, AppUserModelID %r' % (title, aumid))
        check('window AppUserModelID is Deer.Browser (src/modules/VitreStartup.sys.ts APP_ID: the Start menu shortcut\'s and the ProgIDs\' id, '
              'so a pinned Deer and its windows share one taskbar button)', aumid == 'Deer.Browser', aumid)

    # ---- hand-off: the default-browser command shape, profile from DEER_PROFILE ----
    env2 = dict(env, DEER_PROFILE=PROFILE)
    code = run([exe, '-osint', '-url', page('deer-handed-over')], env=env2, timeout=60)
    check('Deer.exe -osint -url <url> returns 0', code == 0, code)
    handed = wait_for(lambda: 'deer-handed-over' in open(log, encoding='utf-8', errors='replace').read(), 30)
    check('the URL arrived in the running Deer (Gecko remoting by profile path)', handed)
    time.sleep(1)
    running2 = pids_from(INSTALL)
    cmds2 = command_lines('deer.exe')
    parents2 = [pid for pid in running2 if cmds2.get(pid, (None, ''))[0] not in running2]
    check('still one browser process', parents2 == parents, '%s -> %s' % (parents, parents2))
    check('the test hook ran once (no second browser)', open(log, encoding='utf-8', errors='replace').read().count('LAUNCHED') == 1)

    # ---- rejected shapes start nothing ----
    before = set(pids_from(INSTALL))
    bogus = os.path.join(TEST, 'bogus-profile')
    for args in (['-osint', '-url', 'a', 'b'], ['-osint', '-profile', bogus], ['-osint', '-url', '-P'], ['https://x.test/', '-osint', '-url', 'y']):
        code = run([exe] + args, env=env2, timeout=30)
        check('rejected: Deer.exe %s -> exit 1' % ' '.join(args), code == 1, code)
    time.sleep(1)
    check('rejected launches started no process and made no profile', set(pids_from(INSTALL)) == before and not os.path.exists(bogus))

    # ---- setup and uninstall refuse while Deer runs ----
    code = run([setup, '/S', '/log:' + os.path.join(OUT, 'running-setup.log')] + setup_args())
    check('setup refuses while Deer runs (exit 3)', code == 3, code)
    code = run([os.path.join(INSTALL, 'Uninstall.exe'), '/S', '/log:' + os.path.join(OUT, 'running-uninstall.log')])
    check('uninstall refuses while Deer runs (exit 3)', code == 3, code)
    check('install untouched after the refusals', os.path.exists(os.path.join(engine, 'deer.exe')) and os.path.exists(os.path.join(INSTALL, 'Uninstall.exe')))
    if gui:
        wizard_while_running(setup, 'Reinstall', 'setup-running')
        wizard_while_running(os.path.join(INSTALL, 'Uninstall.exe'), 'Uninstall', 'uninstall-running')
        check('install still untouched after the wizards were cancelled', os.path.exists(os.path.join(engine, 'deer.exe')) and
              os.path.exists(os.path.join(INSTALL, 'Uninstall.exe')) and reg_exists(TEST_ROOT + r'\Microsoft\Windows\CurrentVersion\Uninstall\Deer'))

    # ---- close Deer like a user (WM_CLOSE to its windows) ----
    for h in top_windows(set(pids_from(INSTALL))):
        if window_class(h) == 'MozillaWindowClass':
            user32.PostMessageW(h, 0x0010, 0, 0)
    closed = wait_for(lambda: not pids_from(INSTALL), 45, 0.5)
    if not check('Deer exits when its window is closed', closed, pids_from(INSTALL)):
        kill_tree(pids_from(INSTALL))
        time.sleep(2)
    traces = mozilla_traces(engine)
    print('     engine traces after the run: %d registry values keyed to the install' % len(traces))
    for t in traces:
        print('       ' + t)
    return traces


def launched_info(log):
    """The launch probe's LAUNCHED record in `log` ({} until it is there)."""
    try:
        text = open(log, encoding='utf-8', errors='replace').read()
    except OSError:
        return {}
    line = next((l for l in text.splitlines() if l.startswith('LAUNCHED ')), '')
    return json.loads(line[len('LAUNCHED '):]) if line else {}


def log_has(log, text):
    try:
        return text in open(log, encoding='utf-8', errors='replace').read()
    except OSError:
        return False


def browser_parents():
    running = pids_from(INSTALL)
    cmds = command_lines('deer.exe')
    return sorted(pid for pid in running if cmds.get(pid, (None, ''))[0] not in running), cmds


def make_old_profile(local):
    """A profile of the development build under its old name: <local>\\Vitre\\Profile with its marker."""
    old = os.path.join(local, 'Vitre', 'Profile')
    os.makedirs(os.path.join(old, 'storage', 'default'))
    for name in ('vitre-profile', 'vitre-harness'):  # the harness marker: config.js runs the launch probe there
        open(os.path.join(old, name), 'w').close()
    open(os.path.join(old, 'deer-migration-sentinel.txt'), 'w').write('kept')
    open(os.path.join(old, 'storage', 'default', 'data.bin'), 'wb').write(os.urandom(1 << 16))
    return old


def phase_migration():
    section('3c. the installed Deer.exe\'s default profile: test data profile, the Vitre -> Deer copy, cleared variables')
    exe = os.path.join(INSTALL, 'Deer.exe')

    # A test install never falls back to the person's %LOCALAPPDATA%: without a stand-in it runs on its
    # own test data profile.
    log = os.path.join(OUT, 'default-profile.log')
    env = launcher_env(log)
    env.pop('DEER_TEST_LOCALAPPDATA', None)
    code = run([exe, page('deer-default-profile')], env=env, timeout=60)
    info = wait_for(lambda: launched_info(log), 60)
    check('a test install started with no -profile, DEER_PROFILE or stand-in runs on its own test data profile (Data\\Profile)',
          code == 0 and info and os.path.normcase(info.get('profile', '')) == os.path.normcase(PROFILE), (code, info))
    check('Deer closes', close_deer())

    # A browser runs on the old profile: the default start hands its page there and copies nothing.
    old = make_old_profile(LOCAL_STAND)
    new = os.path.join(LOCAL_STAND, 'Deer', 'Profile')
    log1 = os.path.join(OUT, 'migration-old-running.log')
    code = run([exe, '-profile', old, page('deer-on-old-profile')], env=launcher_env(log1), timeout=60)
    info = wait_for(lambda: launched_info(log1), 60)
    check('Deer runs on the old profile (started with -profile, as the development build would hold it)',
          code == 0 and info and os.path.normcase(info.get('profile', '')) == os.path.normcase(old), info)
    wait_for(lambda: log_has(log1, 'TABS'), 20)
    roots, _cmds = browser_parents()
    log2 = os.path.join(OUT, 'migration-default.log')
    env2 = dict(launcher_env(log2), DEER_TEST_LOCALAPPDATA=LOCAL_STAND)
    code = run([exe, page('deer-to-old-profile')], env=env2, timeout=60)
    check('Deer.exe on the default profile while the old one is in use: 0', code == 0, code)
    check('its page went to the browser on the old profile', wait_for(lambda: log_has(log1, 'deer-to-old-profile'), 30))
    half = [n for n in os.listdir(os.path.join(LOCAL_STAND, 'Deer'))] if os.path.isdir(os.path.join(LOCAL_STAND, 'Deer')) else []
    check('nothing was copied while it ran (no Deer profile, no half copy), still one browser', not os.path.exists(new) and not half and
          browser_parents()[0] == roots, (half, roots, browser_parents()[0]))
    check('Deer closes', close_deer())

    # The next start copies, and the caller's XUL_APP_FILE / XRE_PROFILE_PATH / XRE_PROFILE_LOCAL_PATH
    # (deer-engine.json identity.launch.clearEnv) never reach the engine.
    log3 = os.path.join(OUT, 'migration-copied.log')
    elsewhere = os.path.join(TEST, 'xre-elsewhere')
    env3 = dict(launcher_env(log3), DEER_TEST_LOCALAPPDATA=LOCAL_STAND, XUL_APP_FILE=os.path.join(TEST, 'no-such-application.ini'),
                XRE_PROFILE_PATH=elsewhere, XRE_PROFILE_LOCAL_PATH=elsewhere, MOZ_NEW_INSTANCE='1')
    t0 = time.time()
    code = run([exe, page('deer-after-copy')], env=env3, timeout=120)
    took = time.time() - t0
    info = wait_for(lambda: launched_info(log3), 60)
    check('the next start (old browser closed) copies Local\\Vitre\\Profile to Local\\Deer\\Profile and runs on it (%.1f s)' % took,
          code == 0 and info and os.path.normcase(info.get('profile', '')) == os.path.normcase(new) and
          os.path.exists(os.path.join(new, 'deer-migration-sentinel.txt')) and os.path.exists(os.path.join(new, 'storage', 'default', 'data.bin')), info)
    check('the old profile is still there (copied, never moved)', os.path.exists(os.path.join(old, 'deer-migration-sentinel.txt')) and
          os.path.exists(os.path.join(old, 'vitre-profile')))
    roots, cmds = browser_parents()
    first = cmds.get(roots[0], (None, ''))[1] if roots else ''
    check('the engine got -profile <Local\\Deer\\Profile>', '-profile' in first and new.lower() in first.lower(), first)
    check('XUL_APP_FILE, XRE_PROFILE_PATH and XRE_PROFILE_LOCAL_PATH were cleared (Deer started on -profile\'s folder with its own '
          'identity; the other folder was never made)', bool(info) and not os.path.exists(elsewhere))
    # MOZ_NEW_INSTANCE in the caller's environment would turn Gecko's remoting off: this second start would
    # try to open the profile the running Deer holds instead of handing its page over.
    code = run([exe, page('deer-new-instance-handoff')], env=env3, timeout=60)
    check('a second start with MOZ_NEW_INSTANCE in the caller\'s environment: 0, its page went to the running Deer, still one browser',
          code == 0 and wait_for(lambda: log_has(log3, 'deer-new-instance-handoff'), 30) and browser_parents()[0] == roots,
          (code, roots, browser_parents()[0]))
    check('Deer closes', close_deer())


def phase_launcher_errors():
    section('3b. launcher without its engine')
    broken = os.path.join(TEST, 'Broken')
    os.makedirs(broken, exist_ok=True)
    shutil.copyfile(os.path.join(HERE, 'out', 'Deer', 'Deer.exe'), os.path.join(broken, 'Deer.exe'))
    p = subprocess.Popen([os.path.join(broken, 'Deer.exe'), '-profile', os.path.join(broken, 'profile')])
    box = wait_for(lambda: next((h for h in top_windows({p.pid}) if window_class(h) == '#32770'), None), 20)
    text = body_text(box) if box else ''
    check('a message box says files are missing and how to repair', box and 'missing' in text and 'Install Deer again' in text, text[:200])
    if box:
        capture(box, 'launcher-missing-engine')
        user32.PostMessageW(box, 0x0010, 0, 0)
    try:
        p.wait(15)
    except subprocess.TimeoutExpired:
        p.kill()
    check('it exits with 2 and makes no profile', p.returncode == 2 and not os.path.exists(os.path.join(broken, 'profile')), p.returncode)
    rmtree(broken)


def phase_update(setup):
    section('4. update, downgrade, unusable folders')
    stale = os.path.join(INSTALL, 'engine', 'stale-file-of-an-older-version.txt')
    open(stale, 'w').close()
    rec = os.path.join(INSTALL, 'install.ini')
    set_ini(rec, 'Version', '0.0.9')
    reg_set(TEST_ROOT + r'\Microsoft\Windows\CurrentVersion\Uninstall\Deer', 'DisplayVersion', '0.0.9')
    profile_files = listing(PROFILE, 1)
    code = run([setup, '/S', '/log:' + os.path.join(OUT, 'update.log')] + setup_args())
    version = json.load(open(os.path.join(HERE, 'out', 'build.json')))['version']
    check('update over 0.0.9 exits 0', code == 0, code)
    check('update: version recorded and shown in Apps & features', read_ini(rec).get('Version') == version and
          (reg_values(TEST_ROOT + r'\Microsoft\Windows\CurrentVersion\Uninstall\Deer') or {}).get('DisplayVersion', (None,))[0] == version)
    check('update: files of the old version are gone (folder swap)', not os.path.exists(stale))
    check('update: the desktop shortcut chosen before is kept', os.path.exists(DESKTOP_LNK))
    check('update: the profile is untouched', set(listing(PROFILE, 1)) == set(profile_files))

    set_ini(rec, 'Version', '9.9.9')
    code = run([setup, '/S', '/log:' + os.path.join(OUT, 'downgrade.log')] + setup_args())
    check('installing over a newer version is refused (exit 6)', code == 6, code)
    code = run([setup, '/S', '/allowdowngrade', '/log:' + os.path.join(OUT, 'downgrade-allowed.log')] + setup_args())
    check('/allowdowngrade installs anyway', code == 0 and read_ini(rec).get('Version') == version, code)

    # A step after the file swap fails (a folder sits where the Start menu shortcut goes): the files
    # stay, the message says so, and running setup again completes the install.
    os.remove(START_LNK)
    os.makedirs(START_LNK)
    unfinished = os.path.join(OUT, 'unfinished.log')
    code = run([setup, '/S', '/log:' + unfinished] + setup_args())
    text = open(unfinished, encoding='utf-8', errors='replace').read()
    check('a failure after the files are in place: exit 5, "files are installed ... run setup again", Deer still installed',
          code == 5 and 'Run setup again' in text and os.path.exists(os.path.join(INSTALL, 'engine', 'deer.exe')) and os.path.exists(rec), code)
    os.rmdir(START_LNK)
    code = run([setup, '/S', '/log:' + os.path.join(OUT, 'repair.log')] + setup_args())
    check('running setup again completes it: Start menu shortcut back, desktop shortcut kept, Apps & features entry there',
          code == 0 and os.path.isfile(START_LNK) and os.path.isfile(DESKTOP_LNK) and reg_exists(TEST_ROOT + r'\Microsoft\Windows\CurrentVersion\Uninstall\Deer'), code)

    other = os.path.join(TEST, 'NotEmpty')
    os.makedirs(other, exist_ok=True)
    open(os.path.join(other, 'someone-elses-file.txt'), 'w').close()
    code = run([setup, '/S', '/testkeys', '/installdir:' + other, '/shortcutdir:' + LINKS, '/datadir:' + DATA, '/log:' + os.path.join(OUT, 'notempty.log')])
    check('a non-empty folder that is not Deer is refused (exit 8)', code == 8 and os.listdir(other) == ['someone-elses-file.txt'], code)
    code = run([setup, '/S', '/testkeys', '/installdir:' + os.path.join(TEST, 'Elsewhere'), '/shortcutdir:' + LINKS, '/datadir:' + DATA,
                '/log:' + os.path.join(OUT, 'elsewhere.log')])
    check('a second install location is refused while Deer is installed (exit 8)', code == 8 and not os.path.exists(os.path.join(TEST, 'Elsewhere')), code)
    code = run([setup, '/S', '/testkeys', '/datadir:C:\\Windows\\Temp\\x', '/log:' + os.path.join(OUT, 'baddata.log')])
    check('a test data folder outside %TEMP% is refused (exit 1)', code == 1, code)

    fake = os.path.join(TEST, 'NormalInstall')
    os.makedirs(fake, exist_ok=True)
    open(os.path.join(fake, 'install.ini'), 'w').write('[Deer]\r\nVersion=0.1.0\r\nMode=user\r\nFiles=Deer.exe\r\n')
    open(os.path.join(fake, 'Deer.exe'), 'w').close()
    code = run([os.path.join(HERE, 'out', 'Deer', 'Uninstall.exe'), '/S', '/testkeys', '/installdir:' + fake, '/log:' + os.path.join(OUT, 'fake-normal.log')])
    check('/testkeys never removes a normal install (exit 1, files kept)', code == 1 and os.path.exists(os.path.join(fake, 'Deer.exe')), code)
    code = run([setup, '/S', '/bogus'])
    check('unknown arguments: exit 1', code == 1, code)
    rmtree(other)
    rmtree(fake)


def plant_toast_registration(install_hashes):
    """What the engine writes the first time it shows a Windows notification (ToastNotification.cpp
    RegisterRuntimeAumid; seen on this machine for gecko\\runtime): an AppUserModelId named after the
    install hash, the notification COM server it names, and Windows' own settings for that AUMID.
    The test writes the same keys (it cannot make the engine show a toast unattended), all pointing
    into the test install, for the uninstaller to remove. Returns the keys."""
    engine = os.path.join(INSTALL, 'engine')
    keys = []
    for h in install_hashes:
        aumid = AUMID_ROOT + '\\FirefoxPortableToast-' + h
        clsid = CLSID_ROOT + '\\{%s}' % str(uuid.uuid4()).upper()
        notify = NOTIFY_ROOT + '\\FirefoxPortableToast-' + h
        for key in (aumid, clsid, notify):
            if reg_exists(key):
                sys.exit('refusing to plant %s: it exists already' % key)
        planted.extend([aumid, clsid, notify])
        reg_set(aumid, 'DisplayName', 'Deer installer test')
        reg_set(aumid, 'IconUri', os.path.join(engine, 'browser', 'VisualElements', 'VisualElements_70.png'))
        reg_set(aumid, 'CustomActivator', clsid.rsplit('\\', 1)[1])
        reg_set(clsid + r'\InprocServer32', '', os.path.join(engine, 'notificationserver.dll'))
        reg_set(notify, 'Enabled', '1')
        keys += [aumid, clsid, notify]
    return keys


def plant_identity_traces(install_hashes):
    """What an engine with Deer's own identity (tools/setup-engine.py step 8) writes for this install
    folder, under Deer's names: HKCU\\Software\\Deer\\EngineData\\Launcher "<engine>\\deer.exe|Image" and
    "|Blocklist" (naming the blocklist file), HKCU\\Software\\Deer\\firefox\\Installer\\<hash>,
    %APPDATA%\\Deer\\EngineData\\blocklist-<hash>. A local-test engine keeps Mozilla's identity, so the
    test writes them itself (only names keyed to the test install; the parent keys may hold other
    installs' entries and stay); the files go into the %APPDATA% stand-in, never the person's own.
    A release setup's engine has Deer's identity and has already written its own "|Blocklist" value for
    the test install in phase 3 (naming a file in the person's %APPDATA%\\Deer\\EngineData that the engine
    makes only once it blocks a module): that value, keyed to the test install, is pointed at the
    stand-in's file instead, so the uninstaller is seen removing the file the value names.
    Returns (registry values, registry keys, files) planted."""
    engine = os.path.join(INSTALL, 'engine')
    values, keys, files = [], [], []
    launcher = r'Software\Deer\EngineData\Launcher'
    blocklist = os.path.join(ROAMING, 'Deer', 'EngineData', 'blocklist-0123456789ABCDEF')
    for name, value in ((os.path.join(engine, 'deer.exe') + '|Image', 'planted by installer/test.py'),
                        (os.path.join(engine, 'deer.exe') + '|Blocklist', blocklist)):
        if (reg_values(launcher) or {}).get(name) is None or name.endswith('|Blocklist'):
            reg_set(launcher, name, value)
            values.append((launcher, name))
    os.makedirs(os.path.dirname(blocklist), exist_ok=True)
    open(blocklist, 'wb').close()
    files.append(blocklist)
    for h in install_hashes:
        key = r'Software\Deer\firefox\Installer' + '\\' + h
        if not reg_exists(key):
            reg_set(key, 'planted', 'installer/test.py')
            keys.append(key)
            planted.append(key)
        f = os.path.join(ROAMING, 'Deer', 'EngineData', 'blocklist-' + h)
        open(f, 'wb').close()
        files.append(f)
    planted_values.extend(values)
    return values, keys, files


OTHER_HASH = '0123456789ABCDE0'  # another install's hash: its entries must stay


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def plant_shared(install_hashes, others):
    """Deer's shared engine folders in the stand-ins as an engine with Deer's identity leaves them for
    this install (a bare start's installs.ini / profiles.ini sections and profile, a killed background
    task's profile, a crash's skeleton UI lock, the empty folders Gecko makes at every start) and, with
    `others`, entries of another install and things in use that must stay. Returns (gone, kept): paths."""
    h = install_hashes[0]
    gone, kept = [], []
    ini = '[%s]\r\nDefault=Profiles/abc.default-release\r\nLocked=1\r\n' % h
    profiles = '[Install%s]\r\nDefault=Profiles/abc.default-release\r\nLocked=1\r\n\r\n' % h
    profiles += '[Profile0]\r\nName=default-release\r\nIsRelative=1\r\nPath=Profiles/abc.default-release\r\nDefault=1\r\n\r\n'
    if others:
        ini += '\r\n[%s]\r\nDefault=Profiles/keep.default\r\nLocked=1\r\n' % OTHER_HASH
        profiles += '[Install%s]\r\nDefault=Profiles/keep.default\r\nLocked=1\r\n\r\n' % OTHER_HASH
        profiles += '[Profile1]\r\nName=keep\r\nIsRelative=1\r\nPath=Profiles/keep.default\r\n\r\n'
    profiles += '[General]\r\nStartWithLastProfile=1\r\nVersion=2\r\n'
    write(os.path.join(ROAMING, 'Deer', 'installs.ini'), ini)
    write(os.path.join(ROAMING, 'Deer', 'profiles.ini'), profiles)
    write(os.path.join(ROAMING, 'Deer', 'Profiles', 'abc.default-release', 'prefs.js'), '// made by a bare start\n')
    write(os.path.join(LOCAL_STAND, 'Deer', 'Profiles', 'abc.default-release', 'cache2', 'index'), 'cache')
    write(os.path.join(LOCAL_STAND, 'Deer', 'EngineData', 'SkeletonUILock-1A2B3C4D'), '')
    # What Deer's updater keeps in Local\Deer\updates: a staged setup, its record, a part, the last setup log.
    updates = os.path.join(LOCAL_STAND, 'Deer', 'updates')
    for name in ('Deer-Setup-1.5.0.exe', 'Deer-Setup-1.5.0.json', 'Deer-Setup-1.6.0.exe.part', 'setup.log'):
        write(os.path.join(updates, name), 'staged')
    gone += [os.path.join(updates, n) for n in ('Deer-Setup-1.5.0.exe', 'Deer-Setup-1.5.0.json', 'Deer-Setup-1.6.0.exe.part', 'setup.log')]
    write(os.path.join(TEMP_STAND, 'MozillaBackgroundTask-%s-backgroundupdate' % h, 'prefs.js'), '// task\n')
    os.makedirs(os.path.join(TEMP_STAND, 'deerapp-temp-files'), exist_ok=True)
    gone += [os.path.join(ROAMING, 'Deer', 'Profiles', 'abc.default-release'), os.path.join(LOCAL_STAND, 'Deer', 'Profiles', 'abc.default-release'),
             os.path.join(LOCAL_STAND, 'Deer', 'EngineData'), os.path.join(TEMP_STAND, 'MozillaBackgroundTask-%s-backgroundupdate' % h)]
    if others:
        write(os.path.join(ROAMING, 'Deer', 'Profiles', 'keep.default', 'prefs.js'), '// another install\'s\n')
        write(os.path.join(TEMP_STAND, 'MozillaBackgroundTask-%s-backgroundupdate' % OTHER_HASH, 'prefs.js'), '// another install\'s task\n')
        write(os.path.join(TEMP_STAND, 'deerapp-temp-files', 'opened-with-another-program.pdf'), '%PDF')
        write(os.path.join(updates, 'notes.txt'), 'not the updater\'s')
        kept.append(os.path.join(updates, 'notes.txt'))
        kept += [os.path.join(ROAMING, 'Deer', 'Profiles', 'keep.default'), os.path.join(TEMP_STAND, 'MozillaBackgroundTask-%s-backgroundupdate' % OTHER_HASH),
                 os.path.join(TEMP_STAND, 'deerapp-temp-files', 'opened-with-another-program.pdf'), os.path.join(ROAMING, 'Deer', 'installs.ini'),
                 os.path.join(ROAMING, 'Deer', 'profiles.ini')]
    else:
        gone += [os.path.join(ROAMING, 'Deer'), os.path.join(LOCAL_STAND, 'Deer'), os.path.join(TEMP_STAND, 'deerapp-temp-files')]
    # A killed background task's profile in the real %TEMP%: named after the test install, so removed there too.
    real = os.path.join(tempfile.gettempdir(), 'MozillaBackgroundTask-%s-deer-installer-test' % h)
    write(os.path.join(real, 'prefs.js'), '// task\n')
    planted_files.append(os.path.join(real, 'prefs.js'))
    gone.append(real)
    return gone, kept


def ini_sections(path):
    try:
        return [l.strip()[1:-1] for l in open(path, encoding='utf-8') if l.strip().startswith('[')]
    except OSError:
        return None


def phase_uninstall(engine_traces, install_hashes):
    section('5. silent uninstall, keeping the data')
    toast_keys = plant_toast_registration(install_hashes)
    print('     planted the engine\'s toast registration: ' + ', '.join('HKCU\\' + k for k in toast_keys))
    id_values, id_keys, id_files = plant_identity_traces(install_hashes)
    print('     planted Deer-identity engine traces: %d value(s), %d key(s), %d file(s)' % (len(id_values), len(id_keys), len(id_files)))
    # Deer's profile from phase 3c stays in Local\Deer: only what belongs to this install may go.
    shared_gone, shared_kept = plant_shared(install_hashes, True)
    print('     planted in the stand-ins: %d entries of this install, %d that must stay' % (len(shared_gone), len(shared_kept)))
    log = os.path.join(OUT, 'uninstall.log')
    code, took, eof = run_piped([os.path.join(INSTALL, 'Uninstall.exe'), '/S', '/log:' + log])
    check('Uninstall.exe /S exits 0', code == 0, '%s after %.1f s' % (code, took))
    check('its self-removal helper inherits no handle (the caller\'s pipe closes with Uninstall.exe)', eof)
    gone = wait_for(lambda: not os.path.exists(INSTALL), 15)
    check('install folder gone (Uninstall.exe deleted itself after exiting)', gone, os.listdir(INSTALL) if os.path.exists(INSTALL) else '')
    check('Programs folder left as it was (only Deer removed)', not os.path.exists(INSTALL) and os.path.exists(os.path.dirname(INSTALL)))
    check('both shortcuts gone', not os.path.exists(START_LNK) and not os.path.exists(DESKTOP_LNK))
    check('HKCU\\Software\\DeerTest gone entirely', not reg_exists(TEST_ROOT), reg_tree(TEST_ROOT))
    check('data folder kept (default)', os.path.exists(os.path.join(PROFILE, 'vitre-profile')))
    left = mozilla_traces(os.path.join(INSTALL, 'engine'))
    check('the engine\'s per-install registry values are removed (%d were there)' % len(engine_traces), not left, left)
    hashed = [t for h in install_hashes for t in hash_traces(h)]
    check('the engine\'s install-hash entries are removed (HKCU Installer\\<hash>, ProgramData updates\\<hash>, UpdateLock)', not hashed, hashed)
    left = [k for k in toast_keys if reg_exists(k)]
    check('the engine\'s toast registration is removed (AppUserModelId FirefoxPortableToast-<hash>, its COM class, '
          'Windows\' notification settings)', toast_keys and not left, left)
    left = [k + ' : ' + n for k, n in id_values if (reg_values(k) or {}).get(n) is not None] + [k for k in id_keys if reg_exists(k)] + \
        [f for f in id_files if os.path.exists(f)]
    check('Deer-identity engine traces of this install are removed (HKCU\\Software\\Deer\\EngineData values incl. "|Blocklist" and the file '
          'it names, \\firefox\\Installer\\<hash>, %%APPDATA%%\\Deer\\EngineData\\blocklist-<hash>; %d planted)' % (len(id_values) + len(id_keys) + len(id_files)),
          (id_values or id_keys or id_files) and not left, left)
    left = [p for p in shared_gone if os.path.exists(p)]
    check('this install\'s entries in Deer\'s shared folders are removed: the bare start\'s profile (roaming and local), the skeleton UI '
          'lock and its emptied folder, the background task profiles (stand-in and real %TEMP%), the updater\'s staged setups, '
          'part and setup.log', not left, left)
    left = [p for p in shared_kept if not os.path.exists(p)]
    check('what is not this install\'s stays: another install\'s profile and task folder, a file in deerapp-temp-files, another file '
          'in Local\\Deer\\updates, Deer\'s profile',
          not left and os.path.exists(os.path.join(LOCAL_STAND, 'Deer', 'Profile', 'deer-migration-sentinel.txt')), left)
    h = install_hashes[0] if install_hashes else ''
    check('installs.ini keeps only the other install\'s section', ini_sections(os.path.join(ROAMING, 'Deer', 'installs.ini')) == [OTHER_HASH],
          ini_sections(os.path.join(ROAMING, 'Deer', 'installs.ini')))
    sections = ini_sections(os.path.join(ROAMING, 'Deer', 'profiles.ini'))
    text = open(os.path.join(ROAMING, 'Deer', 'profiles.ini'), encoding='utf-8').read() if sections is not None else ''
    check('profiles.ini loses [Install<hash>] and the bare start\'s profile; the other one is Profile0 now (Gecko reads from 0)',
          sections == ['Install' + OTHER_HASH, 'Profile0', 'General'] and 'Path=Profiles/keep.default' in text and 'abc.default-release' not in text, sections)
    check('Deer\'s empty folders with something left in them stay (Roaming\\Deer\\Profiles, Local\\Deer)',
          os.path.isdir(os.path.join(ROAMING, 'Deer', 'Profiles')) and os.path.isdir(os.path.join(LOCAL_STAND, 'Deer')) and
          not os.path.exists(os.path.join(LOCAL_STAND, 'Deer', 'Profiles')), h)


def deer_parent():
    """(pid, command line) of the running Deer browser process of the test install, or (None, '').
    Gecko first runs as a short-lived launcher process that starts the browser process and exits, so
    only a process still there when its command line is read counts."""
    running = pids_from(INSTALL)
    if not running:
        return None, ''
    cmds = command_lines('deer.exe')
    for pid in running:
        if pid in cmds and cmds[pid][0] not in running and pids_from(INSTALL).get(pid):
            return pid, cmds[pid][1]
    return None, ''


def close_deer():
    for h in top_windows(set(pids_from(INSTALL))):
        if window_class(h) == 'MozillaWindowClass':
            user32.PostMessageW(h, 0x0010, 0, 0)
    if not wait_for(lambda: not pids_from(INSTALL), 45, 0.5):
        kill_tree(pids_from(INSTALL))
        time.sleep(2)
        return False
    return True


def phase_removedata(setup):
    section('6. install again with /launch, update with /wait while Deer runs, then /uninstall /removedata')
    clean = dict(os.environ)
    for k in [k for k in clean if k.startswith('VITRE_') or k == 'DEER_PROFILE']:
        clean.pop(k)
    code = run([setup, '/S', '/launch', '/log:' + os.path.join(OUT, 'reinstall.log')] + setup_args(), env=clean)
    check('reinstall with /launch exits 0', code == 0, code)
    check('reinstall: no desktop shortcut unless asked', not os.path.exists(DESKTOP_LNK))
    pid, cmd = wait_for(lambda: (lambda r: r if r[0] else None)(deer_parent()), 30) or (None, '')
    check('/launch started the installed Deer on the test profile', pid and PROFILE in cmd and '-profile' in cmd, cmd)
    time.sleep(3)

    # "Restart to update": the setup waits for Deer to close, installs, starts Deer again.
    upd = subprocess.Popen([setup, '/S', '/wait:90', '/launch', '/log:' + os.path.join(OUT, 'update-wait.log')] + setup_args(),
                           env=clean, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(4)
    check('/wait: setup waits while Deer runs', upd.poll() is None)
    # The mutex it holds lets administrators of any account wait on and release it (an elevated copy
    # that UAC starts under another account takes it over), and gives full access only to this account.
    sddl = gate_sddl()
    user_sid = ps('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value').strip()
    check('the "one setup at a time" mutex grants Administrators wait and release (0x100001), this account full control',
          '(A;;0x100001;;;BA)' in sddl and ('(A;;0x1f0001;;;%s)' % user_sid).lower() in sddl.lower(), sddl)
    code = run([setup, '/S', '/log:' + os.path.join(OUT, 'second-setup.log')] + setup_args(), env=clean)
    check('a second setup started meanwhile is refused (exit 9)', code == 9, code)
    check('Deer closes', close_deer())
    try:
        code = upd.wait(120)
    except subprocess.TimeoutExpired:
        upd.kill()
        code = None
    check('/wait: setup installs once Deer has closed (exit 0)', code == 0, code)
    pid2, cmd2 = wait_for(lambda: (lambda r: r if r[0] else None)(deer_parent()), 30) or (None, '')
    check('/launch started Deer again after the update', pid2 and pid2 != pid and PROFILE in cmd2, cmd2)
    time.sleep(3)
    check('Deer closes again', close_deer())
    # Deer's shared folders hold nothing but this install's leftovers: they all go.
    for stand_in in (os.path.join(ROAMING, 'Deer'), os.path.join(LOCAL_STAND, 'Deer'), TEMP_STAND):
        rmtree(stand_in)
    r = subprocess.run([os.path.join(WORK, 'probe.exe'), 'hash', os.path.join(INSTALL, 'engine')], capture_output=True, text=True)
    shared_gone, _kept = plant_shared(r.stdout.split()[:1], False)
    code = run([setup, '/S', '/uninstall', '/testkeys', '/installdir:' + INSTALL, '/removedata', '/log:' + os.path.join(OUT, 'uninstall-removedata.log')])
    check('Deer-Setup.exe /uninstall /removedata exits 0', code == 0, code)
    check('install folder, data folder, shortcuts and test keys are all gone',
          not os.path.exists(INSTALL) and not os.path.exists(DATA) and not os.path.exists(START_LNK) and not reg_exists(TEST_ROOT),
          [p for p in (INSTALL, DATA, START_LNK) if os.path.exists(p)] + ([TEST_ROOT] if reg_exists(TEST_ROOT) else []))
    left = [p for p in shared_gone if os.path.exists(p)]
    check('Deer\'s shared folders holding only this install\'s leftovers are gone: Roaming\\Deer (installs.ini, profiles.ini, the bare '
          'start\'s profile, Profiles), Local\\Deer, Temp\\deerapp-temp-files, the background task profiles', not left, left)
    code = run([setup, '/S', '/uninstall', '/testkeys', '/installdir:' + INSTALL])
    check('uninstalling again: "not installed" (exit 10)', code == 10, code)


def phase_decoder(release):
    section('0b. the payload decoder: synthetic streams, then the real payload against the release folder')
    payload = os.path.join(WORK, 'payload.bin')
    if not os.path.exists(payload):
        check('installer/work/payload.bin exists (made by build.py)', False)
        return
    r = subprocess.run([sys.executable, os.path.join(HERE, 'tests', 'lzma_roundtrip.py'), '--payload', payload, '--release', release],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
    for line in r.stdout.splitlines():
        if line.startswith(('FAIL', '     unpacked', 'RESULT')):
            print('     ' + line)
    passed = sum(1 for l in r.stdout.splitlines() if l.startswith('PASS'))
    check('lzma_roundtrip.py: %d checks pass (raw streams, x86 BCJ, damaged input, packages, the release payload byte for byte)' % passed,
          r.returncode == 0 and 'RESULT ok' in r.stdout, (r.stdout + r.stderr)[-600:] if r.returncode else '')


def phase_migration_rules():
    section('0c. the Vitre -> Deer profile copy (tests/migration.py --no-launcher: the rules through probe.exe)')
    r = subprocess.run([sys.executable, os.path.join(HERE, 'tests', 'migration.py'), '--no-launcher'], capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=900)
    for line in r.stdout.splitlines():
        if line.startswith(('FAIL', 'RESULT')):
            print('     ' + line)
    passed = sum(1 for l in r.stdout.splitlines() if l.startswith('PASS'))
    check('migration.py: %d checks pass (nothing to copy, a full copy, in use, stale lock, unreadable file, crash leftover, two at once)' % passed,
          r.returncode == 0 and 'RESULT ok' in r.stdout, (r.stdout + r.stderr)[-600:] if r.returncode else '')


def version_file_ok(folder):
    """deer-version.json in `folder` matches build.json."""
    try:
        v = json.load(open(os.path.join(folder, 'deer-version.json'), encoding='utf-8'))
    except (OSError, ValueError) as e:
        return False, str(e)
    want = {'product': 'Deer', 'version': build_info.get('version'), 'build': build_info.get('build'), 'buildDate': build_info.get('buildDate'),
            'engineVersion': build_info.get('engineVersion'), 'engineBuildId': build_info.get('engineBuildID'), 'platform': 'win64',
            'channel': 'local-test' if build_info.get('devEngine') else 'release'}
    bad = {k: (v.get(k), w) for k, w in want.items() if v.get(k) != w}
    return not bad, bad or v


def start_deer_on_profile(env):
    """Starts the installed Deer.exe on the test profile; returns (pid, command line) of its browser process."""
    code = run([os.path.join(INSTALL, 'Deer.exe'), '-profile', PROFILE], env=env, timeout=60)
    if code != 0:
        return None, 'Deer.exe exit %s' % code
    return wait_for(lambda: (lambda r: r if r[0] else None)(deer_parent()), 30) or (None, '')


def phase_update_mode(setup):
    section('7. /update (Deer\'s updater): not installed, Deer closed, Deer running (waits, restarts), /norestart, newer installed')
    clean = dict(os.environ)
    for k in [k for k in clean if k.startswith('VITRE_') or k == 'DEER_PROFILE']:
        clean.pop(k)
    log = lambda name: '/log:' + os.path.join(OUT, name + '.log')
    code = run([setup, '/update', '/testkeys', log('update-none')], env=clean)
    check('/update with nothing installed: exit 10, nothing written', code == 10 and not os.path.exists(INSTALL) and not reg_exists(TEST_ROOT), code)

    code = run([setup, '/S', log('update-base')] + setup_args(), env=clean)
    check('install for the /update tests exits 0', code == 0, code)
    rec = os.path.join(INSTALL, 'install.ini')
    set_ini(rec, 'Version', '0.0.9')
    marker = os.path.join(INSTALL, 'engine', 'stale-file-of-an-older-version.txt')
    open(marker, 'w').close()
    t0 = time.time()
    code = run([setup, '/update', '/testkeys', log('update-closed')], env=clean)
    took = time.time() - t0
    version = build_info.get('version')
    check('/update over 0.0.9 while Deer is closed: exit 0 (%.1f s), new version recorded, old files gone' % took,
          code == 0 and read_ini(rec).get('Version') == version and not os.path.exists(marker), code)
    ok, detail = version_file_ok(INSTALL)
    check('deer-version.json of the updated install matches the build', ok, detail)
    time.sleep(2)
    check('/update did not start Deer (it was not running)', not pids_from(INSTALL), pids_from(INSTALL))
    check('/update kept the install a just-for-me install in the same folder', read_ini(rec).get('Scope') == 'user' and
          (reg_values(TEST_ROOT + r'\Microsoft\Windows\CurrentVersion\Uninstall\Deer') or {}).get('InstallLocation', (None,))[0] == INSTALL)

    # Deer running: the update waits for it to close, installs, and starts it again.
    os.makedirs(PROFILE, exist_ok=True)
    pid, cmd = start_deer_on_profile(clean)
    if not check('Deer runs on the test profile before the update', pid and PROFILE in cmd, cmd):
        return
    time.sleep(3)
    sentinel = os.path.join(PROFILE, 'deer-installer-test-sentinel.txt')
    open(sentinel, 'w').write('kept')
    set_ini(rec, 'Version', '0.0.9')
    upd = subprocess.Popen([setup, '/update', '/testkeys', '/wait:120', log('update-running')], env=clean,
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(4)
    check('/update waits while Deer runs (no files touched yet)', upd.poll() is None and read_ini(rec).get('Version') == '0.0.9')
    check('Deer closes', close_deer())
    try:
        code = upd.wait(180)
    except subprocess.TimeoutExpired:
        upd.kill()
        code = None
    check('/update installs once Deer has closed (exit 0)', code == 0 and read_ini(rec).get('Version') == version, code)
    pid2, cmd2 = wait_for(lambda: (lambda r: r if r[0] else None)(deer_parent()), 30) or (None, '')
    check('/update started Deer again, on the same (test) profile', pid2 and pid2 != pid and PROFILE in cmd2, cmd2)
    check('the person\'s data is kept (profile marker, prefs.js, a file the test put there)', os.path.exists(os.path.join(PROFILE, 'vitre-profile')) and
          os.path.exists(os.path.join(PROFILE, 'prefs.js')) and os.path.exists(sentinel) and open(sentinel).read() == 'kept')
    time.sleep(3)

    # /norestart: the updater installs at quit and Deer stays closed.
    set_ini(rec, 'Version', '0.0.9')
    upd = subprocess.Popen([setup, '/update', '/norestart', '/testkeys', '/wait:120', log('update-norestart')], env=clean,
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    check('Deer closes (update /norestart waiting)', close_deer())
    try:
        code = upd.wait(180)
    except subprocess.TimeoutExpired:
        upd.kill()
        code = None
    time.sleep(4)
    check('/update /norestart: exit 0, installed, Deer not started again', code == 0 and read_ini(rec).get('Version') == version and not pids_from(INSTALL),
          (code, pids_from(INSTALL)))
    kill_tree(pids_from(INSTALL))

    # "Restart to update" as Deer's updater should call it: /launch starts Deer afterwards even when the
    # browser had already quit before setup looked (the updater starts setup and quits at once).
    set_ini(rec, 'Version', '0.0.9')
    code = run([setup, '/update', '/launch', '/testkeys', log('update-launch')], env=clean)
    pid3, cmd3 = wait_for(lambda: (lambda r: r if r[0] else None)(deer_parent()), 30) or (None, '')
    check('/update /launch with Deer already closed: exit 0, installed, Deer started on the test profile',
          code == 0 and read_ini(rec).get('Version') == version and pid3 and PROFILE in cmd3, (code, cmd3))
    time.sleep(3)
    check('Deer closes (after /update /launch)', close_deer())

    set_ini(rec, 'Version', '9.9.9')
    code = run([setup, '/update', '/testkeys', log('update-newer')], env=clean)
    check('/update over a newer version is refused (exit 6) and changes nothing', code == 6 and read_ini(rec).get('Version') == '9.9.9', code)
    time.sleep(2)
    check('... and without /launch starts nothing', not pids_from(INSTALL), pids_from(INSTALL))
    set_ini(rec, 'Version', version)

    # "Restart to update" (/update /launch) stopping early: Deer quit for it, so it is started again.
    def restarted(label, code, want_code, version_now):
        pid, cmd = wait_for(lambda: (lambda r: r if r[0] else None)(deer_parent()), 30) or (None, '')
        check('%s: exit %d, %s, Deer started again on the test profile' % (label, want_code, 'nothing installed' if version_now != version else 'installed'),
              code == want_code and read_ini(rec).get('Version') == version_now and pid and PROFILE in cmd, (code, read_ini(rec).get('Version'), cmd))
        time.sleep(2)
        check('Deer closes (%s)' % label, close_deer())

    set_ini(rec, 'Version', '9.9.9')
    code = run([setup, '/update', '/launch', '/testkeys', log('update-launch-newer')], env=clean)
    restarted('/update /launch over a newer version', code, 6, '9.9.9')
    set_ini(rec, 'Version', '0.0.9')
    code = run([setup, '/update', '/launch', '/testkeys', '/sha256:' + '0' * 64, log('update-launch-sha-wrong')], env=clean)
    text = open(os.path.join(OUT, 'update-launch-sha-wrong.log'), encoding='utf-8', errors='replace').read()
    check('/sha256 that is not this setup file\'s: refused before anything else, saying why', 'is not the file Deer checked' in text, 'update-launch-sha-wrong.log')
    restarted('/update /launch /sha256:<another file\'s>', code, 4, '0.0.9')
    code = run([setup, '/update', '/launch', '/testkeys', '/sha256:' + sha256(setup), log('update-launch-sha')], env=clean)
    text = open(os.path.join(OUT, 'update-launch-sha.log'), encoding='utf-8', errors='replace').read()
    check('/sha256 of this setup file: it says so and holds the file while it runs', 'has the SHA-256 Deer checked' in text, 'update-launch-sha.log')
    restarted('/update /launch /sha256:<this file\'s>', code, 0, version)
    code = run([setup, '/S', '/sha256:' + sha256(setup), '/log:' + os.path.join(OUT, 'sha-without-update.log')] + setup_args(), env=clean)
    check('/sha256 without /update: bad arguments (exit 1)', code == 1, code)

    # Another setup holds the "one setup at a time" mutex: /update waits for it (up to /wait).
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    k32.CreateMutexW.restype = wt.HANDLE
    k32.CreateMutexW.argtypes = [ctypes.c_void_p, wt.BOOL, wt.LPCWSTR]
    k32.ReleaseMutex.argtypes = [wt.HANDLE]
    gate = k32.CreateMutexW(None, True, GATE)
    try:
        set_ini(rec, 'Version', '0.0.9')
        t0 = time.time()
        code = run([setup, '/update', '/launch', '/testkeys', '/wait:4', log('update-launch-gate-busy')], env=clean)
        took = time.time() - t0
        text = open(os.path.join(OUT, 'update-launch-gate-busy.log'), encoding='utf-8', errors='replace').read()
        check('/update while another setup runs: it waits /wait (%.1f s) for it before giving up' % took, took >= 3.5 and 'waiting up to 4 s' in text, took)
        restarted('/update /launch with another setup still running', code, 9, '0.0.9')
        upd = subprocess.Popen([setup, '/update', '/launch', '/testkeys', '/wait:90', log('update-launch-gate-wait')], env=clean,
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(4)
        check('/update waits while another setup runs (nothing installed yet)', upd.poll() is None and read_ini(rec).get('Version') == '0.0.9')
    finally:
        k32.ReleaseMutex(gate)
        k32.CloseHandle(gate)
    try:
        code = upd.wait(180)
    except subprocess.TimeoutExpired:
        upd.kill()
        code = None
    restarted('/update /launch once the other setup finished', code, 0, version)
    # The setup waited for installed this very version meanwhile: nothing to install, Deer started.
    gate = k32.CreateMutexW(None, True, GATE)
    try:
        upd = subprocess.Popen([setup, '/update', '/launch', '/testkeys', '/wait:90', log('update-launch-gate-same')], env=clean,
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(3)
        stamp = os.path.getmtime(os.path.join(INSTALL, 'Deer.exe'))
    finally:
        k32.ReleaseMutex(gate)
        k32.CloseHandle(gate)
    try:
        code = upd.wait(120)
    except subprocess.TimeoutExpired:
        upd.kill()
        code = None
    text = open(os.path.join(OUT, 'update-launch-gate-same.log'), encoding='utf-8', errors='replace').read()
    check('after waiting, the same version already installed: nothing installed again (the log says so, Deer.exe untouched)',
          'nothing to install' in text and os.path.getmtime(os.path.join(INSTALL, 'Deer.exe')) == stamp, 'update-launch-gate-same.log')
    restarted('/update /launch after another setup installed this version', code, 0, version)
    code = run([os.path.join(INSTALL, 'Uninstall.exe'), '/S', '/removedata', log('update-uninstall')])
    gone = wait_for(lambda: not os.path.exists(INSTALL), 15)
    check('uninstall after the /update tests: exit 0, folder, data and test keys gone', code == 0 and gone and not os.path.exists(DATA) and
          not reg_exists(TEST_ROOT), code)


# ---- all users (test mode: HKCU\Software\DeerTestMachine stands in for HKLM\Software) -----------------

def machine_paths():
    install = os.path.join(TEST, 'ProgramFiles', 'Deer')
    start = os.path.join(LINKS, 'All Users', 'Start Menu', 'Programs', 'Deer.lnk')
    desktop = os.path.join(LINKS, 'All Users', 'Desktop', 'Deer.lnk')
    return install, start, desktop


def machine_args(install, extra=()):
    return ['/allusers', '/testkeys', '/installdir:' + install, '/shortcutdir:' + LINKS, '/datadir:' + DATA] + list(extra)


def check_machine_install(install, start, desktop, want_desktop, label):
    exe = os.path.join(install, 'Deer.exe')
    unin = os.path.join(install, 'Uninstall.exe')
    rec = read_ini(os.path.join(install, 'install.ini'))
    check('%s: files in place, install record says all users (Scope=machine, test root %s)' % (label, TEST_MACHINE_ROOT),
          os.path.exists(os.path.join(install, 'engine', 'deer.exe')) and rec.get('Scope') == 'machine' and rec.get('Mode') == 'test' and
          rec.get('RegistryRoot') == TEST_MACHINE_ROOT and rec.get('StartMenuShortcut') == start, rec)
    root = TEST_MACHINE_ROOT
    client = root + r'\Clients\StartMenuInternet\Deer'
    checks = [(root + r'\Microsoft\Windows\CurrentVersion\Uninstall\Deer', 'InstallLocation', install),
              (root + r'\Microsoft\Windows\CurrentVersion\Uninstall\Deer', 'UninstallString', '"%s"' % unin),
              (root + r'\Microsoft\Windows\CurrentVersion\Uninstall\Deer', 'DisplayVersion', build_info.get('version')),
              (client + r'\shell\open\command', '', '"%s"' % exe),
              (client + r'\Capabilities\URLAssociations', 'https', 'DeerURL'),
              (root + r'\RegisteredApplications', 'Deer', root + r'\Clients\StartMenuInternet\Deer\Capabilities'),
              (root + r'\Microsoft\Windows\CurrentVersion\App Paths\Deer.exe', '', exe),
              (root + r'\Classes\DeerHTML\shell\open\command', '', '"%s" -osint -url "%%1"' % exe),
              (root + r'\Classes\DeerURL', 'URL Protocol', '')]
    wrong = ['%s : %s = %r' % (k, n or '(default)', (reg_values(k) or {}).get(n, (None,))[0]) for k, n, v in checks if (reg_values(k) or {}).get(n, (None,))[0] != v]
    check('%s: StartMenuInternet, RegisteredApplications, App Paths, ProgIDs and the Uninstall key in the machine root' % label, not wrong, wrong)
    check('%s: nothing in the just-for-me test root' % label, not reg_exists(TEST_ROOT), reg_tree(TEST_ROOT))
    info = dict(line.split('=', 1) for line in subprocess.run([os.path.join(WORK, 'probe.exe'), 'lnk', start], capture_output=True, text=True,
                                                              encoding='utf-8').stdout.splitlines() if '=' in line) if os.path.exists(start) else {}
    check('%s: common Start menu shortcut (All Users), target Deer.exe, AppUserModelID Deer.Browser' % label,
          info.get('target') == exe and info.get('aumid') == 'Deer.Browser', info)
    check('%s: common desktop shortcut %s' % (label, 'made' if want_desktop else 'not made'), os.path.exists(desktop) == want_desktop)
    ok, detail = version_file_ok(install)
    check('%s: deer-version.json matches the build' % label, ok, detail)


def phase_all_users(setup, gui=True):
    section('8. install for all users (test mode: no UAC, the elevated step runs as a plain child; HKCU\\%s for HKLM)' % TEST_MACHINE_ROOT)
    install, start, desktop = machine_paths()
    clean = dict(os.environ)
    for k in [k for k in clean if k.startswith('VITRE_') or k == 'DEER_PROFILE']:
        clean.pop(k)
    log = os.path.join(OUT, 'allusers-install.log')
    t0 = time.time()
    code = run([setup, '/S', '/desktop', '/log:' + log] + machine_args(install), env=clean)
    took = time.time() - t0
    text = open(log, encoding='utf-8', errors='replace').read()
    check('silent all-users install exits 0 (%.1f s)' % took, code == 0, code)
    check('setup handed the work to an elevated copy (test mode: a plain child, never UAC) and the copy ran with /elevated',
          'test mode: starting the administrator step as a plain child process (no UAC)' in text and
          text.count('Deer setup ') == 2 and '/elevated' in text.split('Deer setup ')[2] and 'asking for administrator permission' not in text, log)
    check('the log ends with RESULT 0 (the parent, after its elevated copy)', text.strip().endswith('RESULT 0') and text.count('RESULT 0') == 2)
    check_machine_install(install, start, desktop, True, 'all users')
    exe = os.path.join(install, 'Deer.exe')

    code = run([setup, '/S', '/log:' + os.path.join(OUT, 'allusers-then-user.log')] + setup_args(), env=clean)
    check('a just-for-me install is refused while Deer is installed for all users (exit 8)', code == 8 and not os.path.exists(INSTALL), code)
    code = run([setup, '/S', '/log:' + os.path.join(OUT, 'allusers-again.log')] + machine_args(install), env=clean)
    check('setup again for all users (same folder): exit 0, desktop shortcut kept', code == 0 and os.path.exists(desktop), code)

    # /update of an all-users install: the elevated copy waits and installs, this run restarts Deer.
    os.makedirs(PROFILE, exist_ok=True)
    rec = os.path.join(install, 'install.ini')
    code = run([exe, '-profile', PROFILE], env=clean, timeout=60)
    running = wait_for(lambda: pids_from(install), 30)
    check('Deer runs from the all-users install', code == 0 and running, code)
    time.sleep(3)
    set_ini(rec, 'Version', '0.0.9')
    upd_log = os.path.join(OUT, 'allusers-update.log')
    # A copy of the setup (the file Deer's updater would have checked and started), so that an attempt
    # to rename it can never move the build's own file.
    held = os.path.join(TEST, 'Deer-Setup-held.exe')
    shutil.copyfile(setup, held)
    upd = subprocess.Popen([held, '/update', '/testkeys', '/installdir:' + install, '/wait:120', '/sha256:' + sha256(held), '/log:' + upd_log], env=clean,
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(4)
    check('/update of the all-users install waits while Deer runs', upd.poll() is None)
    # Its elevated step was started from that file: nothing may put another file in its place now.
    renamed = written = False
    try:
        os.rename(held, held + '.swapped')
        renamed = True
        os.rename(held + '.swapped', held)
    except OSError:
        pass
    try:
        with open(held, 'r+b'):
            written = True
    except OSError:
        pass
    check('while the update runs, the setup file it was started from cannot be renamed or opened for writing (/sha256: held)',
          not renamed and not written, (renamed, written))
    for h in top_windows(set(pids_from(install))):
        if window_class(h) == 'MozillaWindowClass':
            user32.PostMessageW(h, 0x0010, 0, 0)
    closed = wait_for(lambda: not pids_from(install), 45, 0.5)
    check('Deer closes', closed)
    try:
        code = upd.wait(180)
    except subprocess.TimeoutExpired:
        upd.kill()
        code = None
    text = open(upd_log, encoding='utf-8', errors='replace').read()
    check('/update all users: exit 0 through the elevated copy (/norestart there), version recorded',
          code == 0 and 'starting the administrator step' in text and '/norestart' in text and read_ini(rec).get('Version') == build_info.get('version'), code)
    try:
        os.remove(held)
        check('the setup file is free again once setup ended', True)
    except OSError as e:
        check('the setup file is free again once setup ended', False, e)
    back = wait_for(lambda: pids_from(install), 30)
    check('/update all users: the unelevated run started Deer again', back, upd_log)
    time.sleep(3)
    for h in top_windows(set(pids_from(install))):
        if window_class(h) == 'MozillaWindowClass':
            user32.PostMessageW(h, 0x0010, 0, 0)
    if not wait_for(lambda: not pids_from(install), 45, 0.5):
        kill_tree(pids_from(install))
        time.sleep(2)
    engine = os.path.join(install, 'engine')
    traces = mozilla_traces(engine)
    hashes = subprocess.run([os.path.join(WORK, 'probe.exe'), 'hash', engine], capture_output=True, text=True).stdout.split()[:1]

    # Uninstall: the uninstaller of an all-users install hands over to an elevated copy too.
    unlog = os.path.join(OUT, 'allusers-uninstall.log')
    code, took, eof = run_piped([os.path.join(install, 'Uninstall.exe'), '/S', '/log:' + unlog])
    text = open(unlog, encoding='utf-8', errors='replace').read()
    check('Uninstall.exe /S of the all-users install: exit 0 through the elevated copy', code == 0 and 'starting the administrator step' in text and
          text.count('Deer uninstaller ') == 2, '%s after %.1f s' % (code, took))
    gone = wait_for(lambda: not os.path.exists(install), 20)
    check('all-users install folder gone (the elevated copy removed Uninstall.exe after both exited)', gone,
          os.listdir(install) if os.path.exists(install) else '')
    check('both All Users shortcuts gone, HKCU\\%s gone entirely' % TEST_MACHINE_ROOT,
          not os.path.exists(start) and not os.path.exists(desktop) and not reg_exists(TEST_MACHINE_ROOT), reg_tree(TEST_MACHINE_ROOT))
    check('the data folder is kept (default)', os.path.exists(os.path.join(PROFILE, 'vitre-profile')))
    left = mozilla_traces(engine) + [t for h in hashes for t in hash_traces(h)]
    check('the engine\'s per-install traces of the all-users install are removed (%d were there)' % len(traces), not left, left)

    if gui:
        phase_all_users_gui(setup)
    rmtree(DATA)


def phase_all_users_gui(setup):
    install, start, desktop = machine_paths()
    if not check('no all-users test install is left before the wizard test', not os.path.exists(install)):
        return
    log = os.path.join(OUT, 'allusers-gui.log')
    p = subprocess.Popen([setup, '/testkeys', '/installdir:' + install, '/shortcutdir:' + LINKS, '/datadir:' + DATA, '/log:' + log])
    try:
        hwnd = wizard_window(p.pid)
        if not check('wizard opens (for the all-users choice)', hwnd):
            return
        user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
        time.sleep(0.8)
        just = control(hwnd, 'Just for me (no administrator permission needed)')
        everyone = control(hwnd, 'All users of this computer (needs administrator permission)')
        check('options page offers "Install for": Just for me (chosen) and All users', 'Install for' in body_text(hwnd) and just and everyone and
              checked(just) and not checked(everyone), body_text(hwnd)[:300])
        press(everyone)
        time.sleep(0.4)
        check('"All users" can be chosen', everyone and checked(everyone) and not checked(just))
        capture(hwnd, 'gui-5-allusers-options')
        press(control(hwnd, 'Install'))
        done = wait_for(lambda: control(hwnd, 'Finish'), 180)
        if not check('the all-users install runs to the finish page (progress of the elevated copy)', done, body_text(hwnd)[:300]):
            return
        time.sleep(0.5)
        capture(hwnd, 'gui-6-allusers-done')
        press(done)
        p.wait(30)
        check('wizard exits with 0', p.returncode == 0, p.returncode)
    finally:
        if p.poll() is None:
            p.kill()
    text = open(log, encoding='utf-8', errors='replace').read()
    check('the wizard ran the install in its elevated copy (test mode: plain child)', 'starting the administrator step' in text and '/elevated' in text)
    check_machine_install(install, start, desktop, True, 'wizard, all users')
    code = run([os.path.join(install, 'Uninstall.exe'), '/S', '/log:' + os.path.join(OUT, 'allusers-gui-uninstall.log')])
    gone = wait_for(lambda: not os.path.exists(install), 20)
    check('uninstall of the wizard\'s all-users install: exit 0, folder, shortcuts and machine test root gone',
          code == 0 and gone and not os.path.exists(start) and not reg_exists(TEST_MACHINE_ROOT), code)


def jump_lists_naming(exe, since=None):
    """Windows' stored jump lists (%APPDATA%\\...\\Recent\\CustomDestinations) that name `exe`, as
    (written since `since`, older ones)."""
    base = os.path.join(os.environ['APPDATA'], r'Microsoft\Windows\Recent\CustomDestinations')
    found, older = [], []
    try:
        names = os.listdir(base)
    except OSError:
        return found, older
    for name in names:
        try:
            path = os.path.join(base, name)
            data = open(path, 'rb').read()
            fresh = since is None or os.path.getmtime(path) >= since
        except OSError:
            continue
        if any(exe.lower() in data[off:].decode('utf-16le', 'ignore').lower() for off in (0, 1)):
            (found if fresh else older).append(name)
    return found, older


def split_foreign(diff, ours):
    """(entries naming this test's folders or engine install hashes, the others). Other programs may run
    a Gecko engine meanwhile (other agents' tests on this machine do): their entries name their own
    engine folders and hashes and are reported as notes, not failures."""
    mine, foreign = [], []
    for entry in diff:
        text = ' '.join(entry) if isinstance(entry, tuple) else str(entry)
        (mine if any(o.lower() in text.lower() for o in ours) else foreign).append(entry)
    return mine, foreign


def compare(before, after, ours):
    section('9. nothing outside the test folders changed')
    for key in before:
        b, a = before[key], after[key]
        if key == 'mozilla-registry':
            diff = sorted(set((k, n) for k, v in (b or {}).items() for n in (v or {})) ^ set((k, n) for k, v in (a or {}).items() for n in (v or {})))
            mine, foreign = split_foreign(diff, ours)
            check('HKCU\\Software\\Mozilla: same keys and values as before (for this test\'s engines)', not mine, mine[:8])
            if foreign:
                note('HKCU\\Software\\Mozilla changed meanwhile, but not for this test\'s engines (another program ran one): %s' % foreign[:4])
            continue
        if key in ('appdata-deer', 'localappdata-deer'):
            # Nothing of the person's Deer folders is ever removed or changed. An engine with Deer's identity
            # that another program runs meanwhile makes Gecko's empty Profiles folders: a note, not a failure.
            removed = sorted(set(b) - set(a))
            changed = sorted(k for k in set(a) & set(b) if not a[k][0] and a[k] != b[k])
            added = sorted(set(a) - set(b))
            check('%s: nothing removed or changed' % key, not removed and not changed, (removed + changed)[:8])
            bad = [k for k in added if k.split(os.sep)[0] != 'Profiles']
            check('%s: nothing added (but Gecko\'s own Profiles folder)' % key, not bad, bad[:8])
            if added and not bad:
                note('%s gained %s meanwhile (an engine with Deer\'s identity ran somewhere else)' % (key, added[:4]))
            continue
        if key in ('appdata-mozilla', 'localappdata-mozilla', 'programdata-mozilla', 'classes-appusermodelid', 'classes-clsid',
                   'notification-settings'):
            # Only presence matters for folders and keys other programs may also write in.
            diff = sorted(set(b) ^ set(a))
            if key in ('appdata-mozilla', 'localappdata-mozilla', 'programdata-mozilla'):
                diff, foreign = split_foreign(diff, ours)
                if foreign:
                    note('%s changed meanwhile, not under this test\'s folders or engine hashes (another program?): %s' % (key, foreign[:4]))
            check('%s: no entry added or removed' % key, not diff, diff[:8])
            continue
        check('%s unchanged' % key, b == a, '' if b == a else str(sorted(set(b or {}) ^ set(a or {})) if isinstance(b, dict) else (b, a))[:400])


def build_probe():
    csc = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), r'Microsoft.NET\Framework64\v4.0.30319\csc.exe')
    out = os.path.join(WORK, 'probe.exe')
    os.makedirs(WORK, exist_ok=True)
    r = subprocess.run([csc, '/nologo', '/target:exe', '/optimize+', '/out:' + out, os.path.join(HERE, 'tests', 'Probe.cs')] +
                       [os.path.join(HERE, n) for n in ('Shell.cs', 'EngineTraces.cs', 'Lzma.cs', 'Package.cs', 'ProfileMigration.cs')],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit('probe build failed:\n' + r.stdout + r.stderr)
    return out


setup_path = None
build_info = {}


def check_root(root):
    """The test deletes its root at the start and the end: only a folder inside %TEMP% that is new or
    holds nothing but what this test puts there."""
    temp = os.path.normcase(os.path.abspath(tempfile.gettempdir())) + os.sep
    if not os.path.normcase(root).startswith(temp):
        sys.exit('--root must be a folder inside %s' % tempfile.gettempdir())
    if os.path.isdir(root):
        foreign = sorted(set(os.listdir(root)) - ROOT_ENTRIES)
        if foreign:
            sys.exit('--root %s holds things this test did not create (%s): choose another folder' % (root, ', '.join(foreign[:5])))
    elif os.path.exists(root):
        sys.exit('--root %s is a file' % root)


def main():
    global setup_path, build_info
    ap = argparse.ArgumentParser()
    ap.add_argument('--setup')
    ap.add_argument('--keep', action='store_true', help='keep the test folder afterwards')
    ap.add_argument('--no-gui', action='store_true')
    ap.add_argument('--root', help='test folder inside the temp folder (default: deer-installer-test there)')
    a = ap.parse_args()
    if a.root:
        set_root(os.path.abspath(a.root))
    check_root(TEST)
    info = json.load(open(os.path.join(HERE, 'out', 'build.json')))
    build_info = info
    started = time.time()
    setup_path = os.path.abspath(a.setup or info['setup'])
    release = info['release']
    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):  # setup appends to its logs: every run starts with none
        if name.endswith('.log'):
            os.remove(os.path.join(OUT, name))
    print('setup %s (%.1f MB, payload %s, %s blocks)\nrelease %s\nengine %s (brand %s, dev engine %s, media placeholder %s)\ntest folder %s\n' % (
        setup_path, os.path.getsize(setup_path) / 1048576, info.get('payloadFormat'), info.get('payloadBlocks'), release, info.get('engine'),
        info.get('engineBrand'), info.get('devEngine'), info.get('mediaPlaceholder'), TEST))

    if pids_from(TEST):
        kill_tree(pids_from(TEST))
        time.sleep(2)
    rmtree(TEST)
    for root in (TEST_ROOT, TEST_MACHINE_ROOT):
        if reg_exists(root):
            print('removing HKCU\\%s left by an earlier test run' % root)
            reg_delete_tree(root)
    # Every program this test starts (setup, the uninstallers, Deer.exe) gets the stand-ins.
    os.environ.update(DEER_TEST_APPDATA=ROAMING, DEER_TEST_LOCALAPPDATA=LOCAL_STAND, DEER_TEST_TEMP=TEMP_STAND)
    probe = build_probe()

    section('0. snapshots')
    before = snapshots()
    print('     taken: ' + ', '.join(before))
    install_engine = os.path.join(INSTALL, 'engine')
    r = subprocess.run([probe, 'hash', install_engine], capture_output=True, text=True)
    install_hashes = [r.stdout.split()[0]] if r.stdout.strip() else []
    print('     the test install\'s engine hash: %s' % install_hashes)
    r = subprocess.run([probe, 'hash', os.path.join(machine_paths()[0], 'engine')], capture_output=True, text=True)
    ours = [TEST] + install_hashes + r.stdout.split()[:1]  # what names this test's engines in the snapshot diffs
    preexisting = [t for h in install_hashes for t in hash_traces(h)] + mozilla_traces(install_engine)
    if preexisting:
        note('engine traces for the test path existed before this run (an earlier aborted run): %s' % preexisting)

    try:
        phase_decoder(release)
        phase_migration_rules()
        if not a.no_gui:
            phase_gui(setup_path)
        phase_silent_install(setup_path, release)
        traces = phase_launch(setup_path, gui=not a.no_gui)
        phase_migration()
        hashed = [t for h in install_hashes for t in hash_traces(h)]
        print('     engine install-hash entries after the run: %s' % hashed)
        phase_launcher_errors()
        phase_update(setup_path)
        phase_uninstall(traces, install_hashes)
        phase_removedata(setup_path)
        phase_update_mode(setup_path)
        phase_all_users(setup_path, gui=not a.no_gui)
    finally:
        if pids_from(TEST):
            kill_tree(pids_from(TEST))
            time.sleep(2)
        # A phase that failed half way may leave a test install: its own uninstaller removes it and the
        # engine's traces for it (in HKCU\Software\Mozilla and %ProgramData%), before the comparison.
        for left in (INSTALL, machine_paths()[0]):
            if os.path.exists(os.path.join(left, 'install.ini')) and os.path.exists(os.path.join(left, 'Uninstall.exe')):
                print('removing the test install left in %s' % left)
                run([os.path.join(left, 'Uninstall.exe'), '/S', '/wait:30', '/log:' + os.path.join(OUT, 'leftover-uninstall.log')])
                wait_for(lambda: not os.path.exists(left), 20)
        after = snapshots()
        compare(before, after, ours)
        jumps, stale = jump_lists_naming(os.path.join(INSTALL, 'engine', 'deer.exe'), started)
        if jumps:
            note('Windows keeps a taskbar jump list that Gecko wrote while the test Deer ran (%s in %%APPDATA%%\\Microsoft\\Windows\\Recent\\'
                 'CustomDestinations): its tasks start <install>\\engine\\deer.exe WITHOUT -profile, i.e. on the Firefox profile store. '
                 'Fix in the product prefs (browser.taskbar.lists.enabled=false), not in the installer' % ', '.join(jumps))
        if stale:
            note('jump lists written before this run still name the test install\'s deer.exe (%s in %%APPDATA%%\\Microsoft\\Windows\\Recent\\'
                 'CustomDestinations; an earlier run, before browser.taskbar.lists.enabled=false): delete them by hand' % ', '.join(stale))
        for key in planted:  # in case the uninstaller did not remove them (the checks above say so)
            if reg_exists(key):
                print('removing the planted HKCU\\%s' % key)
                reg_delete_tree(key)
        for key, name in planted_values:
            if (reg_values(key) or {}).get(name) is not None:
                print('removing the planted value HKCU\\%s : %s' % (key, name))
                k = winreg.OpenKey(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE)
                winreg.DeleteValue(k, name)
                winreg.CloseKey(k)
        for f in planted_files:
            if os.path.exists(f):
                print('removing the planted file %s' % f)
                os.remove(f)
            folder = os.path.dirname(f)
            if os.path.basename(folder).startswith('MozillaBackgroundTask-') and os.path.isdir(folder) and not os.listdir(folder):
                os.rmdir(folder)
        if not a.keep:
            rmtree(TEST)
            for root in (TEST_ROOT, TEST_MACHINE_ROOT):
                if reg_exists(root):
                    reg_delete_tree(root)
    for n in notes:
        print('NOTE ' + n)
    print('RESULT %s' % ('ok' if not failed else '%d failed' % failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
