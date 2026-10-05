"""tools/run.py for the extensions tests, with two additions:

  1. captures include Firefox's popup windows (extension popups, the extensions panel, doorhangers,
     menus): XUL panels are separate top-level windows that PrintWindow on the browser window never
     shows, so every visible WS_POPUP window of the same process is captured too and composited at
     its screen position (from spikes/extensions/verify/runx.py). Popup pixels are premultiplied
     BGRA; their transparent shadow margins come out black in PrintWindow, not on screen.
  2. the local test site (serve.py, 127.0.0.1:47651) runs for the duration, and the test extensions
     are built first if they are missing (make-extensions.py).

Same arguments as tools/run.py, e.g.
  python tests/extensions/runx.py --test tests/extensions/bar.js --name extensions-bar --app build-extensions
"""
import ctypes
import ctypes.wintypes as wt
import os
import socket
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'tools'))
import run as R  # noqa: E402

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32


class BMI(ctypes.Structure):
    _fields_ = [('biSize', wt.DWORD), ('biWidth', wt.LONG), ('biHeight', wt.LONG), ('biPlanes', wt.WORD),
                ('biBitCount', wt.WORD), ('biCompression', wt.DWORD), ('biSizeImage', wt.DWORD),
                ('biXPelsPerMeter', wt.LONG), ('biYPelsPerMeter', wt.LONG), ('biClrUsed', wt.DWORD),
                ('biClrImportant', wt.DWORD)]


def grab(hwnd):
    r = wt.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    w, h = r.right - r.left, r.bottom - r.top
    if w <= 0 or h <= 0:
        return None
    hdc = user32.GetWindowDC(hwnd)
    mem = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    gdi32.SelectObject(mem, bmp)
    ok = user32.PrintWindow(hwnd, mem, 2)
    bmi = BMI(ctypes.sizeof(BMI), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bmi), 0)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(hwnd, hdc)
    return ok, r.left, r.top, w, h, bytearray(buf.raw)


def popups_of(main):
    pid = wt.DWORD()
    user32.GetWindowThreadProcessId(main, ctypes.byref(pid))
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(hwnd, _):
        if hwnd == main or not user32.IsWindowVisible(hwnd):
            return True
        p = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value != pid.value:
            return True
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(hwnd, cls, 64)
        if not cls.value.startswith('Mozilla'):
            return True
        # Other browser windows are not popups (WS_POPUP = 0x80000000).
        if not (user32.GetWindowLongW(hwnd, -16) & 0x80000000):
            return True
        found.append((hwnd, cls.value))
        return True

    user32.EnumWindows(each, 0)
    found.reverse()  # EnumWindows is top-most first; paint bottom-most first
    return found


def capture(hwnd, path):
    ok, mx, my, mw, mh, main = grab(hwnd)
    for ph, cls in popups_of(hwnd):
        g = grab(ph)
        if not g:
            continue
        _, px, py, pw, ph_, buf = g
        print('[capture] + popup %s at (%d,%d) %dx%d' % (cls, px - mx, py - my, pw, ph_))
        for y in range(ph_):
            ty = py - my + y
            if ty < 0 or ty >= mh:
                continue
            x0 = max(0, mx - px)
            x1 = min(pw, mx + mw - px)
            if x1 <= x0:
                continue
            src = buf[(y * pw + x0) * 4:(y * pw + x1) * 4]
            dst_off = (ty * mw + (px - mx + x0)) * 4
            a = src[3::4]
            if all(v == 255 for v in a):
                main[dst_off:dst_off + len(src)] = src
            else:
                dst = main[dst_off:dst_off + len(src)]
                for i in range(0, len(src), 4):
                    al = src[i + 3]
                    if al == 0 and src[i] == 0 and src[i + 1] == 0 and src[i + 2] == 0:
                        continue
                    inv = 255 - al
                    dst[i] = min(255, src[i] + dst[i] * inv // 255)
                    dst[i + 1] = min(255, src[i + 1] + dst[i + 1] * inv // 255)
                    dst[i + 2] = min(255, src[i + 2] + dst[i + 2] * inv // 255)
                main[dst_off:dst_off + len(src)] = dst
    R.png(path, mw, mh, bytes(main))
    return ok, mw, mh


def site_up(port=47651):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.5):
            return True
    except OSError:
        return False


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if not os.path.exists(os.path.join(HERE, 'build', 'www', 'page.html')):
        subprocess.run([sys.executable, os.path.join(HERE, 'make-extensions.py')], check=True)
    server = None
    if not site_up():
        server = subprocess.Popen([sys.executable, os.path.join(HERE, 'serve.py')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    R.capture = capture
    try:
        code = R.main()
    finally:
        if server:
            server.terminate()
    sys.exit(code)
