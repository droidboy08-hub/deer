"""Find a native dialog by its exact title, screenshot it, then accept or cancel it.

  python dialog_helper.py "<title>" <out.png> accept|cancel|none [timeout seconds]

Used by the take-over spike for the Save dialog Vitre opens (nsIFilePicker); the boot script runs
this through Subprocess. Prints one JSON line.
"""
import ctypes
import ctypes.wintypes as wt
import importlib.util
import json
import os
import sys
import time

user32 = ctypes.windll.user32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass


def find(title):
    hits = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            t = ctypes.create_unicode_buffer(512)
            user32.GetWindowTextW(hwnd, t, 512)
            if t.value == title:
                hits.append(hwnd)
        return True

    user32.EnumWindows(each, 0)
    return hits[0] if hits else None


def child_texts(hwnd):
    out = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(h, _):
        c = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(h, c, 64)
        n = user32.SendMessageW(h, 0x000E, 0, 0)
        b = ctypes.create_unicode_buffer(n + 2)
        user32.SendMessageW(h, 0x000D, n + 1, b)
        if b.value and c.value in ('Edit', 'ToolbarWindow32', 'Button'):
            out.append([c.value, b.value[:200]])
        return True

    user32.EnumChildWindows(hwnd, each, 0)
    return out


def main():
    title, out, action = sys.argv[1], sys.argv[2], sys.argv[3]
    timeout = float(sys.argv[4]) if len(sys.argv) > 4 else 15
    deadline = time.time() + timeout
    hwnd = None
    while time.time() < deadline and not hwnd:
        hwnd = find(title)
        time.sleep(0.2)
    if not hwnd:
        print(json.dumps({'found': False}))
        return 1
    time.sleep(1.0)  # let the dialog finish drawing
    cls = ctypes.create_unicode_buffer(64)
    user32.GetClassNameW(hwnd, cls, 64)
    pid = wt.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    texts = child_texts(hwnd)
    # The runner's screenshot code (PrintWindow) works for any window.
    spec = importlib.util.spec_from_file_location('vitre_run', os.path.join(os.path.dirname(__file__), '..', '..', '..', 'tools', 'run.py'))
    run = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(run)
    ok, w, h = run.capture(hwnd, out)
    if action == 'accept':
        user32.PostMessageW(hwnd, 0x0111, 1, 0)  # WM_COMMAND IDOK: the Save button
    elif action == 'cancel':
        user32.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE
    print(json.dumps({'found': True, 'class': cls.value, 'pid': pid.value, 'captured': bool(ok), 'size': [w, h], 'controls': texts[:12], 'action': action}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
