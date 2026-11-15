"""Wire the development engine for Vitre. Idempotent; run it again after changing the overlay.

  python tools/setup-runtime.py [--check] [--copy]

runtime/ is a private, git-ignored copy of Mozilla's unbranded Firefox 157 build (docs/BUILDING.md).
Everything Vitre adds to it is described here, so a fresh runtime (or a newer Firefox) is wired with
one command. Where the engine's parts are on each platform is in engine_paths.py.

Windows (runtime/ is the engine folder):
  1. tools/runtime-overlay/**  ->  runtime/**   (the tracked source of these files)
       config.js                                  AutoConfig loader (launch guard, package, test hook)
       defaults/pref/config-prefs.js              tells Gecko to run config.js unsandboxed
       defaults/pref/vitre-prefs.js               product defaults
       distribution/policies.json                 no self-update, no telemetry, no default-browser agent
       browser/chrome/icons/default/vitre.ico     window icon (root attribute icon="vitre")
     but not defaults/vitre-platform/ (MAC_ONLY_OVERLAY): config.js reads it on macOS only, and
     Windows runtimes and engines (setup-engine.py) hold exactly the files they did before the port.
  2. runtime/vitre.exe  = a byte copy of runtime/firefox.exe. Vitre runs as vitre.exe (every child
     process carries that image name too), so tools keyed on the name "firefox.exe" leave it alone.
     The copy keeps Mozilla's signature valid. Redo after replacing the runtime.
  3. runtime/vitre  = a junction to ../build (the chrome package). Sandboxed content processes can
     only read files inside the runtime directory, so the package has to appear there.
  4. runtime/crashreporter.exe is renamed to crashreporter.exe.off: with Mozilla's identity it would
     tidy the installed Firefox's crash folder (%APPDATA%\\Mozilla\\Firefox\\Crash Reports).

macOS (runtime/Deer Dev.app: GreD is Contents/Resources, the programs are in Contents/MacOS):
  1. tools/runtime-overlay/**  ->  Contents/Resources/**   (the same files, and defaults/vitre-platform/;
     the .ico window icons go along unused, since macOS shows the bundle's icon)
  2. Contents/Resources/vitre  = a relative symbolic link to gecko/build. Sandboxed content processes
     read only inside the .app and a few allowed paths, so the package has to appear there. --copy
     puts a copy of build/ there instead, for when the sandbox refuses to follow the link (run it again
     after every build). There is no vitre.exe: the engine always runs as Contents/MacOS/firefox
     (engine_paths.py says why).
  3. Contents/MacOS/crashreporter.app is renamed to crashreporter.app.off, as in Windows step 4: its
     --ping-cleanup would tidy ~/Library/Application Support/Firefox/Crash Reports.
  4. Contents/Resources/deer.icns: Deer's icon for the Dock and Finder, the gold icon on Apple's macOS
     grid (the Default appearance of the design board), drawn by tools/mac/appicon.py from
     design/icon/ into tools/mac/bin/deer.icns (git-ignored, made again when its sources change). If
     it cannot be built (no Xcode Command Line Tools), a warning says so and the bundle keeps
     Mozilla's icon; --check reports it until it is in place.
  5. Contents/Info.plist: CFBundleName and CFBundleDisplayName "Deer Dev", CFBundleIdentifier
     io.github.droidboy08-hub.deer.dev, and LSEnvironment (kept) plus XRE_PROFILE_PATH = the dev
     profile and MOZ_CRASHREPORTER_DISABLE=1, so a start from the Dock, Finder, `open` or a clicked link
     uses Deer's profile. The strings people see that name the engine ("Nightly": Finder's Get Info
     string and the reasons in macOS's privacy prompts, every NS...UsageDescription) name "Deer Dev",
     as Mozilla's Info.plist.in names the bundle in each. CFBundleIconFile deer.icns, and no
     CFBundleIconName: that names the AppIcon in Mozilla's Assets.car, which would win over any
     CFBundleIconFile (firefox.icns and Assets.car stay in the bundle, unused). A CFBundleName in
     Contents/Resources/*.lproj/InfoPlist.strings overrides the plist's, so it is set there too, and
     so are those strings where a localization has them. Nothing is re-signed: the linker's ad-hoc
     signature does not bind Info.plist or seal Resources (codesign -dv: "Info.plist=not bound",
     "Sealed Resources=none"). The executable's name and the engine's identifiers stay as they are.
  6. ~/Library/Application Support/Deer Dev/Profile and its marker file vitre-profile.
  7. com.apple.quarantine removed from the bundle; then the bundle is touched and registered again
     with LaunchServices (lsregister -f), which reads the new name, identifier and icon.

--check only reports what is out of date and exits 1 if anything is. --copy is for macOS only.
"""
import filecmp
import importlib.util
import os
import plistlib
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:  # engine_paths.py sits beside this file, also when setup-engine.py loads it by path
    sys.path.append(HERE)
import engine_paths  # noqa: E402
# is_junction and same_target keep their old home here: setup-engine.py imports them from this file.
from engine_paths import RUNTIME, is_junction, same_target  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OVERLAY = os.path.join(ROOT, 'tools', 'runtime-overlay')
BUILD = os.path.join(ROOT, 'build')
# Overlay files only a macOS engine gets: config.js loads defaults/vitre-platform/mac*.js on macOS only.
# A Windows runtime and a release engine (setup-engine.py) leave them out; anything else that copies the
# overlay into a Windows engine or release (installer/build.py copy_engine) has to skip them too.
MAC_ONLY_OVERLAY = 'defaults/vitre-platform/'


def mac_only(rel_path):
    """True for an overlay file that only a macOS engine gets (rel_path: relative to OVERLAY, with
    either separator)."""
    return rel_path.replace('\\', '/').lower().startswith(MAC_ONLY_OVERLAY)


# macOS: the development bundle's name, identifier and profile. The identifier is for good: privacy
# grants, the default-browser setting and the app's preferences are all keyed on it.
MAC_NAME = 'Deer Dev'
MAC_BUNDLE_ID = 'io.github.droidboy08-hub.deer.dev'
MAC_PROFILE = os.path.join(os.path.expanduser('~'), 'Library', 'Application Support', 'Deer Dev', 'Profile')
LSREGISTER = ('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework'
              '/Support/lsregister')
# The bundle's icon, Contents/Resources/<this>, drawn by tools/mac/appicon.py.
MAC_ICON = 'deer.icns'
# The engine's own name in the Info.plist strings people see. Mozilla's browser/app/macbuild/Contents/
# Info.plist.in writes @MAC_APP_NAME@ into each: "Nightly" in the unbranded build, Firefox in branded ones.
STOCK_NAME = re.compile(r'\b(?:Mozilla[ \t]+)?(?:Firefox(?:[ \t]+(?:Nightly|Developer[ \t]+Edition))?|Nightly)\b')
# `key =` at the start of an entry of a .strings file (the key may be quoted)
STRINGS_KEY = re.compile(r'^[ \t]*"?([A-Za-z_][A-Za-z0-9_.-]*)"?[ \t]*=', re.M)


def wire_windows(check, stale):
    if not os.path.exists(os.path.join(RUNTIME, 'firefox.exe')):
        sys.exit('no runtime: %s\\firefox.exe is missing' % RUNTIME)

    # 1. overlay files, all but the macOS-only ones
    for folder, _dirs, files in os.walk(OVERLAY):
        for name in files:
            src = os.path.join(folder, name)
            if mac_only(os.path.relpath(src, OVERLAY)):
                continue
            dst = os.path.join(RUNTIME, os.path.relpath(src, OVERLAY))
            if os.path.exists(dst) and filecmp.cmp(src, dst, shallow=False):
                continue
            stale.append(os.path.relpath(dst, ROOT))
            if not check:
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(src, dst)

    # 2. vitre.exe
    exe, firefox = os.path.join(RUNTIME, 'vitre.exe'), os.path.join(RUNTIME, 'firefox.exe')
    if not (os.path.exists(exe) and filecmp.cmp(firefox, exe, shallow=False)):
        stale.append('runtime\\vitre.exe')
        if not check:
            shutil.copyfile(firefox, exe)

    # 3. junction runtime\vitre -> ..\build
    link = os.path.join(RUNTIME, 'vitre')
    if not (is_junction(link) and same_target(link, BUILD)):
        stale.append('runtime\\vitre (junction)')
        if not check:
            os.makedirs(BUILD, exist_ok=True)
            if is_junction(link):
                os.rmdir(link)  # removes the junction only, never its target
            elif os.path.exists(link):
                sys.exit('%s exists and is not a junction; move it away first' % link)
            r = subprocess.run(['cmd', '/c', 'mklink', '/J', link, BUILD], capture_output=True, text=True)
            if r.returncode:
                sys.exit('mklink failed: ' + (r.stderr or r.stdout))

    # 4. Mozilla's crash reporter, renamed out of the way (crashreporter.exe.off). This runtime keeps
    # Mozilla's identity, so about a minute into every session the crash manager runs
    # crashreporter.exe --ping-cleanup on the INSTALLED Firefox's "%APPDATA%\Mozilla\Firefox\Crash
    # Reports" (release check, 2026-10-05). The release engine leaves the file out (setup-engine.py STRIP).
    reporter = os.path.join(RUNTIME, 'crashreporter.exe')
    if os.path.exists(reporter):
        stale.append('runtime\\crashreporter.exe (renamed to crashreporter.exe.off)')
        if not check:
            parked = reporter + '.off'
            if os.path.exists(parked):
                os.remove(parked)
            os.rename(reporter, parked)


# ---- macOS ----------------------------------------------------------------------------------------

def rel(path):
    return os.path.relpath(path, ROOT)


def tree_files(top):
    """{relative path: path} of every file under the folder top."""
    files = {}
    for folder, _dirs, names in os.walk(top):
        for name in names:
            path = os.path.join(folder, name)
            files[os.path.relpath(path, top)] = path
    return files


def same_tree(src, dst):
    """dst is a real folder holding exactly src's files, byte for byte."""
    if os.path.islink(dst) or not os.path.isdir(dst):
        return False
    a, b = tree_files(src), tree_files(dst)
    return a.keys() == b.keys() and all(filecmp.cmp(a[k], b[k], shallow=False) for k in a)


def package_copy(path):
    """A real folder holding a chrome package: what --copy leaves at Contents/Resources/vitre."""
    return (os.path.isdir(path) and not os.path.islink(path)
            and os.path.isfile(os.path.join(path, 'chrome.manifest')))


def write_checked(path, data, original):
    """Replace a bundle plist in one step and make sure plutil can still read it (an Info.plist that
    does not parse leaves an app that does not open); on failure put the original bytes back."""
    tmp = path + '.setup-runtime-tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    shutil.copymode(path, tmp)
    os.replace(tmp, path)
    r = subprocess.run(['/usr/bin/plutil', '-lint', path], capture_output=True, text=True)
    if r.returncode:
        with open(path, 'wb') as f:
            f.write(original)
        sys.exit('%s would not parse after the change, left as it was: %s'
                 % (path, (r.stdout or r.stderr).strip()))


# .strings files: Mozilla's are UTF-16 little-endian with a byte-order mark; UTF-8 is accepted too.
STRINGS_BOMS = ((b'\xff\xfe', 'utf-16-le'), (b'\xfe\xff', 'utf-16-be'), (b'\xef\xbb\xbf', 'utf-8'))


def read_strings(path):
    """(bytes, byte-order mark, encoding, text) of a .strings file."""
    with open(path, 'rb') as f:
        data = f.read()
    for bom, encoding in STRINGS_BOMS:
        if data.startswith(bom):
            return data, bom, encoding, data[len(bom):].decode(encoding)
    return data, b'', 'utf-8', data.decode('utf-8')


def strings_entry(key):
    """`key = "value";` in a .strings file (the key may be quoted); group 2 is the value as written."""
    return re.compile(r'^([ \t]*"?%s"?[ \t]*=[ \t]*")((?:[^"\\\n]|\\.)*)("[ \t]*;)' % re.escape(key), re.M)


def shown_string(key):
    """An Info.plist (or InfoPlist.strings) key whose text people see and that names the engine:
    Finder's Get Info string and every reason macOS gives in a privacy prompt (NS...UsageDescription:
    camera, microphone, location, Apple Events, folders, volumes, local network, Bluetooth...).
    CFBundleName and CFBundleDisplayName are set whole; identifiers are never touched."""
    return key == 'CFBundleGetInfoString' or re.fullmatch(r'NS\w+UsageDescription', key) is not None


def rebrand(text):
    """text with the engine's name replaced by the bundle's ("Nightly 157.0" -> "Deer Dev 157.0")."""
    return STOCK_NAME.sub(MAC_NAME, text)


def load_appicon():
    """tools/mac/appicon.py, which draws deer.icns (loaded by path; macOS only)."""
    spec = importlib.util.spec_from_file_location('appicon', os.path.join(HERE, 'mac', 'appicon.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def ls_registered(app, bundle_id):
    """True when LaunchServices lists this app for bundle_id, False when it does not, None when it
    cannot be asked. LSCopyApplicationURLsForBundleIdentifier (LaunchServices/LSInfo.h) through ctypes."""
    try:
        import ctypes
        vp = ctypes.c_void_p
        cf = ctypes.CDLL('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
        cs = ctypes.CDLL('/System/Library/Frameworks/CoreServices.framework/CoreServices')
        cf.CFStringCreateWithCString.restype = vp
        cf.CFStringCreateWithCString.argtypes = [vp, ctypes.c_char_p, ctypes.c_uint32]
        cs.LSCopyApplicationURLsForBundleIdentifier.restype = vp
        cs.LSCopyApplicationURLsForBundleIdentifier.argtypes = [vp, vp]
        cf.CFArrayGetCount.restype, cf.CFArrayGetCount.argtypes = ctypes.c_long, [vp]
        cf.CFArrayGetValueAtIndex.restype, cf.CFArrayGetValueAtIndex.argtypes = vp, [vp, ctypes.c_long]
        cf.CFURLGetFileSystemRepresentation.restype = ctypes.c_bool
        cf.CFURLGetFileSystemRepresentation.argtypes = [vp, ctypes.c_bool, ctypes.c_char_p, ctypes.c_long]
        cf.CFRelease.argtypes = [vp]
        name = cf.CFStringCreateWithCString(None, bundle_id.encode('utf-8'), 0x08000100)  # kCFStringEncodingUTF8
        urls = cs.LSCopyApplicationURLsForBundleIdentifier(name, None)
        cf.CFRelease(name)
        if not urls:
            return False
        paths = []
        for i in range(cf.CFArrayGetCount(urls)):
            buf = ctypes.create_string_buffer(4096)
            if cf.CFURLGetFileSystemRepresentation(cf.CFArrayGetValueAtIndex(urls, i), True, buf, len(buf)):
                paths.append(buf.value.decode('utf-8'))
        cf.CFRelease(urls)
    except Exception:
        return None
    for path in paths:
        try:
            if os.path.samefile(path, app):  # by file identity: LaunchServices may spell the path differently
                return True
        except OSError:
            pass
    return False


def quarantined(app):
    """The files in the bundle that carry com.apple.quarantine (find does not follow the package link)."""
    r = subprocess.run(['/usr/bin/find', app, '-xattrname', 'com.apple.quarantine', '-print0'], capture_output=True)
    return [p for p in r.stdout.decode('utf-8', 'surrogateescape').split('\0') if p]


def wire_mac(check, copy, stale):
    app, res, macos = engine_paths.ENGINE_APP, engine_paths.GRE_DIR, engine_paths.BIN_DIR
    if not os.path.exists(engine_paths.ENGINE_EXE):
        sys.exit('no runtime: %s is missing (put Mozilla\'s unbranded Firefox 157 for macOS there as "%s")'
                 % (engine_paths.ENGINE_EXE, os.path.basename(app)))
    if not os.path.isabs(MAC_PROFILE):
        sys.exit('no home folder: cannot place the dev profile (%s)' % MAC_PROFILE)
    bundle_changed = False  # the icon or a plist rewritten, quarantine removed: LaunchServices must read the bundle again

    # 1. overlay files, relative to GreD. Finder's .DS_Store and AppleDouble ._* files are not part of it.
    for folder, _dirs, files in os.walk(OVERLAY):
        for name in files:
            if name == '.DS_Store' or name.startswith('._'):
                continue
            src = os.path.join(folder, name)
            dst = os.path.join(res, os.path.relpath(src, OVERLAY))
            if os.path.exists(dst) and filecmp.cmp(src, dst, shallow=False):
                continue
            stale.append(rel(dst))
            if not check:
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(src, dst)

    # 2. the chrome package: Contents/Resources/vitre -> gecko/build (or a copy of it with --copy)
    link = engine_paths.PACKAGE_LINK
    if copy:
        if not os.path.isfile(os.path.join(BUILD, 'chrome.manifest')):
            sys.exit('--copy: %s holds no chrome package; run  node tools/build.mjs  first' % BUILD)
        if not same_tree(BUILD, link):
            stale.append('%s (a copy of build)' % rel(link))
            if not check:
                if os.path.islink(link):
                    engine_paths.remove_link(link)  # the link only, never the build folder
                elif package_copy(link):
                    shutil.rmtree(link)
                elif os.path.lexists(link):
                    sys.exit('%s exists and is not a package copy or a link; move it away first' % link)
                shutil.copytree(BUILD, link)
    elif not (os.path.islink(link) and same_target(link, BUILD)):
        stale.append('%s (symbolic link to build)' % rel(link))
        if not check:
            os.makedirs(BUILD, exist_ok=True)
            if os.path.islink(link):
                engine_paths.remove_link(link)  # the link only, never the build folder
            elif package_copy(link):
                shutil.rmtree(link)  # left by --copy
            elif os.path.lexists(link):
                sys.exit('%s exists and is not a symbolic link; move it away first' % link)
            engine_paths.make_link(link, BUILD, relative=True)

    # 3. Mozilla's crash reporter, renamed out of the way (Windows step 4 explains why). With the stock
    # identity its crash folder is the person's real Firefox one under ~/Library/Application Support.
    reporter = os.path.join(macos, 'crashreporter.app')
    if os.path.exists(reporter):
        stale.append('%s (renamed to crashreporter.app.off)' % rel(reporter))
        if not check:
            parked = reporter + '.off'
            if os.path.isdir(parked) and not os.path.islink(parked):
                shutil.rmtree(parked)
            elif os.path.lexists(parked):
                os.remove(parked)
            os.rename(reporter, parked)

    # 4. Deer's icon. tools/mac/appicon.py draws it into tools/mac/bin/deer.icns, again only when its
    # sources change; --check draws nothing, so an icon still to be drawn is reported out of date.
    icon = os.path.join(res, MAC_ICON)
    appicon = load_appicon()
    built = None
    try:
        if check and appicon.out_of_date():
            stale.append('%s (Deer\'s icon, still to be drawn into %s)' % (rel(icon), rel(appicon.ICNS)))
            bundle_changed = True
        else:
            built = appicon.build_icns()
    except appicon.IconError as e:
        if check:
            stale.append('%s (Deer\'s icon cannot be drawn: %s)' % (rel(icon), e))
        else:
            sys.stderr.write('warning: Deer\'s icon was not drawn, so the bundle keeps the icon it has: %s\n' % e)
    if built and not (os.path.isfile(icon) and filecmp.cmp(built, icon, shallow=False)):
        stale.append('%s (Deer\'s icon, from %s)' % (rel(icon), rel(built)))
        bundle_changed = True
        if not check:
            tmp = icon + '.setup-runtime-tmp'
            shutil.copyfile(built, tmp)
            os.replace(tmp, icon)
    icon_ready = check or os.path.isfile(icon)

    # 5. the bundle's name, identifier, environment, icon and the strings people see
    plist_path = os.path.join(app, 'Contents', 'Info.plist')
    with open(plist_path, 'rb') as f:
        raw = f.read()
    info = plistlib.loads(raw)
    env = dict(info.get('LSEnvironment') or {})
    env.update({'XRE_PROFILE_PATH': MAC_PROFILE, 'MOZ_CRASHREPORTER_DISABLE': '1'})
    want = {'CFBundleName': MAC_NAME, 'CFBundleDisplayName': MAC_NAME, 'CFBundleIdentifier': MAC_BUNDLE_ID,
            'LSEnvironment': env}
    want.update((k, rebrand(v)) for k, v in info.items() if isinstance(v, str) and shown_string(k))
    drop = []
    if icon_ready:
        # CFBundleIconName names the AppIcon in Mozilla's Assets.car, which wins over CFBundleIconFile.
        want['CFBundleIconFile'] = MAC_ICON
        drop = [k for k in ('CFBundleIconName',) if k in info]
    keys = [k for k, v in want.items() if info.get(k) != v] + ['no ' + k for k in drop]
    if keys:
        stale.append('%s (%s)' % (rel(plist_path), ', '.join(keys)))
        bundle_changed = True
        if not check:
            info.update(want)
            for k in drop:
                del info[k]
            fmt = plistlib.FMT_BINARY if raw.startswith(b'bplist00') else plistlib.FMT_XML
            write_checked(plist_path, plistlib.dumps(info, fmt=fmt, sort_keys=False), raw)

    # InfoPlist.strings: a localized CFBundleName (Mozilla's says "Nightly") wins over Info.plist's, and
    # so would a localized privacy reason. Only keys the file already sets are changed; where it sets
    # none, the plist's value applies.
    for lproj in sorted(os.listdir(res)):
        path = os.path.join(res, lproj, 'InfoPlist.strings')
        if not (lproj.endswith('.lproj') and os.path.isfile(path)):
            continue
        data, bom, encoding, text = read_strings(path)
        fixes = {}  # key: the value it gets, from the value as written
        for k in ('CFBundleName', 'CFBundleDisplayName'):
            if any(m.group(2) != MAC_NAME for m in strings_entry(k).finditer(text)):
                fixes[k] = lambda _value: MAC_NAME
        for k in sorted(set(STRINGS_KEY.findall(text))):
            if shown_string(k) and any(rebrand(m.group(2)) != m.group(2) for m in strings_entry(k).finditer(text)):
                fixes[k] = rebrand
        if fixes:
            stale.append('%s (%s)' % (rel(path), ', '.join(fixes)))
            bundle_changed = True
            if not check:
                for k, fix in fixes.items():
                    text = strings_entry(k).sub(lambda m, fix=fix: m.group(1) + fix(m.group(2)) + m.group(3), text)
                write_checked(path, bom + text.encode(encoding), data)

    # 6. the dev profile that XRE_PROFILE_PATH names, with the vitre-profile marker config.js requires
    marker = os.path.join(MAC_PROFILE, 'vitre-profile')
    if not os.path.isfile(marker):
        stale.append('%s (with its vitre-profile marker)' % MAC_PROFILE)
        if not check:
            os.makedirs(MAC_PROFILE, exist_ok=True)
            open(marker, 'ab').close()

    # 7. quarantine, then LaunchServices. A quarantined bundle that was edited is refused as "damaged".
    files = quarantined(app)
    if files:
        stale.append('%s (com.apple.quarantine on %d file(s))' % (rel(app), len(files)))
        bundle_changed = True
        if not check:
            for i in range(0, len(files), 200):
                subprocess.run(['/usr/bin/xattr', '-d', '-s', 'com.apple.quarantine'] + files[i:i + 200],
                               capture_output=True)
            left = quarantined(app)
            if left:
                sys.exit('com.apple.quarantine could not be removed from %d file(s), e.g. %s' % (len(left), left[0]))
    if bundle_changed or ls_registered(app, MAC_BUNDLE_ID) is False:
        stale.append('%s (LaunchServices registration as %s)' % (rel(app), MAC_BUNDLE_ID))
        if not check:
            os.utime(app, None)  # touch: Finder and the Dock notice the changed bundle
            r = subprocess.run([LSREGISTER, '-f', app], capture_output=True, text=True)
            if r.returncode:
                sys.exit('lsregister failed: ' + (r.stderr or r.stdout))


def main():
    check = '--check' in sys.argv
    stale = []
    if engine_paths.IS_MAC:
        wire_mac(check, '--copy' in sys.argv, stale)
    else:
        wire_windows(check, stale)

    if not stale:
        print('runtime is wired for Vitre: nothing to do')
    elif check:
        print('out of date:\n  ' + '\n  '.join(stale))
        sys.exit(1)
    else:
        print('updated:\n  ' + '\n  '.join(stale))


if __name__ == '__main__':
    main()
