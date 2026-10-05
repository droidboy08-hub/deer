"""Run the menus tests (from gecko/):  python tests/menus/all.py [name ...] [--app build-x]

  pages     every page context on local pages: link (wash, every action), mail / phone / file /
            javascript links, image, image link, canvas, selection (Search for, Go to, Find),
            editable, password, misspelled word (spelling in a textarea and a rich field), video,
            audio, a frame, the page; rows of absent services left out; right-click outside reopens,
            click outside is absorbed, wheel / tab switch close; a page that replaces the menu and
            Shift+right-click; edge flipping; Inspect
  keyboard  menus opened by the real keyboard path (WM_CONTEXTMENU): placement on a focused link, at
            the caret (flipping up), under a selection, with nothing focused; the first row focused,
            access keys underlined; arrows, Home / End, Tab, Enter, Space, access keys, Esc / Alt /
            F10; keys never reach the page or Vitre's shortcuts; a keyboard menu on a tab circle
  chrome    Vitre's own menus: the active pill, a background circle (caption), the + circle, the
            address field, Home; their actions; the drag strip and window controls keep Windows'
            system menu; the 'menus' service (points, elements, alignments, nested rows listed in
            place under a caption (no submenus), onClose)
  ext       a local temporary extension with the menus permission: page items under the
            extension's caption (its nested items listed in place), a checkbox, tab items in the
            circle menu; clicked, cleaned up
  look      material and motion: frost measured over stripes (on vs off), light theme, the raised
            tint over a dark page, reduced motion, the open motion mid-flight, the boards' scenes
            (MenuGallery, MenuSelection, MenuSpelling, MenuChrome) at 1440 x 900
  real      a real site (en.wikipedia.org): link, image, selection, page, keyboard menu
  integration  with every module in the tree (build-menus-full, no stand-ins): Peek link opens a real
            peek, the peek page menu, the peek header and find field menus drawn through the service,
            Find selection, Settings and Show downloads
Without names all of them run. The menus-only build (build-menus, node tools/build.mjs
--out=build-menus --modules=menus) and the full one (--out=build-menus-full) are made first. Captures and logs are in tests/menus/out/ (log-<name>.txt).
Test pages are served by a local HTTP server started here (tests/menus is its root, so the output
folder is reachable at /out/). 'real' needs the network.
"""
import functools
import http.server
import os
import subprocess
import sys
import threading

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PY = sys.executable
RUN = [PY, os.path.join(ROOT, 'tools', 'run.py')]
T = os.path.join(ROOT, 'tests', 'menus')
OUT = os.path.join(T, 'out')

TESTS = {
    'pages': ('pages.js', 420),
    'keyboard': ('keyboard.js', 300),
    'chrome': ('chrome.js', 300),
    'ext': ('ext.js', 240),
    'look': ('look.js', 300),
    'real': ('real.js', 240),
    'integration': ('integration.js', 240),
}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def serve():
    handler = functools.partial(Quiet, directory=T)
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def report(name, returncode, text):
    lines = text.splitlines()
    passed = sum(1 for line in lines if line.startswith('PASS '))
    bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', '[console.error]')) or 'no window found' in line]
    print('%-9s %s  (%d checks passed)' % (name, 'ok' if returncode == 0 else 'FAILED', passed))
    for line in bad:
        print('    ' + line[:600])
    with open(os.path.join(OUT, 'log-%s.txt' % name), 'w', encoding='utf-8') as f:
        f.write(text)
    return returncode == 0


def main():
    args = sys.argv[1:]
    app = ['--app', 'build-menus']
    if '--app' in args:
        i = args.index('--app')
        app = ['--app', args[i + 1]]
        del args[i:i + 2]
    names = args or list(TESTS)
    os.makedirs(OUT, exist_ok=True)
    custom_app = app != ['--app', 'build-menus']
    if not custom_app:
        for cmd in (['node', os.path.join(ROOT, 'tools', 'build.mjs'), '--out=build-menus', '--modules=menus'],
                    ['node', os.path.join(ROOT, 'tools', 'build.mjs'), '--out=build-menus-full']):
            if subprocess.run(cmd, cwd=ROOT, capture_output=True).returncode:
                sys.exit('build failed: ' + ' '.join(cmd[2:]))
    httpd = serve()
    base = 'http://127.0.0.1:%d/' % httpd.server_address[1]
    ok = True
    try:
        for name in names:
            if name not in TESTS:
                sys.exit('no such test: %s (have: %s)' % (name, ', '.join(TESTS)))
            script, timeout = TESTS[name]
            r = subprocess.run(RUN + ['--test', os.path.join(T, script), '--name', 'menus-' + name, '--timeout', str(timeout), '--out', OUT,
                                      '--env', 'VITRE_MENUS_BASE=' + base] + (['--app', 'build-menus-full'] if name == 'integration' and not custom_app else app),
                               cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
            ok &= report(name, r.returncode, r.stdout + r.stderr)
            if name == 'look':
                c = subprocess.run([PY, os.path.join(T, 'check.py'), os.path.join(OUT, 'log-look.txt')], cwd=ROOT, capture_output=True, text=True)
                print(c.stdout.rstrip())
                ok &= c.returncode == 0
    finally:
        httpd.shutdown()
    for f in os.listdir(OUT):
        if f.endswith('.done'):
            os.remove(os.path.join(OUT, f))
    print('ALL OK' if ok else 'SOME FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
