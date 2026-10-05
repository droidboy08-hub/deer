"""Run the find-in-page tests (from gecko/):  python tests/find/all.py [name ...] [--app build-x]

  core       the battery on a local page served over http with a cross-site (out-of-process) frame:
             open from the page and from the field, live search, counts, steps (Enter, Shift+Enter,
             F3, Ctrl+G, buttons), wrap, match case, no matches, empty field, pre-fill from a selection,
             close keeping the match selected and its link focused, Ctrl+F back to the same match,
             Ctrl+Enter, parked find and the Esc ladder, F6 both ways, F3 with find closed, Ctrl+L,
             Home, a tab switch, the count limit text, the landing ring, the scroll guard (and the
             parked tint over fixed content), anchor jumps below the bar (scroll-padding-top), match
             colours, the field menu hook, the native findbar never created; captures of each state
  contexts   a dark page, the bar hidden (auto-hide), a PDF (file:, pdf.js through the stand-in), a long
             Wikipedia article (network), reload and navigation
  peek       find in a peek: the capsule in the sheet header (the real 'peek' service when the peek
             module is built in, else a stand-in service over the visible page), Ctrl+Q
  motion     the open and close morph frame by frame (the chrome refresh driver under test control)
  reduced    the same with reduced motion: 150 ms cross-fades, nothing slides

Each test is one run of tools/run.py with its own profile; a local http server serves tests/find/pages
on 127.0.0.1 (the cross-site frame comes from localhost on the same port). Captures and logs are in
tests/find/out/.
"""
import functools
import http.server
import os
import subprocess
import sys
import threading

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = os.path.join(HERE, 'pages')
OUT = os.path.join(HERE, 'out')
PY = sys.executable

TESTS = {
    'core': ('core.js', 300),
    'contexts': ('contexts.js', 300),
    'peek': ('peek.js', 180),
    'motion': ('motion.js', 120),
    'reduced': ('motion.js', 120, ['--pref', 'ui.prefersReducedMotion=1']),
}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    args = sys.argv[1:]
    app = None
    if '--app' in args:
        i = args.index('--app')
        app = args[i + 1]
        del args[i:i + 2]
    names = args or list(TESTS)
    handler = functools.partial(Quiet, directory=PAGES)
    # 127.0.0.1 and localhost (which resolves to it) are two sites for Fission.
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    failed = []
    for name in names:
        script, timeout, *extra = TESTS[name]
        cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, script), '--name', 'find-' + name + '-t',
               '--out', os.path.join(OUT, name), '--timeout', str(timeout), '--env', 'FIND_PORT=%d' % port, '--env', 'FIND_PAGES=' + PAGES]
        if extra:
            cmd += extra[0]
        if app:
            cmd += ['--app', app]
        print('==', name, flush=True)
        r = subprocess.run(cmd, cwd=ROOT)
        if r.returncode:
            failed.append(name)
    httpd.shutdown()
    print('FAILED: ' + ', '.join(failed) if failed else 'all passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
