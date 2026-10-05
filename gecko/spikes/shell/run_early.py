"""Prove the production entry point: chrome://vitre/ registered at AutoConfig time, before any window.

gecko/runtime/config.js only loads a boot script after a window has finished starting, and spikes
may not edit gecko/runtime. So this wrapper works on a throwaway COPY of the runtime in %TEMP%
(about 350 MB, deleted afterwards unless --keep-runtime), whose config.js is early/config.js:
the same file plus one early `autoRegister(chrome.manifest)`. Everything else is tools/run.py.

  python spikes/shell/run_early.py --boot spikes/shell/boot-early.js --name shell-early --url https://example.com
"""
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..', 'tools')))
import run as base  # noqa: E402

COPY = os.path.join(tempfile.gettempdir(), 'vitre-shell-spike-runtime')


def main():
    keep = '--keep-runtime' in sys.argv
    if keep:
        sys.argv.remove('--keep-runtime')
    src = os.path.join(base.ROOT, 'runtime')
    if not os.path.exists(os.path.join(COPY, 'firefox.exe')):
        print('[early] copying runtime to', COPY)
        shutil.copytree(src, COPY, dirs_exist_ok=True)
    shutil.copyfile(os.path.join(HERE, 'early', 'config.js'), os.path.join(COPY, 'config.js'))
    base.FIREFOX = os.path.join(COPY, 'firefox.exe')
    os.environ['VITRE_MANIFEST'] = os.path.join(HERE, 'chrome.manifest')
    os.environ['VITRE_EARLY'] = '1'
    try:
        base.main()
    finally:
        if not keep:
            shutil.rmtree(COPY, ignore_errors=True)
            print('[early] removed', COPY)


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    main()
