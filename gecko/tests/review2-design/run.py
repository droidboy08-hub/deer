"""Design-fidelity review of the integrated app (reviewer's own; not a product test).

  python tests/review2-design/run.py <script-without-.js> [--timeout N] [extra run.py args]

Serves the board-shaped mock sites of tests/review/design_run.py (Field Notes article, a dark issues
page, a busy colour grid...), tests/integrate/pages under /integ/, files the script writes under
/out/, and a throttled ranged download under /dl/<name>?mb=N&kbps=K. Runs
tests/review2-design/<script>.js through tools/run.py against build-review2-design; captures and
the log land in tests/review2-design/out/<script>/.
"""
import http.server
import importlib.util
import os
import re
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PY = sys.executable
INTEG = os.path.join(ROOT, 'tests', 'integrate', 'pages')

spec = importlib.util.spec_from_file_location('old_design_run', os.path.join(ROOT, 'tests', 'review', 'design_run.py'))
old = importlib.util.module_from_spec(spec)
spec.loader.exec_module(old)

TYPES = {'.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webm': 'video/webm',
         '.pdf': 'application/pdf', '.zip': 'application/zip', '.js': 'text/javascript', '.css': 'text/css'}
OUTROOT = os.path.join(HERE, 'out')


class Handler(old.Handler):
    def static(self, base, rel):
        full = os.path.abspath(os.path.join(base, *[p for p in rel.split('/') if p]))
        if not full.startswith(os.path.abspath(base)) or not os.path.isfile(full):
            self.send_error(404)
            return
        with open(full, 'rb') as f:
            body = f.read()
        ctype = TYPES.get(os.path.splitext(full)[1].lower(), 'application/octet-stream')
        rng = self.headers.get('Range')
        try:
            if rng and ctype.startswith('video/'):
                m = re.match(r'bytes=(\d+)-(\d*)', rng)
                a = int(m.group(1))
                z = int(m.group(2)) if m.group(2) else len(body) - 1
                part = body[a:z + 1]
                self.send_response(206)
                self.send_header('Content-Range', 'bytes %d-%d/%d' % (a, z, len(body)))
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(len(part)))
                self.send_header('Accept-Ranges', 'bytes')
                self.end_headers()
                self.wfile.write(part)
                return
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass

    def slow(self, query):
        q = dict(p.split('=', 1) for p in query.split('&') if '=' in p)
        size = int(float(q.get('mb', '64')) * (1 << 20))
        kbps = int(q.get('kbps', '256'))
        a, z = 0, size - 1
        rng = self.headers.get('Range')
        status = 200
        if rng:
            m = re.match(r'bytes=(\d+)-(\d*)', rng)
            if m:
                a = int(m.group(1))
                z = int(m.group(2)) if m.group(2) else size - 1
                status = 206
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Content-Length', str(z - a + 1))
            if status == 206:
                self.send_header('Content-Range', 'bytes %d-%d/%d' % (a, z, size))
            self.end_headers()
            left = z - a + 1
            chunk = max(1024, kbps * 1024 // 10)
            block = b'\x5a' * chunk
            while left > 0:
                n = min(chunk, left)
                self.wfile.write(block[:n])
                left -= n
                time.sleep(0.1)
        except OSError:
            pass

    def do_GET(self):  # noqa: N802
        path, _, query = self.path.partition('?')
        if path.startswith('/integ/'):
            return self.static(INTEG, path[len('/integ/'):])
        if path.startswith('/out/'):
            return self.static(OUTROOT, path[len('/out/'):])
        if path.startswith('/dl/'):
            return self.slow(query)
        return super().do_GET()


def main():
    args = sys.argv[1:]
    name = args[0]
    timeout = '300'
    extra = []
    i = 1
    while i < len(args):
        if args[i] == '--timeout':
            timeout = args[i + 1]
            i += 2
        else:
            extra.append(args[i])
            i += 1
    out = os.path.join(OUTROOT, name)
    os.makedirs(out, exist_ok=True)
    dl = os.path.join(tempfile.gettempdir(), 'vitre-review2-design', name)
    os.makedirs(dl, exist_ok=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, name + '.js'), '--name', 'r2d-' + name + '-x',
           '--app', 'build-review2-design', '--out', out, '--timeout', timeout, '--env', 'VITRE_TEST_PORT=%d' % port,
           '--env', 'R2D_DL=' + dl, '--env', 'R2D_EXT=' + os.path.join(ROOT, 'tests', 'extensions', 'build', 'ext'),
           '--pref', 'vitre.downloadsFolder=' + dl,
           '--pref', 'media.gmp-manager.updateEnabled=false', '--pref', 'media.gmp-manager.url=http://127.0.0.1:9/none'] + extra
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    text = r.stdout + r.stderr
    with open(os.path.join(out, 'run.txt'), 'w', encoding='utf-8') as f:
        f.write(text)
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    print(text[-12000:])
    server.shutdown()
    return r.returncode


if __name__ == '__main__':
    sys.exit(main())
