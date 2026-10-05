"""Runner for the packaging spike: like gecko/tools/run.py but for this spike's own runtime copy
and with the production loader (no VITRE_BOOT needed).

  python spikes/packaging/run-dist.py --name packaging-x [--boot spikes/packaging/boot-x.js]
      [--runtime <dir with firefox.exe>] [--url URL] [--timeout 90] [--pref k=v] [--arg X]
      [--env K=V] [--remote] [--keep-profile] [--profile <dir>] [--out <dir>]
      [--shoot name:seconds ...]   external screenshots at fixed times (for runs without a boot script)
      [--app-ini path]             launch "firefox.exe -app path" instead of the browser

--remote drops -no-remote so Firefox's own single-instance remoting is active for that profile.
Without --boot nothing Vitre-specific is in the environment except VITRE_LOG (so traces are kept).
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
spec = importlib.util.spec_from_file_location('vitre_run', os.path.join(ROOT, 'tools', 'run.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


# ---- window identity probes (title, AppUserModelID, window icon) ---------------------------------
import ctypes
import ctypes.wintypes as wt


class GUID(ctypes.Structure):
    _fields_ = [('d1', wt.DWORD), ('d2', wt.WORD), ('d3', wt.WORD), ('d4', ctypes.c_ubyte * 8)]


class PROPERTYKEY(ctypes.Structure):
    _fields_ = [('fmtid', GUID), ('pid', wt.DWORD)]


class PROPVARIANT(ctypes.Structure):
    _fields_ = [('vt', ctypes.c_ushort), ('r1', ctypes.c_ushort), ('r2', ctypes.c_ushort), ('r3', ctypes.c_ushort),
                ('p', ctypes.c_void_p), ('p2', ctypes.c_void_p)]


def window_aumid(hwnd):
    """System.AppUserModel.ID set on the window (what the taskbar groups by), or '' if not set."""
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
        val = '(unset: hr=%#x vt=%d)' % (hr & 0xffffffff, pv.vt)
        if hr in (0, 1) and pv.vt == 31 and pv.p:  # VT_LPWSTR (cross-process reads return S_FALSE)
            val = ctypes.wstring_at(pv.p)
        release(ps)
        return val
    except Exception as e:  # pragma: no cover
        return '(error %s)' % e


def window_title(hwnd):
    buf = ctypes.create_unicode_buffer(512)
    base.user32.GetWindowTextW(hwnd, buf, 512)
    return buf.value


def dump_window_icon(hwnd, path, size=64):
    """Draw the window's big icon (WM_GETICON, else the class icon) into a PNG. Returns its source."""
    user32, gdi32 = base.user32, ctypes.windll.gdi32
    user32.SendMessageW.restype = ctypes.c_void_p
    user32.SendMessageW.argtypes = [wt.HWND, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
    hicon = user32.SendMessageW(hwnd, 0x7F, 1, 0)  # WM_GETICON, ICON_BIG
    src = 'WM_GETICON(ICON_BIG)'
    if not hicon:
        user32.GetClassLongPtrW.restype = ctypes.c_void_p
        user32.GetClassLongPtrW.argtypes = [wt.HWND, ctypes.c_int]
        hicon = user32.GetClassLongPtrW(hwnd, -14)  # GCLP_HICON
        src = 'class icon (GCLP_HICON)'
    if not hicon:
        return 'none'
    hdc = user32.GetDC(0)
    mem = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, size, size)
    gdi32.SelectObject(mem, bmp)
    brush = gdi32.CreateSolidBrush(0x00FFFFFF)
    rect = wt.RECT(0, 0, size, size)
    user32.FillRect(mem, ctypes.byref(rect), brush)
    user32.DrawIconEx.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]
    user32.DrawIconEx(mem, 0, 0, hicon, size, size, 0, None, 3)

    class BMI(ctypes.Structure):
        _fields_ = [('biSize', wt.DWORD), ('biWidth', wt.LONG), ('biHeight', wt.LONG), ('biPlanes', wt.WORD),
                    ('biBitCount', wt.WORD), ('biCompression', wt.DWORD), ('biSizeImage', wt.DWORD),
                    ('biXPelsPerMeter', wt.LONG), ('biYPelsPerMeter', wt.LONG), ('biClrUsed', wt.DWORD),
                    ('biClrImportant', wt.DWORD)]

    bmi = BMI(ctypes.sizeof(BMI), size, -size, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(size * size * 4)
    gdi32.GetDIBits(mem, bmp, 0, size, buf, ctypes.byref(bmi), 0)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteObject(brush)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(0, hdc)
    base.png(path, size, size, buf.raw)
    return src


def identity(hwnd, out, name):
    src = dump_window_icon(hwnd, os.path.join(out, name + '.icon.png'))
    return 'title=%r aumid=%r icon=%s -> %s.icon.png' % (window_title(hwnd), window_aumid(hwnd), src, name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--boot')
    ap.add_argument('--name', required=True)
    ap.add_argument('--runtime', default=os.path.join(HERE, 'dist', 'Vitre', 'runtime'))
    ap.add_argument('--url', default='about:blank')
    ap.add_argument('--out')
    ap.add_argument('--timeout', type=float, default=90)
    ap.add_argument('--pref', action='append', default=[])
    ap.add_argument('--arg', action='append', default=[])
    ap.add_argument('--env', action='append', default=[])
    ap.add_argument('--shoot', action='append', default=[])
    ap.add_argument('--remote', action='store_true')
    ap.add_argument('--keep-profile', action='store_true')
    ap.add_argument('--profile')
    ap.add_argument('--no-default-prefs', action='store_true', help='do not write the harness user.js')
    ap.add_argument('--app-ini')
    ap.add_argument('--app-in-profile', help='junction <profile>/chrome -> this folder and load the app from there (VITRE_APP)')
    a = ap.parse_args()

    out = os.path.abspath(a.out or os.path.join(HERE, 'out', a.name))
    os.makedirs(out, exist_ok=True)
    profile = os.path.abspath(a.profile) if a.profile else os.path.join(tempfile.gettempdir(), 'vitre-gecko-' + a.name)
    if not a.keep_profile:
        shutil.rmtree(profile, ignore_errors=True)
    os.makedirs(profile, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith('.done'):
            os.remove(os.path.join(out, f))

    if not a.no_default_prefs:
        prefs = dict(base.PREFS)
        for p in a.pref:
            k, v = p.split('=', 1)
            prefs[k] = json.loads(v) if v in ('true', 'false') or v.lstrip('-').replace('.', '', 1).isdigit() else v
        with open(os.path.join(profile, 'user.js'), 'w', encoding='utf-8') as f:
            for k, v in prefs.items():
                f.write('user_pref(%s, %s);\n' % (json.dumps(k), json.dumps(v)))

    log = os.path.join(out, 'log.txt')
    open(log, 'w').close()
    env = dict(os.environ, VITRE_LOG=log, VITRE_OUT=out, MOZ_CRASHREPORTER_DISABLE='1', MOZ_DISABLE_AUTO_SAFE_MODE='1')
    for k in ('VITRE_BOOT', 'VITRE_LIB', 'VITRE_APP'):
        env.pop(k, None)
    if a.boot:
        env['VITRE_BOOT'] = os.path.abspath(a.boot)
        env['VITRE_LIB'] = os.path.join(ROOT, 'tools', 'spike-lib.js')
    for e in a.env:
        k, v = e.split('=', 1)
        env[k] = v
    if a.app_in_profile:
        # <profile>\chrome is one of the few places outside the install dir that sandboxed content
        # processes may read, so an app folder linked there works without touching the runtime.
        link = os.path.join(profile, 'chrome')
        if os.path.lexists(link):
            os.rmdir(link)
        subprocess.run(['cmd', '/c', 'mklink', '/J', link, os.path.abspath(a.app_in_profile)], check=True, capture_output=True)
        env['VITRE_APP'] = link

    exe = os.path.join(os.path.abspath(a.runtime), 'firefox.exe')
    cmd = [exe]
    if a.app_ini:
        cmd += ['-app', os.path.abspath(a.app_ini)]
    if not a.remote:
        cmd.append('-no-remote')
    cmd += ['-profile', profile, *a.arg]
    if a.url and (not a.app_ini or a.url != 'about:blank'):
        cmd.append(a.url)
    print('[run] ' + ' '.join(cmd))
    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    shots = []
    for s in a.shoot:
        n, t = s.split(':')
        shots.append((float(t), n))
    shots.sort()
    start = time.time()
    seen = 0
    deadline = start + a.timeout
    quit_seen = False
    last_alive_check = start
    try:
        while time.time() < deadline and not quit_seen:
            time.sleep(0.1)
            while shots and time.time() - start >= shots[0][0]:
                _, n = shots.pop(0)
                hwnd = base.find_window(base.firefox_pids(profile))
                if hwnd:
                    ok, w, h = base.capture(hwnd, os.path.join(out, n + '.png'))
                    print('[shoot] %s.png %dx%d ok=%s %s' % (n, w, h, bool(ok), identity(hwnd, out, n)))
                else:
                    print('[shoot] %s: no window found' % n)
            with open(log, encoding='utf-8', errors='replace') as f:
                lines = f.read().split('\n')[:-1]
            for line in lines[seen:]:
                if line.startswith('@@capture '):
                    name = line[10:].strip()
                    hwnd = base.find_window(base.firefox_pids(profile))
                    if hwnd:
                        ok, w, h = base.capture(hwnd, os.path.join(out, name + '.png'))
                        print('[capture] %s.png %dx%d ok=%s %s' % (name, w, h, bool(ok), identity(hwnd, out, name)))
                    else:
                        print('[capture] %s: no window found' % name)
                    open(os.path.join(out, name + '.png.done'), 'w').close()
                elif line.startswith('@@quit'):
                    quit_seen = True
                else:
                    print(line)
            seen = len(lines)
            if not a.boot and not shots and time.time() - start > 2 and not a.shoot == []:
                break
            # The browser may quit by itself (normal shutdown / restart tests): stop when it is gone.
            if time.time() - last_alive_check > 4 and time.time() - start > 8:
                last_alive_check = time.time()
                if not base.firefox_pids(profile):
                    print('[run] browser exited by itself after %.0fs' % (time.time() - start))
                    break
        if not quit_seen and a.boot and time.time() >= deadline:
            print('[run] timed out after %ss' % a.timeout)
    finally:
        time.sleep(0.5)
        for pid in base.firefox_pids(profile):
            subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True)
        proc.poll()
        if a.app_in_profile and os.path.lexists(os.path.join(profile, 'chrome')):
            os.rmdir(os.path.join(profile, 'chrome'))  # drop the junction, never its target


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
