"""Wire the stock Firefox runtime for Vitre. Idempotent; run it again after changing the overlay.

  python tools/setup-runtime.py [--check]

runtime/ is a private, git-ignored copy of Firefox 157. Everything Vitre adds to it is described
here, so a fresh runtime (or a newer Firefox) is wired with one command:

  1. tools/runtime-overlay/**  ->  runtime/**   (the tracked source of these files)
       config.js                                  AutoConfig loader (launch guard, package, test hook)
       defaults/pref/config-prefs.js              tells Gecko to run config.js unsandboxed
       defaults/pref/vitre-prefs.js               product defaults
       distribution/policies.json                 no self-update, no telemetry, no default-browser agent
       browser/chrome/icons/default/vitre.ico     window icon (root attribute icon="vitre")
  2. runtime/vitre.exe  = a byte copy of runtime/firefox.exe. Vitre runs as vitre.exe (every child
     process carries that image name too), so tools keyed on the name "firefox.exe" leave it alone.
     The copy keeps Mozilla's signature valid. Redo after replacing the runtime.
  3. runtime/vitre  = a junction to ../build (the chrome package). Sandboxed content processes can
     only read files inside the runtime directory, so the package has to appear there.
  4. runtime/crashreporter.exe is renamed to crashreporter.exe.off: with Mozilla's identity it would
     tidy the installed Firefox's crash folder (%APPDATA%\\Mozilla\\Firefox\\Crash Reports).

--check only reports what is out of date and exits 1 if anything is.
"""
import filecmp
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
RUNTIME = os.path.join(ROOT, 'runtime')
OVERLAY = os.path.join(ROOT, 'tools', 'runtime-overlay')
BUILD = os.path.join(ROOT, 'build')


def is_junction(path):
    try:
        return os.path.isjunction(path)
    except AttributeError:  # Python < 3.12
        return bool(os.path.isdir(path) and os.lstat(path).st_file_attributes & 0x400)


def same_target(link, target):
    try:
        return os.path.normcase(os.path.realpath(link)) == os.path.normcase(os.path.realpath(target))
    except OSError:
        return False


def main():
    check = '--check' in sys.argv
    stale = []
    if not os.path.exists(os.path.join(RUNTIME, 'firefox.exe')):
        sys.exit('no runtime: %s\\firefox.exe is missing' % RUNTIME)

    # 1. overlay files
    for folder, _dirs, files in os.walk(OVERLAY):
        for name in files:
            src = os.path.join(folder, name)
            dst = os.path.join(RUNTIME, os.path.relpath(src, OVERLAY))
            if os.path.exists(dst) and filecmp.cmp(src, dst, shallow=False):
                continue
            stale.append(os.path.relpath(dst, ROOT))
            if not check:
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copyfile(src, dst)

    # 2. vitre.exe
    exe, firefox = os.path.join(RUNTIME, 'vitre.exe'), os.path.join(RUNTIME, 'firefox.exe')
    if not (os.path.exists(exe) and filecmp.cmp(firefox, exe, shallow=False)):
        stale.append('runtime\\vitre.exe')
        if not check:
            shutil.copyfile(firefox, exe)

    # 3. junction runtime\vitre -> ..\build
    link = os.path.join(RUNTIME, 'vitre')
    if not (is_junction(link) and same_target(link, BUILD)):
        stale.append('runtime\\vitre (junction)')
        if not check:
            os.makedirs(BUILD, exist_ok=True)
            if is_junction(link):
                os.rmdir(link)  # removes the junction only, never its target
            elif os.path.exists(link):
                sys.exit('%s exists and is not a junction; move it away first' % link)
            r = subprocess.run(['cmd', '/c', 'mklink', '/J', link, BUILD], capture_output=True, text=True)
            if r.returncode:
                sys.exit('mklink failed: ' + (r.stderr or r.stdout))

    # 4. Mozilla's crash reporter, renamed out of the way (crashreporter.exe.off). This runtime keeps
    # Mozilla's identity, so about a minute into every session the crash manager runs
    # crashreporter.exe --ping-cleanup on the INSTALLED Firefox's "%APPDATA%\Mozilla\Firefox\Crash
    # Reports" (release check, 2026-10-05). The release engine leaves the file out (setup-engine.py STRIP).
    reporter = os.path.join(RUNTIME, 'crashreporter.exe')
    if os.path.exists(reporter):
        stale.append('runtime\\crashreporter.exe (renamed to crashreporter.exe.off)')
        if not check:
            parked = reporter + '.off'
            if os.path.exists(parked):
                os.remove(parked)
            os.rename(reporter, parked)

    if not stale:
        print('runtime is wired for Vitre: nothing to do')
    elif check:
        print('out of date:\n  ' + '\n  '.join(stale))
        sys.exit(1)
    else:
        print('updated:\n  ' + '\n  '.join(stale))


if __name__ == '__main__':
    main()
