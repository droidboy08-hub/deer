"""Verifier's wrapper around the spike's run-dist.py.

  python spikes/packaging/verify/vrun.py <name> [run-dist args...]

- runtime  = verify/dist/Vitre/runtime (my own copy of the stock runtime, staged by vstage.py)
- out      = verify/out/<name>
- profile  = %TEMP%/vitre-gecko-packaging-verify-<name>
- ALWAYS adds the two prefs that stop the stock runtime from writing shortcuts into the user's
  Start Menu on every fresh profile (see VERIFY.md, finding S1):
      browser.shell.customIcon.enabled=false
      browser.privacySegmentation.createdShortcut=true
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SPIKE = os.path.abspath(os.path.join(HERE, '..'))


def main():
    name = sys.argv[1]
    rest = sys.argv[2:]
    cmd = [sys.executable, os.path.join(SPIKE, 'run-dist.py'), '--name', 'packaging-verify-' + name,
           '--out', os.path.join(HERE, 'out', name)]
    if '--runtime' not in rest:
        cmd += ['--runtime', os.path.join(HERE, 'dist', 'Vitre', 'runtime')]
    cmd += ['--pref', 'browser.shell.customIcon.enabled=false', '--pref', 'browser.privacySegmentation.createdShortcut=true']
    cmd += rest
    sys.exit(subprocess.run(cmd).returncode)


if __name__ == '__main__':
    main()
