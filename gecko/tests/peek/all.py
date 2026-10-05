"""Run the Peek tests (from gecko/):  python tests/peek/all.py [name ...] [--app build-peek] [--keep]

Serves tests/peek/pages on two local origins (127.0.0.1 and localhost, so a peek can switch
process) and runs each script with tools/run.py, the page base in VITRE_PEEK_BASE (and the other
origin in VITRE_PEEK_XSITE). Build first:  node tools/build.mjs --out=build-peek

  open        Shift+click and Ctrl+Q open a sheet (geometry, header, dim, inset off in the sheet,
              motion frames), the address field's Shift+Enter, target=_blank / window.open inside
              the sheet, the Shift+click setting, tab switch (warm close), Ctrl+Shift+T reopen,
              Alt+Left on the first page, the header back button, the closed-tab list
  hop         Shift+click on the dimmed page swaps the content in place (snapshot cross-fade, no
              history), close by a click on the dim (wash, focus back on the link)
  promote     Open as tab keeps the page (same browsing context and process, no load, counter and
              typed text kept), the new pill right of its source, the inset back, header double-click,
              promote over Home, outside selection of the peek's tab
  esc         Esc (page first), Esc Esc on a page that keeps Esc, the nudge after typing, key repeat,
              a lower Esc layer, Ctrl+W, a click on the dim
  real        a real site (Wikipedia) in a peek and promoted
  permission  a geolocation prompt from a peek shows at once, hanging from the header; alert() stays
              in the sheet
  fullscreen  element full screen asked from a peek promotes it first
  session     a restart with a peek open: no orphan tab, nothing for Ctrl+Shift+T
  extras      the one-time discovery hint, F6 through the sheet, find's header slot, the header menu
              (through the menus service), the sheet on resize and in a small window, page keys on
              the peek, a peeked link that is a download
Logs and captures: tests/peek/out/<name>/ (log.txt, *.png).
"""
import functools
import http.server
import os
import socket
import subprocess
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
GECKO = os.path.abspath(os.path.join(HERE, '..', '..'))

TESTS = {
    'open': 240,
    'hop': 180,
    'promote': 240,
    'esc': 200,
    'real': 200,
    'permission': 180,
    'fullscreen': 180,
    'session': 240,
    'extras': 240,
}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        # no-cache (revalidate) rather than no-store: no-store pages are kept out of the bfcache.
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def serve():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    handler = functools.partial(Quiet, directory=os.path.join(HERE, 'pages'))
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, port


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    app = 'build-peek'
    for a in sys.argv[1:]:
        if a.startswith('--app='):
            app = a.split('=', 1)[1]
    keep = '--keep' in sys.argv
    names = args or list(TESTS)
    srv, port = serve()
    base = 'http://127.0.0.1:%d/' % port
    xsite = 'http://localhost:%d/' % port
    ok = True
    try:
        for name in names:
            if name not in TESTS:
                print('unknown test', name)
                ok = False
                continue
            out = os.path.join(HERE, 'out', name)
            os.makedirs(out, exist_ok=True)
            cmd = [sys.executable, os.path.join(GECKO, 'tools', 'run.py'), '--test', os.path.join(HERE, name + '.js'),
                   '--name', 'peek-t-' + name, '--app', app, '--url', base + 'issues.html', '--out', out,
                   '--timeout', str(TESTS[name]), '--env', 'VITRE_PEEK_BASE=' + base, '--env', 'VITRE_PEEK_XSITE=' + xsite]
            if keep:
                cmd.append('--keep-profile')
            p = subprocess.run(cmd, cwd=GECKO, capture_output=True, text=True, encoding='utf-8', errors='replace')
            text = p.stdout + p.stderr
            with open(os.path.join(out, 'run.txt'), 'w', encoding='utf-8') as f:
                f.write(text)
            lines = text.splitlines()
            passed = sum(1 for line in lines if line.startswith('PASS '))
            bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', '[capture]', 'Traceback', '[console.error]'))]
            print('%-11s %s  (%d checks passed)' % (name, 'ok' if p.returncode == 0 else 'FAILED', passed))
            for line in bad:
                print('    ' + line[:600])
            ok = ok and p.returncode == 0
    finally:
        srv.shutdown()
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
