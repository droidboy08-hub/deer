"""Design-fidelity review runs (reviewer's own; not part of the product tests).

  python tests/review/design_run.py <script-without-.js> [--timeout N] [extra run.py args]

Starts a small local server with mock sites shaped like the design boards' (Field Notes, Tideline,
Refract, vitre-shell, Long Exposure Club) and runs tests/review/<script>.js through tools/run.py
against build-review-design. Captures land in tests/review/out-design/.
"""
import http.server
import os
import subprocess
import sys
import threading

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out-design')
PY = sys.executable

ICONS = {
    'f': "<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><rect width='18' height='18' rx='4.5' fill='#d9482b'/><text x='9.4' y='13.6' text-anchor='middle' font-family='Georgia, serif' font-style='italic' font-size='13' fill='#ffffff'>F</text></svg>",
    't': "<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><circle cx='9' cy='9' r='9' fill='#0f8f8a'/><path d='M3.5 8.2c1.4 0 1.4-1.6 2.8-1.6s1.4 1.6 2.8 1.6 1.4-1.6 2.8-1.6 1.4 1.6 2.6 1.6M3.5 11.6c1.4 0 1.4-1.6 2.8-1.6s1.4 1.6 2.8 1.6 1.4-1.6 2.8-1.6 1.4 1.6 2.6 1.6' fill='none' stroke='#ffffff' stroke-width='1.4' stroke-linecap='round'/></svg>",
    'r': "<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><rect x='0.5' y='0.5' width='17' height='17' rx='4.5' fill='#f4f2ec' stroke='rgba(0,0,0,0.12)'/><path d='M9 3.6 14.6 13.8H3.4Z' fill='none' stroke='#1b1d21' stroke-width='1.5' stroke-linejoin='round'/></svg>",
    'v': "<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><rect width='18' height='18' rx='4.5' fill='#1d1f24'/><path d='M6.6 5.6 3.6 9l3 3.4M11.4 5.6l3 3.4-3 3.4' fill='none' stroke='#7df3d0' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>",
    'l': "<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 18 18'><circle cx='9' cy='9' r='9' fill='#141416'/><circle cx='9' cy='9' r='4.6' fill='none' stroke='#ececef' stroke-width='1.5'/><circle cx='9' cy='9' r='1.4' fill='#ececef'/></svg>",
    # one flat white mark on transparent (GitHub-like) and one flat dark mark
    'w': "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='#ffffff' d='M8 0a8 8 0 0 0-2.5 15.6c.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4a3 3 0 0 1 .8-2.100c-.1-.2-.4-1 .1-2.100 0 0 .7-.2 2.200.8a7.600 7.600 0 0 1 4 0c1.500-1 2.200-.8 2.200-.8.4 1.100.2 1.900.1 2.100.5.600.8 1.300.8 2.100 0 3.100-1.900 3.700-3.700 3.900.3.300.6.800.6 1.500v2.200c0 .2.100.5.600.4A8 8 0 0 0 8 0z'/></svg>",
    'k': "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path fill='#111111' d='M2 2h3v5l5-5h4L8 8l6 6h-4L5 9v5H2z'/></svg>",
}

LOREM = ("Float glass is made by pouring molten glass onto a bath of molten tin. The glass floats, spreads and "
         "levels under gravity and surface tension, giving two fire-polished faces that need no grinding. ")


def article():
    para = ''.join("<p>%s</p>" % (LOREM * 3) for _ in range(12))
    return ("<!doctype html><meta charset=utf-8><title>Field Notes</title><link rel=icon href='/icon/f.svg'>"
            "<body style='margin:0;background:#f3eee4;color:#16181d;font:17px/28px Georgia,serif'>"
            "<div style='height:26px;background:#d9482b'></div>"
            "<div style='display:flex;gap:28px;padding:10px 48px;font:600 14px Segoe UI;border-bottom:1px solid #1b1d21'>"
            + ''.join("<span>%s</span>" % s for s in ['Field Notes', 'Essays', 'Archive', 'Glass', 'Ice', 'Maps', 'About', 'Subscribe', 'Search', 'Letters', 'Podcast', 'Shop', 'Contact', 'Members', 'Latest', 'Popular']) +
            "</div><div style='max-width:760px;margin:40px auto'><h1 style='font:400 54px/60px Georgia,serif;margin:0 0 20px'>How a pane of glass is floated</h1>"
            + para + "</div>")


def dark():
    rows = ''.join("<div style='padding:14px 48px;border-bottom:1px solid #2a2d36'>#%d  ETag mismatch on resume after a range request <span style='color:#7df3d0'>bug</span></div>" % (41 - i) for i in range(30))
    return ("<!doctype html><meta charset=utf-8><title>Issues · vitre-shell</title><link rel=icon href='/icon/v.svg'>"
            "<body style='margin:0;background:#0f1115;color:#e6e8ee;font:15px/22px Segoe UI'>"
            "<div style='padding:20px 48px;font:600 15px Segoe UI;display:flex;gap:24px'><span style='color:#7df3d0'>vitre-shell</span><span>Code</span><span>Issues 12</span><span>Pull requests</span><span>Actions</span><span>Wiki</span><span>Insights</span><span>Settings</span><span>Security</span><span>Releases</span></div>"
            + rows)


def busy():
    # A photo-like, colourful page: big colour blocks and text right under the bar.
    cells = ''.join("<div style='height:120px;background:hsl(%d 70%% %d%%);display:flex;align-items:flex-end;padding:8px;font:600 22px Segoe UI;color:#fff'>Slow light %d</div>" % ((i * 37) % 360, 30 + (i * 13) % 45, i) for i in range(48))
    return ("<!doctype html><meta charset=utf-8><title>Slow light · Long Exposure Club</title><link rel=icon href='/icon/l.svg'>"
            "<body style='margin:0;background:#222'><div style='display:grid;grid-template-columns:repeat(8,1fr)'>" + cells + "</div>")


def simple(title, icon, bg='#ffffff', fg='#222'):
    link = "<link rel=icon href='/icon/%s.svg'>" % icon if icon else ''
    return ("<!doctype html><meta charset=utf-8><title>%s</title>%s<body style='margin:0;background:%s;color:%s;font:16px Segoe UI'>"
            "<p style='margin:120px 40px'>%s</p><div style='height:3000px'></div>" % (title, link, bg, fg, title))


def stripes():
    return ("<!doctype html><meta charset=utf-8><title>Stripes</title><link rel=icon href='/icon/t.svg'>"
            "<body style='margin:0;height:3000px;background:repeating-linear-gradient(90deg,#111 0 3px,#eee 3px 6px)'>")


def text_page():
    # Text lines right under the bar, to judge how the lens treats text (light page).
    lines = ''.join("<div style='white-space:nowrap'>%s</div>" % ("The quick brown fox jumps over the lazy dog 0123456789 " * 6) for _ in range(60))
    return ("<!doctype html><meta charset=utf-8><title>Text</title><link rel=icon href='/icon/r.svg'>"
            "<body style='margin:0;background:#fff;color:#111;font:13px/16px Segoe UI'>" + lines)


PAGES = {
    '/article': article, '/dark': dark, '/busy': busy, '/stripes': stripes, '/text': text_page,
    '/tideline': lambda: simple('Tideline', 't', '#e9f5f4'),
    '/refract': lambda: simple('Refract', 'r', '#fbfaf7'),
    '/shell': lambda: simple('Issues · vitre-shell', 'v', '#0f1115', '#e6e8ee'),
    '/club': lambda: simple('Slow light · Long Exposure Club', 'l', '#141416', '#ececef'),
    '/white-mark': lambda: simple('White mark', 'w', '#ffffff'),
    '/dark-mark': lambda: simple('Dark mark', 'k', '#ffffff'),
    '/noicon': lambda: simple('No icon', None, '#ffffff'),
}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/slow':
            import time
            time.sleep(2.5)
            path = '/article'
        if path.startswith('/icon/'):
            key = path[6:7]
            body, ctype = ICONS.get(key, ICONS['f']).encode(), 'image/svg+xml'
        elif path == '/favicon.ico':
            self.send_response(404)
            self.end_headers()
            return
        else:
            body, ctype = PAGES.get(path, lambda: simple('Page', 'f'))().encode(), 'text/html; charset=utf-8'
        try:
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            if ctype != 'image/svg+xml':
                self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass

    def log_message(self, *args):
        pass


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
        elif args[i] == '--tail':
            i += 1
        else:
            extra.append(args[i])
            i += 1
    os.makedirs(OUT, exist_ok=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    port = server.server_address[1]
    cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, name + '.js'), '--name', 'review-design-' + name,
           '--app', 'build-review-design', '--out', OUT, '--timeout', timeout, '--env', 'VITRE_TEST_PORT=%d' % port] + extra
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
    text = r.stdout + r.stderr
    with open(os.path.join(OUT, name + '.log'), 'w', encoding='utf-8') as f:
        f.write(text)
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    print(text[-6000:] if '--tail' in sys.argv else text)
    server.shutdown()
    return r.returncode


if __name__ == '__main__':
    sys.exit(main())
