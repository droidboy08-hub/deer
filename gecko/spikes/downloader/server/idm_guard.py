"""Internet Download Manager is installed on this machine. Its network driver watches firefox.exe
(which the Vitre runtime is), answers "204 No Content" to requests it decides are downloads, and
opens its own dialogs. This closes the IDM dialogs that are about the spike's test server (and
answers No to the "obsolete Firefox integration" box that follows), and nothing else.

  python idm_guard.py http://127.0.0.1:47811
"""
import ctypes
import ctypes.wintypes as wt
import subprocess
import sys
import time

user32 = ctypes.windll.user32
WM_GETTEXT, WM_GETTEXTLENGTH, WM_CLOSE, BM_CLICK = 0x000D, 0x000E, 0x0010, 0x00F5


def idm_pids():
    out = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq IDMan.exe', '/FO', 'CSV', '/NH'], capture_output=True, text=True).stdout
    return {int(l.split(',')[1].strip('"')) for l in out.splitlines() if l.startswith('"IDMan')}


def text(h):
    n = user32.SendMessageW(h, WM_GETTEXTLENGTH, 0, 0)
    b = ctypes.create_unicode_buffer(n + 2)
    user32.SendMessageW(h, WM_GETTEXT, n + 1, b)
    return b.value


def windows(pids):
    tops = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(hwnd, _):
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids and user32.IsWindowVisible(hwnd):
            tops.append(hwnd)
        return True

    user32.EnumWindows(each, 0)
    return tops


def children(top):
    kids = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def child(h, _):
        kids.append((h, text(h)))
        return True

    user32.EnumChildWindows(top, child, 0)
    return kids


def main():
    needle = sys.argv[1]
    pids = idm_pids()
    if not pids:
        print('closed 0')
        return
    closed = 0
    for _ in range(4):
        for top in windows(pids):
            title = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(top, title, 256)
            kids = children(top)
            if title.value in ('Duplicate download link', 'Download File Info') and any(needle in t for _, t in kids):
                user32.PostMessageW(top, WM_CLOSE, 0, 0)  # the same as Cancel
                closed += 1
            elif closed and any('obsolete Firefox browser integration' in t for _, t in kids):
                for h, t in kids:
                    if t == '&No':
                        user32.PostMessageW(h, BM_CLICK, 0, 0)
        time.sleep(0.5)
    print('closed', closed)


if __name__ == '__main__':
    main()
