"""Run the verifier's checks of the "extensions" spike. Logs and captures: verify/out/<key>/.

  python spikes/extensions/verify/run-verify.py            # everything (about 25 minutes)
  python spikes/extensions/verify/run-verify.py vkeys vwin2  # only these keys

Starts the local test server (verify/serve.py on 127.0.0.1:47631) if it is not running and builds
the local test packages (verify/build-test-packages.py). Nothing is downloaded; the only real
sites visited are example.com/.org/.net and the addons.mozilla.org listing page (read only).

Keys without a "v" prefix re-run the ORIGINAL spike scripts in place (read only) under
"extensions-verify-*" profile names. "unsigned" = automation mode with signatures off, exactly as
the original run-install-real.py does. Everything else runs on the stock release configuration.
"""
import os
import socket
import subprocess
import sys
import time

here = os.path.dirname(os.path.abspath(__file__))
py = sys.executable

# key, boot script, mode, number of runs on one profile, extra arguments
RUNS = [
    # --- the original spike scripts
    ('block', 'boot-block.js', 'release', 1, []),
    ('a', 'boot-buttons-a.js', 'release', 1, []),
    ('b', 'boot-buttons-b.js', 'release', 1, []),
    ('install-link-release', 'boot-install.js', 'release', 1, []),
    ('install-link-unsigned-ok', 'boot-install.js', 'unsigned', 1, []),
    ('install-amo-unsigned-ok', 'boot-install-amo.js', 'unsigned', 1, []),
    ('anchor', 'boot-anchor.js', 'release', 1, []),
    ('pages', 'boot-pages.js', 'release', 1, ['--timeout', '200']),
    ('manage', 'boot-manage.js', 'release', 1, ['--timeout', '200']),
    ('cws', 'boot-cws.js', 'release', 1, []),
    ('persist', 'boot-persist.js', 'unsigned', 3, ['--timeout', '100']),
    ('a-hiddenpref', 'boot-buttons-a.js', 'release', 1, ['--pref', 'extensions.unifiedExtensions.button.always_visible=false']),
    # --- the verifier's own scripts
    ('vkeys', 'v-keys.js', 'release', 1, ['--timeout', '120']),
    ('vwin2', 'v-win2.js', 'release', 1, ['--timeout', '200']),
    ('vmisc', 'v-misc.js', 'release', 1, []),
    ('vmenu', 'v-menu.js', 'release', 1, ['--timeout', '100']),
    ('vempty', 'v-empty.js', 'release', 1, ['--timeout', '100']),
    ('vpageaction', 'v-pageaction.js', 'release', 1, ['--timeout', '120']),
    ('vamo', 'v-amo-readonly.js', 'release', 1, ['--timeout', '120']),
    ('vtemp', 'v-temp-persist.js', 'release', 3, ['--timeout', '100']),
    ('vunsigned', 'v-unsigned-perm.js', 'release', 3, ['--timeout', '100']),
    ('vinstall-flow', 'v-install-flow.js', 'release', 1, ['--timeout', '120']),
    ('vupdate', 'v-update.js', 'release', 1, ['--pref', 'extensions.checkUpdateSecurity=false']),
    ('vbuiltin', 'v-builtin.js', 'release', 2, ['--timeout', '100']),
    ('vcws', 'v-cws.js', 'release', 1, ['--timeout', '120']),
]


def server_up():
    try:
        socket.create_connection(('127.0.0.1', 47631), timeout=1).close()
        return True
    except OSError:
        return False


def main():
    only = sys.argv[1:]
    subprocess.check_call([py, os.path.join(here, 'build-test-packages.py')])
    server = None
    if not server_up():
        server = subprocess.Popen([py, os.path.join(here, 'serve.py')])
        time.sleep(1)
    try:
        for key, boot, mode, runs, extra in RUNS:
            if only and key not in only:
                continue
            for n in range(runs):
                print('=== %s (%s, %s) run %d/%d' % (key, boot, mode, n + 1, runs), flush=True)
                cmd = [py, os.path.join(here, 'rerun.py'), key, boot, mode] + extra
                if n:
                    cmd += ['--keep-profile', '--append']
                subprocess.call(cmd)
    finally:
        if server:
            server.terminate()


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
