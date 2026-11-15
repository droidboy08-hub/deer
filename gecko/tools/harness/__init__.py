"""The test harness behind tools/run.py, split by platform.

  common.py   OS-neutral: test prefs, the throwaway profile, the test-script wiring, the arguments and
              the run loop (main)
  win.py      Windows: Toolhelp/taskkill processes, PrintWindow captures, taskbar id, junctions
  mac.py      macOS: ps/signal processes, captures through tools/mac/wintool.py, bundle id, symlinks

tools/run.py imports backend() and re-exports its names, so `import run` keeps working for the tests.
Only the current platform's half is ever imported: nothing Windows-specific runs on macOS and nothing
macOS-specific on Windows. Python 3.9 and the standard library only.
"""
import sys


def backend():
    """The platform half for this OS: harness.win or harness.mac."""
    if sys.platform == 'win32':
        from . import win
        return win
    if sys.platform == 'darwin':
        from . import mac
        return mac
    raise ImportError('the Deer test harness runs on Windows and macOS, not on %s' % sys.platform)
