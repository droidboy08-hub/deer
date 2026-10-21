"""Run every Settings test, one after the other (from gecko/):

  python tests/settings/all.py [name ...] [--no-build] [--port N] [--app build-x]

  pages      every page captured (dark and light), controls wired live, Find a setting, the page
             registry (the 'settings' service), the panel's keys, a small window
  rebind     Keyboard shortcuts: capture with refusals, the new key working in the key router, Reset
  clear      Clear browsing data through Firefox's Sanitizer: the last hour, then all time
  picker     Home's background through the REAL Windows file dialog, Home's Background popover, and
             the downloads folder through the real folder dialog
  appicon    Appearance › App icon: the tiles, open and new windows switching icon, a test shortcut
             following (never a real one)
  wallpapers the picker's Deer wallpapers group (the "Get wallpapers" flow of 2026-10-21) against a
             local stand-in for GitHub Pages (wallpaper_server.py on 127.0.0.1:<port>, default
             47981; nothing listens on <port>+1): nothing asked before a Get button is clicked (Home,
             both tabs, Find a setting, the popover); Credits; the site down, a 1.2 MB index, a
             redirect, a version 1 index: one plain failure line, nothing written; Get on the main
             collection item after item ("Getting N of 8…"), checked thumbnails as faces, names and
             credits, "Check for new wallpapers"; a tile applied at once; a double-click and a quick
             second click do not stop a Get; switching to the Video tab does not either; a second
             click and leaving (Settings closed) stop it; the network failing mid-way (a body cut off
             before its Content-Length) stops it; downloads that do not check out refused; the owner
             changing the collection (new, changed, no longer listed: removed but the current
             background); Remove from the right-click menu, Shift+F10 and the Menu key; the popover;
             live wallpapers (videos: posters, Home playing one muted and looping, bad videos refused,
             one stopped while it streams, a tile whose file has gone chosen during a Get of its kind);
             no Cookie / Referer / Origin sent, no cookie stored. After a restart (the site down):
             offline tiles, leftovers gone, Deer 0.1.5-0.1.8's files moved into the new layout when its
             wallpapers.json vouches for them (the rest gone), its current background kept until a
             Get brings the same file. After another restart: a video of that version as Home's
             background, Remove on it; a junction in the folder: nothing written or removed through it

The module is built with the menus module only (a Deer wallpaper's Remove menu) into build-settings
(node tools/build.mjs --out=build-settings --modules=settings,menus), so other authors' half-written
modules cannot get in the way; --no-build skips it.
--app build-x builds into (and runs) build-x instead, with profile names ending in -build-x, so two
sessions can run this at once (give each its own --port too). Without names all of them run. Each
run prints only its failures and a summary line; logs and captures are in tests/settings/out/. No
test reaches the internet (tools/run.py points Deer wallpapers at a local port nothing serves; the
wallpapers test at its stand-in).
"""
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PY = sys.executable
T = os.path.join(ROOT, 'tests', 'settings')

TESTS = [
    ('pages', 'settings-pages', 260),
    ('rebind', 'settings-rebind', 200),
    ('clear', 'settings-clear', 200),
    ('picker', 'settings-picker', 240),
    ('appicon', 'settings-appicon', 160),
    ('wallpapers', 'settings-wallpapers', 600),
]


def main():
    args = sys.argv[1:]
    port = 47981
    if '--port' in args:
        i = args.index('--port')
        port = int(args[i + 1])
        del args[i:i + 2]
    app = 'build-settings'
    if '--app' in args:
        i = args.index('--app')
        app = args[i + 1]
        del args[i:i + 2]
    run = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--app', app]
    names = [a for a in args if not a.startswith('--')]
    unknown = [n for n in names if n not in [t[0] for t in TESTS]]
    if unknown:
        print('unknown test(s): ' + ', '.join(unknown))
        return 2
    picked = [t for t in TESTS if not names or t[0] in names]
    if '--no-build' not in args:
        r = subprocess.run('node tools/build.mjs --out=%s --modules=settings,menus' % app, cwd=ROOT, shell=True, capture_output=True, text=True)
        print((r.stdout + r.stderr).strip().splitlines()[-1] if (r.stdout + r.stderr).strip() else 'build: no output')
        if r.returncode != 0:
            print(r.stdout + r.stderr)
            return 1
    server = None
    if any(t[0] == 'wallpapers' for t in picked):
        server = subprocess.Popen([PY, os.path.join(T, 'wallpaper_server.py'), '--port', str(port)], stdout=subprocess.PIPE, text=True)
        line = server.stdout.readline().strip()
        if not line.startswith('ready'):
            print('the wallpaper stand-in did not start: ' + line)
            server.kill()
            return 1
    ok = True
    try:
        for script, name, timeout in picked:
            extra = []
            if script == 'wallpapers':
                extra = ['--env', 'WPTEST_ORIGIN=http://127.0.0.1:%d' % port, '--env', 'WPTEST_DOWN=http://127.0.0.1:%d' % (port + 1)]
            if app != 'build-settings':
                name = '%s-%s' % (name, app)
            r = subprocess.run(run + ['--test', os.path.join(T, script + '.js'), '--name', name, '--timeout', str(timeout)] + extra, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
            lines = (r.stdout + r.stderr).splitlines()
            passed = sum(1 for line in lines if line.startswith('PASS '))
            bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', '[console.error]'))]
            good = r.returncode == 0
            ok &= good
            print('%-10s %s  (%d checks passed)' % (script, 'ok' if good else 'FAILED', passed))
            for line in bad:
                print('    ' + line)
            if script == 'wallpapers':
                with open(os.path.join(T, 'out', 'log-wallpapers.txt'), 'w', encoding='utf-8') as f:
                    f.write('\n'.join(lines) + '\n')
    finally:
        if server:
            server.kill()
            server.wait()
    print('all ok' if ok else 'FAILURES')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
