"""tools/run.py with one addition: captures also include Firefox's popup windows.

XUL panels and menus (extension popups, doorhangers, context menus) are separate top-level
windows, so PrintWindow on the browser window alone never shows them. This wrapper captures every
visible popup window of the same process as well and composites it over the main capture at its
screen position. Same arguments as tools/run.py.

  python spikes/extensions/runx.py --boot spikes/extensions/boot-x.js --name extensions-x ...
"""
import ctypes
import ctypes.wintypes as wt
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'tools'))
import run as R  # noqa: E402

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
dwmapi = ctypes.windll.dwmapi


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
        # Verifier's change: other top-level browser windows are not popups (WS_POPUP = 0x80000000).
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
            # Popup pixels are premultiplied BGRA; fully transparent margins keep the page visible.
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


R.capture = capture

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    R.main()
