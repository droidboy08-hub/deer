"""macOS half of the test harness behind tools/run.py: the engine's processes (ps, signals), its
windows and captures (tools/mac/wintool.py: CoreGraphics window list, ScreenCaptureKit), the bundle id
and icon for --identity, and the --app symbolic link. Imported only on macOS (harness.backend()).

The engine is engine_paths.ENGINE_EXE (<runtime>/Deer Dev.app/Contents/MacOS/firefox), started with
-no-remote -foreground -profile <throwaway profile in tmp_root()>. The person's own Deer Dev runs from
the same bundle, so nothing here goes by the program's name alone: the run's processes are the
descendants of the one it started (and the ones the script reports with @@pid), and stale ones are
found by the throwaway profile's path on their command line.

Captures need the Screen Recording permission for the app that runs the harness (Terminal, an
editor, the Claude app). Without it capture() prints PERMISSION_MESSAGE once and the run stops with
exit code 4 (EXIT_NO_SCREEN_RECORDING) instead of writing blank pictures; --no-capture runs a script
without screenshots. macOS stops drawing a covered window that is not active, so the engine's app is
brought to the front before every capture, also when the run's window is on another Space (find_window
then takes the largest titled window that is off screen, and bringing its app to the front takes macOS
to that Space); a capture that fails is tried once more. A sandboxed shell may be refused access to
the window server (the window list then fails and says so): run the harness outside that sandbox.

Python 3.9 and the standard library only.
"""
import os
import plistlib
import re
import shutil
import signal
import struct
import subprocess
import sys
import time

from .common import PREFS as _COMMON_PREFS, ROOT, png  # noqa: F401  (png is re-exported by tools/run.py)

TOOLS = os.path.join(ROOT, 'tools')
if TOOLS not in sys.path:
    sys.path.append(TOOLS)
import engine_paths  # noqa: E402

PLATFORM = 'mac'
RUNTIME = engine_paths.RUNTIME
ENGINE_APP = engine_paths.ENGINE_APP
GRE_DIR = engine_paths.GRE_DIR
VITRE = engine_paths.ENGINE_EXE
# The chrome package the engine loads when --app is not given (a symbolic link to build/).
PACKAGE = engine_paths.PACKAGE_LINK
# Executable names inside the engine's bundle (the main process, content processes, helpers). For
# reference: the run's processes are recognised by their path inside the bundle, see _in_engine().
IMAGES = {'firefox', 'plugin-container', 'crashhelper', 'pingsender', 'crashreporter', 'nmhproxy',
          'nightly gpu helper', 'nightly media plugin helper'}

# Test-only prefs on macOS, besides common.PREFS: no Notification Center notifications (an unsigned
# app's first one asks for permission) and no Core Location (asks for Location Services).
MAC_PREFS = {
    'alerts.useSystemBackend': False,
    'geo.provider.use_corelocation': False,
}
PREFS = dict(_COMMON_PREFS)
PREFS.update(MAC_PREFS)

# Never passed on to the engine (tools/setup-engine.py LAUNCH_CLEAR_ENV): an inherited XRE_PROFILE_PATH
# (Gecko's own restart variable; the dev bundle's Info.plist LSEnvironment sets it to the person's dev
# profile) replaces -profile, XRE_PROFILE_LOCAL_PATH is its local half, XUL_APP_FILE replaces the
# engine's identity and MOZ_NEW_INSTANCE turns its remote client off.
CLEAR_ENV = ('XRE_PROFILE_PATH', 'XRE_PROFILE_LOCAL_PATH', 'XUL_APP_FILE', 'MOZ_NEW_INSTANCE')
# Refused in --env and --arg, so nothing on the command line can move the engine off the throwaway
# profile (the harness sets VITRE_ALLOW_ANY_PROFILE, which turns config.js's launch guard off): an
# XRE_PROFILE_PATH wins over -profile (tests/engine/identity.py proves it), and -profile, -P and
# -ProfileManager / -CreateProfile pick or write profiles of ~/Library/Application Support/Firefox.
# Gecko matches flags with one or two dashes, ignoring case.
PROFILE_ENV = ('XRE_PROFILE_PATH', 'XRE_PROFILE_LOCAL_PATH')
PROFILE_ARGS = ('profile', 'p', 'profilemanager', 'createprofile')

PERMISSION_MESSAGE = ('Screen Recording permission is off for the app running this harness: '
                      'System Settings › Privacy & Security › Screen & System Audio Recording')
EXIT_NO_SCREEN_RECORDING = 4
NO_PERMISSION = 4  # deer-wintool's exit code for it


class ScreenRecordingOff(SystemExit):
    """Raised once PERMISSION_MESSAGE is printed: the run stops (its finally clean-up still runs) and
    the process exits with EXIT_NO_SCREEN_RECORDING."""

    def __init__(self):
        SystemExit.__init__(self, EXIT_NO_SCREEN_RECORDING)


# ---- processes ----------------------------------------------------------------------------------

def _engine_prefixes():
    app = os.path.abspath(ENGINE_APP)
    return tuple({app + '/', os.path.realpath(app) + '/'})


def _in_engine(path):
    """A program (or a command line) inside the engine's bundle."""
    return path.startswith(_engine_prefixes())


def _ps(columns):
    """Rows of `ps -axww -o <columns>` split into len(columns) fields (the last may hold spaces)."""
    try:
        raw = subprocess.run(['ps', '-axww', '-o', ','.join(c + '=' for c in columns)],
                             capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return []
    rows = []
    for line in raw.splitlines():
        parts = line.split(None, len(columns) - 1)
        if len(parts) == len(columns) and parts[0].isdigit() and parts[1].isdigit():
            rows.append(parts)
    return rows


def _rows():
    """[(pid, parent pid, executable path)] of every live process (zombies left out)."""
    return [(int(pid), int(ppid), comm) for pid, ppid, stat, comm in _ps(('pid', 'ppid', 'stat', 'comm'))
            if not stat.startswith('Z')]


def processes():
    """[(pid, parent pid, executable name lower-case)] for every process (one `ps`, a few ms)."""
    return [(pid, ppid, os.path.basename(path).lower()) for pid, ppid, path in _rows()]


class Tree:
    """The engine processes that descend from the one this run started. `known` only grows, so a
    process started by one that has already exited (an in-place restart) is still recognised. As the
    person's own Deer Dev runs from the same bundle, a known pid counts only while its parent is a
    known one (or launchd, for a restart whose old process is gone), or it is a root: the started
    process and the ones the script reported (@@pid)."""

    def __init__(self, root_pid):
        self.known = {root_pid}
        self.roots = {root_pid}

    def adopt(self, pid):
        """An engine process the script reported itself (@@pid): followed from now on, with its children."""
        try:
            pid = int(pid)
        except ValueError:
            return
        self.known.add(pid)
        self.roots.add(pid)

    def alive(self):
        rows = [r for r in _rows() if _in_engine(r[2])]
        grew = True
        while grew:
            grew = False
            for pid, parent, _path in rows:
                if pid not in self.known and parent in self.known:
                    self.known.add(pid)
                    grew = True
        return {pid for pid, parent, _path in rows
                if pid in self.known and (pid in self.roots or parent in self.known or parent == 1)}


def _profile_patterns(profile):
    """The profile's path as a command line may spell it ($TMPDIR is /var/..., really /private/var/...),
    never matching a longer name ('x' never matches the profile of a run named 'x-verify')."""
    spellings = {profile, os.path.realpath(profile)}
    for s in list(spellings):
        if s.startswith('/private/'):
            spellings.add(s[len('/private'):])
    return [re.compile(re.escape(s) + r'(?![\w.-])') for s in spellings]


def stale_pids(profile):
    """Engine processes left by an earlier run on this profile: the ones whose command line names it,
    with their children."""
    rows = [(int(pid), int(ppid), cmd) for pid, ppid, cmd in _ps(('pid', 'ppid', 'command'))]
    rows = [r for r in rows if _in_engine(r[2])]
    keys = _profile_patterns(profile)
    pids = {pid for pid, _parent, cmd in rows if any(k.search(cmd) for k in keys)}
    grew = True
    while grew:
        grew = False
        for pid, parent, _cmd in rows:
            if parent in pids and pid not in pids:
                pids.add(pid)
                grew = True
    pids.discard(os.getpid())
    return pids


def _running(pid):
    try:
        os.waitpid(pid, os.WNOHANG)  # reaps the engine this process started, once it has exited
    except (ChildProcessError, OSError):
        pass
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _signal(pids, sig):
    for pid in pids:
        try:
            os.kill(pid, sig)
        except (ProcessLookupError, PermissionError):
            pass


def kill(pids, grace=3.0):
    """Stop these processes: SIGTERM, and SIGKILL for whatever still runs after `grace` seconds."""
    pids = {int(p) for p in pids} - {0, 1, os.getpid()}
    if not pids:
        return
    _signal(pids, signal.SIGTERM)
    end = time.time() + grace
    left = pids
    while True:
        left = {pid for pid in left if _running(pid)}
        if not left or time.time() >= end:
            break
        time.sleep(0.1)
    _signal(left, signal.SIGKILL)


def crash(pids):
    """@@kill: every engine process of the run ends at once, with no shutdown (SIGKILL), as in a crash."""
    _signal({int(p) for p in pids} - {0, 1, os.getpid()}, signal.SIGKILL)


def loaded_modules(pids, text, image='firefox'):
    """{library name: [pids]} for the files mapped as code (lsof "txt") whose name contains `text`.
    System libraries come from the dyld shared cache and are not listed; the engine's own are."""
    found = {}
    if not pids:
        return found
    try:
        raw = subprocess.run(['lsof', '-n', '-P', '-w', '-a', '-d', 'txt', '-F', 'pn', '-p', ','.join(map(str, sorted(pids)))],
                             capture_output=True, text=True, timeout=60).stdout
    except Exception as e:
        return {'(lsof failed: %s)' % e: []}
    pid = None
    for line in raw.splitlines():
        if line.startswith('p') and line[1:].isdigit():
            pid = int(line[1:])
        elif line.startswith('n') and pid is not None:
            name = os.path.basename(line[1:])
            if text.lower() in name.lower() and pid not in found.get(name, []):
                found.setdefault(name, []).append(pid)
    return found


# ---- windows and captures -----------------------------------------------------------------------

_wintool = None
_OWNER = {}  # window number -> the pid that owns it, from the window lists seen
_list_error = [None]


def _tool():
    """tools/mac/wintool.py, imported on first use (it builds deer-wintool with swiftc the first time)."""
    global _wintool
    if _wintool is None:
        here = os.path.join(TOOLS, 'mac')
        if not os.path.exists(os.path.join(here, 'wintool.py')):
            raise SystemExit('tools/mac/wintool.py is missing: the macOS harness needs it for windows and captures')
        if here not in sys.path:
            sys.path.append(here)
        import wintool
        _wintool = wintool
    return _wintool


def _run(args):
    """deer-wintool's parsed output. Exit code 4 (no Screen Recording permission) stops the run with
    PERMISSION_MESSAGE; other failures raise the tool's WintoolError."""
    tool = _tool()
    try:
        return tool.run([str(x) for x in args])
    except tool.WintoolError as e:
        if e.code == NO_PERMISSION:
            no_permission()
        raise


def no_permission():
    print(PERMISSION_MESSAGE)
    print('[run] stopped without capturing (exit code %d); --no-capture runs the script without screenshots'
          % EXIT_NO_SCREEN_RECORDING)
    sys.stdout.flush()
    raise ScreenRecordingOff()


def preflight():
    """Stop before the engine starts when captures cannot work (no Screen Recording permission)."""
    if not _run(['preflight']).get('screenCapture'):
        no_permission()


def _list(pids):
    """The layer-0 windows of these processes (dicts: id, pid, owner, title, x, y, w, h, onscreen, alpha)."""
    args = ['list']
    for pid in sorted(pids):
        args += ['--pid', pid]
    try:
        rows = _run(args)
    except ScreenRecordingOff:
        raise
    except Exception as e:
        message = getattr(e, 'message', None) or str(e)
        if message != _list_error[0]:
            print('[capture] the window list failed: %s' % message)
            _list_error[0] = message
        return []
    rows = [w for w in rows if isinstance(w, dict) and isinstance(w.get('id'), int)] if isinstance(rows, list) else []
    for w in rows:
        _OWNER[w['id']] = w.get('pid')
    return rows


def _main_processes(pids):
    """The engine's main processes among these (content processes and helpers own no windows)."""
    names = {pid: os.path.basename(path) for pid, _parent, path in _rows()}
    main = {pid for pid in pids if names.get(pid) == 'firefox'}
    return main or set(pids)


def find_window(pids):
    """The largest on-screen, visible layer-0 window of these processes: its window number, or None.
    When none of them is on screen, the largest titled one that is off screen: the window is on another
    Space (the person moved to another Space or to an app in full screen while the run went on), and
    capture() brings its app to the front first, which takes macOS to that Space."""
    pids = {int(p) for p in pids}
    if not pids:
        return None
    best = None
    spare = None
    for w in _list(_main_processes(pids)):
        if w.get('pid') not in pids or w.get('alpha', 1) == 0:
            continue
        area = (w.get('w') or 0) * (w.get('h') or 0)
        if w.get('onscreen') is False:
            # Off screen: only a real browser window (a title, not the menu bar's strips or a hidden window).
            if w.get('title') and (w.get('h') or 0) > 100 and (spare is None or area > spare[0]):
                spare = (area, w['id'])
            continue
        if best is None or area > best[0]:
            best = (area, w['id'])
    if best:
        return best[1]
    return spare[1] if spare else None


def window_handle(text):
    """The window a @@capture line names. tools/spike-lib.js is to send the window number (NSWindow
    windowNumber, decimal or 0x hex); until then it sends the NSView pointer, which is_window() never
    finds among the run's windows, so the run's largest window is captured instead."""
    try:
        return int(text, 16) if text.lower().startswith('0x') else int(text)
    except ValueError:
        return None


def is_window(wid, tree):
    """A window of this run's processes."""
    return any(w['id'] == wid for w in _list(_main_processes(tree.alive())))


def _window(wid):
    """The window list's entry for this window number, or None."""
    owner = _OWNER.get(wid)
    pids = {owner} if owner else {pid for pid, _parent, path in _rows() if _in_engine(path) and os.path.basename(path) == 'firefox'}
    for w in _list(pids):
        if w['id'] == wid:
            return w
    return None


def raise_window(wid):
    """Bring the window's app to the front, and the window on top of it (front --pid --id). True when
    the window became the frontmost one."""
    owner = _OWNER.get(wid)
    if owner is None:
        w = _window(wid)
        owner = w and w.get('pid')
    if not owner:
        return False
    try:
        return bool(_run(['front', '--pid', owner, '--id', wid]).get('front'))
    except ScreenRecordingOff:
        raise
    except Exception as e:
        print('[capture] could not bring the window to the front: %s' % (getattr(e, 'message', None) or e))
        return False


def _png_size(path):
    try:
        with open(path, 'rb') as f:
            head = f.read(24)
    except OSError:
        return 0, 0
    if len(head) < 24 or head[:8] != b'\x89PNG\r\n\x1a\n':
        return 0, 0
    return struct.unpack('>II', head[16:24])


def capture(wid, path):
    """Screenshot the window `wid` (no shadow, physical pixels: 2 per point on Retina) into the PNG
    `path`, after bringing it to the front. Returns (ok, width, height)."""
    if os.path.exists(path):
        os.remove(path)  # never leave an older picture under this name
    for attempt in (1, 2):
        raise_window(wid)
        # The window server composites the raised window; a second try (the first failed: a Space
        # switch still running, or the person took another app to the front in between) waits longer.
        time.sleep(0.4 if attempt == 1 else 1.2)
        try:
            _run(['capture', '--id', wid, '--out', path, '--no-shadow'])
            break
        except ScreenRecordingOff:
            raise
        except Exception as e:
            print('[capture] %s: %s%s' % (os.path.basename(path), getattr(e, 'message', None) or e, ' (trying again)' if attempt == 1 else ''))
            if os.path.exists(path):
                os.remove(path)
            if attempt == 2:
                return False, 0, 0
    w, h = _png_size(path)
    return w > 0 and h > 0, w, h


def _bundle(wid):
    """The .app folder of the process that owns the window (the engine's bundle when unknown)."""
    owner = _OWNER.get(wid)
    path = {pid: p for pid, _parent, p in _rows()}.get(owner, '') if owner else ''
    i = path.find('.app/Contents/MacOS/')
    return path[:i + 4] if i >= 0 else ENGINE_APP


def _info(bundle):
    with open(os.path.join(bundle, 'Contents', 'Info.plist'), 'rb') as f:
        return plistlib.load(f)


def window_aumid(wid):
    """What the Dock groups the window's app by (the taskbar id on Windows): its bundle identifier."""
    try:
        return _info(_bundle(wid)).get('CFBundleIdentifier') or '(unset)'
    except Exception as e:
        return '(error %s)' % e


def window_title(wid):
    """The window's title, or None: without the Screen Recording permission macOS hides the titles of
    other apps' windows."""
    w = _window(wid)
    return w.get('title') if w else None


def dump_window_icon(wid, path, size=64):
    """The icon of the window's app bundle (CFBundleIconFile) as a PNG. Returns its source."""
    try:
        bundle = _bundle(wid)
        name = _info(bundle).get('CFBundleIconFile') or ''
        if name and not name.endswith('.icns'):
            name += '.icns'
        icns = os.path.join(bundle, 'Contents', 'Resources', name)
        if not name or not os.path.exists(icns):
            return 'no icon'
        r = subprocess.run(['sips', '-s', 'format', 'png', '-z', str(size), str(size), icns, '--out', path],
                           capture_output=True, text=True, timeout=60)
        return 'bundle icon %s' % name if r.returncode == 0 and os.path.exists(path) else 'no icon'
    except Exception as e:
        return 'no icon (%s)' % e


def shoot(wid, out, name, identity):
    ok, w, h = capture(wid, os.path.join(out, name + '.png'))
    line = '[capture] %s.png %dx%d ok=%s' % (name, w, h, bool(ok))
    if identity:
        src = dump_window_icon(wid, os.path.join(out, name + '.icon.png'))
        line += ' title=%r taskbar-id=%r %s -> %s.icon.png' % (window_title(wid), window_aumid(wid), src, name)
    print(line)


def shoot_screen(wid, pids, rect, out, name):
    """The screen area `rect` ([x, y, w, h] in global points) with only this run's windows in it: the
    window `wid` brought to the front first, so its menus and popups (separate windows) are captured
    over it (spike.captureScreen)."""
    path = os.path.join(out, name + '.png')
    if os.path.exists(path):
        os.remove(path)
    raise_window(wid)
    time.sleep(0.4)
    x, y, w, h = rect
    try:
        _run(['capture-rect', '--x', x, '--y', y, '--w', w, '--h', h, '--out', path] + [a for p in pids for a in ('--pid', p)])
    except ScreenRecordingOff:
        raise
    except Exception as e:
        print('[capture] %s: %s' % (name + '.png', getattr(e, 'message', None) or e))
    pw, ph = _png_size(path)
    print('[capture] %s.png %dx%d ok=%s (screen area)' % (name, pw, ph, pw > 0 and ph > 0))


# ---- profile ------------------------------------------------------------------------------------

def remove_profile(profile):
    """Delete a throwaway profile. The --app link inside it is unlinked first so the build folder it
    points at is never touched."""
    link = os.path.join(profile, 'chrome', 'vitre-app')
    if os.path.islink(link):
        os.unlink(link)
    if os.path.lexists(link):
        raise SystemExit('refusing to delete %s: %s is not a symbolic link' % (profile, link))
    shutil.rmtree(profile, ignore_errors=True)


def link_app(profile, build):
    """<profile>/chrome/vitre-app -> the build folder, passed as VITRE_APP_DIR. The content sandbox reads
    <profile>/chrome by real path only, so config.js adds the build's real folder as
    security.sandbox.content.mac.testing_read_path2 (harness profile with VITRE_APP_DIR)."""
    link = os.path.join(profile, 'chrome', 'vitre-app')
    os.makedirs(os.path.dirname(link), exist_ok=True)
    if os.path.islink(link):
        os.unlink(link)
    os.symlink(build, link)
    return link


# ---- adapters for harness/common.py main() ----------------------------------------------------

def _check_profile_inputs(a):
    """Stop when --env or --arg would make Gecko use another profile than the throwaway one."""
    for e in a.env:
        if e.split('=', 1)[0] in PROFILE_ENV:
            raise SystemExit('--env %s is refused on macOS: it replaces -profile, and the harness runs on '
                             'its throwaway profile only' % e.split('=', 1)[0])
    for arg in a.arg:
        if arg.startswith('-') and arg.split('=', 1)[0].lstrip('-').lower() in PROFILE_ARGS:
            raise SystemExit('--arg %s is refused on macOS: the harness runs on its throwaway profile only' % arg)


def _prepare_captures(a):
    """Build deer-wintool before the engine starts. Its first build takes about 10 s, as long as
    spike.capture() waits for a capture, so a first capture would otherwise be taken after the script
    has moved on. A failure is only reported here: it matters at the first capture."""
    if getattr(a, 'no_capture', False):
        return
    try:
        _tool().build_tool()
    except (Exception, SystemExit) as e:
        print('[capture] deer-wintool is not ready: %s' % (getattr(e, 'message', None) or e))


def engine(a):
    """The engine: always Contents/MacOS/firefox of the development bundle (never renamed or copied)."""
    if a.exe:
        raise SystemExit('--exe is Windows-only: on macOS the engine always runs as Contents/MacOS/firefox')
    if not os.path.exists(VITRE) or not os.path.exists(os.path.join(GRE_DIR, 'config.js')):
        raise SystemExit('the engine is not wired for Deer: run  python3 tools/setup-runtime.py')
    _check_profile_inputs(a)
    _prepare_captures(a)
    return VITRE


def temp_dir():
    """$TMPDIR with links resolved (/private/var/...), as the engine reports paths."""
    return engine_paths.tmp_root()


def command(exe, profile, args, url):
    # -foreground: the app comes to the front at start (macOS does not draw a covered inactive window).
    return [exe, '-no-remote', '-foreground', '-profile', profile] + list(args) + [url]
