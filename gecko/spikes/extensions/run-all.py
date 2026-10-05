"""Run every script of the "extensions" spike and keep one log per script in out/.

  python spikes/extensions/run-all.py            # everything
  python spikes/extensions/run-all.py block a    # only scripts whose key starts with these

Starts the local test server (serve.py, 127.0.0.1:47631) if it is not already running and builds
the test packages. Captures go to spikes/extensions/out/*.png.
"""
import os
import socket
import subprocess
import sys
import time

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, 'out')
os.makedirs(out, exist_ok=True)
py = sys.executable
COMMON = ['--pref', 'network.dns.disableIPv6=true',
          # Parallel spikes steal OS focus, which closes XUL popups; keep them open for captures.
          '--pref', 'ui.popup.disable_autohide=true']

# key, boot script, profile name, timeout, mode
RUNS = [
    ('block', 'boot-block.js', 'extensions-block', 120, 'release'),
    ('a', 'boot-buttons-a.js', 'extensions-a', 150, 'release'),
    ('b', 'boot-buttons-b.js', 'extensions-b', 150, 'release'),
    ('install-link-release', 'boot-install.js', 'extensions-inst', 150, 'release'),
    ('install-link-unsigned-ok', 'boot-install.js', 'extensions-inst-real', 120, 'unsigned'),
    ('install-amo-unsigned-ok', 'boot-install-amo.js', 'extensions-amo-real', 120, 'unsigned'),
    ('anchor', 'boot-anchor.js', 'extensions-anchor', 90, 'release'),
    ('pages', 'boot-pages.js', 'extensions-pages', 180, 'release'),
    ('manage', 'boot-manage.js', 'extensions-manage', 180, 'release'),
    ('cws', 'boot-cws.js', 'extensions-cws', 120, 'release'),
    # Three runs on one kept profile: install + unpin, restart + pin, restart + check.
    ('persist', 'boot-persist.js', 'extensions-persist', 120, 'persist'),
]


def server_up():
    try:
        socket.create_connection(('127.0.0.1', 47631), timeout=1).close()
        return True
    except OSError:
        return False


def main():
    only = sys.argv[1:]
    subprocess.check_call([py, os.path.join(here, 'build-xpi.py')])
    server = None
    if not server_up():
        server = subprocess.Popen([py, os.path.join(here, 'serve.py')])
        time.sleep(1)
    try:
        for key, boot, name, timeout, mode in RUNS:
            if only and not any(key.startswith(o) for o in only):
                continue
            print('=== %s (%s, %s)' % (key, boot, mode), flush=True)
            if mode == 'persist':
                import shutil
                import tempfile
                shutil.rmtree(os.path.join(tempfile.gettempdir(), 'vitre-gecko-' + name), ignore_errors=True)
                text = ''
                for _ in range(3):
                    res = subprocess.run([py, os.path.join(here, 'run-install-real.py'), boot, name, '--keep-profile'],
                                         capture_output=True, text=True, encoding='utf-8', errors='replace')
                    text += res.stdout + res.stderr
                with open(os.path.join(out, key + '.log'), 'w', encoding='utf-8') as f:
                    f.write(text)
                print(text, flush=True)
                continue
            if mode == 'unsigned':
                cmd = [py, os.path.join(here, 'run-install-real.py'), boot, name]
            else:
                cmd = [py, os.path.join(here, 'runx.py'), '--boot', os.path.join(here, boot), '--name', name,
                       '--url', 'about:blank', '--timeout', str(timeout)] + COMMON
            res = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
            text = res.stdout + res.stderr
            with open(os.path.join(out, key + '.log'), 'w', encoding='utf-8') as f:
                f.write(text)
            print(text, flush=True)
    finally:
        if server:
            server.terminate()


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
