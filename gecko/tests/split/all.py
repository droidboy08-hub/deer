"""Run the split view tests (from gecko/):  python tests/split/all.py [name ...] [--app build-x]

Split view (../design/SPLIT-VIEW-SPEC.md, src/window/split.ts). Each test is one run of
tools/run.py with its own throwaway profile (split-<name>-<app>, so two builds can be tested at
once); a local http server serves tests/split/pages on 127.0.0.1 (localhost is a second site).

  start     every way in: the tab circle's menu (circlesplit; circlepair replacing the unfocused
            side, the Home side), the link menu (linksplit; linkpair loading into the other side,
            no row on image, mail, phone or file links, Back on that side), the pill menu's "New tab
            in split view" (pillsplit: Home on the right, focused, its field open; not on Home), the
            omnibox's "Show here", b.split(); focus stays where it was; Home never with Home
  end       every way out: Separate tabs (both stay, focus stays, pane names go), Swap sides (the
            ratio stays), the x of a half, middle-click on a half, Ctrl+W on the focused side (the
            partner takes focus), closing a side from outside (a background pair's capsule badge,
            b.closeTab), Close both tabs from the capsule menu (two closed-list entries),
            Ctrl+Shift+U; Ctrl+Shift+T never brings a pair's ratio back
  bar       the bar: the group centred exactly as for one tab at 50/50 and at 1/3, the split pill's
            geometry (halves 70..240..410 at 480, seam, plate, mark and Reload slots), names, hover
            plate and x, a click on the unfocused half focuses that side, on the focused half opens
            the address field for it (side glyph, name, grows from the half, centred), the half
            menus (splitpill), the 96x44 capsule (favicons, hairline, badge, click, menu), the
            mixed tint over the other page (also after End, Home, a double-click and a drag of
            the divider), the window controls' own theme, give-way to 360, the fade beside the
            hover x, a focused Home side's Back / Forward / Reload, captures
  panes     the content area: 8 px gutter in the Appearance colour, pane widths from the ratio,
            inner corners, rims (focused accent by page lightness), Firefox's footer and splitter
            hidden, both pages live, a click in the unfocused pane focuses it, the F6 pulse, the
            panes as named regions in the accessibility tree
  divider   the divider: hit area, ew-resize, the grip after a rest, a live drag at most once per
            frame (a pause is not ghost mode), the 320 px minimums, the 50/50 magnet, double-click,
            Esc cancels, the keys (Left / Right 16 px, Shift 64 px, Home / End, Enter), ghost mode,
            the ratio per pair; a press or double-click leaves keyboard focus in the page (ring and
            grip for the keyboard only); focus on it goes to the page when the split goes
  keys      Ctrl+Shift+U both ways (and its key-repeat guard, nothing on Home), F6 / Shift+F6 ring,
            Ctrl+Page Down through both sides, Ctrl+1..9 counting each side, Ctrl+Tab treating the
            pair as one entry (core and switcher), Ctrl+Shift+Page Up/Down moving the pair as one,
            new tabs after the pair, the mouse side buttons over the other pane (other hardware
            keys, a pointer gone or over the bar: the focused side), the field's side after
            Ctrl+Shift+U, the halves and the capsule as bar stops (Tab, Left / Right, Menu key)
  narrow    under 648 px: starts refused (menu rows greyed "Window too narrow", Ctrl+Shift+U says so),
            an open split collapses to the focused side and comes back at 680 px; a swap, a press
            or a key in a narrow window keeps the stored ratio; divider focus goes to the page on a
            collapse; "Show here" works on a collapsed Home side
  fixes     the "only the active tab is on screen" fixes: successors, moveTab, tab-activated
            withinPair, b.shown(), window.focus() from the unfocused pane, the crash card,
            Peek over both panes and its Open as tab, find in the focused side, downloads unchanged,
            the shown unfocused side is never discarded
  restore   a restart brings the pairs back with their focused side and ratio (also a pair that was
            in the background, whose tabs load lazily)

Without names all of them run. Logs and captures: tests/split/out/<name>/ (log.txt and *.png).
No test reaches the internet.
"""
import functools
import http.server
import os
import subprocess
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PAGES = os.path.join(HERE, 'pages')
OUT = os.path.join(HERE, 'out')
PY = sys.executable

TESTS = {
    'start': ('start.js', 240),
    'end': ('end.js', 300),
    'bar': ('bar.js', 300),
    'panes': ('panes.js', 240),
    'divider': ('divider.js', 260),
    'keys': ('keys.js', 330),
    'narrow': ('narrow.js', 300),
    'fixes': ('fixes.js', 380),
    'restore': ('restore.js', 240),
}


def measure_panes(lines):
    """Pixel checks of the panes capture (MEASURE line of panes.js): gutter colour and the rims."""
    import json
    out = []
    for line in lines:
        if not line.startswith('MEASURE '):
            continue
        m = json.loads(line[len('MEASURE '):])
        try:
            from PIL import Image
            im = Image.open(m['path']).convert('RGB')
        except Exception as e:  # noqa: BLE001
            out.append(('panes capture readable (%s)' % e, False))
            continue
        ox = (im.size[0] - m['inner']) // 2
        oy = im.size[1] - m['innerH'] - ox if im.size[1] > m['innerH'] else 0
        y = oy + m['innerH'] // 2
        g = im.getpixel((ox + m['gutter'] + 4, y))
        want = (32, 32, 32) if m['dark'] else (243, 243, 243)
        out.append(('capture: the gutter is %s at x %d (got %s)' % (want, m['gutter'] + 4, g), all(abs(a - c) <= 3 for a, c in zip(g, want))))
        rim = im.getpixel((ox + m['gutter'] - 1, y + 200))
        out.append(('capture: the focused (left, light) pane has its #005FB8 rim at its right edge (got %s)' % (rim,), abs(rim[0] - 0) <= 30 and abs(rim[1] - 95) <= 30 and abs(rim[2] - 184) <= 30))
    return out


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    args = sys.argv[1:]
    app = None
    i = 0
    names = []
    while i < len(args):
        a = args[i]
        if a == '--app':
            app = args[i + 1]
            i += 1
        elif a.startswith('--app='):
            app = a.split('=', 1)[1]
        else:
            names.append(a)
        i += 1
    names = names or list(TESTS)
    for n in names:
        if n not in TESTS:
            sys.exit('unknown test %s (have: %s)' % (n, ', '.join(TESTS)))
    handler = functools.partial(Quiet, directory=PAGES)
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    suffix = (app or 'build').replace('\\', '-').replace('/', '-').replace(':', '')
    failed = []
    for name in names:
        script, timeout = TESTS[name]
        out = os.path.join(OUT, name)
        os.makedirs(out, exist_ok=True)
        cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, script), '--name', 'split-%s-%s-t' % (name, suffix),
               '--out', out, '--timeout', str(timeout), '--env', 'SPLIT_PORT=%d' % port]
        if app:
            cmd += ['--app', app]
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        text = r.stdout + r.stderr
        with open(os.path.join(out, 'log.txt'), 'w', encoding='utf-8') as f:
            f.write(text)
        lines = text.splitlines()
        if name == 'panes':
            for label, good in measure_panes(lines):
                lines.append(('PASS ' if good else 'FAIL ') + label)
        passed = sum(1 for line in lines if line.startswith('PASS '))
        bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback'))]
        ok = r.returncode == 0 and not bad
        print('%-8s %s  (%d checks passed)' % (name, 'ok' if ok else 'FAILED', passed), flush=True)
        for line in bad:
            print('    ' + line[:700])
        if not ok:
            failed.append(name)
    httpd.shutdown()
    print('ALL OK' if not failed else 'FAILED: ' + ', '.join(failed))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
