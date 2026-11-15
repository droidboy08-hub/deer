"""Build deer.icns, Deer's macOS app icon, from the artwork in design/icon/.

  python3 tools/mac/appicon.py            print the path of deer.icns, built first when out of date
  python3 tools/mac/appicon.py --force    build the tool and the icon again now

The picture is the Default appearance of the "Deer app icon" design board on Apple's macOS grid (an 824
px plate with continuous corners on a 1024 px canvas, the charcoal plate, the board's drop shadow):
deer-icon.swift says how it is drawn. The artwork is the owner's default gold icon, as on Windows:
design/icon/deer-gold-1024.png, and deer-gold-small-1024.png for the 16 pt images (tools/make-icon.py
uses it for the Windows icon's 16 to 24 px images the same way).

deer-icon.swift is compiled on first use with "xcrun swiftc -O" (Xcode or the Command Line Tools:
xcode-select --install) into tools/mac/bin/deer-icon. It draws an .iconset, which iconutil packs into
tools/mac/bin/deer.icns. Both files are git-ignored (generated, so never committed) and made again
whenever an input is newer: deer-icon.swift, the two pictures, this file. tools/setup-runtime.py
installs deer.icns in the development bundle as Contents/Resources/deer.icns.

From Python (with gecko/tools/mac on sys.path):
  import appicon
  appicon.ICNS                 the built icon
  appicon.out_of_date()        True when ICNS is missing or older than one of its inputs
  appicon.build_icns()         the path of ICNS, built first when out of date; raises appicon.IconError

Python 3.9 and the standard library only: run with the Python a fresh Mac has (/usr/bin/python3).
"""
import os
import platform
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
ART = os.path.join(REPO, 'design', 'icon', 'deer-gold-1024.png')
SMALL_ART = os.path.join(REPO, 'design', 'icon', 'deer-gold-small-1024.png')
SOURCE = os.path.join(HERE, 'deer-icon.swift')
BIN_DIR = os.path.join(HERE, 'bin')
TOOL = os.path.join(BIN_DIR, 'deer-icon')
ICNS = os.path.join(BIN_DIR, 'deer.icns')
MIN_MACOS = '11.0'  # SwiftUI's RoundedRectangle(style: .continuous).path(in:).cgPath


class IconError(Exception):
    """deer-icon could not be built or run, or iconutil failed."""


def inputs():
    """What deer.icns is made from."""
    return [SOURCE, ART, SMALL_ART, os.path.join(HERE, 'appicon.py')]


def _newest_input():
    missing = [p for p in inputs() if not os.path.isfile(p)]
    if missing:
        raise IconError('missing: ' + ', '.join(missing))
    return max(os.path.getmtime(p) for p in inputs())


def out_of_date():
    """True when deer.icns is missing or older than one of its inputs."""
    return not os.path.isfile(ICNS) or os.path.getmtime(ICNS) < _newest_input()


def build_tool(force=False):
    """The path of deer-icon, compiled first when it is missing or older than deer-icon.swift."""
    if sys.platform != 'darwin':
        raise IconError('deer-icon is for macOS only')
    if not force and os.path.isfile(TOOL) and os.path.getmtime(TOOL) >= os.path.getmtime(SOURCE):
        return TOOL
    os.makedirs(BIN_DIR, exist_ok=True)
    # Built under a name of its own and moved into place, so runs that start together never see half a file.
    tmp = '%s.%d.tmp' % (TOOL, os.getpid())
    target = '%s-apple-macos%s' % (platform.machine() or 'arm64', MIN_MACOS)
    cmd = ['xcrun', 'swiftc', '-O', '-swift-version', '6', '-parse-as-library', '-target', target, '-o', tmp, SOURCE]
    sys.stderr.write('building %s\n' % os.path.relpath(TOOL))
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    except FileNotFoundError:
        raise IconError('xcrun was not found: install the Xcode Command Line Tools (xcode-select --install)')
    if r.returncode or not os.path.isfile(tmp):
        if os.path.exists(tmp):
            os.unlink(tmp)
        hint = ''
        if 'developer path' in r.stderr or 'xcode-select' in r.stderr:
            hint = '\nInstall the Xcode Command Line Tools: xcode-select --install'
        raise IconError('building deer-icon failed:\n%s%s' % ((r.stderr or r.stdout).strip(), hint))
    os.replace(tmp, TOOL)
    return TOOL


def build_icns(force=False):
    """The path of deer.icns, drawn and packed first when it is out of date (or with force)."""
    if not force and not out_of_date():
        return ICNS
    tool = build_tool(force)
    work = tempfile.mkdtemp(prefix='deer-icon-', dir=BIN_DIR)  # beside ICNS, so os.replace stays on one volume
    try:
        iconset = os.path.join(work, 'deer.iconset')
        os.mkdir(iconset)
        r = subprocess.run([tool, '--art', ART, '--small-art', SMALL_ART, '--out', iconset],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode:
            raise IconError('deer-icon failed (exit %d): %s' % (r.returncode, (r.stderr or r.stdout).strip()))
        packed = os.path.join(work, 'deer.icns')
        r = subprocess.run(['/usr/bin/iconutil', '--convert', 'icns', '--output', packed, iconset],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode or not os.path.isfile(packed):
            raise IconError('iconutil failed: %s' % (r.stderr or r.stdout).strip())
        os.replace(packed, ICNS)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return ICNS


def main(argv):
    if argv and argv[0] in ('-h', '--help', 'help'):
        print(__doc__.strip())
        return 0
    if argv and argv != ['--force']:
        sys.stderr.write('usage: python3 tools/mac/appicon.py [--force]\n')
        return 2
    try:
        print(build_icns(force=bool(argv)))
    except IconError as e:
        sys.stderr.write('%s\n' % e)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
