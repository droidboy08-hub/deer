"""Extract Firefox's own UI source from an engine's omni.ja files into gecko/reference/omni.

  python tools/extract-reference.py [--engine DIR] [--out DIR] [--force]

  reference/omni/gre       <- <engine>/omni.ja          toolkit: modules, actors, localization, ...
  reference/omni/browser   <- <engine>/browser/omni.ja  browser.xhtml, tabbrowser, BrowserGlue, ...
  reference/omni/SOURCE.txt   engine version, build id and the SHA-256 of both archives

The folder is about 116 MB and is not part of the repository. It is the ground truth for the exact
engine version Deer is written against: every Firefox internal the code uses names its source file
in it (see ARCHITECTURE.md, "Rules"). Grep it; never load it.

--engine  the engine folder (the one holding omni.ja and browser/omni.ja). Default: gecko/runtime if
          it exists, else the newest gecko/engines/firefox-*/ folder.
--out     the output folder. Default: gecko/reference/omni.
--force   replace an existing output folder, but only one that holds nothing except gre, browser and
          SOURCE.txt. Without it an existing folder is left alone.

The archives are extracted into a new sibling folder (<out>.partial-*), which then takes the place
of <out>; the previous extraction is moved aside (<out>.old-*) and deleted last. A failed or
interrupted run removes its partial folder and leaves an existing extraction as it was. The
repository's .gitignore covers gecko/reference/omni*/.

Only reads the engine; never starts it. Python 3.8+, standard library only.

omni.ja is a zip archive in Mozilla's optimised layout: a 4-byte read-ahead length, then the
central directory at offset 4, then the entries. Python's zipfile cannot open that layout (it
expects the central directory just before the end record), so this script reads the archive
itself: end record, central directory, then each entry's local header and data (stored or
deflate), checking every entry's CRC-32.
"""
import argparse
import hashlib
import os
import re
import shutil
import struct
import sys
import tempfile
import zlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

EOCD_SIG = 0x06054B50
CDIR_SIG = 0x02014B50
LOCAL_SIG = 0x04034B50
EOCD_SIZE = 22
CDIR_SIZE = 46
LOCAL_SIZE = 30


class OmniError(Exception):
    pass


def read_entries(data):
    """Yield (name, bytes) for every file in a zip / Mozilla jar held in memory."""
    # End of central directory record: scan back from the end (it may carry a comment).
    pos = len(data) - EOCD_SIZE
    stop = max(-1, pos - 0xFFFF - 1)
    while pos > stop and struct.unpack_from('<I', data, pos)[0] != EOCD_SIG:
        pos -= 1
    if pos <= stop:
        raise OmniError('no end-of-central-directory record: not a zip archive')
    _sig, _disk, _cdisk, _n_here, count, cdir_size, cdir_offset, _clen = struct.unpack_from('<IHHHHIIH', data, pos)
    if cdir_offset + cdir_size > len(data):
        raise OmniError('central directory lies outside the file')

    off = cdir_offset
    for _ in range(count):
        if struct.unpack_from('<I', data, off)[0] != CDIR_SIG:
            raise OmniError('bad central directory entry at offset %d' % off)
        (_sig, _vmade, _vneed, flags, method, _time, _date, crc, csize, usize,
         nlen, xlen, clen, _disk, _iattr, _eattr, local) = struct.unpack_from('<IHHHHHHIIIHHHHHII', data, off)
        raw_name = bytes(data[off + CDIR_SIZE: off + CDIR_SIZE + nlen])
        name = raw_name.decode('utf-8' if flags & 0x800 else 'cp437')
        off += CDIR_SIZE + nlen + xlen + clen
        if name.endswith('/'):
            continue  # a directory entry
        if flags & 0x1:
            raise OmniError('%s: encrypted entries are not supported' % name)

        if struct.unpack_from('<I', data, local)[0] != LOCAL_SIG:
            raise OmniError('%s: bad local header at offset %d' % (name, local))
        lnlen, lxlen = struct.unpack_from('<HH', data, local + 26)
        start = local + LOCAL_SIZE + lnlen + lxlen
        blob = data[start: start + csize]
        if method == 0:
            body = bytes(blob)
        elif method == 8:
            body = zlib.decompressobj(-15).decompress(blob)
        else:
            raise OmniError('%s: compression method %d is not supported' % (name, method))
        if len(body) != usize or (zlib.crc32(body) & 0xFFFFFFFF) != crc:
            raise OmniError('%s: size or CRC-32 mismatch' % name)
        yield name, body


def safe_path(base, name):
    """The file path for an archive member, refusing absolute paths and '..' segments."""
    parts = name.replace('\\', '/').split('/')
    if name.startswith('/') or re.match(r'^[A-Za-z]:', name) or any(p in ('', '.', '..') for p in parts):
        raise OmniError('unsafe member name: %r' % name)
    return os.path.join(base, *parts)


def long_path(path):
    """Windows: lift the 260-character limit (some omni.ja paths are long) with the \\\\?\\ prefix."""
    if os.name != 'nt' or path.startswith('\\\\?\\'):
        return path
    return '\\\\?\\' + os.path.abspath(path)


def extract(archive, dest):
    with open(archive, 'rb') as f:
        data = f.read()
    files = size = 0
    for name, body in read_entries(memoryview(data)):
        path = long_path(safe_path(dest, name))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as out:
            out.write(body)
        files += 1
        size += len(body)
    return files, size, hashlib.sha256(data).hexdigest()


def default_engine():
    runtime = os.path.join(ROOT, 'runtime')
    if os.path.isfile(os.path.join(runtime, 'omni.ja')):
        return runtime
    engines = os.path.join(ROOT, 'engines')
    found = []
    if os.path.isdir(engines):
        for name in os.listdir(engines):
            path = os.path.join(engines, name)
            if name.startswith('firefox-') and os.path.isfile(os.path.join(path, 'omni.ja')):
                found.append((os.path.getmtime(os.path.join(path, 'omni.ja')), path))
    return max(found)[1] if found else None


def app_info(engine):
    info = {}
    try:
        with open(os.path.join(engine, 'application.ini'), encoding='utf-8') as f:
            for line in f:
                key, sep, value = line.strip().partition('=')
                if sep and key in ('Version', 'BuildID', 'SourceStamp'):
                    info.setdefault(key, value)
    except OSError:
        pass
    return info


def main():
    ap = argparse.ArgumentParser(description='Extract Firefox UI source from omni.ja into reference/omni.')
    ap.add_argument('--engine', help='engine folder holding omni.ja and browser/omni.ja')
    ap.add_argument('--out', default=os.path.join(ROOT, 'reference', 'omni'), help='output folder')
    ap.add_argument('--force', action='store_true', help='replace an existing output folder')
    args = ap.parse_args()

    engine = os.path.abspath(args.engine) if args.engine else default_engine()
    if not engine:
        sys.exit('no engine found: pass --engine <folder with omni.ja>, or run tools/setup-runtime.py first')
    sources = {'gre': os.path.join(engine, 'omni.ja'), 'browser': os.path.join(engine, 'browser', 'omni.ja')}
    for path in sources.values():
        if not os.path.isfile(path):
            sys.exit('missing %s' % path)

    out = os.path.abspath(args.out)
    if os.path.exists(out) and not os.path.isdir(out):
        sys.exit('%s exists and is not a folder' % out)
    if os.path.isdir(out) and os.listdir(out):
        if not args.force:
            sys.exit('%s already exists; pass --force to replace it' % out)
        unexpected = set(os.listdir(out)) - {'gre', 'browser', 'SOURCE.txt'}
        if unexpected:
            sys.exit('%s does not look like an extracted reference (%s); not replacing it' % (out, ', '.join(sorted(unexpected))))

    # Extract into a new folder next to the target, then swap. The folder is created here with a
    # unique name, so nothing that already exists is ever deleted, and any failure (including
    # Ctrl+C) removes it again: no half reference is left behind.
    parent, base = os.path.split(out)
    os.makedirs(parent, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix=base + '.partial-', dir=parent)
    shown = os.path.relpath(engine, ROOT) if engine.lower().startswith(ROOT.lower() + os.sep) else os.path.basename(engine)
    lines = ['Extracted by tools/extract-reference.py from %s' % shown.replace(os.sep, '/')]
    info = app_info(engine)
    if info:
        lines.append('Engine: Firefox %s, build %s, source %s' % (info.get('Version', '?'), info.get('BuildID', '?'), info.get('SourceStamp', '?')))
    try:
        for sub, archive in sources.items():
            files, size, digest = extract(archive, os.path.join(tmp, sub))
            print('%-8s %6d files  %7.1f MB  from %s' % (sub, files, size / 1048576, archive))
            lines.append('%s: %s (%d files) sha256 %s' % (sub, os.path.relpath(archive, engine).replace(os.sep, '/'), files, digest))
        with open(os.path.join(tmp, 'SOURCE.txt'), 'w', encoding='utf-8', newline='\n') as f:
            f.write('\n'.join(lines) + '\n')
    except BaseException as e:
        shutil.rmtree(long_path(tmp), ignore_errors=True)
        if isinstance(e, (OmniError, OSError, zlib.error, struct.error)):
            sys.exit('extraction failed: %s' % e)
        raise

    # Move the previous extraction aside first: renaming fails as a whole (for example while a
    # file in it is open), so the old reference is either replaced or left untouched.
    old = None
    if os.path.isdir(out):
        old = tempfile.mkdtemp(prefix=base + '.old-', dir=parent)
        os.rmdir(old)
        try:
            os.rename(out, old)
        except OSError as e:
            shutil.rmtree(long_path(tmp), ignore_errors=True)
            sys.exit('cannot replace %s (%s); close what is using it and run again' % (out, e))
    try:
        os.rename(tmp, out)
    except OSError as e:
        if old:
            os.rename(old, out)  # put the previous extraction back
        shutil.rmtree(long_path(tmp), ignore_errors=True)
        sys.exit('cannot move the new extraction into place (%s)' % e)
    if old:
        shutil.rmtree(long_path(old), ignore_errors=True)
        if os.path.exists(old):
            print('note: could not delete the previous extraction, now at %s' % old)
    print('wrote', out)


if __name__ == '__main__':
    main()
