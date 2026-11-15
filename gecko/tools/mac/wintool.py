"""Build and run deer-wintool, the macOS window helper of Deer's test harness: it lists windows, brings
an app to the front and takes real screenshots of a window or of a screen rectangle (what tools/run.py
does with user32/gdi32 on Windows).

  python3 tools/mac/wintool.py preflight             may this terminal's app record the screen?
  python3 tools/mac/wintool.py preflight --request   ...and show the system prompt (only the first time)
  python3 tools/mac/wintool.py list --name "Deer Dev"
  python3 tools/mac/wintool.py front --pid PID
  python3 tools/mac/wintool.py capture --id WINDOW --out shot.png --no-shadow
  python3 tools/mac/wintool.py capture-rect --x X --y Y --w W --h H --out menu.png
  python3 tools/mac/wintool.py build                 build it again now

The header of deer-wintool.swift documents the commands, the JSON they print and the exit codes (0 ok,
1 failed, 2 bad arguments, 3 not found, 4 Screen Recording permission off). The tool is compiled on
first use with "xcrun swiftc -O" (Xcode or the Command Line Tools: xcode-select --install) into
tools/mac/bin/deer-wintool, which git ignores, and again whenever deer-wintool.swift is newer.

From Python (with gecko/tools/mac on sys.path):
  import wintool
  wintool.build_tool()                       the path of the built tool
  wintool.run(['list', '--pid', 1234])       the tool's JSON output, parsed; raises wintool.WintoolError,
                                             whose .code is the exit code (wintool.NO_PERMISSION, ...)
  wintool.screen_capture_allowed(), list_windows(), front(), capture(), capture_rect(): the same, typed

Screen captures need the Screen Recording permission for the app that runs the harness (Terminal, an
editor, the Claude app): System Settings > Privacy & Security > Screen & System Audio Recording. Without
it capture and capture-rect exit 4 with that message instead of writing blank pictures. A sandboxed
shell may be refused access to the window server: then list fails and says so; run outside the sandbox.

Python 3.9 and the standard library only: run with the Python a fresh Mac has (/usr/bin/python3).
"""
import json
import os
import platform
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(HERE, 'deer-wintool.swift')
BIN_DIR = os.path.join(HERE, 'bin')
TOOL = os.path.join(BIN_DIR, 'deer-wintool')
MIN_MACOS = '14.0'  # ScreenCaptureKit's SCScreenshotManager

# deer-wintool's exit codes
OK, FAILED, BAD_ARGS, NOT_FOUND, NO_PERMISSION = 0, 1, 2, 3, 4
PERMISSION_MESSAGE = ('Screen Recording permission is off for the app running this harness: '
                      'System Settings › Privacy & Security › Screen & System Audio Recording')


class WintoolError(Exception):
    """deer-wintool could not be built, or a command failed. `code` is its exit code."""

    def __init__(self, code, message):
        Exception.__init__(self, message)
        self.code = code
        self.message = message


def build_tool(force=False):
    """The path of deer-wintool, compiled first when it is missing or older than deer-wintool.swift."""
    if sys.platform != 'darwin':
        raise WintoolError(FAILED, 'deer-wintool is for macOS only')
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
        raise WintoolError(FAILED, 'xcrun was not found: install the Xcode Command Line Tools (xcode-select --install)')
    if r.returncode or not os.path.isfile(tmp):
        if os.path.exists(tmp):
            os.unlink(tmp)
        hint = ''
        if 'developer path' in r.stderr or 'xcode-select' in r.stderr:
            hint = '\nInstall the Xcode Command Line Tools: xcode-select --install'
        raise WintoolError(FAILED, 'building deer-wintool failed:\n%s%s' % ((r.stderr or r.stdout).strip(), hint))
    os.replace(tmp, TOOL)
    return TOOL


def run(args, timeout=90):
    """Run deer-wintool with `args` (strings or numbers) and return its JSON output, parsed.
    Raises WintoolError with the tool's exit code and message when it fails."""
    tool = build_tool()
    args = [str(a) for a in args]
    try:
        r = subprocess.run([tool] + args, capture_output=True, text=True, encoding='utf-8', errors='replace',
                           timeout=timeout)
    except subprocess.TimeoutExpired:
        raise WintoolError(FAILED, 'deer-wintool %s timed out after %s s' % (' '.join(args), timeout))
    if r.returncode:
        raise WintoolError(r.returncode, r.stderr.strip() or 'deer-wintool %s exited with %d' % (' '.join(args), r.returncode))
    try:
        return json.loads(r.stdout)
    except ValueError:
        raise WintoolError(FAILED, 'deer-wintool %s printed no JSON: %r' % (' '.join(args), r.stdout[:200]))


def screen_capture_allowed(request=False):
    """Whether this process's app may record the screen; `request` also shows the system prompt (once)."""
    return bool(run(['preflight'] + (['--request'] if request else []))['screenCapture'])


def list_windows(pids=(), name=None):
    """The ordinary (layer 0) windows, front to back for those on screen, of the processes `pids` and/or
    the apps whose name contains `name`: dicts with id, pid, owner, title, x, y, w, h, onscreen, alpha."""
    args = ['list']
    for pid in pids:
        args += ['--pid', pid]
    if name:
        args += ['--name', name]
    return run(args)


def front(pid, window_id=None):
    """Bring the app `pid` (and its window `window_id`) to the front. Returns the tool's result; its
    "front" says whether that worked."""
    return run(['front', '--pid', pid] + (['--id', window_id] if window_id is not None else []))


def capture(window_id, out, shadow=False, children=False):
    """Screenshot the window `window_id` to the PNG `out` at full resolution. Returns {w, h, scale, via}."""
    args = ['capture', '--id', window_id, '--out', out]
    if not shadow:
        args.append('--no-shadow')
    if children:
        args.append('--children')
    return run(args)


def capture_rect(x, y, w, h, out, pids=()):
    """Screenshot a rectangle of the screen (global points) to the PNG `out`; with `pids`, only those
    processes' windows are in the picture."""
    args = ['capture-rect', '--x', x, '--y', y, '--w', w, '--h', h, '--out', out]
    for pid in pids:
        args += ['--pid', pid]
    return run(args)


def main(argv):
    if not argv or argv[0] in ('-h', '--help', 'help'):
        print(__doc__.strip())
        return OK if argv else BAD_ARGS
    try:
        if argv[0] == 'build':
            print(build_tool(force=True))
            return OK
        tool = build_tool()
    except WintoolError as e:
        sys.stderr.write(e.message + '\n')
        return e.code or FAILED
    return subprocess.call([tool] + argv)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
