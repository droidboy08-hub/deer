"""Screen-DC capture of a spike window (DWM-composited pixels, so Mica / window transparency show).

  python screencap.py <profile-name> <log.txt> <out.png> [timeout]

Waits for a line "@@screencap" in the log, raises the spike's own window (no focus change),
grabs its rectangle from the screen, then lowers it again. Unlike PrintWindow this needs the
window to be actually visible on screen.
"""
import ctypes
import ctypes.wintypes as wt
import json
import os
import struct
import subprocess
import sys
import time
import zlib

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass


def pids(key):
    ps = ("Get-CimInstance Win32_Process -Filter \"Name='firefox.exe'\" | "
          "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress")
    raw = subprocess.run(['powershell', '-NoProfile', '-Command', ps], capture_output=True, text=True, timeout=30).stdout
    rows = json.loads(raw) if raw.strip() else []
    if isinstance(rows, dict):
        rows = [rows]
    return {r['ProcessId'] for r in rows if r.get('CommandLine') and key.lower() in r['CommandLine'].lower()}


def find(pidset):
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        cls = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(hwnd, cls, 64)
        if pid.value in pidset and cls.value == 'MozillaWindowClass':
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


def grab(hwnd, path):
    r = wt.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    w, h = r.right - r.left, r.bottom - r.top
    sdc = user32.GetDC(0)
    mem = gdi32.CreateCompatibleDC(sdc)
    bmp = gdi32.CreateCompatibleBitmap(sdc, w, h)
    gdi32.SelectObject(mem, bmp)
    gdi32.BitBlt(mem, 0, 0, w, h, sdc, r.left, r.top, 0x00CC0020 | 0x40000000)  # SRCCOPY | CAPTUREBLT

    class BMI(ctypes.Structure):
        _fields_ = [('biSize', wt.DWORD), ('biWidth', wt.LONG), ('biHeight', wt.LONG), ('biPlanes', wt.WORD),
                    ('biBitCount', wt.WORD), ('biCompression', wt.DWORD), ('biSizeImage', wt.DWORD),
                    ('biXPelsPerMeter', wt.LONG), ('biYPelsPerMeter', wt.LONG), ('biClrUsed', wt.DWORD),
                    ('biClrImportant', wt.DWORD)]

    bmi = BMI(ctypes.sizeof(BMI), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(bmi), 0)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem)
    user32.ReleaseDC(0, sdc)
    png(path, w, h, buf.raw)
    return w, h


def main():
    key, log, out = sys.argv[1], sys.argv[2], sys.argv[3]
    deadline = time.time() + float(sys.argv[4] if len(sys.argv) > 4 else 60)
    n = 0
    while time.time() < deadline:
        time.sleep(0.2)
        try:
            text = open(log, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        marks = text.count('@@screencap')
        if marks > n:
            n = marks
            hwnd = find(pids('vitre-gecko-' + key))
            if not hwnd:
                print('[screencap] no window')
                continue
            SWP = 0x0001 | 0x0002 | 0x0010  # NOSIZE | NOMOVE | NOACTIVATE
            user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, SWP)  # HWND_TOPMOST
            time.sleep(0.6)
            path = out.replace('.png', '-%d.png' % n)
            print('[screencap]', path, grab(hwnd, path))
            user32.SetWindowPos(hwnd, -2, 0, 0, 0, 0, SWP)  # HWND_NOTOPMOST
        if '@@quit' in text:
            break


if __name__ == '__main__':
    main()
