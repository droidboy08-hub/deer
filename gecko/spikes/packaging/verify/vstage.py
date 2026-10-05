"""Verifier's staging: build the production layout in verify/dist/Vitre/runtime from the STOCK runtime copy.

  python spikes/packaging/verify/vstage.py [--link] [--app <dir>] [--config <file>]

verify/dist/Vitre/runtime/            copy of gecko/runtime made once by hand (cp -r)
verify/dist/Vitre/runtime/config.js   <- ../dist-files/config.js (the spike's loader, unchanged) or --config
verify/dist/Vitre/runtime/vitre/      <- verify/app (copy of the spike's app/) : copy, or junction with --link
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SPIKE = os.path.abspath(os.path.join(HERE, '..'))
RUNTIME = os.path.join(HERE, 'dist', 'Vitre', 'runtime')


def is_junction(path):
    try:
        return bool(os.lstat(path).st_file_attributes & 0x400)
    except OSError:
        return False


def remove(path):
    if os.path.islink(path) or is_junction(path):
        os.rmdir(path)
    elif os.path.isdir(path):
        shutil.rmtree(path)


def arg(name, default):
    if name in sys.argv:
        return sys.argv[sys.argv.index(name) + 1]
    return default


def main():
    link = '--link' in sys.argv
    app = os.path.abspath(arg('--app', os.path.join(HERE, 'app')))
    config = os.path.abspath(arg('--config', os.path.join(SPIKE, 'dist-files', 'config.js')))
    if not os.path.isfile(os.path.join(RUNTIME, 'firefox.exe')):
        sys.exit('runtime copy missing at ' + RUNTIME)
    shutil.copyfile(config, os.path.join(RUNTIME, 'config.js'))
    dest = os.path.join(RUNTIME, 'vitre')
    remove(dest)
    if link:
        subprocess.run(['cmd', '/c', 'mklink', '/J', dest, app], check=True, capture_output=True)
    else:
        shutil.copytree(app, dest)
    print('staged', 'junction' if link else 'copy', app, '->', dest, '| config', config)


if __name__ == '__main__':
    main()
