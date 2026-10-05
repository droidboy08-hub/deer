"""tools/run.py with a capture that grabs the SCREEN where the browser window is (BitBlt from the
desktop DC), instead of PrintWindow on the window.

Needed for things that are not part of the Firefox window: the Windows 11 snap-layouts flyout is
a shell window, so PrintWindow never shows it. The boot script makes its window topmost first, so
the grabbed rectangle is the browser window plus whatever the shell draws over it. The capture is
cropped to the window's client rectangle (nothing outside the window is taken).

Also prints the class names (never the titles) of the visible top-level windows stacked ABOVE the
browser window that intersect it, so a flyout can be recognised in the log.

  python spikes/shell/verify/run_screen.py --boot spikes/shell/verify/boot-v-native.js --name shell-verify-p-native
"""
import ctypes
import ctypes.wintypes as wt
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..', '..', 'tools')))
import run as base  # noqa: E402

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
user32.GetDC.restype = wt.HDC
user32.GetWindow.restype = wt.HWND
user32.ReleaseDC.argtypes = [wt.HWND, wt.HDC]
gdi32.CreateCompatibleDC.restype = wt.HDC
gdi32.CreateCompatibleDC.argtypes = [wt.HDC]
gdi32.CreateCompatibleBitmap.restype = wt.HBITMAP
gdi32.CreateCompatibleBitmap.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int]
gdi32.SelectObject.restype = wt.HGDIOBJ
gdi32.SelectObject.argtypes = [wt.HDC, wt.HGDIOBJ]
gdi32.BitBlt.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.HDC, ctypes.c_int, ctypes.c_int, wt.DWORD]
gdi32.GetDIBits.argtypes = [wt.HDC, wt.HBITMAP, wt.UINT, wt.UINT, ctypes.c_void_p, ctypes.c_void_p, wt.UINT]
gdi32.DeleteObject.argtypes = [wt.HGDIOBJ]
gdi32.DeleteDC.argtypes = [wt.HDC]
SRCCOPY = 0x00CC0020
CAPTUREBLT = 0x40000000


class BMI(ctypes.Structure):
    _fields_ = [('biSize', wt.DWORD), ('biWidth', wt.LONG), ('biHeight', wt.LONG), ('biPlanes', wt.WORD),
                ('biBitCount', wt.WORD), ('biCompression', wt.DWORD), ('biSizeImage', wt.DWORD),
                ('biXPelsPerMeter', wt.LONG), ('biYPelsPerMeter', wt.LONG), ('biClrUsed', wt.DWORD),
                ('biClrImportant', wt.DWORD)]


def above(hwnd, rect):
    """Class names of visible top-level windows above hwnd in z-order that intersect rect."""
    out = []
    h = user32.GetWindow(hwnd, 3)  # GW_HWNDPREV: the window above
    n = 0
    while h and n < 400:
        n += 1
        if user32.IsWindowVisible(h):
            r = wt.RECT()
            user32.GetWindowRect(h, ctypes.byref(r))
            if r.left < rect[2] and r.right > rect[0] and r.top < rect[3] and r.bottom > rect[1] and r.right > r.left:
                cls = ctypes.create_unicode_buffer(128)
                user32.GetClassNameW(h, cls, 128)
                out.append('%s[%d,%d %dx%d]' % (cls.value, r.left - rect[0], r.top - rect[1], r.right - r.left, r.bottom - r.top))
        h = user32.GetWindow(h, 3)
    return out


def capture(hwnd, path):
    # The CLIENT rectangle in screen coordinates: the window rectangle also covers the invisible
    # 8px resize borders, through which other windows on the desktop would show.
    c = wt.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(c))
    pt = wt.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    r = wt.RECT(pt.x, pt.y, pt.x + c.right, pt.y + c.bottom)
    left, top = max(r.left, 0), max(r.top, 0)
    w, h = r.right - left, r.bottom - top
    screen = user32.GetDC(0)
    mem = gdi32.CreateCompatibleDC(screen)
    bmp = gdi32.CreateCompatibleBitmap(screen, w, h)
    gdi32.SelectObject(mem, bmp)
    ok = gdi32.BitBlt(mem, 0, 0, w, h, screen, left, top, SRCCOPY | CAPTUREBLT)
    bmi = BMI(ctypes.sizeof(BMI), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bmi), 0)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(0, screen)
    base.png(path, w, h, buf.raw)
    print('[screen] windows above ours: %s' % (', '.join(above(hwnd, (r.left, r.top, r.right, r.bottom))) or '(none)'))
    return ok, w, h


base.capture = capture

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    base.main()
