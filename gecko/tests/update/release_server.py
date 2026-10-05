"""A local stand-in for GitHub's releases API and its downloads, for Deer's updater tests.

  python tests/update/release_server.py [--port 47971]

Prints "ready <port>" and serves on 127.0.0.1 until it is killed. Nothing here touches the internet.

The repository is "test/deer"; the install the tests stand in is Deer 1.4.2 (tests/update/lib.js).
GET /repos/test/deer/releases/latest   what GitHub's /releases/latest answers, per scenario
GET /test/deer/releases/download/<tag>/<name>
                                       302 to /objects/<tag>/<name>, as GitHub's download links do
                                       (scenario redirect-host: the setup's to http://localhost:<port>)
GET /elsewhere/download/<tag>/<name>   302 to the asset as well (a link outside the repository)
GET /objects/<tag>/<name>              the asset: Deer-Setup.exe (deterministic bytes per tag, with
                                       Range support) or SHA256SUMS.txt
GET /slowfile                          a 50 MB download that takes minutes (for a running download)
Control (never logged):
GET /__scenario/<name>                 what the latest release is from now on (SCENARIOS below)
GET /__log                             every request since the last reset: method, path, query, headers
GET /__reset                           forget the log
GET /__sig/<base64url>                 what SHA256SUMS.txt.sig holds from now on (the test signs with its
                                       own key: this server has no Ed25519)
"""
import argparse
import base64
import hashlib
import http.server
import json
import random
import socket
import sys
import threading
import time
import urllib.parse

SIZE = 3 * 1024 * 1024 + 12345  # Deer-Setup.exe in every scenario (not a real program: never run)
_payloads = {}
_lock = threading.Lock()
LOG = []
STATE = {'scenario': 'newer', 'sig': ''}


def payload(tag):
    with _lock:
        if tag not in _payloads:
            _payloads[tag] = random.Random('deer-' + tag).randbytes(SIZE)
        return _payloads[tag]


def sha(data):
    return hashlib.sha256(data).hexdigest()


# Each scenario: the release (tag, flags, which assets) and how the API and the download behave.
#   api       'ok' | 'ratelimit' (403, x-ratelimit-remaining 0) | 'toomany' (429) | 'error' (500) |
#             'notfound' (404) | 'badjson' | 'slow' (answers after 3 s) | 'stall' (headers and 20 bytes
#             of the body, then nothing for 10 minutes) | 'huge' (a 2 MB answer)
#   assets    which assets the release lists: 'setup', 'sums', 'sig' (SHA256SUMS.txt.sig)
#   sums      'good' | 'bad' (another fingerprint) | 'other' (no line for Deer-Setup.exe) | 'huge'
#             (the right line, then 3 MB of padding)
#   where     'repo' (the release's own download links) | 'localhost' (the setup's link on another
#             host) | 'redirect' (the setup's link redirects to another host) | 'outside' (a link
#             outside the repository's releases)
#   digest    None | 'good' | 'bad': GitHub's own asset digest field
#   delta     the setup's "size" in the API minus its real size
#   download  'ok' | 'truncate' (sends 40 % then closes) | 'slow' (about 8 s) | 'norange' (ignores Range)
BASE = {'api': 'ok', 'tag': 'v1.5.0', 'prerelease': False, 'draft': False, 'assets': ('setup', 'sums'), 'sums': 'good',
        'digest': None, 'delta': 0, 'download': 'ok', 'where': 'repo'}
SCENARIOS = {
    'newer': {},
    'newer-digest': {'digest': 'good'},
    'same': {'tag': 'v1.4.2'},
    'older': {'tag': 'v1.3.9'},
    'prerelease': {'tag': 'v1.6.0-beta.1', 'prerelease': True},
    'pretag': {'tag': 'v1.6.0-rc.1'},
    'draft': {'tag': 'v1.6.0', 'draft': True},
    'no-setup': {'assets': ('sums',)},
    'no-sums': {'assets': ('setup',)},
    'sums-other': {'sums': 'other'},
    'bad-sum': {'sums': 'bad'},
    'bad-digest': {'digest': 'bad'},
    'size': {'delta': 10},
    'truncate': {'download': 'truncate'},
    'slow': {'download': 'slow'},
    'norange': {'download': 'norange'},
    'slow-api': {'api': 'slow', 'tag': 'v1.4.2'},
    'ratelimit': {'api': 'ratelimit'},
    'toomany': {'api': 'toomany'},
    'error': {'api': 'error'},
    'notfound': {'api': 'notfound'},
    'badjson': {'api': 'badjson'},
    'badtag': {'tag': 'latest'},
    'newer2': {'tag': 'v1.6.0'},
    'upper-v': {'tag': 'V1.5.0'},
    'stall-api': {'api': 'stall'},
    'huge-api': {'api': 'huge'},
    'huge-sums': {'sums': 'huge'},
    'other-host': {'where': 'localhost'},
    'redirect-host': {'where': 'redirect'},
    'outside': {'where': 'outside'},
    'signed': {'assets': ('setup', 'sums', 'sig')},
}


def scenario():
    s = dict(BASE)
    s.update(SCENARIOS[STATE['scenario']])
    return s


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def log_message(self, *a):
        pass

    def send(self, status, body=b'', ctype='application/json', headers=None):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        path = url.path
        if path.startswith('/__'):
            return self.control(path)
        with _lock:
            LOG.append({'method': self.command, 'path': path, 'query': url.query, 'headers': {k: v for k, v in self.headers.items()}, 'scenario': STATE['scenario'], 'at': time.time()})
        s = scenario()
        if path == '/repos/test/deer/releases/latest':
            return self.latest(s)
        if path == '/slowfile':
            return self.slowfile()
        parts = path.split('/')
        if len(parts) == 7 and parts[1:5] == ['test', 'deer', 'releases', 'download']:
            target = '/objects/%s/%s' % (parts[5], parts[6])
            if s['where'] == 'redirect' and parts[6] == 'Deer-Setup.exe':
                target = 'http://localhost:%d%s' % (self.server.server_address[1], target)
            self.send_response(302)
            self.send_header('Location', target)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if len(parts) == 5 and parts[1:3] == ['elsewhere', 'download']:
            self.send_response(302)
            self.send_header('Location', '/objects/%s/%s' % (parts[3], parts[4]))
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        if len(parts) == 4 and parts[1] == 'objects':
            return self.asset(s, urllib.parse.unquote(parts[2]), urllib.parse.unquote(parts[3]))
        self.send(404, b'{"message":"Not Found"}')

    def control(self, path):
        if path.startswith('/__scenario/'):
            name = path[len('/__scenario/'):]
            if name not in SCENARIOS:
                return self.send(400, b'unknown scenario', 'text/plain')
            STATE['scenario'] = name
            return self.send(200, b'ok', 'text/plain')
        if path == '/__log':
            with _lock:
                return self.send(200, json.dumps(LOG).encode())
        if path == '/__reset':
            with _lock:
                LOG.clear()
            return self.send(200, b'ok', 'text/plain')
        if path.startswith('/__sig/'):
            raw = path[len('/__sig/'):]
            STATE['sig'] = base64.b64encode(base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4))).decode() + '\n'
            return self.send(200, b'ok', 'text/plain')
        self.send(404, b'', 'text/plain')

    def latest(self, s):
        port = self.server.server_address[1]
        if s['api'] == 'ratelimit':
            reset = int(time.time()) + 1800
            return self.send(403, b'{"message":"API rate limit exceeded for 127.0.0.1."}', headers={
                'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': str(reset)})
        if s['api'] == 'toomany':
            return self.send(429, b'{"message":"Too many requests"}', headers={'retry-after': '120'})
        if s['api'] == 'error':
            return self.send(500, b'{"message":"Server Error"}')
        if s['api'] == 'notfound':
            return self.send(404, b'{"message":"Not Found"}')
        if s['api'] == 'badjson':
            return self.send(200, b'{"tag_name": "v1.5.0", "assets": [')
        if s['api'] == 'slow':
            time.sleep(3)
        tag = s['tag']
        data = payload(tag)
        links = 'http://127.0.0.1:%d/test/deer/releases/download/%s/' % (port, tag)
        setup_link = links + 'Deer-Setup.exe'
        if s['where'] == 'localhost':
            setup_link = 'http://localhost:%d/test/deer/releases/download/%s/Deer-Setup.exe' % (port, tag)
        elif s['where'] == 'outside':
            setup_link = 'http://127.0.0.1:%d/elsewhere/download/%s/Deer-Setup.exe' % (port, tag)
        assets = []
        if 'setup' in s['assets']:
            a = {'name': 'Deer-Setup.exe', 'size': len(data) + s['delta'], 'content_type': 'application/x-msdownload',
                 'browser_download_url': setup_link}
            if s['digest']:
                a['digest'] = 'sha256:' + (sha(data) if s['digest'] == 'good' else 'e' * 64)
            assets.append(a)
        if 'sums' in s['assets']:
            assets.append({'name': 'SHA256SUMS.txt', 'size': 81, 'content_type': 'text/plain',
                           'browser_download_url': links + 'SHA256SUMS.txt'})
        if 'sig' in s['assets']:
            assets.append({'name': 'SHA256SUMS.txt.sig', 'size': 89, 'content_type': 'text/plain',
                           'browser_download_url': links + 'SHA256SUMS.txt.sig'})
        body = {'tag_name': tag, 'name': 'Deer ' + tag.lstrip('vV'), 'draft': s['draft'], 'prerelease': s['prerelease'],
                'html_url': 'http://127.0.0.1:%d/test/deer/releases/%s' % (port, tag), 'assets': assets}
        if s['api'] == 'huge':
            body['body'] = 'x' * (2 * 1024 * 1024)
        raw = json.dumps(body).encode()
        if s['api'] == 'stall':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            try:
                self.wfile.write(raw[:20])
                self.wfile.flush()
                time.sleep(600)
            except OSError:
                pass
            return
        self.send(200, raw, headers={'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '59'})

    def slowfile(self):
        """An ordinary download that takes minutes (64 KB every 0.2 s, Range ignored): it keeps
        Deer's downloads engine busy while a test asks Deer to quit (tests/update/prompt.js)."""
        size = 50 * 1024 * 1024
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Length', str(size))
        self.end_headers()
        chunk = b'\0' * 65536
        try:
            for _ in range(size // len(chunk)):
                self.wfile.write(chunk)
                self.wfile.flush()
                time.sleep(0.2)
        except (ConnectionError, OSError):
            pass

    def asset(self, s, tag, name):
        data = payload(tag)
        if name == 'SHA256SUMS.txt':
            if s['sums'] == 'good':
                text = '%s  Deer-Setup.exe\n' % sha(data)
            elif s['sums'] == 'bad':
                text = '%s  Deer-Setup.exe\n' % ('f' * 64)
            elif s['sums'] == 'huge':
                text = ('%s  Deer-Setup.exe\n' % sha(data)) + ('# padding\n' * 300000)
            else:
                text = '%s  Deer-Setup-other.exe\n' % sha(data)
            return self.send(200, text.encode(), 'text/plain')
        if name == 'SHA256SUMS.txt.sig':
            return self.send(200, STATE['sig'].encode(), 'text/plain')
        if name != 'Deer-Setup.exe':
            return self.send(404, b'', 'text/plain')
        start = 0
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes=') and s['download'] != 'norange':
            try:
                start = int(rng[6:].split('-')[0])
            except ValueError:
                start = 0
            if start >= len(data):
                self.send_response(416)
                self.send_header('Content-Range', 'bytes */%d' % len(data))
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
        body = data[start:]
        self.send_response(206 if start else 200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Accept-Ranges', 'bytes')
        if start:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, len(data) - 1, len(data)))
        self.end_headers()
        try:
            if s['download'] == 'truncate':
                cut = int(len(data) * 0.4)
                self.wfile.write(body[:max(0, cut - start)])
                self.wfile.flush()
                time.sleep(0.3)
                self.connection.shutdown(socket.SHUT_RDWR)
                self.close_connection = True
                return
            if s['download'] == 'slow':
                step = 32 * 1024
                for i in range(0, len(body), step):
                    self.wfile.write(body[i:i + step])
                    self.wfile.flush()
                    time.sleep(0.08)
                return
            self.wfile.write(body)
        except (ConnectionError, OSError):
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=47971)
    a = ap.parse_args()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', a.port), Handler)
    server.daemon_threads = True
    print('ready %d' % a.port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.exit(main())
