"""Install Deer on this Mac as /Applications/Deer.app, made from the development engine.

  python3 tools/mac/install-app.py [--to <folder>] [--no-build]

Not a release: no .dmg, no notarisation (the Mac release is a later phase). It is the engine that
tools/setup-runtime.py wires as runtime/Deer Dev.app, made to stand on its own as "Deer", so the
owner can start Deer from the Dock, Finder, Spotlight or Launchpad like any app and keep it while the
repo changes. Run it again to install a newer build: the old Deer.app is replaced.

What it does:
  1. node tools/build.mjs (unless --no-build) and tools/setup-runtime.py, so the dev engine has the
     current overlay, Deer's icon and no crash reporter;
  2. copies runtime/Deer Dev.app (ditto: links, modes and the ad-hoc signature as they are) to a
     staging bundle beside the destination;
  3. Contents/Resources/vitre: a real copy of gecko/build in place of the dev bundle's link to it. The
     installed app cannot reach into the repo, and sandboxed content processes read only inside the
     bundle;
  4. Contents/Info.plist: CFBundleName and CFBundleDisplayName "Deer", CFBundleIdentifier
     io.github.droidboy08-hub.deer (the dev one ends in .dev: the two are separate apps with their
     own privacy grants and settings), CFBundleShortVersionString Deer's version (gecko/package.json),
     LSEnvironment XRE_PROFILE_PATH = ~/Library/Application Support/Deer/Profile and
     MOZ_CRASHREPORTER_DISABLE=1: a start from the Dock, Finder, `open` or a clicked link opens Deer's
     own profile, never the development one and never ~/Library/Application Support/Firefox. The
     strings people see (Get Info, the privacy prompts' reasons) say "Deer", in the plist and in
     every *.lproj/InfoPlist.strings. Nothing is re-signed (setup-runtime.py step 5 says why);
  5. ~/Library/Application Support/Deer/Profile and its vitre-profile marker (config.js runs in no
     profile without it);
  6. com.apple.quarantine off the staged bundle, then it takes the destination's place. An existing
     <folder>/Deer.app is replaced only when it is Deer (this identifier) and not running; anything
     else of that name is left alone and the install stops;
  7. LaunchServices registers the new bundle (lsregister -f), which reads its name, identifier and icon.

The engine itself is the same build as the dev one (Mozilla's unbranded Firefox 157, never to be
published as it is). Python 3.9 or later; macOS only.
"""
import argparse
import importlib.util
import json
import os
import plistlib
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
GECKO = os.path.dirname(TOOLS)
BUILD = os.path.join(GECKO, 'build')

NAME = 'Deer'
BUNDLE_ID = 'io.github.droidboy08-hub.deer'
PROFILE = os.path.join(os.path.expanduser('~'), 'Library', 'Application Support', 'Deer', 'Profile')


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(cmd, what):
    r = subprocess.run(cmd, cwd=GECKO)
    if r.returncode:
        sys.exit('%s failed (exit %d): %s' % (what, r.returncode, ' '.join(cmd)))


def bundle_id(app):
    try:
        with open(os.path.join(app, 'Contents', 'Info.plist'), 'rb') as f:
            return plistlib.load(f).get('CFBundleIdentifier')
    except (OSError, plistlib.InvalidFileException, ValueError):
        return None


def running_from(app):
    """The pids of processes whose program lies inside `app`."""
    r = subprocess.run(['/bin/ps', '-axo', 'pid=,comm='], capture_output=True, text=True)
    inside = os.path.realpath(app) + '/'
    pids = []
    for line in r.stdout.splitlines():
        pid, _, comm = line.strip().partition(' ')
        if comm.strip().startswith(inside) or comm.strip().startswith(app + '/'):
            pids.append(pid)
    return pids


def rebrand(setup, text):
    """The dev name, or the engine's own, replaced by Deer's: "Deer Dev 157.0" -> "Deer 157.0"."""
    return setup.STOCK_NAME.sub(NAME, text).replace(setup.MAC_NAME, NAME)


def main():
    ap = argparse.ArgumentParser(description='Install Deer as <folder>/Deer.app (macOS).')
    ap.add_argument('--to', default='/Applications', help='the folder Deer.app goes in (default /Applications)')
    ap.add_argument('--no-build', action='store_true', help='use gecko/build as it is')
    args = ap.parse_args()
    if sys.platform != 'darwin':
        sys.exit('macOS only')

    setup = load('setup_runtime', os.path.join(TOOLS, 'setup-runtime.py'))
    engine_paths = setup.engine_paths
    folder = os.path.abspath(args.to)
    dest = os.path.join(folder, NAME + '.app')
    stage = os.path.join(folder, '.' + NAME + '.app.installing')
    old = os.path.join(folder, '.' + NAME + '.app.replaced')

    # Look at what is there before anything changes.
    if not os.path.isdir(folder):
        sys.exit('no folder %s' % folder)
    if os.path.lexists(dest):
        found = bundle_id(dest)
        if found != BUNDLE_ID:
            sys.exit('%s exists and is not Deer (identifier %r): move it away first' % (dest, found))
        pids = running_from(dest)
        if pids:
            sys.exit('Deer is running from %s (pid %s): quit it (Deer > Quit Deer), then run this again'
                     % (dest, ', '.join(pids)))
    for leftover in (stage, old):
        if os.path.lexists(leftover):
            if bundle_id(leftover) not in (BUNDLE_ID, setup.MAC_BUNDLE_ID):
                sys.exit('%s exists and is not a Deer bundle this script left: move it away first' % leftover)
            shutil.rmtree(leftover)

    # 1. the chrome package and the dev engine, current
    if not args.no_build:
        run([shutil.which('node') or 'node', 'tools/build.mjs'], 'the build')
    if not os.path.isfile(os.path.join(BUILD, 'chrome.manifest')):
        sys.exit('%s holds no chrome package: run  node tools/build.mjs  first' % BUILD)
    run([sys.executable, os.path.join(TOOLS, 'setup-runtime.py')], 'setup-runtime.py')
    with open(os.path.join(GECKO, 'package.json'), encoding='utf-8') as f:
        version = json.load(f)['version']

    # 2. a staged copy of the dev bundle
    print('copying %s' % engine_paths.ENGINE_APP)
    run(['/usr/bin/ditto', engine_paths.ENGINE_APP, stage], 'ditto')
    try:
        res = os.path.join(stage, 'Contents', 'Resources')

        # 3. the chrome package, copied in
        package = os.path.join(res, 'vitre')
        if os.path.islink(package) or os.path.isfile(package):
            os.remove(package)
        elif os.path.isdir(package):
            shutil.rmtree(package)
        shutil.copytree(BUILD, package)

        # 4. name, identifier, version, environment, and the strings people see
        plist_path = os.path.join(stage, 'Contents', 'Info.plist')
        with open(plist_path, 'rb') as f:
            raw = f.read()
        info = plistlib.loads(raw)
        env = dict(info.get('LSEnvironment') or {})
        env.update({'XRE_PROFILE_PATH': PROFILE, 'MOZ_CRASHREPORTER_DISABLE': '1'})
        info.update({'CFBundleName': NAME, 'CFBundleDisplayName': NAME, 'CFBundleIdentifier': BUNDLE_ID,
                     'CFBundleShortVersionString': version, 'LSEnvironment': env})
        for k, v in list(info.items()):
            if isinstance(v, str) and setup.shown_string(k):
                info[k] = rebrand(setup, v)
        fmt = plistlib.FMT_BINARY if raw.startswith(b'bplist00') else plistlib.FMT_XML
        setup.write_checked(plist_path, plistlib.dumps(info, fmt=fmt, sort_keys=False), raw)
        for lproj in sorted(os.listdir(res)):
            path = os.path.join(res, lproj, 'InfoPlist.strings')
            if not (lproj.endswith('.lproj') and os.path.isfile(path)):
                continue
            data, bom, encoding, text = setup.read_strings(path)
            new = text
            for k in ('CFBundleName', 'CFBundleDisplayName'):
                new = setup.strings_entry(k).sub(lambda m: m.group(1) + NAME + m.group(3), new)
            for k in sorted(set(setup.STRINGS_KEY.findall(new))):
                if setup.shown_string(k):
                    new = setup.strings_entry(k).sub(lambda m: m.group(1) + rebrand(setup, m.group(2)) + m.group(3), new)
            if new != text:
                setup.write_checked(path, bom + new.encode(encoding), data)

        # 5. Deer's profile and its marker
        os.makedirs(PROFILE, exist_ok=True)
        open(os.path.join(PROFILE, 'vitre-profile'), 'ab').close()

        # 6. quarantine off, then into place
        files = setup.quarantined(stage)
        for i in range(0, len(files), 200):
            subprocess.run(['/usr/bin/xattr', '-d', '-s', 'com.apple.quarantine'] + files[i:i + 200], capture_output=True)
        # The programs are the dev bundle's, byte for byte (their ad-hoc, linker-made signatures with
        # them). Not codesign --verify: Mozilla's build fails it as it comes ("code has no resources but
        # signature indicates they must be present") and runs all the same, as the dev bundle does.
        if not setup.same_tree(engine_paths.BIN_DIR, os.path.join(stage, 'Contents', 'MacOS')):
            sys.exit('the staged Contents/MacOS differs from %s' % engine_paths.BIN_DIR)
        if os.path.lexists(dest):
            os.rename(dest, old)
        os.rename(stage, dest)
    except BaseException:
        if os.path.lexists(stage):
            shutil.rmtree(stage, ignore_errors=True)
        if os.path.lexists(old) and not os.path.lexists(dest):
            os.rename(old, dest)
        raise
    if os.path.lexists(old):
        shutil.rmtree(old)

    # 7. LaunchServices
    os.utime(dest, None)
    r = subprocess.run([setup.LSREGISTER, '-f', dest], capture_output=True, text=True)
    if r.returncode:
        sys.exit('installed, but lsregister failed: ' + (r.stderr or r.stdout))
    print('installed %s (Deer %s, %s), profile %s' % (dest, version, BUNDLE_ID, PROFILE))


if __name__ == '__main__':
    main()
