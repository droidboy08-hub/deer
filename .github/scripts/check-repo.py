"""Check what the repository holds: no engines, Mozilla binaries, profiles, captures or large files.

  python .github/scripts/check-repo.py

Lists the files git would keep in the repository this script belongs to (tracked plus
untracked-but-not-ignored, so it also works before the first commit), wherever it is run from, and
fails when one of them breaks a rule below. Absolute paths with a Windows user folder are reported
as warnings only. Exit code: 0 ok, 1 a rule is broken, 2 git is missing or this is not a git
repository. Standard library only.
"""
import os
import re
import subprocess
import sys

MAX_BYTES = 5 * 1024 * 1024

# Never committed: Mozilla's binaries and archives, add-on packages, browser profile data.
BAD_SUFFIXES = (
    '.exe', '.dll', '.msi', '.msix', '.ja', '.7z', '.xpi', '.crx',
    '.sqlite', '.sqlite-wal', '.sqlite-shm', '.mozlz4', '.jsonlz4', '.baklz4', '.lz4',
)
# Never committed: engines, extracted Mozilla source, build output, dependencies, test output.
BAD_PARTS = re.compile(
    r'(^|/)(runtime|node_modules|out|out-[^/]+|build|build-[^/]+|dist|__pycache__)/'
    r'|^app/dist-[^/]+/|^gecko/engines/|^gecko/reference/omni[^/]*/|^\.workflows/'
)
# Files only a browser profile holds (lower case), including the markers Deer's launchers and the
# test runner put in every profile they create.
BAD_NAMES = {'parent.lock', '.parentlock', 'cookies.sqlite', 'places.sqlite', 'key4.db', 'logins.json', 'cert9.db',
             'times.json', 'compatibility.ini', 'xulstore.json', 'sessioncheckpoints.json',
             'vitre-profile', 'vitre-harness'}
# Text files every Gecko engine folder holds (lower case). The engine's binaries are ignored by
# type, so an engine copied to an unexpected place (an install folder, a renamed runtime) would
# otherwise slip in through its text files. Deliberately not in .gitignore, so this check sees them.
ENGINE_NAMES = {'platform.ini', 'dependentlibs.list', 'precomplete', 'removed-files', 'channel-prefs.js',
                'firefox.visualelementsmanifest.xml', 'dev-engine-do-not-ship.txt'}
# Allowed despite the rules above: small archives the tests serve as downloads.
ALLOWED = re.compile(r'^gecko/tests/[^/]+/pages/files/[^/]+\.zip$')
# Images belong only in documentation, the browser's sources, tests' fixtures and icons.
IMAGE = re.compile(r'\.(png|jpe?g|gif|webp|bmp)$', re.I)
IMAGE_OK = re.compile(r'^docs/images/|^design/|^gecko/src/|^gecko/tools/runtime-overlay/|^gecko/installer/|(^|/)icon[^/]*\.png$|(^|/)pixel\.png$')
# C:\Users\<name>, C:/Users/<name>, C:\\Users\\<name> (escaped) and the MSYS form /c/Users/<name>.
USER_PATH = re.compile(r'\b[A-Za-z]:(?:\\{1,2}|/)Users(?:\\{1,2}|/)[^\\/\s"\'<>`]+|(?<![\w.])/[a-z]/Users/[^/\s"\'<>`]+')
TEXT_SUFFIXES = ('.md', '.txt', '.js', '.mjs', '.ts', '.py', '.json', '.html', '.css', '.cmd', '.ps1', '.sh', '.cs', '.ftl',
                 '.yml', '.xhtml', '.ini', '.manifest', '.properties', '.svg')
HERE = os.path.dirname(os.path.abspath(__file__))


def git(*args):
    return subprocess.run(['git', '-C', HERE] + list(args), capture_output=True, check=True).stdout


def repo_files():
    try:
        root = git('rev-parse', '--show-toplevel').decode('utf-8').strip()
        out = git('-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z')
    except FileNotFoundError:
        print('git is not installed or not on PATH')
        sys.exit(2)
    except subprocess.CalledProcessError as e:
        print('not a git repository (run "git init" in the project folder first): %s'
              % e.stderr.decode('utf-8', 'replace').strip())
        sys.exit(2)
    names = sorted({n for n in out.decode('utf-8').split('\0') if n})
    return root, names


def main():
    sys.stdout.reconfigure(errors='replace')  # file names and paths may not fit the console's code page
    root, names = repo_files()
    errors, warnings, sizes = [], [], []
    for name in names:
        path = os.path.join(root, name)
        if not os.path.isfile(path):
            continue  # deleted in the working tree
        size = os.path.getsize(path)
        sizes.append((size, name))
        low = name.lower()
        if size > MAX_BYTES:
            errors.append('%s: %.1f MB (limit %d MB)' % (name, size / 1048576, MAX_BYTES // 1048576))
        if ALLOWED.match(name):
            continue
        if low.endswith(BAD_SUFFIXES) or low.endswith('.zip'):
            errors.append('%s: binary or archive type that is never committed' % name)
        if BAD_PARTS.search(name):
            errors.append('%s: inside a folder that is never committed (engine, build or test output)' % name)
        if os.path.basename(low) in BAD_NAMES:
            errors.append('%s: browser profile data' % name)
        if os.path.basename(low) in ENGINE_NAMES:
            errors.append('%s: part of a copy of the engine (Mozilla\'s files are never committed)' % name)
        if IMAGE.search(name) and not IMAGE_OK.search(name):
            errors.append('%s: an image outside docs/, design/ and the sources (a test capture?)' % name)
        if low.endswith(TEXT_SUFFIXES) and size < MAX_BYTES:
            with open(path, 'rb') as f:
                found = sorted(set(USER_PATH.findall(f.read().decode('utf-8', 'replace'))))
            if found:
                warnings.append('%s: absolute user path %s' % (name, ', '.join(found[:3])))

    # A profile folder left in the tree: its tell-tale files are ignored above, so look on disk for
    # them next to the files that would be committed (works before the first commit, which is when
    # it matters), and for a profile's own prefs.js (written by the engine, "user_pref(" lines).
    for folder in sorted({os.path.dirname(name) for _size, name in sizes}):
        try:
            entries = {e.lower() for e in os.listdir(os.path.join(root, folder))}
        except OSError:
            continue
        markers = sorted(entries & BAD_NAMES)
        if markers:
            errors.append('%s/: a browser profile folder (holds %s); delete it or move it into an out/ folder'
                          % (folder or '.', ', '.join(markers)))
    for _size, name in sizes:
        if os.path.basename(name).lower() in ('prefs.js', 'user.js'):
            with open(os.path.join(root, name), 'rb') as f:
                if b'user_pref(' in f.read():
                    errors.append('%s: preferences written into a browser profile' % name)

    total = sum(s for s, _ in sizes)
    print('%d files, %.2f MB' % (len(sizes), total / 1048576))
    print('largest:')
    for size, name in sorted(sizes, reverse=True)[:10]:
        print('  %8.1f KB  %s' % (size / 1024, name))
    for w in warnings:
        print('warning: ' + w)
    for e in errors:
        print('error: ' + e)
    if errors:
        print('%d problem(s); fix .gitignore or remove the files' % len(errors))
        return 1
    print('ok')
    return 0


if __name__ == '__main__':
    sys.exit(main())
