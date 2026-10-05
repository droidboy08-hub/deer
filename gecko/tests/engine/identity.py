"""Deer's engine identity, proven on the unbranded engine (from gecko/):

  python tests/engine/identity.py [--no-setup] [--suites] [--reference] [--fallback] [--env-overrides]
                                  [--keep-profile] [--keep-traces]
                                  [--engine engines/deer-identity] [--app build-identity] [--prefix identity]

  --engine, --app, --prefix   the engine folder written and tested, the chrome package build it links,
             and the prefix of every run name and output folder (<prefix>-session, <prefix>-smoke, ...).
             Defaults: engines/deer-identity, build-identity, identity. Another agent uses its own
             (e.g. --engine engines/deer-identity-check --app build-identity-check --prefix identity-check).
  setup      node tools/build.mjs --out=<app>; python tools/setup-engine.py --app <app> --out <engine>,
             then --check (skipped with --no-setup)
  snapshot   everything outside the profile and the engine folder where Gecko keeps housekeeping data:
             files (stat only, nothing is opened) under %APPDATA%\\Deer*, %LOCALAPPDATA%\\Deer*,
             %APPDATA%\\Mozilla, %LOCALAPPDATA%\\Mozilla, %ProgramData%\\Mozilla*, %ProgramData%\\Deer*,
             %USERPROFILE%\\AppData\\LocalLow\\Mozilla* and \\Deer*, the top of %TEMP% for the engine's
             names there (mozilla*, firefox*, deerapp*, *BackgroundTask*: background-task profiles, the
             helper-app folder mozilla-temp-files / deerapp-temp-files; TempWatch also lists what came and
             went there during the window) and the top of the Start menu's Programs folder; registry values
             under HKCU\\Software\\Mozilla, HKCU\\Software\\Deer, HKCU\\Software\\Classes\\AppUserModelId,
             HKCU\\...\\Windows Error Reporting (the crash reporter's WER module), the names under
             HKCU\\Software\\Classes and HKCU\\Software\\Classes\\CLSID, HKCU\\...\\CurrentVersion\\Run,
             Notifications\\Settings, RegisteredApplications and Clients\\StartMenuInternet.
             Profiles are never looked into: a folder holding prefs.js or parent.lock is recorded as a
             folder only (the throwaway profile of these runs is in %TEMP%, outside every snapshot).
  --suites   inside the snapshot window, also tests/core/smoke.js, tests/core/shell.js and
             tests/engine/probe.js through tests/engine/run_engine.py (names <prefix>-smoke,
             <prefix>-shell, <prefix>-probe)
  session    tests/engine/identity.js on engines/deer-identity, started like Deer.exe starts it
             (deer.exe -profile P <url>, no -no-remote, no -app, no XUL_APP_FILE, and here without
             MOZ_CRASHREPORTER_DISABLE): identity, data root, user agent, getBrowserInfo(), crash
             reporter, Windows notifications set up, URL hand-off from a 2nd start (deer.exe -profile P
             <url>) and a 3rd (-new-window <url>) with their exit codes and the number of main
             processes, the remote window class, then an in-place restart and a clean quit.
  diff       every file and registry value that appeared, changed or went away during the window,
             sorted into: under Deer's names / under Mozilla's names / elsewhere. Anything under
             Mozilla's names that belongs to this engine (its folder, its install hash) FAILS; other
             changes there are listed as not ours (an installed Firefox running meanwhile is named).
  clean      before the snapshot and after the diff: this engine's traces are removed with the list an
             uninstaller needs (traces(): only entries keyed to this engine's folder or install hash);
             after it, nothing of this engine may differ from the first snapshot (--keep-traces skips it)
  --reference  afterwards (outside the snapshot): identity.js in facts mode on engines/deer-runtime
             when that folder still has the stock identity, for the reference user agent
  --fallback afterwards (outside the snapshot): engines/deer-runtime's unpatched deer.exe started with
             -app engines/deer-identity/browser/application.ini (the route when the exe cannot be
             patched), and what that leaves in the environment of programs Deer starts
  --env-overrides  afterwards (outside the snapshot): what a launcher must remove from the engine's
             environment, proven: an inherited XUL_APP_FILE (a throwaway "DeerEnvProbe" ini in
             <engine>\\browser, removed again) replaces the compiled-in identity, and an inherited
             XRE_PROFILE_PATH replaces -profile (runs <prefix>-xulapp, <prefix>-xreprofile; their traces
             are cleaned)
Output: tests/engine/out/<prefix>-*/ (log.txt; <prefix>-session/identity.log has this runner's lines).
Exit code 0 when every check passed, nothing of this engine was written under Mozilla's names and the
cleanup left nothing of it.
"""
import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import winreg

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')
PY = sys.executable
ENGINE = os.path.join(ROOT, 'engines', 'deer-identity')
STOCK = os.path.join(ROOT, 'engines', 'deer-runtime')
BUILD = 'build-identity'

_spec = importlib.util.spec_from_file_location('run_engine', os.path.join(HERE, 'run_engine.py'))
RE = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(RE)

LINES = []


def say(line=''):
    print(line, flush=True)
    LINES.append(line)


def sh(cmd, **kw):
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', **kw)


# ---- Gecko's install hash ---------------------------------------------------------------------------
# CityHash64 (v1.0.x, as vendored in Mozilla's source: other-licenses/nsis/Contrib/CityHash; MIT
# licence, Copyright (c) 2011 Google, Inc.) of the engine folder's path in UTF-16LE, upper-case hex
# without padding (toolkit/mozapps/update/common/commonupdatedir.cpp GetInstallHash).

_M = (1 << 64) - 1
_K0, _K1, _K2, _K3 = 0xc3a5c85c97cb3127, 0xb492b66fbe98f273, 0x9ae16a3b2f90404f, 0xc949d7c7509e6557


def _f64(s, i):
    return int.from_bytes(s[i:i + 8], 'little')


def _f32(s, i):
    return int.from_bytes(s[i:i + 4], 'little')


def _rot(v, n):
    return v if n == 0 else ((v >> n) | (v << (64 - n))) & _M


def _mix(v):
    return v ^ (v >> 47)


def _h16(u, v):
    kmul = 0x9ddfea08eb382d69
    a = ((u ^ v) * kmul) & _M
    a ^= a >> 47
    b = ((v ^ a) * kmul) & _M
    b ^= b >> 47
    return (b * kmul) & _M


def _weak(w, x, y, z, a, b):
    a = (a + w) & _M
    b = _rot((b + a + z) & _M, 21)
    c = a
    a = (a + x + y) & _M
    b = (b + _rot(a, 44)) & _M
    return (a + z) & _M, (b + c) & _M


def _weak_s(s, i, a, b):
    return _weak(_f64(s, i), _f64(s, i + 8), _f64(s, i + 16), _f64(s, i + 24), a, b)


def cityhash64(s):
    n = len(s)
    if n <= 16:
        if n > 8:
            a, b = _f64(s, 0), _f64(s, n - 8)
            return _h16(a, _rot((b + n) & _M, n)) ^ b
        if n >= 4:
            return _h16((n + (_f32(s, 0) << 3)) & _M, _f32(s, n - 4))
        if n > 0:
            y = s[0] + (s[n >> 1] << 8)
            z = n + (s[n - 1] << 2)
            return (_mix(((y * _K2) ^ (z * _K3)) & _M) * _K2) & _M
        return _K2
    if n <= 32:
        a = (_f64(s, 0) * _K1) & _M
        b = _f64(s, 8)
        c = (_f64(s, n - 8) * _K2) & _M
        d = (_f64(s, n - 16) * _K0) & _M
        return _h16((_rot((a - b) & _M, 43) + _rot(c, 30) + d) & _M, (a + _rot(b ^ _K3, 20) - c + n) & _M)
    if n <= 64:
        z = _f64(s, 24)
        a = (_f64(s, 0) + (n + _f64(s, n - 16)) * _K0) & _M
        b = _rot((a + z) & _M, 52)
        c = _rot(a, 37)
        a = (a + _f64(s, 8)) & _M
        c = (c + _rot(a, 7)) & _M
        a = (a + _f64(s, 16)) & _M
        vf, vs = (a + z) & _M, (b + _rot(a, 31) + c) & _M
        a = (_f64(s, 16) + _f64(s, n - 32)) & _M
        z = _f64(s, n - 8)
        b = _rot((a + z) & _M, 52)
        c = _rot(a, 37)
        a = (a + _f64(s, n - 24)) & _M
        c = (c + _rot(a, 7)) & _M
        a = (a + _f64(s, n - 16)) & _M
        wf, ws = (a + z) & _M, (b + _rot(a, 31) + c) & _M
        r = _mix(((vf + ws) * _K2 + (wf + vs) * _K0) & _M)
        return (_mix((r * _K0 + vs) & _M) * _K2) & _M
    # Inputs over 64 bytes: CityHash v1.0.0/1.0.1's loop (the one Mozilla vendors).
    x = _f64(s, 0)
    y = _f64(s, n - 16) ^ _K1
    z = _f64(s, n - 56) ^ _K0
    v = _weak_s(s, n - 64, n, y)
    w = _weak_s(s, n - 32, (n * _K1) & _M, _K0)
    z = (z + _mix(v[1]) * _K1) & _M
    x = (_rot((z + x) & _M, 39) * _K1) & _M
    y = (_rot(y, 33) * _K1) & _M
    left, i = (n - 1) & ~63, 0
    while True:
        x = (_rot((x + y + v[0] + _f64(s, i + 16)) & _M, 37) * _K1) & _M
        y = (_rot((y + v[1] + _f64(s, i + 48)) & _M, 42) * _K1) & _M
        x ^= w[1]
        y ^= v[0]
        z = _rot(z ^ w[0], 33)
        v = _weak_s(s, i, (v[1] * _K1) & _M, (x + w[0]) & _M)
        w = _weak_s(s, i + 32, (z + w[1]) & _M, y)
        z, x = x, z
        i += 64
        left -= 64
        if left == 0:
            break
    return _h16((_h16(v[0], w[0]) + _mix(y) * _K1 + z) & _M, (_h16(v[1], w[1]) + x) & _M)


def install_hash(folder):
    return '%X' % cityhash64(folder.encode('utf-16le'))


# ---- this engine's traces outside its folder (what an uninstaller removes) ---------------------------

# The names an engine keeps its housekeeping data under: Deer's (tools/setup-engine.py IDENTITY and
# COMPILED_NAMES) and, for an engine with the stock identity, Mozilla's.
DEER_NAMES = {'compiled': 'Deer\\EngineData', 'vendor': 'Deer', 'appname': 'firefox', 'root': 'Deer',
              'updates': 'Deer-Engine-1de4eec8-1241-4177-a864-e594fb38', 'toast': 'DeerApp', 'temp': 'deerapp-temp-files'}
MOZILLA_NAMES = {'compiled': 'Mozilla\\Firefox', 'vendor': 'Mozilla', 'appname': 'firefox', 'root': None,
                 'updates': 'Mozilla-1de4eec8-1241-4177-a864-e594e8d1fb38', 'toast': 'Firefox', 'temp': 'mozilla-temp-files'}


def traces(engine, names=DEER_NAMES):
    """Every place outside the profile and the folder where the engine in `engine` keeps housekeeping
    data, as (kind, location, name): exactly the entries keyed to this engine (its path or its install
    hash), so nothing of another install is ever listed. From the session's diff (and, for the
    notification entries, Gecko's widget/windows/ToastNotification.cpp)."""
    exe = os.path.join(engine, 'deer.exe')
    h = install_hash(engine)
    appdata, local = os.environ['APPDATA'], os.environ['LOCALAPPDATA']
    programdata = os.environ.get('ProgramData', r'C:\ProgramData')
    upd = os.path.join(programdata, names['updates'])
    reg = 'Software\\%s\\' % names['compiled']
    files = os.path.join(appdata, names['compiled'])
    # The third-party-module blocklist file (only once a module is blocked in about:third-party) is
    # named by the "<exe>|Blocklist" value (seen: blocklist-<CityHash64 of the lower-cased exe path>).
    blocklist = None
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, reg + 'Launcher') as k:
            blocklist = winreg.QueryValueEx(k, exe + '|Blocklist')[0]
    except OSError:
        pass
    toast = names['toast'] + 'PortableToast-' + h
    out = [
        ('file', blocklist, None),  # first: read from the value the next line deletes
        ('values', reg + 'Launcher', exe + '|'),
        ('values', reg + 'PreXULSkeletonUISettings', exe + '|'),
        ('values', reg + 'DllPrefetchExperiment', exe),
        ('values', reg + 'Default Browser Agent', engine + '|'),
        ('key', 'Software\\%s\\%s\\Installer\\%s' % (names['vendor'], names['appname'], h), None),
        ('key', 'Software\\Classes\\AppUserModelId\\' + toast, None),
        ('key', 'Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\' + toast, None),
        ('clsid', 'Software\\Classes\\CLSID', engine),
        ('dir', os.path.join(upd, 'updates', h), None),
        ('file', os.path.join(upd, 'UpdateLock-' + h), None),
        ('file', os.path.join(upd, 'profile_count_' + h + '.json'), None),
        # A background task's throwaway profile, left only if the task was killed (from Gecko's code:
        # vendor literal "Mozilla" whatever the identity; not observed, background tasks cannot start
        # under the test sandbox).
        ('globdirs', tempfile.gettempdir(), 'MozillaBackgroundTask-' + h + '-'),
    ]
    if names['root']:
        # Deer's own folders and keys, shared by every Deer engine of this user: removed only when empty.
        # The pre-XUL skeleton UI (off in Deer) would hold %LOCALAPPDATA%\<compiled>\SkeletonUILock-<hash>
        # (8 hex digits; seen for Mozilla's names) while it shows; such a lock is left only by a crash.
        root = names['root']
        skeleton = os.path.join(local, names['compiled'])
        out += [('glob', skeleton, 'SkeletonUILock-'), ('empty', skeleton, None),
                ('empty', os.path.join(upd, 'updates'), None), ('empty', upd, None), ('empty', files, None),
                ('empty', os.path.join(local, root, 'Profiles'), None), ('empty', os.path.join(appdata, root, 'Profiles'), None),
                ('empty', os.path.join(local, root), None), ('empty', os.path.join(appdata, root), None),
                # %TEMP%\deerapp-temp-files: files opened with another program (Gecko deletes them on
                # exit; every start creates and deletes deerapp-temp-<n> in it). Shared by Deer's engines.
                ('empty', os.path.join(tempfile.gettempdir(), names['temp']), None),
                ('emptykeys', 'Software\\' + names['vendor'], None)]
    return h, out


def _delete_tree(root, path):
    try:
        with winreg.OpenKey(root, path, 0, winreg.KEY_READ) as k:
            subs = []
            i = 0
            while True:
                try:
                    subs.append(winreg.EnumKey(k, i))
                except OSError:
                    break
                i += 1
    except OSError:
        return False
    for s in subs:
        _delete_tree(root, path + '\\' + s)
    winreg.DeleteKey(root, path)
    return True


def _prune_empty_keys(path):
    """Delete keys under (and including) path that hold no values and no subkeys, bottom up."""
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_READ) as k:
            subs = []
            i = 0
            while True:
                try:
                    subs.append(winreg.EnumKey(k, i))
                except OSError:
                    break
                i += 1
    except OSError:
        return []
    removed = []
    for s in subs:
        removed += _prune_empty_keys(path + '\\' + s)
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_READ) as k:
        n_sub, n_val, _ = winreg.QueryInfoKey(k)
    if n_sub == 0 and n_val == 0:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path)
        removed.append('HKCU\\' + path)
    return removed


def clean_traces(engine, names=DEER_NAMES):
    """Remove this engine's traces (traces()). Returns what was removed."""
    h, items = traces(engine, names)
    removed = []
    for kind, where, name in items:
        if kind == 'values':
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, where, 0, winreg.KEY_READ | winreg.KEY_SET_VALUE) as k:
                    vnames, i = [], 0
                    while True:
                        try:
                            vnames.append(winreg.EnumValue(k, i)[0])
                        except OSError:
                            break
                        i += 1
                    for n in vnames:
                        if n.lower() == name.lower() or (name.endswith('|') and n.lower().startswith(name.lower())):
                            winreg.DeleteValue(k, n)
                            removed.append('HKCU\\%s :: %s' % (where, n))
            except OSError:
                pass
        elif kind == 'key':
            if _delete_tree(winreg.HKEY_CURRENT_USER, where):
                removed.append('HKCU\\' + where)
        elif kind == 'clsid':
            # The notification server's COM registration, only when it points into this engine folder.
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, where, 0, winreg.KEY_READ) as k:
                    subs, i = [], 0
                    while True:
                        try:
                            subs.append(winreg.EnumKey(k, i))
                        except OSError:
                            break
                        i += 1
                for s in subs:
                    try:
                        server = winreg.QueryValue(winreg.HKEY_CURRENT_USER, where + '\\' + s + '\\InprocServer32')
                    except OSError:
                        continue
                    if server and os.path.normcase(server).startswith(os.path.normcase(name) + os.sep):
                        if _delete_tree(winreg.HKEY_CURRENT_USER, where + '\\' + s):
                            removed.append('HKCU\\%s\\%s (%s)' % (where, s, server))
            except OSError:
                pass
        elif kind == 'dir' and os.path.isdir(where):
            import shutil
            shutil.rmtree(where)
            removed.append(where)
        elif kind == 'file' and where and os.path.isfile(where):
            # Only inside the folders listed for these names (the blocklist path comes from the registry).
            homes = [os.path.join(os.environ.get('ProgramData', r'C:\ProgramData'), names['updates']),
                     os.path.join(os.environ['APPDATA'], names['compiled'])]
            if any(os.path.normcase(where).startswith(os.path.normcase(x) + os.sep) for x in homes):
                os.remove(where)
                removed.append(where)
        elif kind == 'globdirs' and os.path.isdir(where):
            import shutil
            for n in os.listdir(where):
                p = os.path.join(where, n)
                if n.lower().startswith(name.lower()) and os.path.isdir(p):
                    shutil.rmtree(p, ignore_errors=True)
                    removed.append(p)
        elif kind == 'glob' and os.path.isdir(where):
            for n in os.listdir(where):
                p = os.path.join(where, n)
                if n.startswith(name) and os.path.isfile(p):
                    os.remove(p)
                    removed.append(p)
        elif kind == 'empty' and os.path.isdir(where) and not os.listdir(where):
            os.rmdir(where)
            removed.append(where)
        elif kind == 'emptykeys':
            removed += _prune_empty_keys(where)
    return h, removed


# ---- snapshots (read only) ------------------------------------------------------------------------

def _is_profile(path):
    return any(os.path.exists(os.path.join(path, n)) for n in ('prefs.js', 'parent.lock', 'vitre-profile', 'times.json'))


def walk_files(label, top, out, depth=None):
    """{label\\relpath: [kind, size, mtime_ns]} for everything under top (stat only)."""
    if not os.path.isdir(top):
        return
    stack = [(top, 0)]
    while stack:
        folder, level = stack.pop()
        try:
            entries = list(os.scandir(folder))
        except OSError:
            continue
        for e in entries:
            rel = label + '\\' + os.path.relpath(e.path, top)
            try:
                st = e.stat(follow_symlinks=False)
            except OSError:
                continue
            if e.is_dir(follow_symlinks=False):
                if _is_profile(e.path):
                    out[rel] = ['profile', 0, st.st_mtime_ns]
                    continue
                out[rel] = ['dir', 0, st.st_mtime_ns]
                if depth is None or level + 1 < depth:
                    stack.append((e.path, level + 1))
            else:
                out[rel] = ['file', st.st_size, st.st_mtime_ns]


def snap_files():
    out = {}
    appdata, local = os.environ['APPDATA'], os.environ['LOCALAPPDATA']
    programdata = os.environ.get('ProgramData', r'C:\ProgramData')
    # The low-integrity data root (Gecko's MOZ_USER_DIR "Mozilla" lives there on some versions).
    locallow = os.path.join(os.environ.get('USERPROFILE', os.path.dirname(appdata)), 'AppData', 'LocalLow')
    for base, label in ((appdata, '%APPDATA%'), (local, '%LOCALAPPDATA%'), (programdata, '%ProgramData%'), (locallow, '%LocalLow%')):
        if not os.path.isdir(base):
            continue
        for name in os.listdir(base):
            low = name.lower()
            if low.startswith(('deer', 'mozilla')):
                p = os.path.join(base, name)
                try:
                    out[label + '\\' + name] = ['dir' if os.path.isdir(p) else 'file', 0, os.stat(p).st_mtime_ns]
                except OSError:
                    continue
                walk_files(label + '\\' + name, p, out)
    # %TEMP%: only names under Mozilla's (other programs keep plenty there). A background task's
    # ephemeral profile is "<vendor>BackgroundTask-<install hash>-<task>..."; mozilla-temp-files is
    # Gecko's folder for files opened with another program (shared by every Gecko browser).
    temp = tempfile.gettempdir()
    for name in os.listdir(temp):
        low = name.lower()
        if low.startswith(('mozilla', 'firefox', 'deerapp')) or 'backgroundtask' in low:
            p = os.path.join(temp, name)
            try:
                st = os.stat(p)
            except OSError:
                continue
            isdir = os.path.isdir(p)
            out['%TEMP%\\' + name] = ['dir' if isdir else 'file', 0 if isdir else st.st_size, st.st_mtime_ns]
            if isdir:
                walk_files('%TEMP%\\' + name, p, out)
    walk_files('%StartMenuPrograms%', os.path.join(appdata, 'Microsoft', 'Windows', 'Start Menu', 'Programs'), out, depth=1)
    return out


REG_TREES = ['Software\\Mozilla', 'Software\\Deer', 'Software\\Classes\\AppUserModelId',
             'Software\\Microsoft\\Windows\\CurrentVersion\\Run', 'Software\\RegisteredApplications',
             'Software\\Clients\\StartMenuInternet',
             # RuntimeExceptionHelperModules: "<engine>\mozwer.dll", registered when the crash reporter is on.
             'Software\\Microsoft\\Windows\\Windows Error Reporting']
REG_NAMES = ['Software\\Classes', 'Software\\Classes\\CLSID',
             'Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings']


def _short(v):
    s = repr(v)
    return s if len(s) <= 160 else s[:157] + '...'


def walk_reg(path, out, values=True):
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_READ)
    except OSError:
        return
    with key:
        out['HKCU\\' + path + '\\'] = ['key']
        if values:
            i = 0
            while True:
                try:
                    name, data, kind = winreg.EnumValue(key, i)
                except OSError:
                    break
                out['HKCU\\' + path + ' :: ' + (name or '(default)')] = ['value', kind, _short(data)]
                i += 1
        i = 0
        subs = []
        while True:
            try:
                subs.append(winreg.EnumKey(key, i))
            except OSError:
                break
            i += 1
    for s in subs:
        if values:
            walk_reg(path + '\\' + s, out, True)
        else:
            out['HKCU\\' + path + '\\' + s + '\\'] = ['key']


def snap_reg():
    out = {}
    for p in REG_TREES:
        walk_reg(p, out, True)
    for p in REG_NAMES:
        walk_reg(p, out, False)
    return out


def snapshot():
    return {'files': snap_files(), 'registry': snap_reg(), 'time': time.time()}


class TempWatch:
    """Names that come and go in %TEMP%\\mozilla-temp-files and at the top of %TEMP% (Mozilla-named
    only) while the session runs: a before/after snapshot misses a file created and deleted in between,
    and cannot tell this engine's change from another program's. ReadDirectoryChangesW reports names
    only; nothing is opened."""
    ACTIONS = {1: 'added', 2: 'removed', 3: 'modified', 4: 'renamed from', 5: 'renamed to'}

    def __init__(self):
        import ctypes
        import ctypes.wintypes as wt
        import threading
        self.ct, self.wt, self.threading = ctypes, wt, threading
        k = ctypes.WinDLL('kernel32', use_last_error=True)
        k.CreateFileW.restype = wt.HANDLE
        k.CreateFileW.argtypes = [wt.LPCWSTR, wt.DWORD, wt.DWORD, ctypes.c_void_p, wt.DWORD, wt.DWORD, wt.HANDLE]
        k.ReadDirectoryChangesW.argtypes = [wt.HANDLE, ctypes.c_void_p, wt.DWORD, wt.BOOL, wt.DWORD,
                                            ctypes.POINTER(wt.DWORD), ctypes.c_void_p, ctypes.c_void_p]
        k.OpenThread.restype = wt.HANDLE
        k.CancelSynchronousIo.argtypes = [wt.HANDLE]
        self.k = k
        self.events, self.threads, self.stopping = [], [], False
        self.t0 = time.time()

    def _watch(self, folder, label, keep):
        k, ct, wt = self.k, self.ct, self.wt
        h = k.CreateFileW(folder, 0x1, 0x7, None, 3, 0x02000000, None)  # LIST_DIRECTORY, share all, BACKUP_SEMANTICS
        if not h or h == wt.HANDLE(-1).value:
            return
        buf = ct.create_string_buffer(65536)
        got = wt.DWORD()
        try:
            while not self.stopping:
                if not k.ReadDirectoryChangesW(h, buf, len(buf), False, 0x1 | 0x2, ct.byref(got), None, None):
                    break
                off = 0
                while got.value:
                    nxt, action, nlen = (wt.DWORD.from_buffer(buf, off + i).value for i in (0, 4, 8))
                    name = buf.raw[off + 12:off + 12 + nlen].decode('utf-16le', 'replace')
                    if keep(name):
                        self.events.append((time.time() - self.t0, self.ACTIONS.get(action, action), label + '\\' + name))
                    if not nxt:
                        break
                    off += nxt
        finally:
            k.CloseHandle(h)

    def start(self):
        temp = tempfile.gettempdir()
        moz = lambda n: n.lower().startswith(('mozilla', 'firefox', 'deerapp')) or 'backgroundtask' in n.lower()
        targets = [(temp, '%TEMP%', moz)]
        for sub in ('mozilla-temp-files', 'deerapp-temp-files'):
            if os.path.isdir(os.path.join(temp, sub)):
                targets.append((os.path.join(temp, sub), '%TEMP%\\' + sub, lambda n: True))
        for folder, label, keep in targets:
            t = self.threading.Thread(target=self._watch, args=(folder, label, keep), daemon=True)
            t.start()
            self.threads.append(t)
        self.t0 = time.time()
        return self

    def stop(self):
        self.stopping = True
        for t in self.threads:
            h = self.k.OpenThread(0x0001, False, t.native_id)  # THREAD_TERMINATE: what CancelSynchronousIo needs
            if h:
                self.k.CancelSynchronousIo(h)
                self.k.CloseHandle(h)
            t.join(2)
        return self.events


def expand_new_keys(before, after):
    """A key that appeared under Classes or CLSID: read its whole content now (what Gecko registered)."""
    extra = {}
    for k in after['registry']:
        if k not in before['registry'] and k.endswith('\\') and re.match(r'HKCU\\Software\\Classes\\(CLSID\\)?[^\\]+\\$', k):
            walk_reg(k[5:-1], extra, True)
    return extra


# ---- diff and attribution ---------------------------------------------------------------------------

# Where an entry lives (the key path or folder; never a value name, which is often a path): under
# Deer's names, under Mozilla's (Software\Mozilla, the Mozilla data folders, Firefox-named ids), or
# elsewhere.
DEER = re.compile(r'(?i)^(HKCU\\Software\\Deer(\\|$)|%(APPDATA|LOCALAPPDATA|ProgramData|LocalLow|TEMP)%\\Deer|.*\\(AppUserModelId|Notifications\\Settings)\\DeerApp)')
MOZ = re.compile(r'(?i)^(HKCU\\Software\\Mozilla(\\|$)|%(APPDATA|LOCALAPPDATA|ProgramData|LocalLow|TEMP)%\\Mozilla|.*\\(AppUserModelId|Notifications\\Settings)\\Firefox|.*firefox)')


def diff(before, after, extra):
    rows = []
    for kind in ('files', 'registry'):
        a, b = before[kind], after[kind]
        for k in sorted(set(a) | set(b)):
            if a.get(k) == b.get(k):
                continue
            if k not in a:
                state = 'new'
            elif k not in b:
                state = 'gone'
            else:
                state = 'changed'
            entry = b.get(k) or a.get(k)
            if kind == 'files' and entry[0] in ('dir', 'profile') and state == 'changed':
                state = 'touched'  # folder contents changed (listed on their own) or a file came and went
            rows.append((kind, state, k, b.get(k) or a.get(k)))
    for k, v in sorted(extra.items()):
        if k not in after['registry']:
            rows.append(('registry', 'new', k, v))
    return rows


def classify(row, engine, hashes):
    kind, state, key, value = row
    text = (key + ' ' + json.dumps(value)).lower().replace('\\\\', '\\')
    ours = bool(re.search(re.escape(engine.lower()) + r'([\\|"\']|$)', text)) or any(h and h.lower() in text for h in hashes)
    where = key.split(' :: ')[0]
    if DEER.search(where):
        return 'deer', ours
    if MOZ.search(where):
        return 'mozilla', ours
    return 'other', ours


# Mozilla-named places a Deer engine is known to still write to, with the reason: {place: why}. A diff
# row there is listed as "LEFT, explained" when TempWatch saw activity in it, not as a failure. Empty
# for the 157 engine: %TEMP%\mozilla-temp-files (every start creates and deletes mozilla-temp-<n> in
# it) was the last one and is renamed by setup-engine.py's COMPILED_NAMES. Other Gecko programs on the
# machine (Firefox, the development runtime) still produce Mozilla-named activity in the watch.
EXPLAINED = {}


def report(rows, engine, hashes, firefox_running, watched=()):
    groups = {'deer': [], 'mozilla': [], 'other': []}
    for row in rows:
        g, ours = classify(row, engine, hashes)
        groups[g].append((row, ours))
    bad = 0
    say('\nwritten outside the profile and the engine folder during the session (stat and registry diff):')
    titles = {'deer': "under Deer's names", 'mozilla': "under Mozilla's names", 'other': 'elsewhere'}
    seen_in = {e[2] for e in watched} | {e[2].rsplit('\\', 1)[0] for e in watched}
    for g in ('deer', 'mozilla', 'other'):
        say('  %s: %d' % (titles[g], len(groups[g])))
        for (kind, state, key, value), ours in groups[g]:
            mark = ''
            where = key.split(' :: ')[0]
            explained = next((k for k in EXPLAINED if where == k or where.startswith(k + '\\')), None)
            if g == 'mozilla' and explained and explained in seen_in:
                mark = 'LEFT, explained '
            elif g == 'mozilla':
                if ours:
                    mark = 'FAIL '
                    bad += 1
                else:
                    mark = '(not this engine) '
            shown = value[2] if kind == 'registry' and value and value[0] == 'value' else (value[1] if value and value[0] == 'file' else '')
            say('    %s%-7s %s%s' % (mark, state, key, ('  = ' + str(shown)) if shown != '' else ''))
    if groups['mozilla'] and not bad and firefox_running:
        say('  (the installed Firefox was running meanwhile: %s)' % ', '.join(firefox_running))
    if watched:
        say('  came and went in %TEMP% during the runs (TempWatch, seconds from the first run\'s start; '
            'Mozilla-named ones can be any Gecko program on this machine):')
        for t, action, name in watched[:40]:
            say('    %+7.1f %-12s %s' % (t, action, name))
        if len(watched) > 40:
            say('    ... %d more' % (len(watched) - 40))
    for k, why in EXPLAINED.items():
        if k in seen_in:
            say('  LEFT under Mozilla\'s names, explained: %s: %s' % (k, why))
    return bad


def other_firefox_running():
    r = sh(['powershell', '-NoProfile', '-Command',
            "Get-Process firefox -ErrorAction SilentlyContinue | ForEach-Object { $_.Path } | Sort-Object -Unique"])
    return [p for p in r.stdout.splitlines() if p.strip() and not p.lower().startswith(ROOT.lower())]


# ---- the session ------------------------------------------------------------------------------------

def main_processes(profile):
    """deer.exe processes started on this profile that are not child processes (no -contentproc)."""
    ps = ("[Console]::OutputEncoding = [Text.Encoding]::UTF8; "
          "Get-CimInstance Win32_Process -Filter \"Name='deer.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress")
    try:
        rows = json.loads(sh(['powershell', '-NoProfile', '-Command', ps], timeout=60).stdout or '[]')
    except Exception:
        return -1
    if isinstance(rows, dict):
        rows = [rows]
    key = re.compile(re.escape(os.path.basename(profile).lower()) + r'(?![\w.-])')
    return sum(1 for r in rows if r.get('CommandLine') and key.search(r['CommandLine'].lower()) and '-contentproc' not in r['CommandLine'])


def window_classes(pids):
    """Class names of every window (top-level and message-only) of these processes."""
    import ctypes
    import ctypes.wintypes as wt
    user32 = ctypes.windll.user32
    user32.FindWindowExW.restype = wt.HWND
    user32.FindWindowExW.argtypes = [wt.HWND, wt.HWND, wt.LPCWSTR, wt.LPCWSTR]
    found = set()

    def add(hwnd):
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids:
            buf = ctypes.create_unicode_buffer(512)
            user32.GetClassNameW(hwnd, buf, 512)
            found.add(buf.value)

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(hwnd, _):
        add(hwnd)
        return True

    user32.EnumWindows(each, 0)
    HWND_MESSAGE = wt.HWND(-3)
    h = None
    for _ in range(100000):
        h = user32.FindWindowExW(HWND_MESSAGE, h, None, None)
        if not h:
            break
        add(h)
    return sorted(found)


def restart_registrations(pids):
    """{pid: [command line, flags]} registered with Windows' restart manager (RegisterApplicationRestart):
    what Windows would start after an update reboot. Only processes that registered appear."""
    import ctypes
    import ctypes.wintypes as wt
    k32 = ctypes.WinDLL('kernel32', use_last_error=True)
    k32.OpenProcess.restype = wt.HANDLE
    k32.GetApplicationRestartSettings.argtypes = [wt.HANDLE, wt.LPWSTR, ctypes.POINTER(wt.DWORD), ctypes.POINTER(wt.DWORD)]
    out = {}
    for pid in pids:
        h = k32.OpenProcess(0x1000 | 0x0010, False, pid)  # QUERY_LIMITED_INFORMATION | VM_READ
        if not h:
            continue
        size, flags = wt.DWORD(0), wt.DWORD(0)
        if k32.GetApplicationRestartSettings(h, None, ctypes.byref(size), ctypes.byref(flags)) == 0 and size.value:
            buf = ctypes.create_unicode_buffer(size.value)
            if k32.GetApplicationRestartSettings(h, buf, ctypes.byref(size), ctypes.byref(flags)) == 0:
                out[pid] = [buf.value, flags.value]
        k32.CloseHandle(h)
    return out


def session(name, test, mode, env_extra, engine, keep, timeout=240, pre_args=(), strict_quit=True):
    """Run tests/engine/identity.js (or `test`) on `engine` as Deer.exe starts it. strict_quit=False:
    a process still running 30 s after the script quit is stopped and reported, not counted as a
    failure. The browser process sometimes lingers about 30 s after a quit that comes within seconds
    of a start, then exits by itself: seen with Deer's identity, the stock one (identity-toastcmp)
    and DeerProbe alike, so it is not an identity check."""
    exe = os.path.join(engine, 'deer.exe')
    out = os.path.join(OUT, name)
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith(('.done', '.json', '.html')) and not f.startswith('snapshot'):
            os.remove(os.path.join(out, f))
    profile = os.path.join(tempfile.gettempdir(), 'vitre-gecko-' + name)
    RE.EXE_IMAGE = 'deer.exe'
    RE.kill(RE.stale_pids(profile))
    if os.path.exists(profile):
        RE.remove_profile(profile)
    os.makedirs(profile)
    with open(os.path.join(profile, 'user.js'), 'w', encoding='utf-8') as f:
        for k, v in RE.PREFS.items():
            f.write('user_pref(%s, %s);\n' % (json.dumps(k), json.dumps(v)))
    open(os.path.join(profile, 'vitre-harness'), 'w').close()
    log = os.path.join(out, 'log.txt')
    open(log, 'w').close()
    # Whether the read-only add-on folder %APPDATA%\Mozilla\Extensions (XREUSysExt) existed before this
    # run: identity.js checks that the engine does not create it.
    usys = os.path.join(os.environ['APPDATA'], 'Mozilla', 'Extensions')
    env = dict(os.environ, VITRE_LOG=log, VITRE_OUT=out, VITRE_ALLOW_ANY_PROFILE='1', MOZ_DISABLE_AUTO_SAFE_MODE='1',
               VITRE_BOOT=os.path.abspath(test), VITRE_LIB=os.path.join(ROOT, 'tools', 'spike-lib.js'), DEER_IDENTITY_MODE=mode,
               DEER_IDENTITY_USYSEXT_EXISTED='1' if os.path.isdir(usys) else '0')
    for k in ('VITRE_APP_DIR', 'VITRE_DISABLE', 'XUL_APP_FILE', 'XRE_PROFILE_PATH', 'XRE_PROFILE_LOCAL_PATH', 'MOZ_CRASHREPORTER_DISABLE'):
        env.pop(k, None)
    env.update(env_extra)
    # The 2nd and 3rd starts get the environment a shortcut or another program would give Deer.exe's child.
    env_other = {k: v for k, v in env.items() if not k.startswith(('VITRE_BOOT', 'VITRE_LIB', 'VITRE_LOG', 'VITRE_OUT', 'DEER_IDENTITY'))}
    cmd = [exe, *pre_args, '-profile', profile, 'about:blank']
    say('[%s] %s' % (name, ' '.join(cmd).replace(profile, '<profile>')) + ('  env ' + json.dumps(env_extra) if env_extra else ''))
    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tree = RE.Tree(proc.pid)
    seen, failed, quit_at = 0, 0, None
    lines_all = []
    deadline = time.time() + timeout
    try:
        while time.time() < deadline:
            time.sleep(0.1)
            alive = tree.alive()
            if quit_at is not None and not alive:
                break
            if quit_at is not None and time.time() - quit_at > 30:
                say('[%s] still running 30 s after the script quit: stopped%s' % (
                    name, '' if strict_quit else ' (not counted: a shutdown linger seen with every identity)'))
                failed += 1 if strict_quit else 0
                break
            with open(log, encoding='utf-8', errors='replace') as f:
                lines = f.read().split('\n')[:-1]
            for line in lines[seen:]:
                lines_all.append(line)
                if line.startswith('@@remoting'):
                    classes = [c for c in window_classes(tree.alive()) if 'remote' in c.lower()]
                    with open(os.path.join(out, 'remoting.json'), 'w', encoding='utf-8') as f:
                        json.dump(classes, f)
                elif line.startswith('@@restartcmd'):
                    regs = restart_registrations(tree.alive())
                    regs = [[v[0].replace(profile, '<profile>'), v[1]] for v in regs.values()]
                    with open(os.path.join(out, 'restartcmd.json'), 'w', encoding='utf-8') as f:
                        json.dump(regs, f)
                elif line.startswith('@@handoff '):
                    # deer.exe starts as Gecko's launcher process, which starts the browser process and
                    # exits: the start is over when its whole process tree is gone.
                    _, n, url = line.split(' ', 2)
                    args = [exe, '-profile', profile] + (['-new-window'] if n == '2' else []) + [url]
                    t0 = time.time()
                    p2 = subprocess.Popen(args, env=env_other, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    t2 = RE.Tree(p2.pid)
                    gone = False
                    while time.time() - t0 < 25:
                        if p2.poll() is not None and not t2.alive():
                            gone = True
                            break
                        time.sleep(0.05)
                    ms = int((time.time() - t0) * 1000)
                    if not gone:
                        RE.kill(t2.alive() | ({p2.pid} if p2.poll() is None else set()))
                    result = {'exitCode': p2.poll(), 'processTreeGoneAfterMs': ms if gone else None,
                              'startedProcesses': len(t2.known), 'mainProcesses': main_processes(profile),
                              'args': ['deer.exe', '-profile', '<profile>'] + args[3:]}
                    say('[%s] start %s: %s' % (name, int(n) + 1, json.dumps(result)))
                    with open(os.path.join(out, 'handoff-%s.json' % n), 'w', encoding='utf-8') as f:
                        json.dump(result, f)
                elif line.startswith('@@quit'):
                    quit_at = time.time()
                elif line.startswith('@@capture'):
                    pass
                else:
                    if re.match(r'(FAIL|ERROR)\b', line):
                        failed += 1
                    say(line)
            seen = len(lines)
        else:
            say('[%s] timed out after %ss' % (name, timeout))
            failed += 1
    finally:
        left = tree.alive()
        if left:
            RE.kill(left)
        if not keep:
            time.sleep(0.5)
            RE.remove_profile(profile)
    with open(os.path.join(out, 'identity.log'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(LINES) + '\n')
    return failed, lines_all


def facts_of(lines):
    out = {}
    for line in lines:
        m = re.match(r'FACT (.+?) = (.*)$', line)
        if m:
            try:
                out[m.group(1)] = json.loads(m.group(2))
            except ValueError:
                out[m.group(1)] = m.group(2)
    return out


def engine_identity(folder):
    try:
        return json.load(open(os.path.join(folder, 'deer-engine.json'), encoding='utf-8')).get('identity')
    except (OSError, ValueError):
        return None


def env_overrides(engine, prefix):
    """Prove what a launcher must remove from the engine's environment (deer-engine.json
    identity.launch.clearEnv). Returns True when both overrides were shown to take effect."""
    ok = True
    test = os.path.join(HERE, 'identity.js')
    # 1. XUL_APP_FILE: Gecko reads that ini instead of deer.exe's compiled-in application data. The ini
    # must sit in <engine>\browser (its folder becomes the application directory).
    probe_ini = os.path.join(engine, 'browser', 'application-envprobe.ini')
    text = open(os.path.join(engine, 'browser', 'application.ini'), encoding='utf-8').read()
    text = re.sub(r'(?m)^(Vendor|Name|Profile|RemotingName)=.*$', lambda m: m.group(1) + '=DeerEnvProbe', text)
    with open(probe_ini, 'w', encoding='utf-8', newline='') as f:
        f.write(text)
    try:
        _f, lines = session(prefix + '-xulapp', test, 'quick', {'XUL_APP_FILE': probe_ini}, engine, False, 120, strict_quit=False)
    finally:
        os.remove(probe_ini)
    got = (facts_of(lines).get('identity') or {}).get('appinfo', {})
    good = got.get('name') == 'DeerEnvProbe' and got.get('vendor') == 'DeerEnvProbe'
    ok &= good
    say('%s an inherited XUL_APP_FILE replaces the compiled-in identity (appinfo %s/%s): the launcher must remove it' % (
        'PASS' if good else 'FAIL', got.get('vendor'), got.get('name')))
    probe_names = dict(DEER_NAMES, vendor='DeerEnvProbe', root='DeerEnvProbe')
    _h, removed = clean_traces(engine, probe_names)
    _h, removed2 = clean_traces(engine)
    say('cleaned  %d traces of that run' % (len(removed) + len(removed2)))
    # 2. XRE_PROFILE_PATH: Gecko's own restart variable; when present it wins over -profile.
    other = os.path.join(tempfile.gettempdir(), 'vitre-gecko-' + prefix + '-xreprofile-other')
    RE.kill(RE.stale_pids(other))
    if os.path.exists(other):
        RE.remove_profile(other)
    os.makedirs(other)
    with open(os.path.join(other, 'user.js'), 'w', encoding='utf-8') as f:
        for k, v in RE.PREFS.items():
            f.write('user_pref(%s, %s);\n' % (json.dumps(k), json.dumps(v)))
    open(os.path.join(other, 'vitre-harness'), 'w').close()
    try:
        _f, lines = session(prefix + '-xreprofile', test, 'quick', {'XRE_PROFILE_PATH': other}, engine, False, 120, strict_quit=False)
    finally:
        time.sleep(0.5)
        RE.remove_profile(other)
    prof = ((facts_of(lines).get('identity') or {}).get('dirs') or {}).get('ProfD') or ''
    good = os.path.normcase(prof) == os.path.normcase(other)
    ok &= good
    say('%s an inherited XRE_PROFILE_PATH replaces -profile (ProfD %s): the launcher must remove it and XRE_PROFILE_LOCAL_PATH' % (
        'PASS' if good else 'FAIL', prof.replace(tempfile.gettempdir(), '%TEMP%')))
    _h, removed = clean_traces(engine)
    say('cleaned  %d traces of that run' % len(removed))
    return ok


def main():
    global ENGINE, BUILD
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--no-setup', action='store_true')
    ap.add_argument('--suites', action='store_true')
    ap.add_argument('--reference', action='store_true')
    ap.add_argument('--fallback', action='store_true')
    ap.add_argument('--env-overrides', action='store_true')
    ap.add_argument('--keep-profile', action='store_true')
    ap.add_argument('--keep-traces', action='store_true')
    ap.add_argument('--engine', default=os.path.relpath(ENGINE, ROOT))
    ap.add_argument('--app', default=BUILD)
    ap.add_argument('--prefix', default='identity')
    a = ap.parse_args()
    ENGINE = os.path.abspath(os.path.join(ROOT, a.engine))
    BUILD = a.app
    P = a.prefix
    if os.path.normcase(ENGINE) == os.path.normcase(STOCK):
        sys.exit('--engine must not be engines/deer-runtime (the stock-identity reference engine)')
    ok = True

    if not a.no_setup:
        for cmd in (['node', os.path.join(ROOT, 'tools', 'build.mjs'), '--out=' + BUILD],
                    [PY, os.path.join(ROOT, 'tools', 'setup-engine.py'), '--app', BUILD, '--out', ENGINE],
                    [PY, os.path.join(ROOT, 'tools', 'setup-engine.py'), '--app', BUILD, '--out', ENGINE, '--check']):
            r = sh(cmd)
            if r.returncode:
                sys.exit('setup failed: %s\n%s' % (' '.join(cmd[1:]), (r.stdout + r.stderr)[-3000:]))
        say('setup    ok  (%s built; %s written and checked)' % (BUILD, os.path.relpath(ENGINE, ROOT)))
    ident = engine_identity(ENGINE)
    if not ident or not ident.get('app'):
        sys.exit('%s has no Deer identity (deer-engine.json): run without --no-setup' % os.path.relpath(ENGINE, ROOT))
    say('identity %s' % json.dumps(ident['app']))
    say('launch   deer.exe needs: %s' % json.dumps(ident['launch']))

    # Start from a machine without this engine's traces, so the diff is its whole first-run footprint.
    h, removed = clean_traces(ENGINE)
    say('install hash %s (CityHash64 of %s)' % (h, ENGINE))
    say('cleaned  %d traces of earlier runs of this engine%s' % (len(removed), ''.join('\n    ' + r for r in removed)))
    running = other_firefox_running()
    t0 = time.time()
    before = snapshot()
    say('snapshot %d files, %d registry entries (%.1f s)' % (len(before['files']), len(before['registry']), time.time() - t0))
    watch = TempWatch().start()

    if a.suites:
        for label, name, test, extra in (
                ('smoke', P + '-smoke', os.path.join(ROOT, 'tests', 'core', 'smoke.js'), ['--env', 'VITRE_SELFTEST=1', '--url', 'https://example.com']),
                ('shell', P + '-shell', os.path.join(ROOT, 'tests', 'core', 'shell.js'), ['--url', 'https://example.com']),
                ('probe', P + '-probe', os.path.join(HERE, 'probe.js'), [])):
            t1 = time.time()
            r = sh([PY, os.path.join(HERE, 'run_engine.py'), '--runtime', ENGINE, '--test', test, '--name', name,
                    '--app', BUILD, '--timeout', '200'] + extra)
            text = r.stdout + r.stderr
            os.makedirs(os.path.join(OUT, name), exist_ok=True)
            with open(os.path.join(OUT, name, name + '.log'), 'w', encoding='utf-8') as f:
                f.write(text)
            lines = text.splitlines()
            passed = sum(1 for x in lines if x.startswith('PASS '))
            bad = [x for x in lines if x.startswith(('FAIL', 'ERROR', '[run]', 'Traceback'))]
            good = r.returncode == 0 and not bad
            ok &= good
            say('%-8s %s  (%d checks passed, %.0f s)' % (label, 'ok' if good else 'FAILED', passed, time.time() - t1))
            for x in bad + [x for x in lines if x.startswith('GAP ')]:
                say('    ' + x[:300])

    failed, lines = session(P + '-session', os.path.join(HERE, 'identity.js'), 'session', {}, ENGINE, a.keep_profile,
                            strict_quit=False)
    facts = facts_of(lines)
    passed = sum(1 for x in lines if x.startswith('PASS '))
    say('session  %s  (%d checks passed)' % ('ok' if not failed else 'FAILED', passed))
    ok &= not failed

    time.sleep(2)
    watched = watch.stop()
    after = snapshot()
    extra = expand_new_keys(before, after)
    ident_fact = facts.get('identity') or {}
    hashes = {h, ident_fact.get('installHash')}
    if ident_fact.get('installHash') and ident_fact['installHash'] != h:
        say('FAIL the engine reports install hash %s, the CityHash64 port %s' % (ident_fact['installHash'], h))
        ok = False
    rows = diff(before, after, extra)
    running = sorted(set(running) | set(other_firefox_running()))
    bad = report(rows, ENGINE, hashes, running, watched)
    if bad:
        say('FAIL %d entries of this engine under Mozilla\'s names' % bad)
        ok = False
    else:
        left = [k for k in EXPLAINED if any(e[2] == k or e[2].startswith(k + '\\') for e in watched)]
        say("PASS nothing of this engine was written under Mozilla's names%s" % (
            (' except the explained LEFT place(s): ' + ', '.join(left)) if left else ''))

    # What an uninstaller removes (traces()): afterwards nothing of this engine may be left.
    if not a.keep_traces:
        _h, removed = clean_traces(ENGINE)
        say('cleaned  %d traces with the uninstaller list (traces() in this file)' % len(removed))
        for r in removed:
            say('    ' + r)
        cleaned = snapshot()
        rest = diff(before, cleaned, {})
        left = [r for r in rest if classify(r, ENGINE, hashes)[1]]
        for kind, state, key, value in rest:
            if (kind, state, key, value) not in left and classify((kind, state, key, value), ENGINE, hashes)[0] == 'deer':
                say('INFO not this engine\'s (another Deer engine or install?): %s %s' % (state, key))
        if left:
            ok = False
            say('FAIL left after cleaning (missing from traces()):')
            for kind, state, key, value in left:
                say('    %-7s %s' % (state, key))
        else:
            say('PASS after cleaning, everything outside the profile and the engine folder is as it was before the session')

    if a.reference:
        sid = engine_identity(STOCK)
        if os.path.exists(os.path.join(STOCK, 'deer.exe')) and (not sid or sid.get('stock')):
            f2, l2 = session(P + '-ref', os.path.join(HERE, 'identity.js'), 'facts', {'MOZ_CRASHREPORTER_DISABLE': '1'}, STOCK, False, 120,
                             strict_quit=False)
            ref = facts_of(l2).get('identity', {})
            ua_ref, ua_deer = ref.get('ua', {}).get('navigator'), ident_fact.get('ua', {}).get('navigator')
            same = ua_ref and ua_ref == ua_deer
            say('%s the user agent equals the stock engine\'s: %r / %r' % ('PASS' if same else 'FAIL', ua_deer, ua_ref))
            say('INFO stock getBrowserInfo() %s; Deer %s' % (json.dumps(facts_of(l2).get('getBrowserInfo')), json.dumps(facts.get('getBrowserInfo'))))
            ok &= bool(same) and not f2
        else:
            say('reference skipped: engines/deer-runtime does not hold a stock-identity engine')

    if a.fallback:
        sid = engine_identity(STOCK)
        if os.path.exists(os.path.join(STOCK, 'deer.exe')) and (not sid or sid.get('stock')):
            # -app must be the first argument (nsBrowserApp.cpp); Gecko turns it into XUL_APP_FILE.
            ini = os.path.join(ENGINE, 'browser', 'application.ini')
            f3, l3 = session(P + '-fallback', os.path.join(HERE, 'identity.js'), 'fallback',
                             {'MOZ_CRASHREPORTER_DISABLE': '1'}, STOCK, False, 120, pre_args=('-app', ini))
            say('fallback %s  (-app <%s/browser/application.ini> on the unpatched exe)' % ('ok' if not f3 else 'FAILED', os.path.relpath(ENGINE, ROOT)))
            ok &= not f3
            # That run kept Deer-named data for engines/deer-runtime (its compiled names stay Mozilla's).
            _h, removed = clean_traces(STOCK, DEER_NAMES)
            say('cleaned  %d Deer-named traces of that run: %s' % (len(removed), ', '.join(removed)))
        else:
            say('fallback skipped: engines/deer-runtime does not hold a stock-identity engine')

    if a.env_overrides:
        ok &= env_overrides(ENGINE, P)

    say('ALL OK' if ok else 'SOME FAILED')
    with open(os.path.join(OUT, P + '-session', 'identity.log'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(LINES) + '\n')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
