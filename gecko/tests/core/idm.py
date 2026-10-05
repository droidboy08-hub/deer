"""Does Internet Download Manager still attach when the runtime runs as vitre.exe? Report only.
Run from gecko/:   python tests/core/idm.py [--control]

IDM hooks browsers it knows by process name: its network driver answers "204 No Content" to requests
it takes for downloads and opens its own dialog, and it draws a "Download this video" bar on the
window (spikes/downloader/RESULT.md saw both while the runtime was called firefox.exe).

This starts a local server with download-looking addresses (.bin, .zip, .mp4) and a media page,
runs tests/core/idm.js in Vitre (process image vitre.exe), and reports:
  - IDM DLLs loaded in the browser's processes (tasklist /m),
  - whether the requests reached the server and came back whole (200, all bytes) or were taken (204),
  - whether Firefox's own download list got the attachment,
  - new IDM windows that appeared during the run (those that name the test server are closed again),
  - tests/core/out/idm-vitre.png to look at for IDM's bar.
--control repeats the same run with the process called firefox.exe (same binary, same profile
handling: a throwaway -profile), which is the comparison that shows the hook is keyed on the name.
Nothing in IDM is changed; if IDM is not running the report says so.
"""
import ctypes
import ctypes.wintypes as wt
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'tests', 'core', 'out')
user32 = ctypes.windll.user32
PAYLOAD = os.urandom(512 * 1024)
REQUESTS = []

MEDIA = b"""<!doctype html><meta charset=utf-8><title>Media test page</title>
<body style="font:16px system-ui;margin:120px 40px;background:#f4f1ea">
<h1>Media test page</h1>
<video id=v src="/vitre-idm-test.mp4" width=480 controls muted autoplay loop></video>
<p><a href="/vitre-idm-test.zip">an archive</a></p>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        attach = 'as=download' in self.path
        if path == '/media.html':
            body, kind = MEDIA, 'text/html; charset=utf-8'
        elif path.startswith('/vitre-idm-test.'):
            body = PAYLOAD
            kind = {'mp4': 'video/mp4', 'zip': 'application/zip'}.get(path.rsplit('.', 1)[1], 'application/octet-stream')
        else:
            body, kind = b'not here', 'text/plain'
        REQUESTS.append((self.path, self.headers.get('User-Agent', '')[:40]))
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        if attach:
            self.send_header('Content-Disposition', 'attachment; filename="vitre-idm-test' + os.path.splitext(path)[1] + '"')
        self.end_headers()
        try:
            self.wfile.write(body)
        except OSError:
            pass

    def log_message(self, *_args):
        pass


def idm_pids():
    out = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq IDMan.exe', '/FO', 'CSV', '/NH'], capture_output=True, text=True).stdout
    return {int(line.split(',')[1].strip('"')) for line in out.splitlines() if line.startswith('"IDMan')}


def window_text(h):
    n = user32.SendMessageW(h, 0x000E, 0, 0)
    b = ctypes.create_unicode_buffer(n + 2)
    user32.SendMessageW(h, 0x000D, n + 1, b)
    return b.value


def idm_windows(pids):
    """{hwnd: (title, [child texts])} for IDM's visible top-level windows."""
    tops = {}

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def each(hwnd, _):
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids and user32.IsWindowVisible(hwnd):
            title = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, title, 256)
            kids = []

            @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
            def child(h, _l):
                kids.append(window_text(h))
                return True

            user32.EnumChildWindows(hwnd, child, 0)
            tops[hwnd] = (title.value, kids)
        return True

    user32.EnumWindows(each, 0)
    return tops


def answer_no(top):
    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def child(h, _l):
        if window_text(h) == '&No':
            user32.PostMessageW(h, 0x00F5, 0, 0)  # BM_CLICK
            return False
        return True

    user32.EnumChildWindows(top, child, 0)


def run(exe, tag, server, pids):
    before = idm_windows(pids)
    del REQUESTS[:]
    downloads = os.path.join(OUT, 'idm-downloads')
    os.makedirs(downloads, exist_ok=True)
    cmd = [sys.executable, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(ROOT, 'tests', 'core', 'idm.js'),
           '--name', 'core-idm-' + tag, '--exe', exe, '--timeout', '90', '--out', OUT,
           '--env', 'VITRE_IDM_SERVER=' + server, '--env', 'VITRE_IDM_TAG=' + tag,
           '--pref', 'browser.download.dir=' + downloads, '--pref', 'browser.download.folderList=2',
           '--pref', 'browser.download.useDownloadDir=true', '--pref', 'browser.download.always_ask_before_handling_new_types=false']
    print('---- process image: %s ----' % exe)
    out = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
    for line in out.splitlines():
        if line.startswith(('[modules]', 'FETCH', 'DOWNLOAD', '[capture]', 'ERROR', '[run]')):
            print('  ' + line)
    print('  server saw %d request(s): %s' % (len(REQUESTS), ', '.join(sorted({p for p, _ua in REQUESTS})) or 'none'))
    time.sleep(1.5)
    new = {h: v for h, v in idm_windows(pids).items() if h not in before}
    if not pids:
        print('  IDM is not running: nothing could attach')
    elif not new:
        print('  no IDM window appeared')
    closed = 0
    for h, (title, kids) in new.items():
        ours = any(server in k or 'vitre-idm-test' in k for k in kids)
        print('  IDM window appeared: %r%s' % (title, ' (about the test server: closed)' if ours else ' (not about this test: left alone)'))
        if ours:
            user32.PostMessageW(h, 0x0010, 0, 0)  # WM_CLOSE = Cancel
            closed += 1
    if closed:
        # Cancelling makes IDM ask "You have an obsolete Firefox browser integration ... read how to
        # fix it?" once per dialog. Answer No on the boxes this run caused, and on nothing else.
        time.sleep(2.0)
        known = set(before) | set(new)
        for h, (_title, kids) in idm_windows(pids).items():
            if h in known or closed <= 0 or not any('obsolete Firefox browser integration' in k for k in kids):
                continue
            answer_no(h)
            closed -= 1
            print('  answered No to the "obsolete Firefox integration" question IDM asked next')
    for f in os.listdir(downloads):
        os.remove(os.path.join(downloads, f))
    os.rmdir(downloads)


def main():
    os.makedirs(OUT, exist_ok=True)
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server = 'http://127.0.0.1:%d' % httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    pids = idm_pids()
    print('IDMan.exe running: %s' % (sorted(pids) or 'no'))
    run('vitre.exe', 'vitre', server, pids)
    if '--control' in sys.argv:
        run('firefox.exe', 'firefox', server, pids)
    httpd.shutdown()


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
