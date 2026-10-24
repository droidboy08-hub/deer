"""Run the History panel tests (from gecko/):  python tests/history/all.py [name ...] [--app build-x]

The History panel (../design/HISTORY-SPEC.md, src/window/modules/history). Each test is one run of
tools/run.py with its own throwaway profile (history-<name>-<app>-t, so two builds can be tested at
once); a local http server serves tests/history/pages on 127.0.0.1 (localhost is a second site).
History is seeded through PlacesUtils.history.insertMany with visits on several days; the board's
"house sites" are only rows and are never opened. Build first: node tools/build.mjs --out=build-x

  look      the board's scene at 1440x900 (sheet, title bar, sidebar, views, toolbar, first heading,
            card and row columns), the buttons' own sizes and colours, light mode, selection and undo
            states, a small window (the sheet scales as a whole), a private window's one line; captures
  open      every way in and out: Ctrl+H (toggle, key repeat ignored), the + menu's History row,
            Esc, Ctrl+W, the x, a click on the dim; focus back where it was; Ctrl+H from the address
            field carrying the typed text (not the page's own address); Ctrl+L / F6 to the field
            closes it; the hand-off with Settings and Downloads in every order (one panel at a time,
            focus checked, also when Downloads closes after taking over); warm state within 60 s (view, query, scroll, focused row; never the
            selection) and fresh after; a popup window opens it in the main window; element full
            screen is left first
  list      rows by day: one row per page per day with that day's latest counted visit, newest
            first; reloads, embeds, downloads, framed links, hidden (redirect source) and non-web
            pages left out; a day with only uncounted visits skipped; Today / Yesterday / the date /
            another year; a daylight-saving day; midnight relabels in place; the summary; the
            tooltip's three lines; no title (the address at 0.85), file: (Local file); loading more
            near the end; 2000 rows in one day built in frames; 100k visits: Ctrl+H to the first rows,
            a change and a delete with 20,000 rows drawn
  search    the search: every word anywhere in title or address, matches Semibold, a path-only
            match shows host/…/segment, the count, Searching…, no match (Clear search), Esc clears
            then closes, Down / Enter into the list, results grouped by their last day, more on
            scroll, Recently closed searched in memory, the query kept between views
  gestures  click opens here (closes, focus to the page; a Home tab replaced; the focused side in
            split view), Ctrl+click / middle-click a background tab with the wash and the panel
            staying, Ctrl+Shift+click a new tab switched to, Shift+click a peek (History steps aside
            and comes back warm on Esc, focus and wash on the row; not after Open as tab), the
            Shift+click setting "Open in new window", Enter / Alt+Enter / Ctrl+Enter / Shift+Enter /
            Ctrl+Q, double-click and Alt+click as a click, a file: row has no Peek, the row menu
  select    the checkbox (click, Shift+click range), Space, Shift+arrows, Space on a heading (the
            whole day, mixed), Ctrl+A only in search results, right-click on a selected row (the
            selection menu, counts each address once, 15 at most) and outside it (the row's own),
            Esc and the toolbar's x clear it, never restored on reopen
  delete    a row (x, Delete, the menu) takes only that day's visits: the page stays under its
            other days and in the address field, and leaves both when that day held all its visits;
            a selection across days; a day; Undo (Ctrl+Z, the button) restores from memory with no
            Places change; the commit on timeout (paused on hover), close, a new delete, opening a
            page, Clear browsing data, the window closing, and quit (a restart); a visit made while
            a Today delete is pending survives (one row after Undo); the address field leaves out pages
            a pending delete removes entirely; Undo after a peek round trip and after a bulk change; a
            reopen while a 1,500-row commit runs; Delete day on a search-results heading counts the day
  closed    Recently closed: tabs of every normal window newest first and windows, Home / blank /
            peek tabs left out, the count, reopen (click: switched to, panel closes; Ctrl+click:
            background, panel stays; a window), remove from list (x, Delete, menu), Ctrl+Shift+T
            under the panel collapses its entry, the menus, its search
  live      while open: a new visit appears at the top of Today without moving the view, a visit to
            a page already there updates its time in place, a title change, a deletion elsewhere
            (another window's panel, Shift+Delete in the address field) fades only the emptied rows,
            history-cleared resets to "No history yet", new visits ignored during a search (and
            listed once it ends), a bulk change keeps focus and the selection, deletes in one window
            show in another's panel after the commit
  keys      Up / Down (headings are stops), Home / End, Page Up / Down, Ctrl+Up / Down, the Tab
            order, Ctrl+F, Ctrl+C, Shift+F10 (4 px below the row), the Esc ladder one step per key,
            Ctrl+W closes the panel not the tab, Ctrl+Tab / Ctrl+1 underneath keep the panel's focus,
            page keys do nothing under it, a private window's keys
  a11y      roles and names: dialog, searchbox (described), views nav, Clear browsing data, grid
            (rowcount -1 until the end), rowgroups, rowheaders, rows with aria-selected, the x's and
            Delete day's names, the live announcements, a private window's dialog described by its
            line; forced colours

Without names all of them run. Logs and captures: tests/history/out/<name>/ (log.txt and *.png).
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
    'look': ('look.js', 240),
    'open': ('open.js', 300),
    'list': ('list.js', 540),
    'search': ('search.js', 240),
    'gestures': ('gestures.js', 300),
    'select': ('select.js', 240),
    'delete': ('delete.js', 480),
    'closed': ('closed.js', 300),
    'live': ('live.js', 300),
    'keys': ('keys.js', 300),
    'a11y': ('a11y.js', 240),
}


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
        script, timeout, *extra = TESTS[name]
        out = os.path.join(OUT, name)
        os.makedirs(out, exist_ok=True)
        cmd = [PY, os.path.join(ROOT, 'tools', 'run.py'), '--test', os.path.join(HERE, script), '--name', 'history-%s-%s-t' % (name, suffix),
               '--out', out, '--timeout', str(timeout), '--env', 'HISTORY_PORT=%d' % port]
        if app:
            cmd += ['--app', app]
        for more in extra:
            cmd += more
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
        text = r.stdout + r.stderr
        with open(os.path.join(out, 'log.txt'), 'w', encoding='utf-8') as f:
            f.write(text)
        lines = text.splitlines()
        passed = sum(1 for line in lines if line.startswith('PASS '))
        bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback')) or ('[console.error]' in line and 'Deer history' in line)]
        ok = r.returncode == 0 and not bad
        print('%-9s %s  (%d checks passed)' % (name, 'ok' if ok else 'FAILED', passed), flush=True)
        for line in bad:
            print('    ' + line[:700])
        if not ok:
            failed.append(name)
    httpd.shutdown()
    print('ALL OK' if not failed else 'FAILED: ' + ', '.join(failed))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
