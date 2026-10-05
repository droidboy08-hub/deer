"""Run one pagefeatures spike: serve ./pages on a free local port, then run tools/run.py.

  python spikes/pagefeatures/run.py menu            -> boot-menu.js, profile pagefeatures-menu
  python spikes/pagefeatures/run.py find [--timeout 120] [--pref k=v ...] [--page article.html]

Output: spikes/pagefeatures/out/<variant>/{log.txt,*.png}
The boot script reads the page base URL from the VITRE_PF_BASE environment variable.
"""
import argparse
import functools
import http.server
import os
import socket
import subprocess
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
GECKO = os.path.abspath(os.path.join(HERE, '..', '..'))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        # no-cache (revalidate) rather than no-store: no-store pages are kept out of the bfcache.
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('variant')
    ap.add_argument('--boot')
    ap.add_argument('--page', default='article.html')
    ap.add_argument('--timeout', default='120')
    ap.add_argument('--pref', action='append', default=[])
    a = ap.parse_args()

    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    handler = functools.partial(Quiet, directory=os.path.join(HERE, 'pages'))
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    base = 'http://127.0.0.1:%d/' % port
    boot = os.path.join(HERE, a.boot or ('boot-%s.js' % a.variant))
    out = os.path.join(HERE, 'out', a.variant)
    os.makedirs(out, exist_ok=True)
    cmd = [sys.executable, os.path.join(GECKO, 'tools', 'run.py'), '--boot', boot, '--name', 'pagefeatures-' + a.variant,
           '--url', base + a.page, '--out', out, '--timeout', a.timeout]
    for p in a.pref:
        cmd += ['--pref', p]
    env = dict(os.environ, VITRE_PF_BASE=base)
    rc = subprocess.call(cmd, env=env)
    srv.shutdown()
    sys.exit(rc)


if __name__ == '__main__':
    main()
