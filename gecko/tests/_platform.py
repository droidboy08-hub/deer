"""Platform helpers for the test runners (Python 3.9, standard library only).

  sys.path.insert(0, os.path.join(<gecko>, 'tests'))
  import _platform as P
  P.skip_unless('win', 'drives Win32 windows through js-ctypes')
      on any other OS prints "SKIP (Windows-only): drives Win32 windows through js-ctypes" and exits 0
  P.accel_name()   'Meta' on macOS, 'Control' on Windows: the DOM name of the accelerator key
                   (Cmd / Ctrl), to hand to a test script (--env) or to build a key spec with
  P.IS_MAC, P.IS_WIN, P.PLATFORM ('mac', 'win' or sys.platform)

A suite runner calls skip_unless() at the top of main(), before it builds or starts anything, so a
Windows-only suite reports a SKIP line on the Mac instead of failing (and the other way round).
"""
import sys

IS_MAC = sys.platform == 'darwin'
IS_WIN = sys.platform == 'win32'
PLATFORM = 'mac' if IS_MAC else 'win' if IS_WIN else sys.platform

_ONLY = {'win': 'Windows-only', 'mac': 'macOS-only'}


def skip_unless(platform, reason):
    """Return when running on `platform` ('win' or 'mac'); otherwise print the SKIP line and exit 0."""
    if platform not in _ONLY:
        raise ValueError("skip_unless: platform must be 'win' or 'mac', not %r" % (platform,))
    if platform == PLATFORM:
        return
    print('SKIP (%s): %s' % (_ONLY[platform], reason))
    sys.stdout.flush()
    sys.exit(0)


def accel_name():
    """The DOM key name of the platform's accelerator: 'Meta' (Cmd) on macOS, 'Control' on Windows."""
    return 'Meta' if IS_MAC else 'Control'
