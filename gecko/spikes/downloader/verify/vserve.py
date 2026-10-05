"""Verifier's test server: the spike's server (../server/serve.py, unmodified) plus a few routes.

  /page2.html          links for the extra take-over cases below
  /dl/pdfdoc           a small PDF as an attachment (Content-Disposition: attachment)
  /view/pdfdoc         the same PDF with no Content-Disposition (Firefox shows it in pdf.js)
  /dl/once?t=TOKEN     medium.bin as an attachment, ONCE per token: any later request with the same
                       token is answered 403 (a signed / one-time link)
  /dl/post             POST only: a small attachment; GET is answered 405 with an HTML page
  /dl/small            a 2 kB attachment (finishes before anything can react)
  /eme.html?ks=NAME    asks for the key system NAME (default com.widevine.alpha)
"""
import importlib.util
import os
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('spike_serve', os.path.join(HERE, '..', 'server', 'serve.py'))
serve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serve)

ONCE = set()
ONCE_LOCK = threading.Lock()

PDF = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
       b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
       b"4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 20 100 Td (Vitre verify PDF) Tj ET\nendstream endobj\n"
       b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
       b"xref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n0000000211 00000 n \n0000000300 00000 n \n"
       b"trailer<</Size 6/Root 1 0 R>>\nstartxref\n362\n%%EOF\n")

PAGE2 = """<!doctype html><meta charset=utf-8><title>Take-over cases</title>
<body style="font:16px system-ui;margin:40px">
<h1>Take-over cases</h1>
<p><a id="pdf" href="/dl/pdfdoc">PDF attachment</a></p>
<p><a id="pdfinline" href="/view/pdfdoc">PDF inline</a></p>
<p><a id="once" href="/dl/once?t=%TOKEN%&rate=4096">One-time link</a></p>
<form method="post" action="/dl/post"><button id="post">POST download</button></form>
<p><a id="small" href="/dl/small">Tiny attachment</a></p>
<p><a id="blob" download="from-blob.txt">Blob download</a></p>
<script>document.getElementById('blob').href = URL.createObjectURL(new Blob(['hello from a blob, 27 bytes.'], {type: 'text/plain'}));</script>
</body>"""

EME = """<!doctype html><meta charset=utf-8><title>EME request page</title>
<body style="font:16px system-ui;margin:40px"><h1>EME request page</h1><video id="v" width="320" controls></video><pre id="log">starting</pre>
<script>
(async () => {
  const log = (m) => { document.getElementById('log').textContent += '\\n' + m; };
  const ks = new URLSearchParams(location.search).get('ks') || 'com.widevine.alpha';
  try {
    const cfg = [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }];
    const access = await navigator.requestMediaKeySystemAccess(ks, cfg);
    log('access ' + access.keySystem);
  } catch (e) { log('error ' + e); }
})();
</script></body>"""


class Handler(serve.Handler):
    def do_POST(self):
        n = int(self.headers.get('Content-Length', '0') or 0)
        if n:
            self.rfile.read(n)
        if self.path.startswith('/dl/post'):
            self.record(status=200, method='POST')
            body = b'posted-result ' * 4096
            return self.text(200, body, 'application/x-vitre-test', headers=[('Content-Disposition', 'attachment; filename="posted.dat"')])
        self.text(404, 'not found')

    def route(self, p, q):
        if p == '/page2.html':
            self.record()
            return self.text(200, PAGE2.replace('%TOKEN%', q.get('token', 't1')), headers=[('Set-Cookie', serve.SID + '; Path=/')])
        if p == '/eme.html':
            self.record()
            return self.text(200, EME)
        if p in ('/dl/pdfdoc', '/view/pdfdoc'):
            self.record(status=200)
            # No ".pdf" in the name: IDM (installed on this machine) grabs firefox.exe downloads named *.pdf.
            extra = [('Content-Disposition', 'attachment; filename="Verify document"')] if p.startswith('/dl/') else []
            return self.text(200, PDF, 'application/pdf', headers=extra)
        if p == '/dl/small':
            self.record(status=200)
            return self.text(200, b'x' * 2048, 'application/x-vitre-test', headers=[('Content-Disposition', 'attachment; filename="tiny.dat"')])
        if p == '/dl/post':
            self.record(status=405)
            return self.text(405, '<!doctype html><title>Method not allowed</title>POST only')
        if p == '/dl/once':
            token = q.get('t', '')
            with ONCE_LOCK:
                used = token in ONCE
                ONCE.add(token)
            if used:
                self.record(status=403, once='reused')
                return self.text(403, '<!doctype html><title>Link expired</title>This link was already used.')
            rate = float(q.get('rate', '0')) * 1024
            return self.send_file(os.path.join(serve.FIX, 'medium.bin'), rate,
                                  extra=[('Content-Disposition', 'attachment; filename="one-time.dat"'), ('Content-Type', 'application/x-vitre-test')])
        return super().route(p, q)


def main():
    import argparse
    import tempfile
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=47911)
    ap.add_argument('--dir', default=os.path.join(tempfile.gettempdir(), 'vitre-dl-verify'))
    ap.add_argument('--log')
    serve.ARGS = ap.parse_args()
    serve.FIX = os.path.normpath(os.path.join(serve.ARGS.dir, 'fixtures'))
    if serve.ARGS.log:
        open(serve.ARGS.log, 'w').close()
    srv = serve.Server(('127.0.0.1', serve.ARGS.port), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.exit(main())
