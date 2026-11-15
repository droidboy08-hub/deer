"""The OS-neutral half of the test harness behind tools/run.py: the test prefs, the throwaway
profile, the environment that wires the test script in (config.js step 4: VITRE_BOOT, VITRE_LIB,
VITRE_LOG, VITRE_OUT, VITRE_APP_DIR, the "vitre-harness" marker), the arguments and the run loop
that reads the script's log. PREFS, png() and pref_value() are run.py's own, moved here unchanged.

main(ns, doc) is given the platform half, harness/win.py or harness/mac.py, as `ns`, and calls only
these names of it:
  PLATFORM                    'win' or 'mac'
  PREFS                       the test prefs (this file's PREFS, plus the platform's own)
  PACKAGE                     the chrome package the engine loads when --app is not given
  CLEAR_ENV                   variables never passed on to the engine
  engine(a)                   the engine to start, checked (SystemExit when it is not set up)
  temp_dir()                  where throwaway profiles go
  command(exe, profile, args, url)   the engine's command line
  preflight()                 before a run whose captures are certain (--shoot): stop when they cannot work
  Tree(pid), stale_pids(profile), kill(pids), crash(pids)   the engine's processes
  remove_profile(profile), link_app(profile, build)
  find_window(pids), window_handle(text), is_window(handle, tree), shoot(handle, out, name, identity)
  loaded_modules(pids, text, image)
"""
import argparse
import json
import os
import re
import struct
import subprocess
import time
import zlib

# gecko/: this file is gecko/tools/harness/common.py.
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# Test-only prefs. Product defaults live in runtime/defaults/pref/vitre-prefs.js.
PREFS = {
    # Deterministic start: one blank tab, no restored session, no crash-recovery page after a kill.
    'browser.startup.page': 0,
    'browser.startup.homepage': 'about:blank',
    'browser.sessionstore.resume_from_crash': False,
    # Gecko treats the window as active without OS focus (other windows are open on this desktop).
    'focusmanager.testmode': True,
    # Pages render in the light colour scheme whatever the desktop theme is (1 = light): tests that
    # sample the glass theme over a real site (example.com follows the system scheme) compare colours.
    'layout.css.prefers-color-scheme.content-override': 1,
    # Parallel runs overlap on screen; keep rendering when covered so captures stay real.
    'widget.windows.window_occlusion_tracking.enabled': False,
    'browser.dom.window.dump.enabled': True,
    'devtools.chrome.enabled': True,
    'devtools.debugger.remote-enabled': True,
    'browser.tabs.remote.warmup.enabled': True,
    # Local test extensions.
    'extensions.autoDisableScopes': 0,
    'xpinstall.signatures.required': False,
    # Belt and braces for the stock interface (--stock, old spikes): the product defaults set these too.
    'browser.shell.checkDefaultBrowser': False,
    'browser.shell.customIcon.enabled': False,
    'browser.privacySegmentation.createdShortcut': True,
    'browser.aboutwelcome.enabled': False,
    'browser.startup.homepage_override.mstone': 'ignore',
    'datareporting.policy.dataSubmissionEnabled': False,
    'termsofuse.bypassNotification': True,
    # Safe Browsing's remote download lookup (a request to Google for every finished program) would
    # make download tests wait on the network; the local lists are still checked
    # (src/modules/downloads/reputation.ts).
    'browser.safebrowsing.downloads.remote.enabled': False,
    # Deer wallpapers (src/modules/VitreWallpapers.sys.ts) would read the collection from GitHub Pages
    # when a test clicks the background picker's "Get wallpapers": a port nothing serves instead (Necko
    # refuses port 9 outright), so a Get fails at once. tests/settings/wallpapers.js sets its own.
    'vitre.wallpapers.base': 'http://127.0.0.1:9/',
}


def png(path, w, h, bgra):
    rows = bytearray()
    stride = w * 4
    for y in range(h):
        row = bytearray(bgra[y * stride:(y + 1) * stride])
        row[0::4], row[2::4] = row[2::4], row[0::4]
        row[3::4] = b'\xff' * w
        rows += b'\x00' + row

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(bytes(rows), 6)) + chunk(b'IEND', b''))


def pref_value(text):
    if text in ('true', 'false'):
        return text == 'true'
    if re.fullmatch(r'-?\d+', text):
        return int(text)
    return text  # includes decimals: Gecko has no float prefs, they are strings (layout.css.devPixelsPerPx)


def parse_args(doc, mac):
    """run.py's command line. --exe is Windows-only; --no-capture exists on macOS only."""
    ap = argparse.ArgumentParser(description=doc, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--test', '--boot', dest='test')
    ap.add_argument('--name', required=True)
    ap.add_argument('--url', default='about:blank')
    ap.add_argument('--out')
    ap.add_argument('--app')
    ap.add_argument('--timeout', type=float, default=90)
    ap.add_argument('--pref', action='append', default=[])
    ap.add_argument('--env', action='append', default=[])
    ap.add_argument('--arg', action='append', default=[], help='extra runtime argument')
    ap.add_argument('--shoot', action='append', default=[], help='NAME:SECONDS')
    ap.add_argument('--keep-profile', action='store_true')
    ap.add_argument('--stock', action='store_true')
    ap.add_argument('--identity', action='store_true')
    ap.add_argument('--until-exit', action='store_true')
    if mac:
        ap.add_argument('--exe', default=None, help='Windows only')
        ap.add_argument('--no-capture', action='store_true',
                        help='take no screenshots: @@capture and --shoot are answered without one')
    else:
        ap.add_argument('--exe', default='vitre.exe')
    return ap.parse_args()


def main(ns, doc):
    a = parse_args(doc, ns.PLATFORM == 'mac')
    no_capture = getattr(a, 'no_capture', False)

    if not re.fullmatch(r'[\w.-]+', a.name):
        raise SystemExit('--name may only contain letters, digits, ".", "_" and "-"')
    if not a.test and not a.shoot:
        raise SystemExit('give --test SCRIPT, or --shoot NAME:SECONDS to run without a script')
    exe = ns.engine(a)

    test = os.path.abspath(a.test) if a.test else None
    if test and not os.path.exists(test):
        raise SystemExit('no such test script: ' + test)
    out = os.path.abspath(a.out or os.path.join(os.path.dirname(test) if test else ROOT, 'out'))
    os.makedirs(out, exist_ok=True)
    profile = os.path.join(ns.temp_dir(), 'vitre-gecko-' + a.name)
    if a.shoot and not no_capture:
        ns.preflight()

    ns.kill(ns.stale_pids(profile))
    if not a.keep_profile and os.path.exists(profile):
        ns.remove_profile(profile)
    os.makedirs(profile, exist_ok=True)
    for f in os.listdir(out):
        if f.endswith('.done'):
            os.remove(os.path.join(out, f))

    prefs = dict(ns.PREFS)
    # What Deer downloads for the person (ffmpeg, yt-dlp, Deno) lives in %LOCALAPPDATA%\Deer, older
    # copies in %LOCALAPPDATA%\Vitre: a test looks in a folder inside its own profile instead, so it
    # never reads the person's real copies (src/modules/downloads/ffmpeg-install.ts).
    prefs['vitre.localAppData'] = os.path.join(profile, 'LocalAppData')
    for p in a.pref:
        k, v = p.split('=', 1)
        prefs[k] = pref_value(v)
    with open(os.path.join(profile, 'user.js'), 'w', encoding='utf-8') as f:
        for k, v in prefs.items():
            f.write('user_pref(%s, %s);\n' % (json.dumps(k), json.dumps(v)))
    # First-start values go into prefs.js, which Gecko reads once and then owns (user.js would force
    # them again after every restart, so a test could not change them for good). The bar stays on
    # screen: Deer's default is auto-hide since 2026-10-06, but most tests click and capture the bar.
    # Tests of auto-hide turn it on themselves; tests/shell/chrome.js checks the default.
    first_start = os.path.join(profile, 'prefs.js')
    if not os.path.exists(first_start):
        with open(first_start, 'w', encoding='utf-8') as f:
            f.write('user_pref("vitre.barAutoHide", false);\n')
    # config.js honours VITRE_BOOT / VITRE_LIB / VITRE_APP_DIR only in a profile that carries this marker.
    open(os.path.join(profile, 'vitre-harness'), 'w').close()

    log = os.path.join(out, 'log.txt')
    open(log, 'w').close()
    env = dict(os.environ, VITRE_LOG=log, VITRE_OUT=out, VITRE_ALLOW_ANY_PROFILE='1',
               MOZ_CRASHREPORTER_DISABLE='1', MOZ_DISABLE_AUTO_SAFE_MODE='1')
    for name in ('VITRE_BOOT', 'VITRE_LIB', 'VITRE_APP_DIR', 'VITRE_DISABLE') + tuple(ns.CLEAR_ENV):
        env.pop(name, None)
    if test:
        env.update(VITRE_BOOT=test, VITRE_LIB=os.path.join(ROOT, 'tools', 'spike-lib.js'))
    if a.stock:
        env['VITRE_DISABLE'] = '1'
    if a.app:
        build = os.path.abspath(os.path.join(ROOT, a.app))
        if not os.path.exists(os.path.join(build, 'chrome.manifest')):
            raise SystemExit('no chrome.manifest in %s (run: node tools/build.mjs --out=%s)' % (build, a.app))
        # config.js loads the package from VITRE_APP_DIR (harness profiles only); on macOS it also
        # adds the link's real folder to the content sandbox (security.sandbox.content.mac.testing_read_path2).
        env['VITRE_APP_DIR'] = ns.link_app(profile, build)
    elif not a.stock and not os.path.exists(os.path.join(ns.PACKAGE, 'chrome.manifest')):
        raise SystemExit('nothing built: run  node tools/build.mjs')
    for e in a.env:
        k, v = e.split('=', 1)
        env[k] = v

    shots = sorted(((float(s.rsplit(':', 1)[1]), s.rsplit(':', 1)[0]) for s in a.shoot))
    cmd = ns.command(exe, profile, a.arg, a.url)
    started = time.time()
    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tree = ns.Tree(proc.pid)
    seen = 0
    failed = 0
    deadline = started + a.timeout
    quit_seen = False
    last_poll = 0.0
    try:
        while time.time() < deadline and not quit_seen:
            time.sleep(0.1)
            now = time.time()
            if now - last_poll > 0.5:
                last_poll = now
                tree.alive()
            while shots and now - started >= shots[0][0]:
                _at, name = shots.pop(0)
                if no_capture:
                    print('[capture] %s: skipped (--no-capture)' % name)
                    continue
                hwnd = ns.find_window(tree.alive())
                if hwnd:
                    ns.shoot(hwnd, out, name, a.identity)
                else:
                    print('[capture] %s: no window found' % name)
                    failed += 1
            if not test:
                if not shots:
                    quit_seen = True
                continue
            with open(log, encoding='utf-8', errors='replace') as f:
                lines = f.read().split('\n')[:-1]
            for line in lines[seen:]:
                if line.startswith('@@capture '):
                    parts = line[10:].split()
                    name = parts[0]
                    if no_capture:
                        print('[capture] %s: skipped (--no-capture)' % name)
                    else:
                        hwnd = ns.window_handle(parts[1]) if len(parts) > 1 else None
                        if not hwnd or not ns.is_window(hwnd, tree):
                            hwnd = ns.find_window(tree.alive())
                        if hwnd and len(parts) > 6 and parts[2] == 'screen' and hasattr(ns, 'shoot_screen'):
                            ns.shoot_screen(hwnd, tree.alive(), [int(p) for p in parts[3:7]], out, name)
                        elif hwnd:
                            ns.shoot(hwnd, out, name, a.identity)
                        else:
                            print('[capture] %s: no window found' % name)
                            failed += 1
                    open(os.path.join(out, name + '.png.done'), 'w').close()
                elif line.startswith('@@modules '):
                    text = line[10:].strip()
                    pids = tree.alive()
                    found = ns.loaded_modules(pids, text, os.path.basename(exe))
                    print('[modules] "%s" in %d %s processes: %s' % (
                        text, len(pids), os.path.basename(exe), ', '.join('%s (pid %s)' % (d, '/'.join(map(str, p))) for d, p in sorted(found.items())) or 'none loaded'))
                    open(os.path.join(out, 'modules.done'), 'w').close()
                elif line.startswith('@@quit'):
                    quit_seen = True
                elif line.startswith('@@pid '):
                    tree.adopt(line[6:].strip())
                elif line.startswith('@@kill'):
                    # A crash, for tests of what survives one (tests/downloads/network.js): no shutdown
                    # runs; then the same start as above, on the same profile.
                    tree.adopt(line[6:].strip())
                    ns.crash(tree.alive())
                    for _ in range(100):
                        if not tree.alive():
                            break
                        time.sleep(0.1)
                    time.sleep(1.0)
                    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    tree = ns.Tree(proc.pid)
                    print('[kill] the runtime was terminated and started again')
                else:
                    if re.match(r'(FAIL|ERROR)\b', line):
                        failed += 1
                    print(line)
            seen = len(lines)
            if a.until_exit and seen and not quit_seen and not tree.alive():
                # Lines written just before the exit, after the read above.
                with open(log, encoding='utf-8', errors='replace') as f:
                    rest = f.read().split('\n')[:-1][seen:]
                for line in rest:
                    if re.match(r'(FAIL|ERROR)\b', line):
                        failed += 1
                    if not line.startswith('@@'):
                        print(line)
                print('[run] the runtime exited by itself')
                quit_seen = True
        if not quit_seen:
            print('[run] timed out after %ss' % a.timeout)
            failed += 1
    finally:
        time.sleep(0.5)
        ns.kill(tree.alive())
        proc.poll()
        if not a.keep_profile:
            # A used profile is about 280 MB; hundreds of runs fill the disk.
            time.sleep(0.5)
            ns.remove_profile(profile)
    return 1 if failed else 0
