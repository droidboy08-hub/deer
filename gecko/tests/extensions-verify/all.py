"""The extensions verifier's set: the builder's seven scripts (tests/extensions) rerun under this
key's names and build, then the attack scripts in this folder.

  python tests/extensions-verify/all.py [--only bar,keys] [--skip-builder] [--no-amo]

Builds (never build/ or another author's folder):
  build-extensions-verify        extensions + menus + settings (what tests/extensions uses)
  build-extensions-verify-solo   the extensions module alone (fallback.js)
  build-extensions-verify-all    every module of the tree (the attacks that need the core as shipped)
Profiles are named extensions-verify-<script>. Logs and captures: tests/extensions-verify/out/<script>/.
The test extensions and the local site are tests/extensions' own (make-extensions.py); this folder
adds a few more of its own (make-more.py -> tests/extensions-verify/build).
Exit code 1 if any script failed.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
XT = os.path.join(ROOT, 'tests', 'extensions')
OUT = os.path.join(HERE, 'out')

BUILD = 'build-extensions-verify'
SOLO = 'build-extensions-verify-solo'
FULL = 'build-extensions-verify-all'

# (folder, script, app, timeout, extra args)
BUILDER = [
    (XT, 'bar.js', BUILD, 260, []),
    (XT, 'install.js', BUILD, 200, []),
    (XT, 'settings.js', BUILD, 240, []),
    (XT, 'persist.js', BUILD, 240, []),
    (XT, 'private.js', BUILD, 240, []),
    (XT, 'update.js', BUILD, 240, ['--pref', 'extensions.checkUpdateSecurity=false']),
    (XT, 'fallback.js', SOLO, 200, []),
]
ATTACKS = [
    (HERE, 'keys.js', FULL, 240, []),
    (HERE, 'core.js', FULL, 300, []),
    (HERE, 'stress.js', FULL, 300, []),
    (HERE, 'idle.js', FULL, 200, []),
    (HERE, 'windows.js', FULL, 300, []),
    (HERE, 'scale.js', FULL, 240, []),
    (HERE, 'restore.js', FULL, 240, []),
    (HERE, 'panel.js', FULL, 240, []),
    (HERE, 'edge.js', FULL, 300, []),
    (HERE, 'rapid.js', FULL, 200, []),
    (HERE, 'realsite.js', FULL, 200, []),
]


def main():
    only = None
    if '--only' in sys.argv:
        only = set(sys.argv[sys.argv.index('--only') + 1].split(','))
    env = dict(os.environ)
    if '--no-amo' in sys.argv:
        env['VITRE_AMO'] = '0'
    shell = os.name == 'nt'
    for out, mods in ((BUILD, '--modules=extensions,menus,settings'), (SOLO, '--modules=extensions'), (FULL, None)):
        cmd = ['node', 'tools/build.mjs', '--out=' + out] + ([mods] if mods else [])
        subprocess.run(cmd, cwd=ROOT, check=True, shell=shell)
    subprocess.run([sys.executable, os.path.join(XT, 'make-extensions.py')], check=True)
    subprocess.run([sys.executable, os.path.join(HERE, 'make-more.py')], check=True)
    sets = ([] if '--skip-builder' in sys.argv else BUILDER) + ATTACKS
    failed = []
    for folder, script, app, timeout, extra in sets:
        key = script.replace('.js', '')
        tag = ('b-' if folder == XT else '') + key
        if only and key not in only and tag not in only:
            continue
        print('==== %s (%s)' % (tag, app), flush=True)
        out = os.path.join(OUT, tag)
        os.makedirs(out, exist_ok=True)
        args = [sys.executable, os.path.join(XT, 'runx.py'), '--test', os.path.join(folder, script),
                '--name', 'extensions-verify-' + tag, '--app', app, '--timeout', str(timeout), '--out', out] + extra
        if env.get('VITRE_AMO') == '0':
            args += ['--env', 'VITRE_AMO=0']
        code = subprocess.run(args, cwd=ROOT, env=env).returncode
        if code:
            failed.append(tag)
    print('==== failed: %s' % (', '.join(failed) if failed else 'none'))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
