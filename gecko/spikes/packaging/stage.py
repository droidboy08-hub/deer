"""Stage the Vitre production layout into this spike's private runtime copy.

  python spikes/packaging/stage.py [--link]

dist/Vitre/runtime/            stock Firefox 157 (copied once from gecko/runtime)
dist/Vitre/runtime/config.js   <- dist-files/config.js       (the Vitre loader)
dist/Vitre/runtime/vitre/      <- app/                       (the chrome package)

--link makes runtime/vitre a directory junction to app/ instead of a copy (dev loop: edit in place).
"""
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RUNTIME = os.path.join(HERE, 'dist', 'Vitre', 'runtime')
APP = os.path.join(HERE, 'app')


def remove(path):
    if os.path.islink(path) or (os.path.isdir(path) and os.path.exists(path) and is_junction(path)):
        os.rmdir(path)  # removes the junction only, never the target
    elif os.path.isdir(path):
        shutil.rmtree(path)


def is_junction(path):
    try:
        return bool(os.lstat(path).st_file_attributes & 0x400)  # FILE_ATTRIBUTE_REPARSE_POINT
    except OSError:
        return False


def main():
    link = '--link' in sys.argv
    if not os.path.isfile(os.path.join(RUNTIME, 'firefox.exe')):
        sys.exit('runtime copy missing: copy gecko/runtime to ' + RUNTIME + ' first')
    shutil.copyfile(os.path.join(HERE, 'dist-files', 'config.js'), os.path.join(RUNTIME, 'config.js'))
    dest = os.path.join(RUNTIME, 'vitre')
    remove(dest)
    if link:
        subprocess.run(['cmd', '/c', 'mklink', '/J', dest, APP], check=True, capture_output=True)
    else:
        shutil.copytree(APP, dest)
    # (Window icons are set at runtime with nsIWindowsUIUtils.setWindowIcon; the old
    # chrome/icons/default/<window id>.ico lookup did not work on 157, so nothing is staged for it.)
    for stale in (os.path.join(RUNTIME, 'browser', 'chrome', 'icons'), os.path.join(RUNTIME, 'chrome', 'icons')):
        if os.path.isdir(stale):
            shutil.rmtree(stale)
    print('staged', 'junction' if link else 'copy', '->', dest)


if __name__ == '__main__':
    main()
