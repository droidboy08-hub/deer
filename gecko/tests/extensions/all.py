"""Run the extensions test set: builds the module's two outputs, the test extensions, then every test.

  python tests/extensions/all.py [--only bar,settings] [--no-amo]

  build-extensions        the extensions module with the 'menus' and 'settings' modules it uses
  build-extensions-solo   the extensions module alone (fallback.js: no menus, no settings)
Captures and logs land in tests/extensions/out. Exit code 1 if any test failed.
--no-amo skips the read-only load of the real addons.mozilla.org listing in install.js.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

TESTS = [
    # (script, profile name, app, timeout, extra args)
    ('bar.js', 'extensions-bar', 'build-extensions', 260, []),
    ('install.js', 'extensions-install', 'build-extensions', 200, []),
    ('settings.js', 'extensions-settings', 'build-extensions', 240, []),
    ('persist.js', 'extensions-persist', 'build-extensions', 240, []),
    ('private.js', 'extensions-private', 'build-extensions', 240, []),
    ('update.js', 'extensions-update', 'build-extensions', 240, ['--pref', 'extensions.checkUpdateSecurity=false']),
    ('fallback.js', 'extensions-fallback', 'build-extensions-solo', 200, []),
]


def main():
    only = None
    if '--only' in sys.argv:
        only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
    env = dict(os.environ)
    if '--no-amo' in sys.argv:
        env['VITRE_AMO'] = '0'
    node = 'node'
    subprocess.run([node, 'tools/build.mjs', '--out=build-extensions', '--modules=extensions,menus,settings'], cwd=ROOT, check=True, shell=os.name == 'nt')
    subprocess.run([node, 'tools/build.mjs', '--out=build-extensions-solo', '--modules=extensions'], cwd=ROOT, check=True, shell=os.name == 'nt')
    subprocess.run([sys.executable, os.path.join(HERE, 'make-extensions.py')], check=True)
    failed = []
    for script, name, app, timeout, extra in TESTS:
        if only and script.replace('.js', '') not in only:
            continue
        print('==== %s' % script, flush=True)
        args = [sys.executable, os.path.join(HERE, 'runx.py'), '--test', os.path.join(HERE, script), '--name', name,
                '--app', app, '--timeout', str(timeout)] + extra
        if '--env' not in extra and env.get('VITRE_AMO') == '0':
            args += ['--env', 'VITRE_AMO=0']
        code = subprocess.run(args, cwd=ROOT, env=env).returncode
        if code:
            failed.append(script)
    print('==== failed: %s' % (', '.join(failed) if failed else 'none'))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
