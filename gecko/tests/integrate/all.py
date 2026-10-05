"""Integration tests: the seven feature modules together (from gecko/):

    python tests/integrate/all.py [name ...] [--app build-x] [--no-build] [--jobs N]

  menus      right-click flows into the other modules: Peek link, Download linked file, Save image as,
             Find selection, Settings (Home menu and + circle), Show downloads; nothing native
  peek       find inside a peek (the capsule in the sheet's header), Ctrl+Q / promote, then Ctrl+Tab:
             the switcher shows the promoted tab with its picture
  pill       the active pill's right end with 0, 1, 3 and 8 extensions, with and without the download
             mark (a page with a video) and with a download running: the address stays centred at
             the pill's middle and readable
  settings   changes made in the Settings panel take effect live in every module: switcher style,
             Show the tab bar (auto-hide), Start pages below the tab bar, a rebind, the downloads
             folder; Settings > Extensions registered by the extensions module
  ladder     the Esc ladder with several layers open at once (menu over find over peek, and more)
  inset      the page top strip follows the bar's hiding mode (auto-hide, F11): no empty band, kept
             through a reveal, back afterwards; the PDF viewer's offset follows too
  services   every service is provided with the contracted members (and the documented additions)

The default build is `build-integrate` (every module), built first unless --no-build. A local HTTP
server serves tests/integrate/pages (and /out/ = tests/integrate/out/<name>) on 127.0.0.1, with
localhost as a second site; its base is passed as INTEG_BASE. Downloads go to
%TEMP%\\vitre-integrate\\<name> (vitre.downloadsFolder), never the user's Downloads folder.
The pill test installs the extensions test packages (tests/extensions/build, made by
tests/extensions/make-extensions.py when missing) as temporary add-ons.
Logs and captures: tests/integrate/out/<name>/ (log.txt, *.png). A run fails on FAIL, ERROR,
a timeout or a [console.error] line from Vitre's code.
"""
import functools
import http.server
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PY = sys.executable
OUT = os.path.join(HERE, 'out')
PAGES = os.path.join(HERE, 'pages')
EXT = os.path.join(ROOT, 'tests', 'extensions')

TESTS = {
    'services': ('services.js', 120),
    'inset': ('inset.js', 240),
    'menus': ('menus.js', 300),
    'peek': ('peek.js', 300),
    'pill': ('pill.js', 300),
    'settings': ('settings.js', 360),
    'ladder': ('ladder.js', 300),
}

TYPES = {'.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webm': 'video/webm',
         '.pdf': 'application/pdf', '.zip': 'application/zip', '.bin': 'application/octet-stream', '.js': 'text/javascript',
         '.css': 'text/css', '.txt': 'text/plain; charset=utf-8'}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        if path.startswith('/out/'):
            base, rel = OUT, path[len('/out/'):]
        else:
            base, rel = PAGES, path.lstrip('/')
        full = os.path.abspath(os.path.join(base, *[p for p in rel.split('/') if p]))
        if not full.startswith(os.path.abspath(base)) or not os.path.isfile(full):
            self.send_error(404)
            return
        with open(full, 'rb') as f:
            body = f.read()
        ext = os.path.splitext(full)[1].lower()
        try:
            self.send_response(200)
            self.send_header('Content-Type', TYPES.get(ext, 'application/octet-stream'))
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass

    def log_message(self, *args):
        pass


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def run(name, app, port):
    script, timeout = TESTS[name]
    out = os.path.join(OUT, name)
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out, exist_ok=True)
    dl = os.path.join(tempfile.gettempdir(), 'vitre-integrate', name)
    shutil.rmtree(dl, ignore_errors=True)
    os.makedirs(dl, exist_ok=True)
    cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, script), '--name', 'integ-' + name,
           '--app', app, '--out', out, '--timeout', str(timeout),
           '--env', 'INTEG_BASE=http://127.0.0.1:%d/' % port, '--env', 'INTEG_XSITE=http://localhost:%d/' % port,
           '--env', 'INTEG_DL=' + dl, '--env', 'INTEG_EXT=' + os.path.join(EXT, 'build', 'ext'),
           '--pref', 'vitre.downloadsFolder=' + dl,
           # No DRM plug-in downloads in a test run.
           '--pref', 'media.gmp-manager.updateEnabled=false', '--pref', 'media.gmp-manager.url=http://127.0.0.1:9/none']
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    text = r.stdout + r.stderr
    with open(os.path.join(out, 'run.txt'), 'w', encoding='utf-8') as f:
        f.write(text)
    lines = text.splitlines()
    passed = sum(1 for line in lines if line.startswith('PASS '))
    bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', '[console.error]')) or 'no window found' in line]
    ok = r.returncode == 0 and not bad
    return name, ok, passed, bad


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    args = sys.argv[1:]
    app = 'build-integrate'
    jobs = 1
    build = True
    names = []
    i = 0
    while i < len(args):
        a = args[i]
        if a == '--app':
            app = args[i + 1]
            i += 1
        elif a.startswith('--app='):
            app = a.split('=', 1)[1]
        elif a == '--jobs':
            jobs = int(args[i + 1])
            i += 1
        elif a == '--no-build':
            build = False
        else:
            names.append(a)
        i += 1
    names = names or list(TESTS)
    for n in names:
        if n not in TESTS:
            sys.exit('unknown test %s (have: %s)' % (n, ', '.join(TESTS)))
    if build and app == 'build-integrate':
        subprocess.run(['node', os.path.join(ROOT, 'tools', 'build.mjs'), '--out=build-integrate'], cwd=ROOT, check=True)
    if 'pill' in names and not os.path.exists(os.path.join(EXT, 'build', 'ext', 'popup')):
        subprocess.run([PY, os.path.join(EXT, 'make-extensions.py')], cwd=ROOT, check=True)
    os.makedirs(OUT, exist_ok=True)
    port = free_port()
    server = http.server.ThreadingHTTPServer(('', port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    ok_all = True
    try:
        with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
            for name, ok, passed, bad in pool.map(functools.partial(lambda n: run(n, app, port)), names):
                print('%-9s %s  (%d checks passed)' % (name, 'ok' if ok else 'FAILED', passed))
                for line in bad:
                    print('    ' + line[:600])
                ok_all &= ok
    finally:
        server.shutdown()
    print('ALL OK' if ok_all else 'SOME FAILED')
    sys.exit(0 if ok_all else 1)


if __name__ == '__main__':
    main()
