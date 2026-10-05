"""Does Gecko's startup cache serve STALE Vitre code after the app folder is updated?

  python spikes/packaging/test-cache.py

Uses variants/cache (a copy of app/) through VITRE_APP and one kept profile:
  run 1  v1 files, long session, normal quit   -> caches written
  run 2  files edited to v2, same profile      -> which version runs?
  run 3  same, with -purgecaches               -> v2 expected
  run 4  no flag again                         -> stays v2?
  run 5  files edited to v3, pref nglayout.debug.disable_xul_cache=true, no purge -> ?
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# --in-runtime: test the PRODUCTION location (dist/Vitre/runtime/vitre as a real copy, no VITRE_APP).
IN_RUNTIME = '--in-runtime' in sys.argv
VAR = os.path.join(HERE, 'dist', 'Vitre', 'runtime', 'vitre') if IN_RUNTIME else os.path.join(HERE, 'variants', 'cache')
NAME = 'packaging-cache' + ('rt' if IN_RUNTIME else '')


def edit(version, color):
    with open(os.path.join(VAR, 'chrome', 'window.js'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('window.VitreWindowProbe = { loaded: "window.js v%d", hasGBrowser: typeof gBrowser !== "undefined" };\n' % version)
    p = os.path.join(VAR, 'modules', 'VitreProbe.sys.mjs')
    s = open(p, encoding='utf-8').read()
    import re
    s = re.sub(r'version: \d+,', 'version: %d,' % version, s)
    open(p, 'w', encoding='utf-8', newline='\n').write(s)
    p = os.path.join(VAR, 'skin', 'vitre.css')
    s = open(p, encoding='utf-8').read()
    s = re.sub(r'background: rgb\([^)]*\);', 'background: rgb(%s);' % color, s, count=1)
    open(p, 'w', encoding='utf-8', newline='\n').write(s)


def run(label, extra=(), wait='0'):
    cmd = [sys.executable, os.path.join(HERE, 'run-dist.py'), '--name', NAME, '--keep-profile',
           '--boot', os.path.join(HERE, 'boot-cache.js'), *([] if IN_RUNTIME else ['--env', 'VITRE_APP=' + VAR]), '--env', 'VITRE_CACHE_WAIT=' + wait,
           '--env', 'VITRE_CACHE_LABEL=' + label, '--url', 'https://example.com', '--timeout', '120', *extra]
    out = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace').stdout
    for line in out.split('\n'):
        if line.startswith('VERSIONS') or line.startswith('ERROR') or 'timed out' in line or 'exited by itself' in line:
            print('[%s] %s' % (label, line))


def main():
    import tempfile
    shutil.rmtree(os.path.join(tempfile.gettempdir(), 'vitre-gecko-' + NAME), ignore_errors=True)
    if IN_RUNTIME:
        subprocess.run([sys.executable, os.path.join(HERE, 'stage.py')], check=True)  # real copy, not a junction
    else:
        shutil.rmtree(VAR, ignore_errors=True)
        shutil.copytree(os.path.join(HERE, 'app'), VAR)
    edit(1, '10, 132, 255')
    run('run1 v1 on disk, fresh profile, 30 s session then normal quit', wait='30')
    prof = os.path.join(tempfile.gettempdir(), 'vitre-gecko-' + NAME)
    for sub in ('startupCache',):
        d = os.path.join(prof, sub)
        print('[cache files]', sub, sorted(os.listdir(d)) if os.path.isdir(d) else 'missing')
    edit(2, '200, 0, 0')
    run('run2 v2 on disk, same profile, no flag')
    run('run3 v2 on disk, -purgecaches', extra=['--arg=-purgecaches'], wait='30')
    run('run4 v2 on disk, no flag')
    edit(3, '0, 160, 0')
    run('run5 v3 on disk, nglayout.debug.disable_xul_cache=true', extra=['--pref', 'nglayout.debug.disable_xul_cache=true'])
    run('run6 v3 on disk, no flag')
    if IN_RUNTIME:
        subprocess.run([sys.executable, os.path.join(HERE, 'stage.py'), '--link'], check=True)  # back to the dev junction


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
