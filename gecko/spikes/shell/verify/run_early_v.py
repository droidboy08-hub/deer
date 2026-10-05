"""Verifier variant of ../run_early.py: registers verify/chrome.manifest (whose VitreShell also logs
windowUtils.paintCount in every hook) at AutoConfig time, on a throwaway copy of the runtime.

  python spikes/shell/verify/run_early_v.py --boot spikes/shell/boot-early.js --name shell-verify-k-earlyv --url https://example.com --out spikes/shell/verify/out/earlyv
"""
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..', '..', 'tools')))
import run as base  # noqa: E402

COPY = os.path.join(tempfile.gettempdir(), 'vitre-shell-verify-runtime')


def main():
    src = os.path.join(base.ROOT, 'runtime')
    if not os.path.exists(os.path.join(COPY, 'firefox.exe')):
        print('[early] copying runtime to', COPY)
        shutil.copytree(src, COPY, dirs_exist_ok=True)
    shutil.copyfile(os.path.join(HERE, '..', 'early', 'config.js'), os.path.join(COPY, 'config.js'))
    base.FIREFOX = os.path.join(COPY, 'firefox.exe')
    os.environ['VITRE_MANIFEST'] = os.path.join(HERE, 'chrome.manifest')
    os.environ['VITRE_EARLY'] = '1'
    try:
        base.main()
    finally:
        shutil.rmtree(COPY, ignore_errors=True)
        print('[early] removed', COPY)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
