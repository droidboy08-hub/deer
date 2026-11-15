"""Where the development engine lives and how the chrome package is linked into it, on Windows and macOS.

  import engine_paths            (gecko/tools must be on sys.path; scripts in this folder have it there)

gecko/runtime is a private, git-ignored copy of Mozilla's unbranded Firefox 157 build, wired for Deer by
tools/setup-runtime.py. Its layout depends on the platform:

                Windows                          macOS
  ENGINE_APP    None                             runtime/Deer Dev.app
  ENGINE_EXE    runtime/vitre.exe                <app>/Contents/MacOS/firefox
  STOCK_EXE     runtime/firefox.exe              <app>/Contents/MacOS/firefox (the same file)
  BIN_DIR       runtime/                         <app>/Contents/MacOS (GreBinD: firefox, XUL, *.dylib, helpers)
  GRE_DIR       runtime/                         <app>/Contents/Resources (GreD: omni.ja, config.js, defaults/,
                                                 distribution/, browser/ = AChrom's parent)
  PACKAGE_LINK  runtime/vitre: a junction        <app>/Contents/Resources/vitre: a symbolic link

On macOS the engine always runs as Contents/MacOS/firefox: never rename, copy or link that file.
nsMacUtilsImpl::GetAppPath (xpcom/base/nsMacUtilsImpl.cpp) finds the .app by searching the binary's path
for "/Contents/MacOS/", and GMP looks for MOZ_APP_NAME beside it. So there is no vitre.exe on macOS.

Python 3.9 and the standard library only: these are run with the Python a fresh Mac has.
"""
import os
import subprocess
import sys
import tempfile

IS_MAC = sys.platform == 'darwin'
IS_WIN = sys.platform == 'win32'
PLATFORM = 'mac' if IS_MAC else 'win' if IS_WIN else 'other'

GECKO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
RUNTIME = os.path.join(GECKO, 'runtime')

if IS_MAC:
    ENGINE_APP = os.path.join(RUNTIME, 'Deer Dev.app')
    BIN_DIR = os.path.join(ENGINE_APP, 'Contents', 'MacOS')
    GRE_DIR = os.path.join(ENGINE_APP, 'Contents', 'Resources')
    ENGINE_EXE = os.path.join(BIN_DIR, 'firefox')
    STOCK_EXE = ENGINE_EXE
else:
    # Windows, and the Windows layout anywhere else (nothing else is supported yet).
    ENGINE_APP = None
    BIN_DIR = RUNTIME
    GRE_DIR = RUNTIME
    ENGINE_EXE = os.path.join(RUNTIME, 'vitre.exe')
    STOCK_EXE = os.path.join(RUNTIME, 'firefox.exe')
PACKAGE_LINK = os.path.join(GRE_DIR, 'vitre')


def is_junction(path):
    """A Windows directory junction. Never true elsewhere: before Python 3.12 the test reads
    st_file_attributes, which only Windows has."""
    try:
        return os.path.isjunction(path)
    except AttributeError:  # Python < 3.12
        return bool(os.path.isdir(path) and getattr(os.lstat(path), 'st_file_attributes', 0) & 0x400)


def is_link(path):
    """The kind of link Deer makes on this platform: a junction on Windows, a symbolic link on macOS."""
    return os.path.islink(path) if IS_MAC else is_junction(path)


def same_target(link, target):
    try:
        return os.path.normcase(os.path.realpath(link)) == os.path.normcase(os.path.realpath(target))
    except OSError:
        return False


def make_link(link, target, relative=False):
    """Link the folder `link` to `target`. Windows makes a junction (always absolute). macOS makes a
    symbolic link, relative to the link's real folder when `relative` is set, so it still resolves
    after the repository is moved."""
    if IS_MAC:
        if relative:
            target = os.path.relpath(os.path.realpath(target), os.path.realpath(os.path.dirname(link)))
        os.symlink(target, link)
        return
    r = subprocess.run(['cmd', '/c', 'mklink', '/J', link, target], capture_output=True, text=True)
    if r.returncode:
        sys.exit('mklink failed: ' + (r.stderr or r.stdout))


def remove_link(link):
    """Remove the link only, never the folder it points at."""
    if not is_link(link):
        sys.exit('%s is not a link; refusing to remove it' % link)
    if IS_MAC:
        os.unlink(link)
    else:
        os.rmdir(link)  # a junction is removed as an empty folder; its target is left alone


def tmp_root():
    """The temporary folder with links resolved: on macOS $TMPDIR is under /var, a link to /private/var,
    and paths compared with what the engine reports must use the real one."""
    return os.path.realpath(tempfile.gettempdir())


def python_cmd():
    """The command that runs Python for a child script: the interpreter running this one (a venv's when
    started from it), else the platform's launcher."""
    if sys.executable:
        return [sys.executable]
    return ['py', '-3'] if IS_WIN else ['python3']
