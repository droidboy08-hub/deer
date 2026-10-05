"""Verifier runner for the pagefeatures spike.

  python spikes/pagefeatures/verify/run.py <variant> [--boot <file>] [--page article.html] [--timeout 150] [--pref k=v]

- <variant> names the output folder (verify/out/<variant>) and the profile (pagefeatures-verify-<variant>).
- --boot: a boot script. A bare name like "boot-menu.js" is looked up in verify/ first, then in the
  spike folder (..), so the original spike scripts are rerun unchanged with output under verify/out.
- Pages are served from verify/pages if the file exists there, else from ../pages (both on one port).
"""
import argparse
import http.server
import os
import socket
import subprocess
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
SPIKE = os.path.abspath(os.path.join(HERE, '..'))
GECKO = os.path.abspath(os.path.join(SPIKE, '..', '..'))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def translate_path(self, path):
        rel = path.split('?', 1)[0].split('#', 1)[0].lstrip('/')
        rel = rel.replace('..', '')
        mine = os.path.join(HERE, 'pages', rel)
        if rel and os.path.exists(mine):
            return mine
        return os.path.join(SPIKE, 'pages', rel)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('variant')
    ap.add_argument('--boot')
    ap.add_argument('--page', default='article.html')
    ap.add_argument('--timeout', default='150')
    ap.add_argument('--pref', action='append', default=[])
    ap.add_argument('--arg', action='append', default=[])
    a = ap.parse_args()

    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), Quiet)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    base = 'http://127.0.0.1:%d/' % port
    name = a.boot or ('boot-%s.js' % a.variant)
    boot = os.path.join(HERE, name)
    if not os.path.exists(boot):
        boot = os.path.join(SPIKE, name)
    out = os.path.join(HERE, 'out', a.variant)
    os.makedirs(out, exist_ok=True)
    cmd = [sys.executable, os.path.join(GECKO, 'tools', 'run.py'), '--boot', boot, '--name', 'pagefeatures-verify-' + a.variant,
           '--url', base + a.page, '--out', out, '--timeout', a.timeout]
    for p in a.pref:
        cmd += ['--pref', p]
    for p in a.arg:
        cmd += ['--arg', p]
    env = dict(os.environ, VITRE_PF_BASE=base, VITRE_PF_SPIKE=SPIKE)
    rc = subprocess.call(cmd, env=env)
    srv.shutdown()
    sys.exit(rc)


if __name__ == '__main__':
    main()
