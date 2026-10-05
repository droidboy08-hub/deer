"""Adversarial verification of the right-click menus (from gecko/):

    python tests/menus-verify/all.py [name ...] [--app build-x] [--no-build]

Runs the menus feature's own suites (tests/menus/*.js) under this verifier's profile names and
output folder, plus the verifier's suites (tests/menus-verify/*.js):

  feature suites (tests/menus):  pages keyboard chrome ext look real integration
  verifier suites:
    attack    states and transitions the feature suites do not drive: a menu replacing another
              (navigation still closes it), rapid repeated right-clicks / keyboard menus / keys,
              the address field open, a pen, a cross-site frame in its own process (wash, place),
              a blob: video, resize, auto-hide and F11 (the bar stays under its menu), slow and
              hung pages, dark / light pages and Transparency effects off, the service under abuse,
              a second, a private and a popup window, element full screen Esc, leftovers, console
    modules   with the real modules (full build): other modules' key hooks while a menu is open (F6,
              Ctrl+Q with find open), the peek's dim and Esc ladder, Settings fields, Home's
              Change background (the background popover)
    extpopup  the one page that keeps Firefox's menu: an extension's popup (a local temporary test
              extension, tests/menus-verify/ext-popup); tabs keep Vitre's
    leak      a window that showed menus (closed with one open) is collected like one that did not
    idle      CPU and repaints of an open menu over a static page and over a blinking caret
    scale     the same menus at 150 % (layout.css.devPixelsPerPx 1.5): placement at the pointer,
              keyboard anchors, the system menu point, hit-testing of rows
    restore   menus after an in-place restart with session restore (deferred tabs)

Without names every suite runs. --tag NAME keeps a separate run apart (profiles
menus-verify-NAME-<suite>, output tests/menus-verify/out-NAME), e.g.
    python tests/menus-verify/all.py attack --app build-menus-verify-orig --tag orig
for the same attack against a copy of an earlier build (the before / after logs of the verifier's
fixes are in out-orig and out-origm; the snapshots themselves were removed).
build-menus-verify (menus only) and build-menus-verify-full (every module) are built first; integration and modules run against the full build, everything else against the
menus-only build. A local HTTP server serves
  /pages/  -> tests/menus/pages        (the feature's pages; lib.js page())
  /out/    -> tests/menus-verify/out   (files a test writes; lib.js outUrl())
  /v/      -> tests/menus-verify/pages (the verifier's pages)
Captures and per-suite logs land in tests/menus-verify/out (log-<name>.txt).
"""
import functools
import http.server
import os
import subprocess
import sys
import threading

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PY = sys.executable
RUN = [PY, os.path.join(ROOT, 'tools', 'run.py')]
FEATURE = os.path.join(ROOT, 'tests', 'menus')
T = os.path.join(ROOT, 'tests', 'menus-verify')
OUT = os.path.join(T, 'out')

# name -> (script, timeout, extra run.py args)
TESTS = {
    'pages': (os.path.join(FEATURE, 'pages.js'), 420, []),
    'keyboard': (os.path.join(FEATURE, 'keyboard.js'), 300, []),
    'chrome': (os.path.join(FEATURE, 'chrome.js'), 300, []),
    'ext': (os.path.join(FEATURE, 'ext.js'), 240, []),
    'look': (os.path.join(FEATURE, 'look.js'), 300, []),
    'real': (os.path.join(FEATURE, 'real.js'), 240, []),
    'integration': (os.path.join(FEATURE, 'integration.js'), 240, []),
    'attack': (os.path.join(T, 'attack.js'), 420, []),
    'idle': (os.path.join(T, 'idle.js'), 180, []),
    'extpopup': (os.path.join(T, 'extpopup.js'), 180, []),
    'leak': (os.path.join(T, 'leak.js'), 180, []),
    'modules': (os.path.join(T, 'modules.js'), 240, []),
    'scale': (os.path.join(T, 'scale.js'), 300, ['--pref', 'layout.css.devPixelsPerPx=1.5']),
    'restore': (os.path.join(T, 'restore.js'), 300, []),
}
FULL = {'integration', 'modules'}
OUT_DIR = [OUT]


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def translate_path(self, path):
        path = path.split('?', 1)[0].split('#', 1)[0]
        for prefix, folder in (('/pages/', os.path.join(FEATURE, 'pages')), ('/out/', OUT_DIR[0]), ('/v/', os.path.join(T, 'pages'))):
            if path.startswith(prefix):
                rest = path[len(prefix):]
                full = os.path.normpath(os.path.join(folder, *[p for p in rest.split('/') if p not in ('', '.', '..')]))
                return full
        return os.path.join(T, '__nothing__')

    def do_GET(self):
        # /slow/<ms>/<leaf>: a page that answers after <ms> (a slow or hung server).
        if self.path.startswith('/slow/'):
            import time
            parts = self.path.split('/')
            try:
                ms = int(parts[2])
            except (IndexError, ValueError):
                ms = 1000
            time.sleep(ms / 1000)
            self.path = '/v/' + '/'.join(parts[3:])
        return super().do_GET()


def serve():
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def report(name, returncode, text):
    lines = text.splitlines()
    passed = sum(1 for line in lines if line.startswith('PASS '))
    bad = [line for line in lines if line.startswith(('FAIL', 'ERROR', '[run]', 'Traceback', '[console.error]')) or 'no window found' in line]
    print('%-11s %s  (%d checks passed)' % (name, 'ok' if returncode == 0 else 'FAILED', passed))
    for line in bad:
        print('    ' + line[:600])
    with open(os.path.join(OUT, 'log-%s.txt' % name), 'w', encoding='utf-8') as f:
        f.write(text)
    return returncode == 0


def main():
    args = sys.argv[1:]
    app = 'build-menus-verify'
    full = 'build-menus-verify-full'
    custom = False
    if '--app' in args:
        i = args.index('--app')
        app = full = args[i + 1]
        custom = True
        del args[i:i + 2]
    build = '--no-build' not in args
    args = [a for a in args if a != '--no-build']
    # --tag NAME: a separate run (profiles menus-verify-NAME-<suite>, output out-NAME), e.g. the
    # suites against a snapshot of an earlier build for before / after evidence.
    tag = ''
    if '--tag' in args:
        i = args.index('--tag')
        tag = args[i + 1]
        del args[i:i + 2]
    global OUT
    if tag:
        OUT = os.path.join(T, 'out-' + tag)
    names = args or list(TESTS)
    for name in names:
        if name not in TESTS:
            sys.exit('no such test: %s (have: %s)' % (name, ', '.join(TESTS)))
    os.makedirs(OUT, exist_ok=True)
    OUT_DIR[0] = OUT
    if build and not custom:
        for cmd in (['node', os.path.join(ROOT, 'tools', 'build.mjs'), '--out=' + app, '--modules=menus'],
                    ['node', os.path.join(ROOT, 'tools', 'build.mjs'), '--out=' + full]):
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
            if r.returncode:
                sys.exit('build failed: %s\n%s' % (' '.join(cmd[2:]), r.stdout + r.stderr))
    httpd = serve()
    base = 'http://127.0.0.1:%d/' % httpd.server_address[1]
    ok = True
    try:
        for name in names:
            script, timeout, extra = TESTS[name]
            cmd = RUN + ['--test', script, '--name', 'menus-verify-' + (tag + '-' if tag else '') + name, '--timeout', str(timeout), '--out', OUT,
                         '--env', 'VITRE_MENUS_BASE=' + base, '--env', 'VITRE_MENUS_FEATURE=' + FEATURE,
                         '--app', full if name in FULL else app] + extra
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace')
            ok &= report(name, r.returncode, r.stdout + r.stderr)
            if name == 'look':
                c = subprocess.run([PY, os.path.join(FEATURE, 'check.py'), os.path.join(OUT, 'log-look.txt')], cwd=ROOT, capture_output=True, text=True)
                print(c.stdout.rstrip())
                ok &= c.returncode == 0
    finally:
        httpd.shutdown()
    for f in os.listdir(OUT):
        if f.endswith('.done'):
            os.remove(os.path.join(OUT, f))
    print('ALL OK' if ok else 'SOME FAILED')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
