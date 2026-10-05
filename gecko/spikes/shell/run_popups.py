"""tools/run.py with a capture that also includes the window's popups.

XUL panels, menus and doorhangers are separate top-level popup windows, so PrintWindow on the
browser window never shows them. This wrapper reuses tools/run.py unchanged and replaces only its
capture step: the browser window plus every visible popup window it owns are grabbed with
PrintWindow and composited at their real screen positions (canvas = union of the rectangles).

  python spikes/shell/run_popups.py --boot spikes/shell/boot-popups.js --name shell-popups
"""
import ctypes
import ctypes.wintypes as wt
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..', 'tools')))
import run as base  # noqa: E402

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
user32.GetWindow.restype = wt.HWND
user32.GetAncestor.restype = wt.HWND


class BMI(ctypes.Structure):
    _fields_ = [('biSize', wt.DWORD), ('biWidth', wt.LONG), ('biHeight', wt.LONG), ('biPlanes', wt.WORD),
                ('biBitCount', wt.WORD), ('biCompression', wt.DWORD), ('biSizeImage', wt.DWORD),
                ('biXPelsPerMeter', wt.LONG), ('biYPelsPerMeter', wt.LONG), ('biClrUsed', wt.DWORD),
                ('biClrImportant', wt.DWORD)]


def rect_of(hwnd):
    r = wt.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right, r.bottom


def grab(hwnd):
    left, top, right, bottom = rect_of(hwnd)
    w, h = right - left, bottom - top
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
    return ok, left, top, w, h, bytearray(buf.raw)


def popups_of(hwnd):
    pid = wt.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(h, _):
        if h == hwnd or not user32.IsWindowVisible(h):
            return True
        p = wt.DWORD()
        user32.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value != pid.value:
            return True
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(h, cls, 64)
        if not cls.value.startswith('Mozilla'):
            return True
        if user32.GetAncestor(h, 3) != hwnd and user32.GetWindow(h, 4) != hwnd:  # GA_ROOTOWNER, GW_OWNER
            return True
        found.append((h, cls.value))
        return True

    user32.EnumWindows(each, 0)
    return found  # top-most first


def capture(hwnd, path):
    main = grab(hwnd)
    ok, ml, mt, mw, mh, mbuf = main
    layers = []
    for h, cls in reversed(popups_of(hwnd)):
        g = grab(h)
        if g:
            layers.append((cls, g))
    left = min([ml] + [g[1] for _, g in layers])
    top = min([mt] + [g[2] for _, g in layers])
    right = max([ml + mw] + [g[1] + g[3] for _, g in layers])
    bottom = max([mt + mh] + [g[2] + g[4] for _, g in layers])
    W, H = right - left, bottom - top
    canvas = bytearray(b'\x30\x30\x30\xff' * (W * H))
    for y in range(mh):
        o = ((mt - top + y) * W + (ml - left)) * 4
        canvas[o:o + mw * 4] = mbuf[y * mw * 4:(y + 1) * mw * 4]
    for cls, (pok, pl, pt, pw, ph, pbuf) in layers:
        # PrintWindow returns the popup's transparent shadow margin as opaque black: key out the
        # pure-black run at both ends of every row so the page shows through around the panel.
        for y in range(ph):
            row = pbuf[y * pw * 4:(y + 1) * pw * 4]
            a = 0
            while a < pw and row[a * 4] == 0 and row[a * 4 + 1] == 0 and row[a * 4 + 2] == 0:
                a += 1
            b = pw
            while b > a and row[b * 4 - 4] == 0 and row[b * 4 - 3] == 0 and row[b * 4 - 2] == 0:
                b -= 1
            if b > a:
                o = ((pt - top + y) * W + (pl - left + a)) * 4
                canvas[o:o + (b - a) * 4] = row[a * 4:b * 4]
        print('[capture]   + popup %s %dx%d at %d,%d (window-relative %d,%d) ok=%s' % (
            cls, pw, ph, pl, pt, pl - ml, pt - mt, bool(pok)))
    base.png(path, W, H, bytes(canvas))
    return ok, W, H


base.capture = capture

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    base.main()
