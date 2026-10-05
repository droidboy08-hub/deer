"""Turn Mozilla's UNBRANDED Firefox build into Deer's engine folder.

  python tools/setup-engine.py [--unpack ZIP] [--engine DIR] [--out DIR] [--app build | --app build-x]
                               [--copy] [--keep-all] [--keep-exe] [--icon FILE] [--media-host M] [--check]
                               [--stock-identity]

  --unpack ZIP  first unpack Mozilla's target.zip as engines/firefox-<version>-unbranded (checked
                against the SHA-256 in engines/firefox-<version>-unbranded.meta/source.json if present)
                and use it as --engine. The zip comes from Mozilla's build index, e.g.
                https://firefox-ci-tc.services.mozilla.com/api/index/v1/task/gecko.v2.mozilla-release.revision.<rev>.firefox.win64-add-on-devel/artifacts/public/build/target.zip
                (this script downloads nothing).
  --engine DIR  the unbranded build, unpacked (default: engines/firefox-<newest>-unbranded). It is
                only read, never changed. engines/<name>.meta/source.json records where it came from.
  --out DIR     the Deer engine folder to write (default: engines/deer-runtime). It is rebuilt from
                scratch on every run (a folder this script did not write is refused, and so is one
                inside --engine, --app or runtime/, or containing one of them).
  --app DIR     the chrome package (default: build). Linked as <out>/vitre (a junction) for
                development; --copy copies it instead (a release must carry a real copy).
  --keep-all    keep the files a Deer release leaves out (list STRIP below).
  --keep-exe    keep firefox.exe's own icon and version strings ("Nightly").
  --icon FILE   the icon put into deer.exe (default: the overlay's window icon, vitre.ico).
  --media-host stub|text|copy|none
                what stands in for firefox.exe after the rename (default stub; see 4 below).
  --check       only report whether --out is a complete Deer engine for --engine; exit 1 if not. Besides
                the overlay, deer.exe, the identity, the placeholder and the package link, every file
                of the engine is compared with the list step 7 records (size and SHA-256): a file
                missing (an interrupted copy, a quarantined DLL), one more (a DLL dropped in) or one
                changed fails the check. A linked package (--app, no --copy) older than src/ is only
                a note (node tools/build.mjs --out=<it> rebuilds it; the engine needs nothing else).
  --stock-identity
                leave the engine's own identity (Mozilla Firefox) as it is: step 8 is skipped. For
                comparisons only; such an engine shares data root and registry keys with an installed
                Firefox.

This is tools/setup-runtime.py for a release engine. setup-runtime.py wires the BRANDED Firefox in
runtime/ for development and is left as it is; this script imports its helpers and its overlay folder,
so both runtimes get the same Deer files:
  1. a copy of the engine folder;
  2. tools/runtime-overlay/** (config.js AutoConfig loader, defaults/pref/config-prefs.js and
     vitre-prefs.js, distribution/policies.json: no app update, no telemetry, no default-browser
     check or agent; browser/chrome/icons/default/vitre.ico: the window icon);
  3. firefox.exe renamed deer.exe. Every child process then runs as deer.exe too. Mozilla's unbranded
     build is NOT Authenticode-signed, so editing its resources loses nothing: unless --keep-exe, the
     main and window-class icons become --icon and the version strings that say "Nightly" (Task
     Manager's description, Explorer's product name) say Deer (EXE_STRINGS); plugin-container.exe
     (the media plug-in process) gets Deer's version strings too (PLUGIN_CONTAINER_STRINGS);
  4. a placeholder named firefox.exe. Media plug-ins (ClearKey, and so Widevine DRM and OpenH264)
     fail without a file of that name in the engine folder: createMediaKeys() rejects with AbortError
     and no plug-in process starts (tests/engine/probe.js). The file is only read, never started: an
     absent or EMPTY file fails, any non-empty readable file works (a 1-byte or a text file did, as
     did a program). "stub" (default) compiles a 4 KB program that only exits with code 1 (in-box
     .NET Framework csc.exe; not byte-reproducible), so a double-click on it does nothing; "text"
     writes a short text file (no compiler, reproducible; a double-click shows Windows' "can't run"
     error); "copy" hard-links deer.exe (a double-click then starts the engine on the user's real
     Firefox profile store); "none" leaves media plug-ins broken;
  5. Mozilla's helper programs a Deer release does not use are removed (STRIP: updater, maintenance
     service, default-browser agent, telemetry ping sender, crash reporter, private-window and desktop
     stubs, Start-tile assets, Mozilla's uninstall helper, Firefox Bridge proxy). They either talk to
     Mozilla's servers or start "firefox.exe" without -profile;
  6. <out>/vitre = the chrome package (content processes can only read files inside the engine folder);
  7. <out>/deer-engine.json: the engine's version, build id and source, what was changed, and every
     file of the engine as written (path: size and SHA-256; the overlay, the package and this file
     itself are checked on their own);
  8. Deer's own identity (unless --stock-identity; see "identity" below and IDENTITY).

Identity. Out of the box the engine calls itself Mozilla Firefox for its own housekeeping: data root
%APPDATA%\\Mozilla\\Firefox (the installed Firefox's), remoting name "firefox-default", registry values
under HKCU\\Software\\Mozilla\\Firefox, C:\\ProgramData\\Mozilla-<guid>\\updates. Gecko takes the name
part from the application data compiled into firefox.exe (browser/app/nsBrowserApp.cpp sAppData); the
application.ini next to the exe is read only with "-app <ini>" or XUL_APP_FILE. Step 8 therefore:
  a. patches deer.exe's compiled-in application data (patch_app_data): Vendor, Name, RemotingName,
     Profile (data root) and UAName, plus the crash-reporter and profile-migrator flags. Every start of
     deer.exe is then Deer whoever starts it (Deer.exe, an in-place restart, a double-click on the
     engine), so the launcher passes nothing for it: no -app, no XUL_APP_FILE. It removes
     LAUNCH_CLEAR_ENV from the engine's environment (an inherited XUL_APP_FILE would replace the
     identity, an inherited XRE_PROFILE_PATH the -profile it passes);
  b. patches the few registry and folder names Gecko compiles in from MOZ_APP_VENDOR /
     MOZ_APP_BASENAME (COMPILED_NAMES: the Launcher, PreXULSkeletonUISettings, DllPrefetchExperiment
     and Default Browser Agent keys, the ProgramData update folder, the toast AppUserModelID prefix,
     the third-party-module blocklist file, the %TEMP% folder for files opened with another program)
     to Deer names of the same length, in deer.exe, xul.dll and mozglue.dll;
  c. writes browser/application.ini with the same identity (what "-app <it>" as deer.exe's first
     argument would read: the fallback if a later engine's exe cannot be patched, see below) and the
     root application.ini (not read by Gecko; for the tools that read Version / BuildID). With
     IDENTITY_PREFS entries it also writes browser/defaults/preferences/deer-identity.js (read after
     Firefox's own defaults); none are needed today.
The application ID stays Firefox's ({ec8030f7-...}): add-ons are written for that ID. UAName=Firefox
keeps the user agent exactly Firefox's ("... Gecko/20100101 Firefox/<version>"), for every engine
version, with no general.useragent.override to keep in sync. browser.runtime.getBrowserInfo() then
answers name "Deer", vendor "Deer" and Firefox's version and build id.
Why compiled in rather than -app: Windows' restart manager starts deer.exe again after an update
reboot with the arguments Gecko registered (-profile kept, -app dropped) in a fresh environment, so
with -app that start would be Mozilla Firefox on Deer's profile; and a deer.exe started by anything
but the launcher (a double-click, a stale shortcut) would use %APPDATA%\\Mozilla\\Firefox. Proof and the
full list of what the engine writes outside its folder and profile: tests/engine/identity.py.
"""
import argparse
import ctypes
import ctypes.wintypes as wt
import datetime
import filecmp
import hashlib
import importlib.util
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ENGINES = os.path.join(ROOT, 'engines')

# setup-runtime.py's helpers and overlay location (imported, not copied: one source for both runtimes).
_spec = importlib.util.spec_from_file_location('setup_runtime', os.path.join(ROOT, 'tools', 'setup-runtime.py'))
setup_runtime = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(setup_runtime)
OVERLAY = setup_runtime.OVERLAY
is_junction = setup_runtime.is_junction
same_target = setup_runtime.same_target

EXE = 'deer.exe'
MARKER = 'deer-engine.json'

# Files and folders of the unbranded build that a Deer release leaves out, with the reason.
STRIP = {
    'updater.exe': "Mozilla's updater (Deer updates itself from GitHub releases)",
    'updater.ini': "the updater's strings",
    'update-settings.ini': "the updater's accepted MAR channel",
    'precomplete': "the updater's / uninstaller's file list",
    'removed-files': "the updater's file list",
    'maintenanceservice.exe': "Mozilla Maintenance Service (updates without UAC)",
    'maintenanceservice_installer.exe': "installs the Mozilla Maintenance Service",
    'default-browser-agent.exe': "scheduled task that reports the default browser to Mozilla",
    'pingsender.exe': "sends telemetry pings to Mozilla",
    'crashreporter.exe': "crash report dialog; submits to crash-reports.mozilla.com",
    'crashhelper.exe': "out-of-process crash dump writer for the crash reporter",
    'private_browsing.exe': "Start-menu stub that starts firefox.exe -private-window (no -profile)",
    'private_browsing.VisualElementsManifest.xml': "Start tile of that stub",
    'firefox.VisualElementsManifest.xml': "Start tile of firefox.exe (Nightly artwork)",
    'browser/VisualElements': "Start tile artwork (Nightly)",
    'desktop-launcher': "desktop launcher that finds and starts the installed Firefox",
    'uninstall': "Mozilla's NSIS helper.exe (registers Firefox as default, uninstalls Firefox)",
    'nmhproxy.exe': "native-messaging proxy for the Firefox Bridge extension in other browsers",
}

# Version strings written into deer.exe (owner's choice; the copyright and trademark lines are
# Mozilla's attribution and stay as they are).
EXE_STRINGS = {
    'ProductName': 'Deer',
    'FileDescription': 'Deer',
    'InternalName': 'deer',
    'OriginalFilename': 'deer.exe',
    'CompanyName': 'Deer',
}
# plugin-container.exe runs media plug-ins (Widevine, OpenH264, ClearKey) as its own process, so its
# description ("Plugin Container for Nightly") is what Task Manager lists for them. Its icon stays.
PLUGIN_CONTAINER_STRINGS = {
    'ProductName': 'Deer',
    'FileDescription': 'Deer media plug-in host',
    'InternalName': 'deer',
    'CompanyName': 'Deer',
}

# The firefox.exe placeholder (--media-host stub). Never run by Gecko; if a person runs it, it exits.
MEDIA_HOST_STUB_CS = r'''// Deer: placeholder named firefox.exe, written by gecko/tools/setup-engine.py.
// Gecko's media plug-in host needs a program of this name next to the engine (deer.exe); it is never
// started. Run by hand it does nothing and exits with code 1. Deer is started by its launcher.
using System.Reflection;
[assembly: AssemblyTitle("Deer media plug-in placeholder")]
[assembly: AssemblyDescription("Placeholder required by the engine's media plug-ins; does nothing.")]
[assembly: AssemblyProduct("Deer")]
[assembly: AssemblyCompany("Deer")]
[assembly: AssemblyVersion("1.0.0.0")]
static class DeerMediaHostPlaceholder
{
    static int Main() { return 1; }
}
'''
# The firefox.exe placeholder for --media-host text: any non-empty readable file satisfies the check.
MEDIA_HOST_TEXT = (b'Deer: placeholder required by the engine\'s media plug-ins (they read a file of this name).\r\n'
                   b'It is not a program. Deer is started by its launcher.\r\n')


def csc_path():
    windir = os.environ.get('WINDIR', r'C:\Windows')
    for fw in ('Framework64', 'Framework'):
        p = os.path.join(windir, 'Microsoft.NET', fw, 'v4.0.30319', 'csc.exe')
        if os.path.exists(p):
            return p
    return None


def write_media_host(out, mode):
    """The firefox.exe placeholder the media plug-ins need (step 4). Returns a note."""
    dst = os.path.join(out, 'firefox.exe')
    if mode == 'none':
        return 'none (media plug-ins will fail)'
    if mode == 'text':
        with open(dst, 'wb') as f:
            f.write(MEDIA_HOST_TEXT)
        return 'text (%d bytes, not a program; never started by the engine)' % len(MEDIA_HOST_TEXT)
    if mode == 'copy':
        try:
            os.link(os.path.join(out, EXE), dst)
            return 'hard link to ' + EXE
        except OSError:
            shutil.copyfile(os.path.join(out, EXE), dst)
            return 'copy of ' + EXE
    csc = csc_path()
    if not csc:
        raise SystemExit('no csc.exe (.NET Framework 4) to build the firefox.exe placeholder; use --media-host copy')
    src = os.path.join(out, 'deer-media-host-stub.cs')
    with open(src, 'w', encoding='utf-8') as f:
        f.write(MEDIA_HOST_STUB_CS)
    r = subprocess.run([csc, '/nologo', '/target:winexe', '/optimize+', '/out:' + dst, src], capture_output=True, text=True)
    os.remove(src)
    if r.returncode or not os.path.exists(dst):
        raise SystemExit('building the firefox.exe placeholder failed: ' + (r.stdout + r.stderr).strip())
    return 'stub (%d bytes, exits with 1; never started by the engine)' % os.path.getsize(dst)


# ---- Win32 resources ------------------------------------------------------------------------------

RT_ICON, RT_GROUP_ICON, RT_VERSION = 3, 14, 16
ICON_GROUPS = (1, 32512)  # 1: the exe's icon (Explorer, Task Manager); 32512: the window-class icon
_k32 = ctypes.WinDLL('kernel32', use_last_error=True)
_k32.LoadLibraryExW.restype = wt.HMODULE
_k32.LoadLibraryExW.argtypes = [wt.LPCWSTR, wt.HANDLE, wt.DWORD]
_k32.FreeLibrary.argtypes = [wt.HMODULE]
_k32.FindResourceExW.restype = wt.HANDLE
_k32.FindResourceExW.argtypes = [wt.HMODULE, ctypes.c_void_p, ctypes.c_void_p, wt.WORD]
_k32.LoadResource.restype = wt.HANDLE
_k32.LoadResource.argtypes = [wt.HMODULE, wt.HANDLE]
_k32.LockResource.restype = ctypes.c_void_p
_k32.LockResource.argtypes = [wt.HANDLE]
_k32.SizeofResource.restype = wt.DWORD
_k32.SizeofResource.argtypes = [wt.HMODULE, wt.HANDLE]
_k32.BeginUpdateResourceW.restype = wt.HANDLE
_k32.BeginUpdateResourceW.argtypes = [wt.LPCWSTR, wt.BOOL]
_k32.UpdateResourceW.restype = wt.BOOL
_k32.UpdateResourceW.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, wt.WORD, ctypes.c_void_p, wt.DWORD]
_k32.EndUpdateResourceW.restype = wt.BOOL
_k32.EndUpdateResourceW.argtypes = [wt.HANDLE, wt.BOOL]
_ENUMNAME = ctypes.WINFUNCTYPE(wt.BOOL, wt.HMODULE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)
_ENUMLANG = ctypes.WINFUNCTYPE(wt.BOOL, wt.HMODULE, ctypes.c_void_p, ctypes.c_void_p, wt.WORD, ctypes.c_void_p)
_k32.EnumResourceNamesW.argtypes = [wt.HMODULE, ctypes.c_void_p, _ENUMNAME, ctypes.c_void_p]
_k32.EnumResourceLanguagesW.argtypes = [wt.HMODULE, ctypes.c_void_p, ctypes.c_void_p, _ENUMLANG, ctypes.c_void_p]


def read_resources(path, rtype):
    """[(id, lang, bytes)] of one resource type (integer ids only: Mozilla's exes use no names)."""
    h = _k32.LoadLibraryExW(path, None, 0x2 | 0x20)  # LOAD_LIBRARY_AS_DATAFILE | AS_IMAGE_RESOURCE
    if not h:
        raise OSError('LoadLibraryEx(%s) failed: %d' % (path, ctypes.get_last_error()))
    out = []

    def on_name(_h, _t, name, _p):
        if name >= 0x10000:
            return True
        langs = []
        _k32.EnumResourceLanguagesW(h, rtype, name, _ENUMLANG(lambda *a: langs.append(a[3]) or True), None)
        for lang in langs:
            r = _k32.FindResourceExW(h, rtype, name, lang)
            out.append((name, lang, ctypes.string_at(_k32.LockResource(_k32.LoadResource(h, r)), _k32.SizeofResource(h, r))))
        return True

    _k32.EnumResourceNamesW(h, rtype, _ENUMNAME(on_name), None)
    _k32.FreeLibrary(h)
    return out


def _align(n):
    return (n + 3) & ~3


def _parse_version_node(buf, off):
    """One VS_VERSIONINFO / StringFileInfo / StringTable / String / Var node -> [key, type, value, children]."""
    length, vlen, vtype = struct.unpack_from('<HHH', buf, off)
    if length < 6 or off + length > len(buf):
        raise SystemExit('unexpected version resource layout at offset %d' % off)
    end = off + length
    p = off + 6
    k = p
    while buf[k:k + 2] != b'\0\0':
        k += 2
    key = buf[p:k].decode('utf-16le')
    p = _align(k + 2)
    vbytes = vlen * 2 if vtype == 1 else vlen
    value = buf[p:p + vbytes]
    p = _align(p + vbytes)
    children = []
    while p < end:
        child, p = _parse_version_node(buf, p)
        children.append(child)
        p = _align(p)
    return [key, vtype, value, children], end


def _build_version_node(node):
    key, vtype, value, children = node
    body = bytearray(6) + (key + '\0').encode('utf-16le')
    body += b'\0' * (_align(len(body)) - len(body)) + value
    for child in children:
        body += b'\0' * (_align(len(body)) - len(body)) + _build_version_node(child)
    struct.pack_into('<HHH', body, 0, len(body), len(value) // 2 if vtype == 1 else len(value), vtype)
    return bytes(body)


def version_strings(data):
    """{key: value} of every StringTable in a VS_VERSIONINFO blob."""
    root, _ = _parse_version_node(data, 0)
    out = {}
    for sfi in root[3]:
        if sfi[0] == 'StringFileInfo':
            for table in sfi[3]:
                for key, _t, value, _c in table[3]:
                    out[key] = value.decode('utf-16le').rstrip('\0')
    return out


def rewrite_version(data, strings):
    """The VS_VERSIONINFO blob with these String values set (the fixed version numbers are kept)."""
    root, _ = _parse_version_node(data, 0)
    for sfi in root[3]:
        if sfi[0] != 'StringFileInfo':
            continue
        for table in sfi[3]:
            entries = table[3]
            for name, text in strings.items():
                value = (text + '\0').encode('utf-16le')
                for e in entries:
                    if e[0] == name:
                        e[1], e[2] = 1, value
                        break
                else:
                    entries.append([name, 1, value, []])
    return _build_version_node(root)


def brand_exe(path, icon_path, strings):
    """Set the version strings and, with icon_path, replace the icon groups ICON_GROUPS. Returns notes."""
    version = read_resources(path, RT_VERSION)
    if not version:
        raise SystemExit('%s has no version resource' % path)
    images, targets, grp = [], [], b''
    if icon_path:
        ico = open(icon_path, 'rb').read()
        reserved, kind, count = struct.unpack_from('<HHH', ico, 0)
        if reserved != 0 or kind != 1 or not count:
            raise SystemExit('%s is not an .ico file' % icon_path)
        used = {n for n, _l, _d in read_resources(path, RT_ICON)}
        next_id = max(used | {20000}) + 1
        grp = struct.pack('<HHH', 0, 1, count)
        for i in range(count):
            w, h, colors, res, planes, bpp, size, offset = struct.unpack_from('<BBBBHHII', ico, 6 + 16 * i)
            grp += struct.pack('<BBBBHHIH', w, h, colors, res, planes, bpp, size, next_id)
            images.append((next_id, ico[offset:offset + size]))
            next_id += 1
        targets = [(n, lang) for n, lang, _d in read_resources(path, RT_GROUP_ICON) if n in ICON_GROUPS]
    vid, vlang, vdata = version[0]
    vnew = rewrite_version(vdata, strings)

    h = _k32.BeginUpdateResourceW(path, False)
    if not h:
        raise OSError('BeginUpdateResource(%s) failed: %d' % (path, ctypes.get_last_error()))
    ok = True
    for lang in {lang for _n, lang in targets}:
        for rid, data in images:
            ok &= bool(_k32.UpdateResourceW(h, RT_ICON, rid, lang, data, len(data)))
    for gid, lang in targets:
        ok &= bool(_k32.UpdateResourceW(h, RT_GROUP_ICON, gid, lang, grp, len(grp)))
    ok &= bool(_k32.UpdateResourceW(h, RT_VERSION, vid, vlang, vnew, len(vnew)))
    if not _k32.EndUpdateResourceW(h, not ok) or not ok:
        raise OSError('UpdateResource(%s) failed: %d' % (path, ctypes.get_last_error()))
    if version_strings(read_resources(path, RT_VERSION)[0][2]).get('ProductName') != strings['ProductName']:
        raise SystemExit('%s: the version resource did not take' % path)
    notes = {'versionStrings': strings}
    if icon_path:
        notes.update(iconGroups=[g for g, _l in targets], icon=os.path.relpath(icon_path, ROOT).replace('\\', '/'))
    return notes


# ---- identity (step 8) ----------------------------------------------------------------------------

# What Gecko calls the application. Compiled into deer.exe (patch_app_data) and written to
# browser/application.ini (identity_ini). Changing a value here changes where an installed Deer keeps
# its engine data: the installer's uninstaller (installer/EngineTraces.cs) must follow.
IDENTITY = {
    # Services.appinfo.vendor. HKCU\Software\<Vendor>\... for the keys Gecko builds at run time
    # (InstallerPrefs: Software\Deer\firefox\Installer\<hash>; the add-on registry location
    # Software\Deer\Deer\Extensions, read only).
    'Vendor': 'Deer',
    # Services.appinfo.name: browser.runtime.getBrowserInfo().name for add-ons, the policy key
    # Software\Policies\Mozilla\<Name> (read only), about:support.
    'Name': 'Deer',
    # Gecko's remoting (single instance; a second start hands its URL to the running one) is keyed by
    # this name and the profile path.
    'RemotingName': 'deer',
    # The data root: %APPDATA%\Deer and %LOCALAPPDATA%\Deer (without it %APPDATA%\<Vendor>\<Name>).
    'Profile': 'Deer',
    # The user agent's application token. Gecko then writes "Firefox/<version>" and no "<Name>/<version>"
    # (netwerk/protocol/http/nsHttpHandler.cpp): the UA stays exactly Firefox's for every engine version.
    'UAName': 'Firefox',
}
# [Crash Reporter] Enabled and [XRE] EnableProfileMigrator (the flags NS_XRE_ENABLE_CRASH_REPORTER and
# NS_XRE_ENABLE_PROFILE_MIGRATOR of the compiled-in data).
CRASH_REPORTER = False  # Deer has no crash server; the engine's ServerURL is Mozilla's
PROFILE_MIGRATOR = False  # Gecko's import wizard on a profile it creates itself (Deer always passes -profile)
NS_XRE_ENABLE_PROFILE_MIGRATOR = 1 << 1
NS_XRE_ENABLE_CRASH_REPORTER = 1 << 3

# Variables a launcher removes from the engine's environment before starting deer.exe (proven by
# tests/engine/identity.py --env-overrides): an inherited XUL_APP_FILE replaces the compiled-in identity
# (Gecko reads that ini instead), an inherited XRE_PROFILE_PATH replaces -profile (Gecko's own restart
# variable, with XRE_PROFILE_LOCAL_PATH as its local-directory half). Gecko clears all three in the
# engine's own environment once it has started, so only an outside parent can pass them on. An
# inherited MOZ_NEW_INSTANCE turns Gecko's remote client off (xul.dll reads it; MOZ_NO_REMOTE is gone in
# 157): a second start would then try to open the profile the running Deer holds instead of handing it
# the URL (installer/tests/migration.py shows it with the development runtime).
LAUNCH_CLEAR_ENV = ('XUL_APP_FILE', 'XRE_PROFILE_PATH', 'XRE_PROFILE_LOCAL_PATH', 'MOZ_NEW_INSTANCE')

# Defaults that belong to the identity: browser/defaults/preferences/deer-identity.js, read after
# Firefox's own firefox.js (browser/omni.ja), before config.js applies Deer's vitre-prefs.js again.
IDENTITY_PREFS = {}
IDENTITY_PREFS_FILE = os.path.join('browser', 'defaults', 'preferences', 'deer-identity.js')

# Registry and folder names Gecko compiles in from MOZ_APP_VENDOR / MOZ_APP_BASENAME (and the
# ProgramData GUID, and MOZ_APP_BASENAME in the toast AppUserModelID), with the Deer names they become.
# Always the same length: a name used as a prefix (a hash is appended to the blocklist file, the skeleton
# UI lock and the toast id) or copied with a fixed length (the ProgramData folder: its first 40
# characters come from .rdata, "fb38" from an immediate in the code) stays whole.
# (file, 'w' UTF-16 | 'a' ASCII, Mozilla's name, Deer's name, how many times it must be found)
_MF, _DE = 'Mozilla\\Firefox', 'Deer\\EngineData'  # 15 characters each
COMPILED_NAMES = [
    # HKCU\Software\...\Launcher: "<exe>|Launcher", "|Browser", "|Image", "|Telemetry", "|Blocklist"
    # (toolkit/xre/LauncherRegistryInfo.cpp). The launcher process (deer.exe) and the browser
    # (xul.dll) must use the same key.
    ('deer.exe', 'w', 'SOFTWARE\\%s\\Launcher' % _MF, 'SOFTWARE\\%s\\Launcher' % _DE, 1),
    ('xul.dll', 'w', 'SOFTWARE\\%s\\Launcher' % _MF, 'SOFTWARE\\%s\\Launcher' % _DE, 1),
    # %APPDATA%\...\blocklist-<install hash>: modules blocked in about:third-party (read by the launcher
    # process, written by the browser).
    ('deer.exe', 'w', '\\%s\\blocklist-' % _MF, '\\%s\\blocklist-' % _DE, 1),
    ('xul.dll', 'w', '\\%s\\blocklist-' % _MF, '\\%s\\blocklist-' % _DE, 1),
    # HKCU\Software\...\DllPrefetchExperiment: "<exe>".
    ('xul.dll', 'w', 'SOFTWARE\\%s\\DllPrefetchExperiment' % _MF, 'SOFTWARE\\%s\\DllPrefetchExperiment' % _DE, 1),
    # HKCU\Software\...\Default Browser Agent: "<engine>|DisableTelemetry", "|DisableDefaultBrowserAgent",
    # "|SetDefaultBrowserUserChoice", "|AppLastRunTime" (written at every start for an agent Deer does
    # not ship).
    ('xul.dll', 'w', 'SOFTWARE\\%s\\Default Browser Agent' % _MF, 'SOFTWARE\\%s\\Default Browser Agent' % _DE, 1),
    ('xul.dll', 'a', 'SOFTWARE\\Mozilla\\firefox\\Default Browser Agent', 'SOFTWARE\\%s\\Default Browser Agent' % _DE, 1),
    # HKCU\Software\...\PreXULSkeletonUISettings: "<exe>|Progress", ... (mozglue/misc/PreXULSkeletonUI.cpp),
    # and the files the skeleton UI reads and locks under %APPDATA%.
    ('mozglue.dll', 'w', 'SOFTWARE\\%s\\PreXULSkeletonUISettings' % _MF, 'SOFTWARE\\%s\\PreXULSkeletonUISettings' % _DE, 1),
    ('mozglue.dll', 'w', '\\%s\\SkeletonUILock-' % _MF, '\\%s\\SkeletonUILock-' % _DE, 1),
    ('mozglue.dll', 'w', '\\%s\\profiles.ini' % _MF, '\\%s\\profiles.ini' % _DE, 1),
    # %ProgramData%\Mozilla-1de4eec8-1241-4177-a864-e594e8d1fb38\ (updates\<hash>, UpdateLock-<hash>,
    # profile_count_<hash>.json; toolkit/mozapps/update/common/commonupdatedir.cpp), shared with an
    # installed Firefox. Becomes %ProgramData%\Deer-Engine-1de4eec8-1241-4177-a864-e594fb38.
    ('xul.dll', 'w', 'Mozilla-1de4eec8-1241-4177-a864-e594e8d1', 'Deer-Engine-1de4eec8-1241-4177-a864-e594', 1),
    # HKCU\Software\Classes\AppUserModelId\FirefoxPortableToast-<hash> (+ its CLSID): registered the first
    # time Windows notifications are set up (widget/windows/ToastNotification.cpp). "FirefoxToast-" is
    # the id Mozilla's own installer registers, which Gecko looks for first.
    ('xul.dll', 'w', 'FirefoxPortableToast-', 'DeerAppPortableToast-', 1),
    ('xul.dll', 'w', 'FirefoxToast-', 'DeerAppToast-', 1),
    # %TEMP%\mozilla-temp-files: the folder for files opened with another program, shared by every Gecko
    # browser on the machine; every start creates and deletes mozilla-temp-<n> in it (seen by
    # tests/engine/identity.py's TempWatch). Becomes %TEMP%\deerapp-temp-files\deerapp-temp-<n>. The
    # second entry is the standalone file-name prefix (its NUL keeps it apart from the folder name).
    ('xul.dll', 'a', 'mozilla-temp-files', 'deerapp-temp-files', 1),
    ('xul.dll', 'a', 'mozilla-temp-\0', 'deerapp-temp-\0', 1),
]
# Left as they are (read only, never written): SOFTWARE\Policies\Mozilla\Firefox (machine policies for
# the launcher process), SOFTWARE\Mozilla\%S\TaskBarIDs (Firefox's installer writes it), and
# Software\Mozilla\NativeMessagingHosts (native messaging hosts registered for Firefox keep working).
# Left, and written: %TEMP%\MozillaBackgroundTask-<install hash>-<task>..., the throwaway profile of a
# background task (deer.exe --backgroundtask, started by Gecko itself: the quota cleanup after "Clear
# browsing data", the HTTP cache purge at shutdown; removed when the task ends). Its vendor is the
# separate literal "Mozilla" passed to "%sBackgroundTask-%s-%s" (xul.dll: the code loads both side by
# side), not a string that can be renamed on its own. A same-length format change would do it,
#   ('xul.dll', 'a', '%sBackgroundTask-%s-%s', 'Deer%.0sBackTask-%s-%s', 1),
# but is not applied: background tasks could not be started under the test sandbox (its job object
# forbids the breakaway they need), so the change is untested.


def _encode(text, enc):
    return text.encode('utf-16le' if enc == 'w' else 'ascii')


def patch_names(out, dry=False):
    """Rewrite COMPILED_NAMES in place (dry: only count). Returns {file: [[old, new, count]]}; exits
    when a name is not found exactly as often as listed (a different engine: review the table)."""
    by_file = {}
    for name, enc, old, new, count in COMPILED_NAMES:
        if len(old) != len(new):
            raise SystemExit('COMPILED_NAMES: %r and %r differ in length' % (old, new))
        by_file.setdefault(name, []).append((enc, old, new, count))
    notes = {}
    for name, items in by_file.items():
        path = os.path.join(out, name)
        data = bytearray(open(path, 'rb').read())
        for enc, old, new, count in items:
            ob, nb = _encode(old, enc), _encode(new, enc)
            found = [m.start() for m in re.finditer(re.escape(ob), data)]
            if len(found) != count:
                raise SystemExit('%s: %r found %d times, expected %d (a different engine build: review '
                                 'COMPILED_NAMES in tools/setup-engine.py, or use --stock-identity)' % (name, old, len(found), count))
            for i in found:
                data[i:i + len(nb)] = nb
            notes.setdefault(name, []).append([old, new, count])
        if not dry:
            pe_set_checksum(data)
            with open(path, 'wb') as f:
                f.write(data)
    return notes


def names_state(out):
    """[problem] for --check: every COMPILED_NAMES entry must read Deer's name and never Mozilla's."""
    problems, cache = [], {}
    for name, enc, old, new, count in COMPILED_NAMES:
        if name not in cache:
            p = os.path.join(out, name)
            cache[name] = open(p, 'rb').read() if os.path.exists(p) else b''
        data = cache[name]
        n_old, n_new = data.count(_encode(old, enc)), data.count(_encode(new, enc))
        if n_old or n_new != count:
            problems.append('%s: compiled name %r (%d left, %d of %d renamed)' % (name, old, n_old, n_new, count))
    return problems


class PE:
    """Just enough of a PE32+ image to patch data in place: sections, base relocations, checksum."""

    def __init__(self, data):
        self.data = data
        if bytes(data[:2]) != b'MZ':
            raise SystemExit('not a PE image (no MZ header)')
        self.pe = struct.unpack_from('<I', data, 0x3c)[0]
        if bytes(data[self.pe:self.pe + 4]) != b'PE\0\0':
            raise SystemExit('not a PE image (no PE signature)')
        nsec, = struct.unpack_from('<H', data, self.pe + 6)
        optsz, = struct.unpack_from('<H', data, self.pe + 20)
        self.opt = self.pe + 24
        if struct.unpack_from('<H', data, self.opt)[0] != 0x20b:
            raise SystemExit('not a 64-bit (PE32+) image')
        self.base, = struct.unpack_from('<Q', data, self.opt + 24)
        self.salign, = struct.unpack_from('<I', data, self.opt + 32)
        self.sections = []
        for i in range(nsec):
            o = self.opt + optsz + 40 * i
            vsize, va, rawsize, rawptr = struct.unpack_from('<IIII', data, o + 8)
            self.sections.append({'name': bytes(data[o:o + 8]).rstrip(b'\0').decode('ascii', 'replace'),
                                  'hdr': o, 'va': va, 'vsize': vsize, 'raw': rawptr, 'rawsize': rawsize})

    def section(self, rva):
        for s in self.sections:
            if s['va'] <= rva < s['va'] + max(s['vsize'], s['rawsize']):
                return s
        return None

    def off(self, rva):
        s = self.section(rva)
        if not s or rva - s['va'] >= s['rawsize']:
            raise SystemExit('RVA %#x is not backed by the file' % rva)
        return s['raw'] + rva - s['va']

    def qword(self, rva):
        return struct.unpack_from('<Q', self.data, self.off(rva))[0]

    def cstr(self, va):
        """The NUL-terminated ASCII string at virtual address va (None for a null pointer)."""
        if not va:
            return None
        o = self.off(va - self.base)
        end = self.data.index(b'\0', o)
        return bytes(self.data[o:end]).decode('ascii', 'replace')

    def directory(self, i):
        return struct.unpack_from('<II', self.data, self.opt + 112 + 8 * i)

    def relocations(self):
        """The set of RVAs carrying an IMAGE_REL_BASED_DIR64 relocation (the only kind in x64 images)."""
        rva, size = self.directory(5)
        o, end, out = self.off(rva), self.off(rva) + size, set()
        while o < end:
            page, block = struct.unpack_from('<II', self.data, o)
            if block < 8:
                break
            for k in range((block - 8) // 2):
                e, = struct.unpack_from('<H', self.data, o + 8 + 2 * k)
                if e >> 12 == 10:
                    out.add(page + (e & 0xfff))
                elif e >> 12 != 0:
                    raise SystemExit('unexpected relocation type %d' % (e >> 12))
            o += block
        return out

    def write_relocations(self, rvas):
        """Rewrite the base relocation table (sorted blocks, one per 4 KB page) in its own section."""
        pages = {}
        for r in sorted(rvas):
            pages.setdefault(r & ~0xfff, []).append(r & 0xfff)
        blob = bytearray()
        for page in sorted(pages):
            entries = [(10 << 12) | off for off in pages[page]]
            if len(entries) % 2:
                entries.append(0)
            blob += struct.pack('<II', page, 8 + 2 * len(entries)) + struct.pack('<%dH' % len(entries), *entries)
        rva, size = self.directory(5)
        s = self.section(rva)
        start = self.off(rva)
        if start + len(blob) > s['raw'] + s['rawsize']:
            raise SystemExit('no room for one more relocation block in %s' % s['name'])
        self.data[start:start + max(size, len(blob))] = blob + b'\0' * max(0, size - len(blob))
        struct.pack_into('<I', self.data, self.opt + 112 + 8 * 5 + 4, len(blob))
        self.grow(s, rva - s['va'] + len(blob))

    def grow(self, s, vsize):
        """Make section s map at least vsize bytes (within its file data), and SizeOfImage follow."""
        if vsize <= s['vsize']:
            return
        nxt = min([t['va'] for t in self.sections if t['va'] > s['va']] or [1 << 62])
        if vsize > s['rawsize'] or s['va'] + vsize > nxt:
            raise SystemExit('section %s cannot grow to %#x' % (s['name'], vsize))
        s['vsize'] = vsize
        struct.pack_into('<I', self.data, s['hdr'] + 8, vsize)
        end = max(t['va'] + t['vsize'] for t in self.sections)
        struct.pack_into('<I', self.data, self.opt + 56, (end + self.salign - 1) & ~(self.salign - 1))

    def add_strings(self, s, strings):
        """Put NUL-terminated strings into the unused file space at the end of section s (zeros past
        its VirtualSize) and map it. Returns {string: virtual address}."""
        at = (s['vsize'] + 7) & ~7
        out = {}
        for text in strings:
            if text in out:
                continue
            b = text.encode('ascii') + b'\0'
            o = s['raw'] + at
            if at + len(b) > s['rawsize'] or any(self.data[o:o + len(b)]):
                raise SystemExit('no free space at the end of %s for %r' % (s['name'], text))
            self.data[o:o + len(b)] = b
            out[text] = self.base + s['va'] + at
            at += len(b)
        self.grow(s, at)
        return out


def pe_set_checksum(data):
    """Update the optional header CheckSum (as imagehlp's CheckSumMappedFile computes it) when the file
    has one. Mozilla's builds leave it 0 (Windows checks it only for drivers): then it stays 0."""
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    at = pe + 24 + 64
    if not struct.unpack_from('<I', data, at)[0]:
        return
    struct.pack_into('<I', data, at, 0)
    view = memoryview(bytes(data) + (b'\0' if len(data) % 2 else b'')).cast('H')
    total = sum(view)
    while total >> 16:
        total = (total & 0xffff) + (total >> 16)
    struct.pack_into('<I', data, at, (total + len(data)) & 0xffffffff)


# mozilla::StaticXREAppData (xpcom/build/XREAppData.h), as nsBrowserApp.cpp compiles it in: pointer
# offsets of the fields read or written here. Version 157 order: vendor, name, remotingName, version,
# buildID, ID, copyright, flags, minVersion, maxVersion, crashReporterURL, profile, UAName, ...
APP_DATA_FIELDS = {'Vendor': 0, 'Name': 8, 'RemotingName': 16, 'Version': 24, 'BuildID': 32, 'ID': 40,
                   'flags': 56, 'MinVersion': 64, 'MaxVersion': 72, 'Profile': 88, 'UAName': 96}


def find_app_data(pe, expect):
    """RVA of the StaticXREAppData whose fields read `expect` ({'Vendor': ..., 'BuildID': ...})."""
    data = bytes(pe.data)
    string_vas = []
    for m in re.finditer(re.escape(expect['BuildID'].encode('ascii') + b'\0'), data):
        sec = next((t for t in pe.sections if t['raw'] <= m.start() < t['raw'] + t['rawsize']), None)
        if sec:
            string_vas.append(pe.base + sec['va'] + m.start() - sec['raw'])
    found = set()
    for s in pe.sections:
        if s['name'] not in ('.rdata', '.data'):
            continue
        raw = data[s['raw']:s['raw'] + min(s['rawsize'], s['vsize'])]
        for va in string_vas:
            for p in re.finditer(re.escape(struct.pack('<Q', va)), raw):
                rva = s['va'] + p.start() - APP_DATA_FIELDS['BuildID']
                if rva % 8:
                    continue
                try:
                    if all(pe.cstr(pe.qword(rva + APP_DATA_FIELDS[k])) == v for k, v in expect.items()):
                        found.add(rva)
                except (SystemExit, ValueError):
                    pass
    found = sorted(found)
    if len(found) != 1:
        raise SystemExit('the compiled-in application data was found %d times (expected once)' % len(found))
    return found[0]


def read_app_data(pe, rva):
    out = {k: pe.cstr(pe.qword(rva + o)) for k, o in APP_DATA_FIELDS.items() if k != 'flags'}
    out['flags'] = struct.unpack_from('<I', pe.data, pe.off(rva + APP_DATA_FIELDS['flags']))[0]
    return out


def app_data_flags(flags):
    flags &= ~(NS_XRE_ENABLE_CRASH_REPORTER | NS_XRE_ENABLE_PROFILE_MIGRATOR)
    return flags | (NS_XRE_ENABLE_CRASH_REPORTER if CRASH_REPORTER else 0) | (NS_XRE_ENABLE_PROFILE_MIGRATOR if PROFILE_MIGRATOR else 0)


def patch_app_data(path, ini):
    """Give deer.exe Deer's identity: the compiled-in application data's Vendor, Name, RemotingName,
    Profile and UAName point at new strings (written into the unused end of the section that holds the
    data), fields that were null get a base relocation, and the flags follow CRASH_REPORTER and
    PROFILE_MIGRATOR. Mozilla's own strings are left where they are. Returns the before/after fields."""
    data = bytearray(open(path, 'rb').read())
    pe = PE(data)
    expect = {'Vendor': ini.get('App.Vendor'), 'Name': ini.get('App.Name'), 'RemotingName': ini.get('App.RemotingName'),
              'Version': ini.get('App.Version'), 'BuildID': ini.get('App.BuildID'), 'ID': ini.get('App.ID')}
    rva = find_app_data(pe, expect)
    before = read_app_data(pe, rva)
    relocs = pe.relocations()
    s = pe.section(rva)
    addr = pe.add_strings(s, [IDENTITY[k] for k in IDENTITY])
    added = []
    for key, value in IDENTITY.items():
        field = rva + APP_DATA_FIELDS[key]
        struct.pack_into('<Q', data, pe.off(field), addr[value])
        if field not in relocs:
            relocs.add(field)
            added.append(key)
    struct.pack_into('<I', data, pe.off(rva + APP_DATA_FIELDS['flags']), app_data_flags(before['flags']))
    if added:
        pe.write_relocations(relocs)
    pe_set_checksum(data)
    with open(path, 'wb') as f:
        f.write(data)
    # Read it back as the loader will.
    pe2 = PE(bytearray(open(path, 'rb').read()))
    after = read_app_data(pe2, rva)
    want = dict(before, **IDENTITY)
    want['flags'] = app_data_flags(before['flags'])
    if after != want:
        raise SystemExit('%s: the application data did not take: %r' % (path, after))
    missing = [k for k in IDENTITY if rva + APP_DATA_FIELDS[k] not in pe2.relocations()]
    if missing:
        raise SystemExit('%s: no relocation for %s' % (path, ', '.join(missing)))
    return {'rva': '%#x' % rva, 'before': before, 'after': after, 'relocationsAdded': added}


def app_data_state(path, ini):
    """[problem] for --check: deer.exe's compiled-in application data must read IDENTITY."""
    try:
        pe = PE(bytearray(open(path, 'rb').read()))
        rva = find_app_data(pe, {'Version': ini.get('App.Version'), 'BuildID': ini.get('App.BuildID'), 'ID': ini.get('App.ID')})
        got = read_app_data(pe, rva)
    except (SystemExit, OSError, ValueError) as e:
        return ['%s: compiled-in application data not readable (%s)' % (os.path.basename(path), e)]
    wrong = {k: got.get(k) for k, v in IDENTITY.items() if got.get(k) != v}
    if got['flags'] != app_data_flags(got['flags']):
        wrong['flags'] = got['flags']
    return ['%s: compiled-in identity is not Deer\'s: %s' % (os.path.basename(path), json.dumps(wrong))] if wrong else []


def identity_ini(text, root):
    """The engine's application.ini text with Deer's identity: [App] keys of IDENTITY set (added at the
    end of [App] when missing), [XRE] EnableProfileMigrator and [Crash Reporter] Enabled set; every
    other line kept, so -app <this file> gives exactly what the patched deer.exe has compiled in."""
    want = {'App': dict(IDENTITY), 'XRE': {'EnableProfileMigrator': str(int(PROFILE_MIGRATOR))},
            'Crash Reporter': {'Enabled': str(int(CRASH_REPORTER))}}
    head = ['; Deer engine identity, written by gecko/tools/setup-engine.py from the engine\'s own application.ini.']
    if root:
        head += ['; Gecko never reads this file (it uses the data compiled into deer.exe, which setup-engine.py',
                 '; patched to the same values); browser\\application.ini is the copy "-app" would take.']
    else:
        head += ['; deer.exe has the same values compiled in, so nothing has to point at this file. It is what',
                 ';   deer.exe -app <this file> ...   (or XUL_APP_FILE=<this file>) would read: the fallback when',
                 '; a later engine\'s exe cannot be patched. Every start must then use it, or identities mix.']
    out, section, done = [], None, set()

    def flush(sec):
        for k, v in want.get(sec, {}).items():
            if (sec, k) not in done:
                out.append('%s=%s' % (k, v))
                done.add((sec, k))

    for line in text.splitlines():
        s = line.strip()
        if s.startswith(';') and section is None:
            continue  # Mozilla's "This file is not used" comment
        if s.startswith('[') and s.endswith(']'):
            if section is not None:
                while out and not out[-1].strip():
                    out.pop()
                flush(section)
                out.append('')
            section = s[1:-1]
            out.append(line)
            continue
        if '=' in s and section in want and s.split('=', 1)[0].strip() in want[section]:
            key = s.split('=', 1)[0].strip()
            out.append('%s=%s' % (key, want[section][key]))
            done.add((section, key))
            continue
        out.append(line)
    while out and not out[-1].strip():
        out.pop()
    if section is not None:
        flush(section)
    for sec in want:
        if not any(d[0] == sec for d in done):
            out += ['', '[%s]' % sec]
            flush(sec)
    return '\r\n'.join(head + out) + '\r\n'


def identity_prefs():
    lines = ['// Deer engine identity: defaults written by gecko/tools/setup-engine.py (IDENTITY_PREFS).',
             '// Read after Firefox\'s own defaults (browser/omni.ja firefox.js), so they win over them.']
    for k, v in IDENTITY_PREFS.items():
        lines.append('pref(%s, %s);' % (json.dumps(k), json.dumps(v)))
    return '\r\n'.join(lines) + '\r\n'


def write_identity(out, engine):
    """Step 8 a-c. Returns the notes for deer-engine.json."""
    ini_path = os.path.join(engine, 'application.ini')
    ini = read_ini(ini_path)
    text = open(ini_path, encoding='utf-8').read()
    patch_names(out, dry=True)  # every name found as often as listed, before anything is written
    exe = patch_app_data(os.path.join(out, EXE), ini)
    names = patch_names(out)
    with open(os.path.join(out, 'application.ini'), 'w', encoding='utf-8', newline='') as f:
        f.write(identity_ini(text, True))
    with open(os.path.join(out, 'browser', 'application.ini'), 'w', encoding='utf-8', newline='') as f:
        f.write(identity_ini(text, False))
    prefs = None
    if IDENTITY_PREFS:
        prefs = os.path.join(out, IDENTITY_PREFS_FILE)
        os.makedirs(os.path.dirname(prefs), exist_ok=True)
        with open(prefs, 'w', encoding='utf-8', newline='') as f:
            f.write(identity_prefs())
    return {
        'app': dict(IDENTITY), 'crashReporter': CRASH_REPORTER, 'profileMigrator': PROFILE_MIGRATOR,
        'dataRoot': ['%APPDATA%\\' + IDENTITY['Profile'], '%LOCALAPPDATA%\\' + IDENTITY['Profile']],
        'compiledIn': exe, 'compiledNames': names,
        'ini': 'browser/application.ini', 'prefs': IDENTITY_PREFS_FILE.replace('\\', '/') if prefs else None,
        # What every start of deer.exe needs for this identity: nothing, it is compiled in. What a
        # launcher removes from the engine's environment: LAUNCH_CLEAR_ENV.
        'launch': {'args': [], 'env': {}, 'clearEnv': list(LAUNCH_CLEAR_ENV)},
    }


def identity_state(out, engine):
    """[problem] for --check."""
    problems = []
    ini_path = os.path.join(engine, 'application.ini')
    text = open(ini_path, encoding='utf-8').read()
    for rel, root in (('application.ini', True), (os.path.join('browser', 'application.ini'), False)):
        p = os.path.join(out, rel)
        if not os.path.exists(p) or open(p, encoding='utf-8', newline='').read() != identity_ini(text, root):
            problems.append(rel + ' (Deer identity)')
    p = os.path.join(out, IDENTITY_PREFS_FILE)
    if IDENTITY_PREFS and (not os.path.exists(p) or open(p, encoding='utf-8', newline='').read() != identity_prefs()):
        problems.append(IDENTITY_PREFS_FILE)
    problems += app_data_state(os.path.join(out, EXE), read_ini(ini_path))
    problems += names_state(out)
    return problems


# ---- engine folder --------------------------------------------------------------------------------

def read_ini(path):
    out, section = {}, ''
    with open(path, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if line.startswith('[') and line.endswith(']'):
                section = line[1:-1]
            elif '=' in line and not line.startswith((';', '#')):
                k, v = line.split('=', 1)
                out[section + '.' + k.strip()] = v.strip()
    return out


def default_engine():
    found = []
    if os.path.isdir(ENGINES):
        for name in os.listdir(ENGINES):
            m = re.fullmatch(r'firefox-([\d.]+)-unbranded', name)
            if m and os.path.exists(os.path.join(ENGINES, name, 'firefox.exe')):
                found.append((tuple(int(x) for x in m.group(1).split('.')), name))
    if not found:
        raise SystemExit('no engine in %s: unpack the unbranded build as engines/firefox-<version>-unbranded' % ENGINES)
    return os.path.join(ENGINES, max(found)[1])


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def unpack(zip_path, into):
    """Unpack Mozilla's target.zip (top folder 'firefox') as <into>/firefox-<version>-unbranded and
    return that folder. The SHA-256 is printed; when <folder>.meta/source.json exists it must match."""
    digest = sha256(zip_path)
    with zipfile.ZipFile(zip_path) as z:
        ini = z.read('firefox/application.ini').decode('utf-8', 'replace')
        m = re.search(r'^Version=(.+)$', ini, re.M)
        if not m:
            raise SystemExit('%s: no Version in firefox/application.ini' % zip_path)
        dest = os.path.join(into, 'firefox-%s-unbranded' % m.group(1).strip())
        meta = os.path.join(dest + '.meta', 'source.json')
        if os.path.exists(meta):
            want = json.load(open(meta, encoding='utf-8')).get('sha256')
            if want and want != digest:
                raise SystemExit('%s: SHA-256 %s does not match %s (%s)' % (zip_path, digest, meta, want))
        if os.path.exists(dest):
            print('%s already unpacked (SHA-256 %s)' % (dest, digest))
            return dest
        tmp = dest + '.unpacking'
        if os.path.exists(tmp):
            shutil.rmtree(tmp)
        for name in z.namelist():
            if not name.startswith('firefox/') or '..' in name.split('/'):
                raise SystemExit('%s: unexpected entry %r' % (zip_path, name))
        z.extractall(tmp)
    os.rename(os.path.join(tmp, 'firefox'), dest)
    os.rmdir(tmp)
    print('unpacked %s -> %s (SHA-256 %s)' % (zip_path, dest, digest))
    return dest


def inside(a, b):
    """a is the folder b or a path inside it (junctions and symbolic links resolved, case ignored)."""
    a, b = (os.path.normcase(os.path.realpath(os.path.abspath(p))) for p in (a, b))
    return a == b or a.startswith(b.rstrip(os.sep) + os.sep)


def unlink_package(out):
    link = os.path.join(out, 'vitre')
    if is_junction(link):
        os.rmdir(link)  # the junction only, never the build folder it points at


TRASH = '.setup-engine-trash'  # <out> + this: the old folder while it is deleted (never a name a person picks)


def remove_out(out):
    """Delete a Deer engine folder this script wrote. Renamed first, so a running deer.exe fails
    loudly here and leaves the folder as it was (package junction included)."""
    if not os.path.exists(os.path.join(out, MARKER)):
        raise SystemExit('%s exists and was not written by setup-engine.py (no %s); move it away first' % (out, MARKER))
    trash = out + TRASH
    if os.path.exists(trash):  # left by a run whose delete failed half way
        unlink_package(trash)
        shutil.rmtree(trash)
    try:
        os.rename(out, trash)
    except OSError as e:
        raise SystemExit('cannot replace %s (is Deer running from it?): %s' % (out, e))
    unlink_package(trash)  # the junction only, never the build folder it points at
    shutil.rmtree(trash)


def engine_files(out):
    """{relative path ('/' separators): [size, sha256]} of every file of the engine folder `out` except
    deer-engine.json, the overlay (compared with tools/runtime-overlay on its own) and the package
    (<out>/vitre: a junction or a copy, compared on its own). Junctions are never followed."""
    overlay = {os.path.normcase(os.path.relpath(os.path.join(f, n), OVERLAY)) for f, _d, names in os.walk(OVERLAY) for n in names}
    files = {}
    for folder, dirs, names in os.walk(out):
        rel_dir = os.path.relpath(folder, out)
        dirs[:] = [d for d in dirs if not is_junction(os.path.join(folder, d)) and not (rel_dir == '.' and d == 'vitre')]
        for name in names:
            rel = os.path.normpath(os.path.join(rel_dir, name))
            if rel == MARKER or os.path.normcase(rel) in overlay:
                continue
            path = os.path.join(folder, name)
            files[rel.replace('\\', '/')] = [os.path.getsize(path), sha256(path)]
    return files


def files_state(out, meta):
    """[problem] for --check: the engine's files against the list deer-engine.json records."""
    want = meta.get('files')
    if not isinstance(want, dict) or not want:
        return ['%s lists no engine files (written by an older setup-engine.py): the engine cannot be checked for completeness' % MARKER]
    have = engine_files(out)
    problems = []
    for label, names in (('missing', sorted(set(want) - set(have))), ('not made by setup-engine.py', sorted(set(have) - set(want))),
                         ('changed since setup-engine.py wrote it', sorted(n for n in set(want) & set(have) if list(want[n]) != have[n]))):
        if names:
            shown = ', '.join(names[:12]) + (' and %d more' % (len(names) - 12) if len(names) > 12 else '')
            problems.append('%d engine file(s) %s: %s' % (len(names), label, shown))
    return problems


def package_note(out, app):
    """A note (not a failure) when <out>/vitre links to a package built before the newest change in src/."""
    link = os.path.join(out, 'vitre')
    if not is_junction(link):
        return None
    try:
        built = json.load(open(os.path.join(app, 'build.json'), encoding='utf-8')).get('built', '')
        built_at = datetime.datetime.fromisoformat(built.replace('Z', '+00:00')).timestamp()
    except (OSError, ValueError, AttributeError):
        return None
    src = os.path.join(ROOT, 'src')
    newest, newest_path = 0, ''
    for folder, _dirs, names in os.walk(src):
        for name in names:
            t = os.path.getmtime(os.path.join(folder, name))
            if t > newest:
                newest, newest_path = t, os.path.join(folder, name)
    if newest <= built_at + 1:
        return None
    return ('the chrome package %s (built %s) is older than src/ (%s changed %s): node tools/build.mjs --out=%s rebuilds it; '
            'the engine itself needs nothing' % (os.path.relpath(app, ROOT), datetime.datetime.fromtimestamp(built_at).isoformat(timespec='seconds'),
                                                 os.path.relpath(newest_path, ROOT),
                                                 datetime.datetime.fromtimestamp(newest).isoformat(timespec='seconds'), os.path.basename(app)))


def expected(engine, keep_all):
    """What a correct --out contains, for --check: {overlay path: source} and the paths that must be absent."""
    files = {}
    for folder, _dirs, names in os.walk(OVERLAY):
        for name in names:
            src = os.path.join(folder, name)
            files[os.path.relpath(src, OVERLAY)] = src
    absent = [] if keep_all else [p for p in STRIP if os.path.lexists(os.path.join(engine, p))]
    return files, absent


def check(engine, out, app, copy, keep_all, media_host, stock_identity=False):
    stale = []
    meta_path = os.path.join(out, MARKER)
    if not os.path.exists(meta_path):
        return ['%s missing' % MARKER]
    try:
        meta = json.load(open(meta_path, encoding='utf-8'))
    except ValueError:
        return ['%s unreadable (an interrupted run?)' % MARKER]
    ini = read_ini(os.path.join(engine, 'application.ini'))
    if meta.get('engine', {}).get('buildId') != ini.get('App.BuildID'):
        stale.append('engine build %s, folder has %s' % (ini.get('App.BuildID'), meta.get('engine', {}).get('buildId')))
    files, absent = expected(engine, keep_all)
    for rel, src in files.items():
        dst = os.path.join(out, rel)
        if not (os.path.exists(dst) and filecmp.cmp(src, dst, shallow=False)):
            stale.append(rel)
    for rel in absent:
        if os.path.lexists(os.path.join(out, rel)):
            stale.append(rel + ' (should be absent)')
    if not os.path.exists(os.path.join(out, EXE)):
        stale.append(EXE)
    elif meta.get('exeSha256') != sha256(os.path.join(out, EXE)):
        stale.append('%s (not the file this script wrote: SHA-256 differs from %s)' % (EXE, MARKER))
    placeholder = os.path.join(out, 'firefox.exe')
    if media_host == 'none':
        if os.path.lexists(placeholder):
            stale.append('firefox.exe (should be absent: --media-host none)')
    elif not os.path.exists(placeholder):
        stale.append('firefox.exe (the media plug-in placeholder)')
    elif not os.path.getsize(placeholder):
        stale.append('firefox.exe is empty (media plug-ins need a non-empty file)')
    elif filecmp.cmp(placeholder, os.path.join(engine, 'firefox.exe'), shallow=False):
        stale.append('firefox.exe is Mozilla\'s own exe, not the placeholder')
    link = os.path.join(out, 'vitre')
    if copy:
        if is_junction(link) or not os.path.exists(os.path.join(link, 'chrome.manifest')):
            stale.append('vitre (copy)')
        elif not filecmp.cmp(os.path.join(link, 'chrome.manifest'), os.path.join(app, 'chrome.manifest'), shallow=False):
            stale.append('vitre (copy of %s: its chrome.manifest differs, rebuilt since?)' % app)
    elif not (is_junction(link) and same_target(link, app)):
        stale.append('vitre (junction to %s)' % app)
    if stock_identity:
        if meta.get('identity', {}).get('app'):
            stale.append('identity (the folder has Deer\'s; --stock-identity asks for Mozilla\'s)')
    elif os.path.exists(os.path.join(out, EXE)):
        stale += identity_state(out, engine)
        # The installer reads the launch contract from the record: it must be this script's.
        if meta.get('identity', {}).get('launch', {}).get('clearEnv') != list(LAUNCH_CLEAR_ENV):
            stale.append('%s identity.launch.clearEnv (not %s)' % (MARKER, ', '.join(LAUNCH_CLEAR_ENV)))
    stale += files_state(out, meta)
    return stale


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--engine')
    ap.add_argument('--out', default=os.path.join(ENGINES, 'deer-runtime'))
    ap.add_argument('--app', default='build')
    ap.add_argument('--copy', action='store_true')
    ap.add_argument('--keep-all', action='store_true')
    ap.add_argument('--keep-exe', action='store_true')
    ap.add_argument('--icon', default=os.path.join(OVERLAY, 'browser', 'chrome', 'icons', 'default', 'vitre.ico'))
    ap.add_argument('--media-host', choices=('stub', 'text', 'copy', 'none'), default='stub')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--stock-identity', action='store_true')
    ap.add_argument('--unpack', metavar='ZIP')
    a = ap.parse_args()

    if a.unpack:
        engine = unpack(os.path.abspath(a.unpack), ENGINES)
    else:
        engine = os.path.abspath(a.engine) if a.engine else default_engine()
    out = os.path.abspath(a.out)
    app = os.path.abspath(os.path.join(ROOT, a.app))
    if inside(out, setup_runtime.RUNTIME) or inside(engine, setup_runtime.RUNTIME) or inside(setup_runtime.RUNTIME, out):
        raise SystemExit('setup-engine.py never reads or writes runtime/ (the branded development runtime)')
    for x, y in ((out, engine), (engine, out), (out, app), (app, out)):
        if inside(x, y):
            raise SystemExit('--out, --engine and --app must be separate folders, none inside another (%s is in %s)' % (x, y))
    if not os.path.exists(os.path.join(engine, 'firefox.exe')) or not os.path.exists(os.path.join(engine, 'application.ini')):
        raise SystemExit('%s is not an unpacked Firefox build (no firefox.exe / application.ini)' % engine)
    ini = read_ini(os.path.join(engine, 'application.ini'))

    if a.check:
        stale = check(engine, out, app, a.copy, a.keep_all, a.media_host, a.stock_identity)
        note = package_note(out, app)
        if note:
            print('note: ' + note)
        if stale:
            print('out of date:\n  ' + '\n  '.join(stale))
            sys.exit(1)
        print('%s is a Deer engine for %s %s (%s)' % (out, ini.get('App.Name'), ini.get('App.Version'), ini.get('App.BuildID')))
        return

    if not os.path.exists(os.path.join(app, 'chrome.manifest')):
        raise SystemExit('no chrome.manifest in %s (run: node tools/build.mjs%s)' % (
            app, '' if os.path.basename(app) == 'build' else ' --out=' + os.path.basename(app)))
    # Branding check: this script is for Mozilla's unbranded build only. The branded Firefox may not be
    # redistributed in a modified form (Mozilla trademark policy).
    # The exe's ProductName is the build's brand ("Firefox" or "Nightly"); brand.ftl says the same, but
    # the branded build's optimized omni.ja is not readable with zipfile.
    product = version_strings(read_resources(os.path.join(engine, 'firefox.exe'), RT_VERSION)[0][2]).get('ProductName', '')
    try:
        with zipfile.ZipFile(os.path.join(engine, 'browser', 'omni.ja')) as z:
            ftl = z.read('localization/en-US/branding/brand.ftl').decode('utf-8', 'replace')
    except Exception:  # noqa: BLE001
        ftl = ''
    m = re.search(r'^-brand-short-name\s*=\s*(.+)$', ftl, re.M)
    brand = m.group(1).strip() if m else product
    # Every official branding carries the name: "Firefox", "Firefox Nightly", "Firefox Developer Edition".
    # The unbranded build says "Nightly" in both places.
    if any('firefox' in s.lower() for s in (product, brand)):
        raise SystemExit('%s is the BRANDED Firefox (ProductName %r, brand %r): Deer ships only the unbranded build' % (engine, product, brand))

    t0 = datetime.datetime.now()
    if os.path.exists(out):
        remove_out(out)
    # Claim the folder before the copy (remove_out checks the marker), so an interrupted copy leaves a
    # folder the next run replaces instead of one it refuses; an empty marker reads as "interrupted".
    os.makedirs(out)
    open(os.path.join(out, MARKER), 'w').close()
    shutil.copytree(engine, out, symlinks=True, dirs_exist_ok=True)

    # 1. overlay (the same files setup-runtime.py puts into runtime/)
    overlay = []
    for folder, _dirs, names in os.walk(OVERLAY):
        for name in names:
            src = os.path.join(folder, name)
            rel = os.path.relpath(src, OVERLAY)
            dst = os.path.join(out, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
            overlay.append(rel.replace('\\', '/'))

    # 2. deer.exe
    os.rename(os.path.join(out, 'firefox.exe'), os.path.join(out, EXE))
    exe_notes = None
    if not a.keep_exe:
        exe_notes = {EXE: brand_exe(os.path.join(out, EXE), os.path.abspath(a.icon), EXE_STRINGS)}
        if os.path.exists(os.path.join(out, 'plugin-container.exe')):
            exe_notes['plugin-container.exe'] = brand_exe(os.path.join(out, 'plugin-container.exe'), None, PLUGIN_CONTAINER_STRINGS)

    # 3. the firefox.exe placeholder the media plug-ins need
    media_host = write_media_host(out, a.media_host)

    # 4. strip
    removed = []
    if not a.keep_all:
        for rel in STRIP:
            p = os.path.join(out, rel)
            if os.path.isdir(p):
                shutil.rmtree(p)
                removed.append(rel)
            elif os.path.lexists(p):
                os.remove(p)
                removed.append(rel)

    # 8. Deer's own identity (deer.exe's compiled-in application data, compiled names, the ini files)
    if a.stock_identity:
        identity = {'stock': True, 'app': None, 'launch': {'args': [], 'env': {}, 'clearEnv': list(LAUNCH_CLEAR_ENV)},
                    'note': 'Mozilla Firefox identity kept (--stock-identity): data root %APPDATA%\\Mozilla\\Firefox'}
    else:
        identity = write_identity(out, engine)

    # 5. the chrome package
    link = os.path.join(out, 'vitre')
    if a.copy:
        shutil.copytree(app, link)
    else:
        r = subprocess.run(['cmd', '/c', 'mklink', '/J', link, app], capture_output=True, text=True)
        if r.returncode:
            raise SystemExit('mklink failed: ' + (r.stderr or r.stdout))

    # 6. record
    source = {}
    meta_dir = engine + '.meta'
    if os.path.exists(os.path.join(meta_dir, 'source.json')):
        source = json.load(open(os.path.join(meta_dir, 'source.json'), encoding='utf-8'))
    meta = {
        'engine': {
            'folder': os.path.relpath(engine, ROOT).replace('\\', '/'),
            'brand': brand,
            'name': ini.get('App.Name'), 'vendor': ini.get('App.Vendor'), 'remotingName': ini.get('App.RemotingName'),
            'version': ini.get('App.Version'), 'buildId': ini.get('App.BuildID'),
            'sourceStamp': ini.get('App.SourceStamp'), 'repository': ini.get('App.SourceRepository'),
            'source': source,
        },
        'exe': EXE,
        'exeSha256': sha256(os.path.join(out, EXE)),
        'exeBranding': exe_notes,
        'mediaHost': {'firefox.exe': media_host, 'why': 'media plug-ins (ClearKey, Widevine, OpenH264) fail with AbortError when no non-empty firefox.exe is next to the engine'},
        'overlay': sorted(overlay),
        'removed': {rel: STRIP[rel] for rel in removed},
        'identity': identity,
        'package': {'path': os.path.relpath(app, ROOT).replace('\\', '/'), 'mode': 'copy' if a.copy else 'junction'},
        'written': t0.isoformat(timespec='seconds'),
        # Every file as written (--check: nothing missing, added or changed since).
        'files': engine_files(out),
    }
    with open(os.path.join(out, MARKER), 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')
    secs = (datetime.datetime.now() - t0).total_seconds()
    print('Deer engine written to %s in %.1f s' % (out, secs))
    print('  engine   %s %s, build %s, brand %r (%s)' % (ini.get('App.Name'), ini.get('App.Version'), ini.get('App.BuildID'), brand, meta['engine']['folder']))
    print('  exe      %s%s' % (EXE, ' (firefox.exe renamed; icon and version strings kept: --keep-exe)' if a.keep_exe else
                                   ' (icon groups %s; version strings %s; plugin-container.exe described as %r)' % (
                                       exe_notes[EXE]['iconGroups'], ', '.join('%s=%s' % kv for kv in EXE_STRINGS.items()),
                                       PLUGIN_CONTAINER_STRINGS['FileDescription'])))
    print('  firefox.exe  %s' % media_host)
    print('  overlay  %s' % ', '.join(meta['overlay']))
    print('  removed  %s' % (', '.join(removed) or 'nothing (--keep-all)'))
    if a.stock_identity:
        print('  identity Mozilla Firefox (--stock-identity: shares %APPDATA%\\Mozilla\\Firefox and HKCU\\Software\\Mozilla with Firefox)')
    else:
        print('  identity %s (compiled into %s; data root %s; %d compiled names renamed; launcher passes nothing)' % (
            ', '.join('%s=%s' % kv for kv in IDENTITY.items()), EXE, ' and '.join(identity['dataRoot']),
            sum(len(v) for v in identity['compiledNames'].values())))
    print('  package  vitre -> %s (%s)' % (meta['package']['path'], meta['package']['mode']))
    print('  files    %d engine files recorded with their SHA-256 (--check compares them)' % len(meta['files']))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
