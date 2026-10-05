"""Local test server for the extensions spike: serves ./www on 127.0.0.1:47631.
.xpi files are sent as application/x-xpinstall so Firefox's install handler picks them up."""
import http.server, os, sys

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **{'.xpi': 'application/x-xpinstall'})
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass

if __name__ == '__main__':
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'www'))
    http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 47631), Handler).serve_forever()
