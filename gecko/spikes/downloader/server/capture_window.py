"""Screenshot a top-level window found by its window class (PrintWindow), e.g. the taskbar:

  python capture_window.py Shell_TrayWnd out.png

Used by the lifecycle spike to look at the taskbar button's progress bar.
"""
import ctypes
import importlib.util
import json
import os
import sys

user32 = ctypes.windll.user32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass


def main():
    cls, out = sys.argv[1], sys.argv[2]
    hwnd = user32.FindWindowW(cls, None)
    if not hwnd:
        print(json.dumps({'found': False}))
        return 1
    spec = importlib.util.spec_from_file_location('vitre_run', os.path.join(os.path.dirname(__file__), '..', '..', '..', 'tools', 'run.py'))
    run = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(run)
    ok, w, h = run.capture(hwnd, out)
    print(json.dumps({'found': True, 'captured': bool(ok), 'size': [w, h]}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
