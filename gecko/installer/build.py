"""Build Deer's release: the release folder, Deer.exe, Uninstall.exe and Deer-Setup.exe.

  python installer/build.py --engine <engine folder> [options]
  python installer/build.py --dev-engine [options]          local tests only, never shipped

Run from anywhere; paths are relative to gecko/. Nothing outside gecko/installer/ is written except the
chrome package build (node tools/build.mjs --out=build-installer -> gecko/build-installer/).

Inputs
  --engine DIR      the engine: the Deer engine tools/setup-engine.py makes from Mozilla's UNBRANDED
                    build (engines/deer-runtime: deer.exe with Deer's identity compiled in, Deer's icon
                    and version strings, the firefox.exe placeholder media plug-ins need, Mozilla's
                    helper programs removed). Refused:
                    - an engine whose brand.ftl (browser/omni.ja) shows "Firefox" in any of its displayed
                      names (Firefox, Firefox Nightly, Firefox Developer Edition ...), one whose brand.ftl
                      cannot be read, and the local test copy: Mozilla's trademark policy forbids
                      shipping a modified build under the Firefox name. The unbranded 157 build reads
                      "Nightly" (checked 2026-10-05);
                    - an engine without deer-engine.json identity.app (the unbranded build itself, or a
                      Deer engine made with --stock-identity: it would keep its data in the installed
                      Firefox's %APPDATA%\\Mozilla\\Firefox);
                    - an engine for which tools/setup-engine.py --check fails (check_deer_engine below:
                      the same check, run against the unbranded build named in deer-engine.json and
                      the engine's own chrome package, so a junction pointing at any build folder is
                      fine; overlay files that changed since are not a reason either, because this
                      script copies tools/runtime-overlay over the engine anyway). That includes every
                      engine file against the list setup-engine.py recorded (size and SHA-256): an
                      engine missing a DLL (an interrupted copy, an antivirus quarantine), holding one
                      more, or with one changed is refused, and so is one whose record has no list;
                    - one whose deer-engine.json identity.launch asks for anything installer/Launcher.cs
                      does not do (arguments, variables, other variables to clear);
                    - one whose deer.exe does not carry the images of --icon (setup-engine.py --icon).
  --dev-engine      Use a copy of gecko/runtime (the branded Firefox the tests run on) made into
                    installer/work/dev-engine/ (made once; --refresh-dev-engine remakes it). The output
                    is named Deer-Setup-LOCALTEST.exe, carries DEV-ENGINE-DO-NOT-SHIP.txt and the
                    wizard says it must not be distributed. For testing the installer on this machine.
                    None of the --engine checks apply (it keeps Mozilla's identity).
  --check-engine    only run the --engine checks above and exit (0: the engine can be packaged)
  --app DIR         the chrome package (default: build it with node tools/build.mjs
                    --out=build-installer and use gecko/build-installer/); always copied, never linked
  --no-app-build    use gecko/build-installer/ as it is
  --icon FILE       the .ico of Deer.exe, Uninstall.exe, Deer-Setup.exe and the wizard's logo (default:
                    ICON below, the gold Deer icon). The engine's own icons are set where the engine is
                    made (setup-engine.py --icon for deer.exe, whose default is the same file;
                    tools/runtime-overlay for the window icons, gold and orange).
  --version X.Y.Z   default: "version" in gecko/package.json
  --publisher NAME  Apps & features "Publisher" (default: Deer)
  --url URL         project page for Apps & features (default: URL below, the GitHub repository;
                    its /releases page is the "update information" link; --url "" for none)
  --preset N        LZMA preset 0-9 (default 9)
  --block-mb N      payload block size in MB (default 16; see "Payload")
  --threads N       compression threads (default: the number of processors)
  --skip-setup      stop after the release folder (no payload, no Deer-Setup.exe)
  --sign-key FILE   sign SHA256SUMS.txt with the release key's private half (tools/release-key.mjs sign):
                    SHA256SUMS.txt.sig, a third release asset. Once gecko/update-key.txt exists, every
                    build carries its public half and installed copies accept only releases signed so;
                    a release build without --sign-key then says so (it cannot be published as an
                    update).

Outputs (installer/out/, git-ignored)
  Deer/                 the release folder = the installed layout:
                          Deer.exe, Uninstall.exe, release.ini, deer-version.json, [LICENSE.txt],
                          [THIRD-PARTY-NOTICES.txt] (the repository's LICENSE and THIRD-PARTY-NOTICES.md),
                          engine/ (the engine, engine/deer.exe, engine/vitre/ = the chrome package,
                          plus tools/runtime-overlay/: config.js, defaults/pref, policies, window icons)
  Deer-Setup.exe        the installer, with Deer/ embedded (see "Payload" below)
  SHA256SUMS.txt, [SHA256SUMS.txt.sig], build.json

deer-version.json is the machine-readable version of an install (Deer's updater reads it):
  {"product", "version", "build", "buildDate" (UTC, ISO 8601), "channel" ("release" | "local-test"),
   "engineVersion", "engineBuildId", "platform" ("win64"), "setup" (the asset name, Deer-Setup.exe)}

Engine files left out of the release: Mozilla's firefox.exe (engine/deer.exe is its copy; firefox.exe.sig
becomes deer.exe.sig so the CDM host check still matches; a Deer engine's small firefox.exe placeholder
is kept), Firefox's updater, maintenance service, default-browser agent, ping sender, crash reporter
UI, native-messaging proxy, private-browsing launcher, desktop launcher, uninstaller and install logs.
Each of those either starts firefox.exe without -profile, writes into Firefox's registrations, or talks
to Mozilla on Mozilla's behalf.

Payload: Deer-Setup.exe carries the release folder as a Deer package (format: the header of
installer/Package.cs) in a .NET manifest resource, with its SHA-256 in a second resource. One file to
download and sign (the payload sits inside the PE image, so an Authenticode signature covers it). The
package is LZMA1 from Python's own lzma module (no other tool): the files' bytes as one stream, the
.exe/.dll files first through the x86 BCJ filter, cut into independent blocks that the setup decodes
on several threads (Lzma.cs: a managed decoder, so the setup still needs nothing but the .NET
Framework 4.8 every Windows 10/11 has). Measured on the 157 engine: 90.7 MB with 16 MB blocks against
130.6 MB as a zip (32 MB blocks: 89.6 MB, 64 MB: 88.7 MB, at twice and four times the memory the setup
needs while unpacking). Windows maps the image lazily, so the resource is read straight from the
file; the setup checks the hash before it unpacks anything, and each block's CRC-32 after.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import importlib.util
import json
import lzma
import os
import re
import shutil
import struct
import subprocess
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
GECKO = os.path.dirname(HERE)
WORK = os.path.join(HERE, 'work')
OUT = os.path.join(HERE, 'out')
RUNTIME = os.path.join(GECKO, 'runtime')
OVERLAY = os.path.join(GECKO, 'tools', 'runtime-overlay')
# The gold Deer icon (tools/make-icon.py; the file keeps its old name on purpose). The same file is
# setup-engine.py's default --icon for deer.exe and the default window icon.
ICON = os.path.join(OVERLAY, 'browser', 'chrome', 'icons', 'default', 'vitre.ico')
URL = 'https://github.com/droidboy08-hub/deer'  # Apps & features: About, Help and (+ /releases) Update links
PACKAGE_DIR = 'vitre'  # engine/<this> = the chrome package; the name engine/config.js loads it from
DEV_MARKER = 'DEV-ENGINE-DO-NOT-SHIP.txt'
DEER_ENGINE_MARKER = 'deer-engine.json'  # written by tools/setup-engine.py
PLACEHOLDER_MAX = 64 * 1024  # a Deer engine's firefox.exe placeholder is a few KB; Mozilla's is ~1 MB
# What installer/Launcher.cs removes from the engine's environment (its ClearEnv; tools/setup-engine.py
# LAUNCH_CLEAR_ENV is the same list). An engine whose deer-engine.json identity.launch asks for more (or
# for arguments or variables) is refused.
LAUNCHER_CLEAR_ENV = ('XUL_APP_FILE', 'XRE_PROFILE_PATH', 'XRE_PROFILE_LOCAL_PATH', 'MOZ_NEW_INSTANCE')
NOTICES = os.path.join(GECKO, '..', 'THIRD-PARTY-NOTICES.md')  # -> <release>/THIRD-PARTY-NOTICES.txt

# Top-level engine entries that are not shipped (see the docstring).
EXCLUDE = {
    'firefox.exe', 'firefox.exe.sig', 'vitre.exe', PACKAGE_DIR, 'private_browsing.exe',
    'firefox.VisualElementsManifest.xml', 'private_browsing.VisualElementsManifest.xml',
    'updater.exe', 'updater.ini', 'update-settings.ini', 'maintenanceservice.exe',
    'maintenanceservice_installer.exe', 'default-browser-agent.exe', 'pingsender.exe',
    'crashreporter.exe', 'nmhproxy.exe', 'uninstall', 'desktop-launcher', 'install.log',
    'installation_telemetry.json', 'postSigningData', 'precomplete', 'removed-files', 'tobedeleted',
    DEV_MARKER,
}
REQUIRED = ['xul.dll', 'omni.ja', 'application.ini', 'platform.ini', os.path.join('browser', 'omni.ja')]


def log(*a):
    print('[build]', *a, flush=True)


def die(msg):
    sys.exit('[build] ERROR: ' + msg)


def csc_path():
    windir = os.environ.get('WINDIR', r'C:\Windows')
    for arch in ('Framework64', 'Framework'):
        p = os.path.join(windir, 'Microsoft.NET', arch, 'v4.0.30319', 'csc.exe')
        if os.path.exists(p):
            return p
    die('csc.exe (.NET Framework 4) not found')


def is_junction(path):
    try:
        return os.path.isjunction(path)
    except AttributeError:
        return bool(os.path.isdir(path) and os.lstat(path).st_file_attributes & 0x400)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def rmtree(path):
    if not os.path.lexists(path):
        return
    if is_junction(path):
        os.rmdir(path)  # the junction only, never its target
        return

    def retry(func, p, _exc):
        os.chmod(p, 0o666)  # read-only files
        func(p)
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=retry)
    else:
        shutil.rmtree(path, onerror=retry)


def check_icon(path):
    """An .ico file with at least one image, or die."""
    try:
        head = open(path, 'rb').read(6)
    except OSError as e:
        die('icon %s cannot be read: %s' % (path, e))
    reserved, kind, count = struct.unpack('<HHH', head) if len(head) == 6 else (1, 0, 0)
    if reserved != 0 or kind != 1 or count == 0:
        die('%s is not an .ico file' % path)


# ---- engine ---------------------------------------------------------------------------------------

def jar_entry(jar, name):
    """One stored or deflated entry of a Mozilla omni.ja (its optimised layout defeats zipfile)."""
    data = open(jar, 'rb').read()
    want = name.encode()
    for m in re.finditer(rb'PK\x03\x04', data):
        i = m.start()
        try:
            _v, _flags, method, _t, _d, _crc, csize, _usize, nlen, xlen = struct.unpack_from('<HHHHHIIIHH', data, i + 4)
        except struct.error:
            continue
        if data[i + 30:i + 30 + nlen] != want:
            continue
        body = data[i + 30 + nlen + xlen:i + 30 + nlen + xlen + csize]
        return zlib.decompress(body, -15) if method == 8 else body
    return None


def engine_brands(engine):
    """{'-brand-short-name': ..., '-brand-full-name': ..., ...} from the engine's brand.ftl, or None."""
    ftl = jar_entry(os.path.join(engine, 'browser', 'omni.ja'), 'localization/en-US/branding/brand.ftl')
    if ftl is None:
        return None
    return {m.group(1): m.group(2).strip() for m in re.finditer(r'^(-brand-[\w-]+)\s*=\s*(.+)$', ftl.decode('utf-8', 'replace'), re.M)}


def engine_brand(engine):
    brands = engine_brands(engine)
    return brands.get('-brand-short-name') if brands else None


def ini_value(path, section, key):
    cur = None
    try:
        for line in open(path, encoding='utf-8', errors='replace'):
            line = line.strip()
            if line.startswith('['):
                cur = line.strip('[]')
            elif cur == section and line.lower().startswith(key.lower() + '='):
                return line.split('=', 1)[1].strip()
    except OSError:
        pass
    return ''


def make_dev_engine(refresh):
    dev = os.path.join(WORK, 'dev-engine')
    if os.path.exists(os.path.join(dev, DEV_MARKER)) and not refresh:
        log('dev engine: reusing', dev)
        return dev
    if not os.path.exists(os.path.join(RUNTIME, 'firefox.exe')):
        die('gecko/runtime/firefox.exe is missing: nothing to copy for --dev-engine')
    rmtree(dev)
    log('dev engine: copying gecko/runtime ->', dev)

    def ignore(folder, names):
        if os.path.normcase(os.path.abspath(folder)) == os.path.normcase(RUNTIME):
            return [n for n in names if n in (PACKAGE_DIR, 'vitre.exe')]  # the dev junction and dev exe
        return [n for n in names if is_junction(os.path.join(folder, n))]
    shutil.copytree(RUNTIME, dev, ignore=ignore)
    with open(os.path.join(dev, DEV_MARKER), 'w', encoding='utf-8') as f:
        f.write('This engine is a copy of gecko/runtime: Mozilla\'s BRANDED Firefox.\n'
                'It exists only to test the installer on a developer machine. Never ship it or any\n'
                'installer built from it. Releases use Mozilla\'s unbranded build (build.py --engine).\n')
    return dev


def check_engine(engine, dev):
    for rel in REQUIRED:
        if not os.path.exists(os.path.join(engine, rel)):
            die('%s is not a Gecko engine folder: %s is missing' % (engine, rel))
    if not (os.path.exists(os.path.join(engine, 'deer.exe')) or os.path.exists(os.path.join(engine, 'firefox.exe'))):
        die('%s has neither deer.exe nor firefox.exe' % engine)
    real = os.path.normcase(os.path.realpath(engine))
    if real == os.path.normcase(os.path.realpath(RUNTIME)):
        die('gecko/runtime is the branded development runtime and is never packaged (use --dev-engine for a local test copy)')
    brands = engine_brands(engine)
    brand = brands.get('-brand-short-name') if brands else None
    marked = os.path.exists(os.path.join(engine, DEV_MARKER))
    # The names the browser shows itself under. Any "Firefox" there (Firefox, Firefox Nightly, Firefox
    # Developer Edition...) is Mozilla's mark; -brand-product-name (the name of the platform, used in
    # "Firefox account" style strings) stays "Firefox" in the unbranded build and is not checked.
    shown = [brands.get(k) or '' for k in ('-brand-shorter-name', '-brand-short-name', '-brand-full-name', '-brand-shortcut-name')] if brands else []
    if not dev:
        if marked:
            die('the engine in %s carries %s: it is the local test copy of the branded runtime' % (engine, DEV_MARKER))
        if not brand:
            die('the engine\'s branding could not be read from %s (browser/omni.ja, localization/en-US/branding/brand.ftl): '
                'refusing to package an engine that may carry the Firefox name' % engine)
        if any('firefox' in s.lower() for s in shown):
            die('the engine in %s is branded Firefox (brand.ftl: %s): Mozilla\'s trademark policy forbids shipping it. '
                'Use the unbranded build.' % (engine, ', '.join(s for s in shown if s)))
    return brand


def media_placeholder(engine):
    """The firefox.exe placeholder of a Deer engine made by tools/setup-engine.py, or None. Media
    plug-ins (ClearKey, Widevine, OpenH264) fail without a non-empty firefox.exe next to the engine;
    setup-engine.py writes a small stand-in there. Mozilla's own firefox.exe is never shipped."""
    p = os.path.join(engine, 'firefox.exe')
    if not (os.path.exists(os.path.join(engine, DEER_ENGINE_MARKER)) and os.path.exists(os.path.join(engine, 'deer.exe'))):
        return None
    if os.path.exists(p) and 0 < os.path.getsize(p) <= PLACEHOLDER_MAX:
        return p
    return None


def load_setup_engine():
    """tools/setup-engine.py as a module (its --check and resource readers)."""
    spec = importlib.util.spec_from_file_location('setup_engine', os.path.join(GECKO, 'tools', 'setup-engine.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def ico_images(path):
    """The image data of each entry of an .ico file."""
    data = open(path, 'rb').read()
    _reserved, _kind, count = struct.unpack_from('<HHH', data, 0)
    out = []
    for i in range(count):
        _w, _h, _c, _r, _p, _b, size, offset = struct.unpack_from('<BBBBHHII', data, 6 + 16 * i)
        out.append(data[offset:offset + size])
    return out


def check_deer_engine(engine, icon):
    """What a release engine must be (the docstring's --engine refusals after the brand check): the
    output of tools/setup-engine.py with Deer's identity, still complete. Dies with the reason, else
    returns notes for the log."""
    meta_path = os.path.join(engine, DEER_ENGINE_MARKER)
    redo = 'Make it again: python tools/setup-engine.py --out %s' % engine
    if not os.path.exists(meta_path):
        die('%s has no %s: a release engine is made from Mozilla\'s unbranded build by tools/setup-engine.py '
            '(python tools/setup-engine.py --engine <the unbranded build> --out engines/deer-runtime)' % (engine, DEER_ENGINE_MARKER))
    try:
        meta = json.load(open(meta_path, encoding='utf-8'))
    except ValueError:
        die('%s cannot be read (an interrupted setup-engine.py run?). %s' % (meta_path, redo))
    identity = meta.get('identity') or {}
    if not identity.get('app'):
        die('the engine in %s has no Deer identity (%s identity.app is empty: made with --stock-identity, or before '
            'setup-engine.py gave engines their own identity). It would keep its data with the installed Firefox. %s' % (engine, DEER_ENGINE_MARKER, redo))
    launch = identity.get('launch') or {}
    extra = [n for n in launch.get('clearEnv') or [] if n not in LAUNCHER_CLEAR_ENV]
    if launch.get('args') or launch.get('env') or extra:
        die('%s identity.launch asks for %s, but installer/Launcher.cs passes no arguments or variables and clears only %s' % (
            DEER_ENGINE_MARKER, json.dumps(launch), ', '.join(LAUNCHER_CLEAR_ENV)))
    source = os.path.normpath(os.path.join(GECKO, (meta.get('engine') or {}).get('folder') or ''))
    if not os.path.exists(os.path.join(source, 'application.ini')) or not os.path.exists(os.path.join(source, 'firefox.exe')):
        die('the unbranded build %s was made from (%s engine.folder: %s) is not there: setup-engine.py --check compares against it' % (
            engine, DEER_ENGINE_MARKER, source))
    se = load_setup_engine()
    # setup-engine.py --check, with the engine's own chrome package as --app (a junction is compared with
    # its own target, a copy with itself): the package is never shipped from the engine (copy_engine
    # leaves it out and puts --app in its place), so wherever it points is fine.
    link = os.path.join(engine, PACKAGE_DIR)
    if is_junction(link):
        app, copy = os.path.realpath(link), False
    else:
        app, copy = link, True
    media = 'stub' if os.path.lexists(os.path.join(engine, 'firefox.exe')) else 'none'
    problems = se.check(source, engine, app, copy, False, media)
    overlay = {os.path.normcase(os.path.relpath(os.path.join(f, n), OVERLAY)) for f, _d, names in os.walk(OVERLAY) for n in names}
    stale_overlay = [p for p in problems if os.path.normcase(p) in overlay]
    package = [p for p in problems if p.startswith(PACKAGE_DIR + ' (')]
    real = [p for p in problems if p not in stale_overlay and p not in package]
    if real:
        die('the engine in %s fails tools/setup-engine.py --check (against %s):\n  %s\n%s' % (engine, source, '\n  '.join(real), redo))
    notes = ['setup-engine.py --check: a Deer engine for %s' % os.path.relpath(source, GECKO)]
    if stale_overlay:
        notes.append('overlay files changed since the engine was made (copied fresh into the release anyway): ' + ', '.join(stale_overlay))
    if media == 'none':
        notes.append('the engine has no firefox.exe placeholder (setup-engine.py --media-host none): media plug-ins will not work')
    # deer.exe's icon: the images of --icon, as setup-engine.py --icon puts them in.
    exe_images = {data for _n, _l, data in se.read_resources(os.path.join(engine, 'deer.exe'), se.RT_ICON)}
    missing = [i for i, img in enumerate(ico_images(icon)) if img not in exe_images]
    if missing:
        die('engine\\deer.exe does not carry the icon %s (%d of its images are missing): its icon came from another file. '
            'Make the engine again with it: python tools/setup-engine.py --out %s --icon %s' % (icon, len(missing), engine, icon))
    notes.append('deer.exe carries the images of ' + os.path.relpath(icon, GECKO))
    return notes


def copy_engine(engine, dest):
    def ignore(folder, names):
        skip = [n for n in names if is_junction(os.path.join(folder, n))]
        if os.path.normcase(os.path.abspath(folder)) == os.path.normcase(os.path.abspath(engine)):
            skip += [n for n in names if n in EXCLUDE]
        return skip
    shutil.copytree(engine, dest, ignore=ignore)
    exe = os.path.join(dest, 'deer.exe')
    if not os.path.exists(exe):
        shutil.copyfile(os.path.join(engine, 'firefox.exe'), exe)
        sig = os.path.join(engine, 'firefox.exe.sig')
        if os.path.exists(sig):
            shutil.copyfile(sig, os.path.join(dest, 'deer.exe.sig'))
    placeholder = media_placeholder(engine)
    if placeholder:
        shutil.copyfile(placeholder, os.path.join(dest, 'firefox.exe'))
    # Everything Vitre/Deer adds to the engine (the same files tools/setup-runtime.py installs).
    for folder, _dirs, files in os.walk(OVERLAY):
        for name in files:
            src = os.path.join(folder, name)
            dst = os.path.join(dest, os.path.relpath(src, OVERLAY))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
    return placeholder


# ---- chrome package -------------------------------------------------------------------------------

def chrome_package(args):
    if args.app:
        app = os.path.abspath(args.app)
    else:
        app = os.path.join(GECKO, 'build-installer')
        if not args.no_app_build:
            log('chrome package: node tools/build.mjs --out=build-installer')
            r = subprocess.run(['node', os.path.join('tools', 'build.mjs'), '--out=build-installer'], cwd=GECKO)
            if r.returncode:
                die('the chrome package build failed')
    if not os.path.exists(os.path.join(app, 'chrome.manifest')):
        die('no chrome.manifest in %s' % app)
    return app


# ---- C# -------------------------------------------------------------------------------------------

def cs_string(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'


def numeric_version(v):
    parts = [int(p) for p in re.findall(r'\d+', v.split('-')[0].split('+')[0])][:4]
    while len(parts) < 4:
        parts.append(0)
    return '.'.join(str(p) for p in parts)


def build_info(path, title, description, a, with_class):
    year = datetime.datetime.now(datetime.timezone.utc).year
    lines = [
        '// Generated by installer/build.py. Do not edit.',
        'using System.Reflection;',
        '[assembly: AssemblyTitle(%s)]' % cs_string(title),
        '[assembly: AssemblyDescription(%s)]' % cs_string(description),
        '[assembly: AssemblyCompany(%s)]' % cs_string(a.publisher),
        '[assembly: AssemblyProduct("Deer")]',
        '[assembly: AssemblyCopyright(%s)]' % cs_string('Copyright %d %s. MPL-2.0.' % (year, a.publisher)),
        '[assembly: AssemblyVersion(%s)]' % cs_string(numeric_version(a.version)),
        '[assembly: AssemblyFileVersion(%s)]' % cs_string(numeric_version(a.version)),
        '[assembly: AssemblyInformationalVersion(%s)]' % cs_string(a.version + (' (local test build)' if a.dev_engine else '')),
    ]
    if with_class:
        lines += [
            'namespace Deer.Setup',
            '{',
            '    static class BuildInfo',
            '    {',
            '        public const string Version = %s;' % cs_string(a.version),
            '        public const string Build = %s;' % cs_string(a.build_id),
            '        public const string Publisher = %s;' % cs_string(a.publisher),
            '        public const string Url = %s;' % cs_string(a.url or ''),
            # static readonly, not const: a const false makes the release build warn about unreachable code
            '        public static readonly bool DevEngine = %s;' % ('true' if a.dev_engine else 'false'),
            '    }',
            '}',
        ]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


def csc(out, sources, manifest, icon, refs=(), resources=(), target='winexe'):
    cmd = [csc_path(), '/nologo', '/target:' + target, '/platform:anycpu', '/optimize+', '/warn:4', '/codepage:65001',
           '/win32icon:' + icon, '/win32manifest:' + manifest, '/out:' + out]
    cmd += ['/r:' + r for r in refs]
    cmd += ['/resource:%s,%s' % (path, name) for path, name in resources]
    cmd += sources
    r = subprocess.run(cmd, capture_output=True, text=True)
    text = (r.stdout + r.stderr).strip()
    if text:
        print(text)
    if r.returncode:
        die('csc failed for ' + os.path.basename(out))
    log('compiled', os.path.relpath(out, HERE), '(%d KB)' % (os.path.getsize(out) // 1024))


SETUP_SOURCES = ['Setup.cs', 'SetupUi.cs', 'Shell.cs', 'EngineTraces.cs', 'Lzma.cs', 'Package.cs']
SETUP_REFS = ['System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll']


def compile_launcher(a, out):
    info = os.path.join(WORK, 'gen', 'launcher', 'BuildInfo.cs')
    build_info(info, 'Deer', 'Deer web browser', a, False)
    csc(out, [os.path.join(HERE, 'Launcher.cs'), os.path.join(HERE, 'ProfileMigration.cs'), info], os.path.join(HERE, 'Launcher.manifest'), a.icon)


def compile_setup(a, out, title, resources=()):
    info = os.path.join(WORK, 'gen', title.replace(' ', '-').lower(), 'BuildInfo.cs')
    build_info(info, title, title, a, True)
    csc(out, [os.path.join(HERE, s) for s in SETUP_SOURCES] + [info], os.path.join(HERE, 'Setup.manifest'), a.icon,
        SETUP_REFS, list(resources) + [(a.icon, 'deer.ico')])


# ---- payload --------------------------------------------------------------------------------------

PE_TYPES = ('.exe', '.dll')
LZMA_PROPS = (3, 0, 2)  # lc, lp, pb: LZMA's defaults (byte-aligned code gains nothing from others here)


def payload_order(release):
    """(empty folders, files in stream order): .exe/.dll first (they go through the x86 filter), then
    the rest; within each group by extension and name, so similar files sit next to each other."""
    dirs, files = [], []
    for folder, subdirs, names in os.walk(release):
        subdirs.sort()
        rel_dir = os.path.relpath(folder, release)
        if not names and not subdirs and rel_dir != '.':
            dirs.append(rel_dir.replace('\\', '/'))
        for name in names:
            p = os.path.join(folder, name)
            files.append((p, os.path.relpath(p, release).replace('\\', '/')))

    def key(item):
        rel = item[1]
        ext = os.path.splitext(rel)[1].lower()
        return (0 if ext in PE_TYPES else 1, ext, os.path.basename(rel).lower(), rel.lower())
    files.sort(key=key)
    return sorted(dirs), files


def compress_block(data, x86, preset):
    filters = ([{'id': lzma.FILTER_X86}] if x86 else []) + [{
        'id': lzma.FILTER_LZMA1, 'preset': preset, 'lc': LZMA_PROPS[0], 'lp': LZMA_PROPS[1], 'pb': LZMA_PROPS[2],
        'dict_size': max(1 << 16, min(len(data), 64 << 20))}]
    return lzma.compress(bytes(data), format=lzma.FORMAT_RAW, filters=filters)


def make_payload(release, path, block_size=16 << 20, preset=9, threads=None, log=log):
    """Writes the release folder as a Deer package (format: installer/Package.cs) to `path`."""
    dirs, files = payload_order(release)
    threads = threads or os.cpu_count() or 4
    jobs = []  # (x86, uncompressed size, crc32, future)
    with concurrent.futures.ThreadPoolExecutor(threads) as pool:  # lzma releases the GIL while it works
        for x86 in (True, False):
            group = [f for f in files if (os.path.splitext(f[1])[1].lower() in PE_TYPES) == x86]
            buf = bytearray()

            def flush():
                if buf:
                    data = bytes(buf)
                    jobs.append((x86, len(data), zlib.crc32(data) & 0xFFFFFFFF, pool.submit(compress_block, data, x86, preset)))
                    buf.clear()
                    pending = [j[3] for j in jobs if not j[3].done()]
                    if len(pending) > 2 * threads:  # bound the uncompressed data waiting in memory
                        concurrent.futures.wait(pending[:len(pending) - 2 * threads])
            for p, _rel in group:
                with open(p, 'rb') as f:
                    while True:
                        chunk = f.read(block_size - len(buf))
                        if not chunk:
                            break
                        buf += chunk
                        if len(buf) >= block_size:
                            flush()
            flush()
        packed = [job[3].result() for job in jobs]
    lines = ['deer-package\t1']
    lines += ['dir\t' + d for d in dirs]
    unpacked = 0
    for p, rel in files:
        st = os.stat(p)
        lines.append('file\t%d\t%d\t%s' % (st.st_size, st.st_mtime_ns // 100 + 116444736000000000, rel))
        unpacked += st.st_size
    for (x86, size, crc, _f), data in zip(jobs, packed):
        lines.append('block\t%s\t%d\t%d\t%d\t%d\t%d\t%08x' % ('x86+lzma' if x86 else 'lzma', LZMA_PROPS[0], LZMA_PROPS[1], LZMA_PROPS[2],
                                                            len(data), size, crc))
    manifest = ('\n'.join(lines) + '\n').encode('utf-8')
    if os.path.exists(path):
        os.remove(path)
    with open(path, 'wb') as out:
        out.write(b'DEERPKG1' + struct.pack('<I', len(manifest)) + manifest)
        for data in packed:
            out.write(data)
    # The setup refuses install folders too long for the deepest file (classic Windows path limits).
    longest = max([len(rel) for _p, rel in files] + [len(d) for d in dirs] + [0])
    return {'files': len(files), 'dirs': len(dirs), 'blocks': len(jobs), 'unpacked': unpacked, 'packed': sum(len(d) for d in packed),
            'longest': longest, 'x86Blocks': sum(1 for j in jobs if j[0])}


# ---- main -----------------------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--engine')
    p.add_argument('--dev-engine', action='store_true')
    p.add_argument('--refresh-dev-engine', action='store_true')
    p.add_argument('--check-engine', action='store_true')
    p.add_argument('--app')
    p.add_argument('--no-app-build', action='store_true')
    p.add_argument('--icon', default=ICON)
    p.add_argument('--version')
    p.add_argument('--publisher', default='Deer')
    p.add_argument('--url', default=URL)
    p.add_argument('--preset', type=int, default=9, choices=range(10))
    p.add_argument('--block-mb', type=int, default=16)
    p.add_argument('--threads', type=int, default=0)
    p.add_argument('--skip-setup', action='store_true')
    p.add_argument('--sign-key')
    a = p.parse_args()
    # DEER_UPDATE_KEY_FILE (tests only, as for tools/release-key.mjs) stands in for gecko/update-key.txt.
    update_key = os.environ.get('DEER_UPDATE_KEY_FILE') or os.path.join(GECKO, 'update-key.txt')
    if a.sign_key and not os.path.exists(update_key):
        die('--sign-key needs gecko/update-key.txt, the public half every build carries (node tools/release-key.mjs new <private key file>)')
    if a.sign_key and a.skip_setup:
        die('--sign-key signs SHA256SUMS.txt, which --skip-setup does not write')
    if bool(a.engine) == bool(a.dev_engine):
        die('give exactly one of --engine <engine folder> or --dev-engine')
    if a.check_engine and not a.engine:
        die('--check-engine checks an --engine')
    if not 1 <= a.block_mb <= 256:
        die('--block-mb must be 1..256')
    if not a.version:
        a.version = json.load(open(os.path.join(GECKO, 'package.json'), encoding='utf-8'))['version']
    now = datetime.datetime.now(datetime.timezone.utc)
    a.build_id = '%s+%s' % (a.version, now.strftime('%Y%m%d.%H%M%S'))
    a.icon = os.path.abspath(a.icon)
    check_icon(a.icon)

    os.makedirs(WORK, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    engine = make_dev_engine(a.refresh_dev_engine) if a.dev_engine else os.path.abspath(a.engine)
    brand = check_engine(engine, a.dev_engine)
    if not a.dev_engine:
        for n in check_deer_engine(engine, a.icon):
            log('engine: ' + n)
        if a.check_engine:
            log('the engine in %s can be packaged (brand %s)' % (engine, brand))
            return
    app = chrome_package(a)
    log('version', a.version, 'build', a.build_id, '| engine', engine, '| brand', brand, '| app', app, '| icon', a.icon)

    # ---- release folder ----
    release = os.path.join(OUT, 'Deer')
    rmtree(release)
    os.makedirs(release)
    log('release folder: copying the engine')
    placeholder = copy_engine(engine, os.path.join(release, 'engine'))
    if placeholder:
        log('kept the Deer engine\'s firefox.exe placeholder for media plug-ins (%d bytes)' % os.path.getsize(placeholder))
    elif not a.dev_engine:
        log('note: the engine in %s has no firefox.exe placeholder: media plug-ins (Widevine, OpenH264, ClearKey) will not work' % engine)
    shutil.copytree(app, os.path.join(release, 'engine', PACKAGE_DIR), ignore=lambda f, n: [x for x in n if is_junction(os.path.join(f, x))])
    compile_launcher(a, os.path.join(release, 'Deer.exe'))
    compile_setup(a, os.path.join(release, 'Uninstall.exe'), 'Deer Uninstaller')
    engine_version = ini_value(os.path.join(engine, 'application.ini'), 'App', 'Version')
    engine_build = ini_value(os.path.join(engine, 'application.ini'), 'App', 'BuildID')
    # The .sig files are what a DRM module's host check reads (Widevine VMP). Mozilla's unbranded build
    # ships none, so DRM-protected video is not expected to play in such a release (not tested).
    engine_signed = os.path.exists(os.path.join(engine, 'firefox.exe.sig')) or os.path.exists(os.path.join(engine, 'deer.exe.sig'))
    if not engine_signed:
        log('note: the engine has no firefox.exe.sig / xul.dll.sig (DRM host-check files); DRM video playback is not expected to work')
    channel = 'local-test' if a.dev_engine else 'release'
    with open(os.path.join(release, 'release.ini'), 'w', encoding='utf-8', newline='\r\n') as f:
        f.write('[Deer]\nVersion=%s\nBuild=%s\nChannel=%s\nEngineVersion=%s\nEngineBuildID=%s\nEngineBrand=%s\n' % (
            a.version, a.build_id, channel, engine_version, engine_build, brand or ''))
    setup_name = 'Deer-Setup-LOCALTEST.exe' if a.dev_engine else 'Deer-Setup.exe'
    version_info = {'product': 'Deer', 'version': a.version, 'build': a.build_id, 'buildDate': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
                    'channel': channel, 'engineVersion': engine_version, 'engineBuildId': engine_build, 'platform': 'win64',
                    'setup': setup_name}
    with open(os.path.join(release, 'deer-version.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(version_info, f, indent=2)
        f.write('\n')
    for lic in (os.path.join(GECKO, '..', 'LICENSE'), os.path.join(GECKO, 'LICENSE')):
        if os.path.exists(lic):
            shutil.copyfile(lic, os.path.join(release, 'LICENSE.txt'))
            break
    # The notices of the bundled components (among them the MIT-licensed CityHash port in Deer-Setup.exe
    # and Uninstall.exe, whose licence asks for its notice in every copy).
    if os.path.exists(NOTICES):
        shutil.copyfile(NOTICES, os.path.join(release, 'THIRD-PARTY-NOTICES.txt'))
    elif not a.dev_engine:
        die('%s is missing: a release carries it as THIRD-PARTY-NOTICES.txt' % os.path.normpath(NOTICES))
    if a.dev_engine:
        shutil.copyfile(os.path.join(engine, DEV_MARKER), os.path.join(release, DEV_MARKER))
    log('release folder ready:', release)

    result = {'version': a.version, 'build': a.build_id, 'buildDate': version_info['buildDate'], 'devEngine': a.dev_engine, 'engine': engine,
              'engineBrand': brand, 'engineVersion': engine_version, 'engineBuildID': engine_build, 'engineSigFiles': engine_signed,
              'mediaPlaceholder': bool(placeholder), 'app': app, 'icon': a.icon, 'url': a.url, 'release': release}
    if not a.skip_setup:
        pkg = os.path.join(WORK, 'payload.bin')
        for stale in ('payload.zip',):
            if os.path.exists(os.path.join(WORK, stale)):
                os.remove(os.path.join(WORK, stale))
        t0 = datetime.datetime.now()
        log('payload: LZMA preset %d, %d MB blocks, %d threads' % (a.preset, a.block_mb, a.threads or os.cpu_count() or 4))
        info = make_payload(release, pkg, a.block_mb << 20, a.preset, a.threads or None)
        digest = sha256(pkg)
        ini = os.path.join(WORK, 'payload.ini')
        with open(ini, 'w', encoding='utf-8') as f:
            f.write('Version=%s\nBuild=%s\nFormat=deer-package-1\nSha256=%s\nPayloadBytes=%d\nUnpacked=%d\nFiles=%d\nBlocks=%d\nLongestPath=%d\nDevEngine=%d\n' % (
                a.version, a.build_id, digest, os.path.getsize(pkg), info['unpacked'], info['files'], info['blocks'], info['longest'],
                1 if a.dev_engine else 0))
        log('payload: %d files, %.1f MB unpacked, %.1f MB packed in %d blocks (%d through the x86 filter) in %.0f s, sha256 %s' % (
            info['files'], info['unpacked'] / 1048576, os.path.getsize(pkg) / 1048576, info['blocks'], info['x86Blocks'],
            (datetime.datetime.now() - t0).total_seconds(), digest))
        setup = os.path.join(OUT, setup_name)
        stale = os.path.join(OUT, 'Deer-Setup.exe' if a.dev_engine else 'Deer-Setup-LOCALTEST.exe')
        if os.path.exists(stale):
            os.remove(stale)
        compile_setup(a, setup, 'Deer Setup', [(pkg, 'payload.bin'), (ini, 'payload.ini')])
        setup_sha = sha256(setup)
        sums = os.path.join(OUT, 'SHA256SUMS.txt')
        if os.path.exists(sums + '.sig'):
            os.remove(sums + '.sig')  # never a signature of an earlier build's file
        with open(sums, 'w', encoding='utf-8', newline='\n') as f:
            f.write('%s  %s\n' % (setup_sha, os.path.basename(setup)))
        if a.sign_key:
            r = subprocess.run(['node', os.path.join(GECKO, 'tools', 'release-key.mjs'), 'sign', sums, os.path.abspath(a.sign_key)],
                               capture_output=True, text=True)
            if r.returncode:
                die('signing SHA256SUMS.txt failed: ' + (r.stderr or r.stdout).strip())
            result['sumsSigned'] = True
            log('signed SHA256SUMS.txt with the release key: SHA256SUMS.txt.sig (publish it with the setup and SHA256SUMS.txt)')
        elif os.path.exists(update_key) and not a.dev_engine:
            log('WARNING: SHA256SUMS.txt is not signed (no --sign-key), but builds carry the release key (gecko/update-key.txt): '
                'installed copies of Deer will refuse this release as an update')
        result.update({'setup': setup, 'setupSha256': setup_sha, 'setupBytes': os.path.getsize(setup), 'payloadSha256': digest,
                       'payloadBytes': os.path.getsize(pkg), 'payloadFormat': 'deer-package-1', 'payloadBlocks': info['blocks'],
                       'unpackedBytes': info['unpacked'], 'files': info['files']})
        log('setup: %s (%.1f MB) sha256 %s' % (setup, os.path.getsize(setup) / 1048576, setup_sha))
    with open(os.path.join(OUT, 'build.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2)
    if a.dev_engine:
        log('LOCAL TEST BUILD: it contains the branded Firefox engine. Never distribute it.')


if __name__ == '__main__':
    main()
