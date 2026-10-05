"""Verify-only wrapper around tools/run.py (which must not be edited).

  python spikes/switcher/verify/run_v.py --boot ... --name ... --url vitre:none   -> start Firefox with NO url argument
                                                                                     (so a restored session keeps its own selected tab)
  VX_FIREFOX=<path to a firefox.exe>  python .../run_v.py ...                      -> use another copy of the runtime
                                                                                     (a scratch copy with a different config.js)
Everything else is tools/run.py unchanged.
"""
import importlib.util
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
spec = importlib.util.spec_from_file_location('vitre_run', os.path.join(ROOT, 'tools', 'run.py'))
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)

if os.environ.get('VX_FIREFOX'):
    run.FIREFOX = os.environ['VX_FIREFOX']

_Popen = subprocess.Popen


class Popen(_Popen):
    def __init__(self, args, *a, **kw):
        if isinstance(args, list) and args and args[-1] == 'vitre:none':
            args = args[:-1]
        super().__init__(args, *a, **kw)


subprocess.Popen = Popen

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    run.main()
