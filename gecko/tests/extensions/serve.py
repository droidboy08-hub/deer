"""Test site for tests/extensions: serves tests/extensions/build/www on 127.0.0.1:47651.
.xpi files go out as application/x-xpinstall so Firefox's install handler takes them.
Started and stopped by runx.py; run by hand with  python tests/extensions/serve.py"""
import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build', 'www')
PORT = 47651


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **{
        '.xpi': 'application/x-xpinstall', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html; charset=utf-8'})

    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else PORT), Handler).serve_forever()
