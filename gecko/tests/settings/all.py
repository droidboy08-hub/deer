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
  wallpapers the picker's Deer wallpapers group against a local stand-in for GitHub Pages
             (wallpaper_server.py on 127.0.0.1:<port>, default 47981; nothing listens on <port>+1):
             no request before a Photo tab shows; the site down, empty, a manifest over 1 MiB, a
             redirect: no group; a slow manifest asked once though Settings closed before it
             answered; bad entries skipped; thumbnails checked, 3 at a time, one that cannot be
             decoded tried once; choose, download, check, Home shows it, not among the recent photos,
             downloaded once; progress and a superseded download; wrong hash / size / not a JPEG /
             404 refused with the tile's line and nothing written; a note, then a Deer wallpaper: the
             Photo tab stays; the popover; the open picker following changes made elsewhere, its tab
             stops through a download; the manifest once per 10 minutes; Find a setting; a wallpaper
             taken out of the collection; pruning; no Cookie / Referer / Origin sent, no cookie
             stored; after a restart: leftovers of cut-short writes removed, with the site down the
             cached group; then live wallpapers (videos, the clip live-wallpaper.mp4): the Video
             tab's own group (no "Add a video" note meanwhile), a clip three days long listed,
             choose, download, check, Home plays it muted and looping (wrapping past the end),
             progress and a superseded download, not an MP4 / an AVIF picture / wrong hash / endless
             body refused, the 2 videos chosen last kept, a video taken out of the collection; after
             another restart Home plays it again on the entry's colour, the popover's focus on its
             tile wholly in view, and an id listed as a photo, then a video, then the photo again:
             each tab's tile fetches, applies and keeps only its own kind's file

The module is built alone into build-settings (node tools/build.mjs --out=build-settings
--modules=settings) so other authors' half-written modules cannot get in the way; --no-build skips it.
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
        r = subprocess.run('node tools/build.mjs --out=%s --modules=settings' % app, cwd=ROOT, shell=True, capture_output=True, text=True)
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
