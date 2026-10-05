"""Round trip of Deer-Setup.exe's payload decoders (Lzma.cs, Package.cs) against Python's lzma module.

  python installer/tests/lzma_roundtrip.py [--payload <payload.bin> --release <release folder>]

1. Raw LZMA1 streams, encoded here with Python's lzma (liblzma) exactly as build.py encodes payload
   blocks (FORMAT_RAW, FILTER_LZMA1, optionally FILTER_X86 first), decoded by the probe (C#): empty,
   one byte, text, incompressible bytes, long overlapping repeats, x86 code from the engine, bytes
   dense with E8/E9 opcodes (the BCJ filter's state machine), several lc/lp/pb settings. Every output
   must be byte-identical.
2. Damaged streams (a byte flipped, cut short, extra bytes) are refused or decode differently, and the
   probe never crashes or hangs on them.
3. A whole package written by build.py's make_payload (a small synthetic release folder, then, with
   --payload, the real one) unpacks to the same files, byte for byte, and a package with a damaged
   block is refused by its CRC.
Builds installer/work/probe.exe. Writes only under %TEMP%\\deer-lzma-roundtrip. Exit code 1 on failure.
"""
import argparse
import hashlib
import importlib.util
import lzma
import os
import random
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
INSTALLER = os.path.dirname(HERE)
GECKO = os.path.dirname(INSTALLER)
WORK = os.path.join(INSTALLER, 'work')
TMP = os.path.join(tempfile.gettempdir(), 'deer-lzma-roundtrip')
failed = 0


def check(name, ok, detail=''):
    global failed
    failed += 0 if ok else 1
    print(('PASS ' if ok else 'FAIL ') + name + ('  ' + str(detail) if detail not in ('', None) else ''), flush=True)
    return ok


def build_probe():
    csc = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), r'Microsoft.NET\Framework64\v4.0.30319\csc.exe')
    out = os.path.join(WORK, 'probe.exe')
    os.makedirs(WORK, exist_ok=True)
    r = subprocess.run([csc, '/nologo', '/target:exe', '/optimize+', '/out:' + out, os.path.join(HERE, 'Probe.cs')] +
                       [os.path.join(INSTALLER, n) for n in ('Shell.cs', 'EngineTraces.cs', 'Lzma.cs', 'Package.cs', 'ProfileMigration.cs')],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit('probe build failed:\n' + r.stdout + r.stderr)
    return out


def load_build():
    spec = importlib.util.spec_from_file_location('deer_installer_build', os.path.join(INSTALLER, 'build.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def encode(data, lc, lp, pb, x86, preset=6):
    filters = ([{'id': lzma.FILTER_X86}] if x86 else []) + [{'id': lzma.FILTER_LZMA1, 'preset': preset, 'lc': lc, 'lp': lp, 'pb': pb,
                                                             'dict_size': max(1 << 16, min(len(data), 1 << 24))}]
    return lzma.compress(data, format=lzma.FORMAT_RAW, filters=filters)


def decode(probe, packed, size, lc, lp, pb, x86, name):
    src = os.path.join(TMP, name + '.lzma')
    dst = os.path.join(TMP, name + '.out')
    with open(src, 'wb') as f:
        f.write(packed)
    if os.path.exists(dst):
        os.remove(dst)
    try:
        r = subprocess.run([probe, 'lzma', src, dst, str(size), str(lc), str(lp), str(pb), '1' if x86 else '0'],
                           capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return 'hang', None
    out = open(dst, 'rb').read() if r.returncode == 0 and os.path.exists(dst) else None
    return r.returncode, out if r.returncode == 0 else (r.stdout + r.stderr).strip()


def x86_sample():
    for rel in (os.path.join('engines', 'deer-runtime', 'freebl3.dll'), os.path.join('engines', 'firefox-157.0-unbranded', 'freebl3.dll'),
                os.path.join('runtime', 'freebl3.dll')):
        p = os.path.join(GECKO, rel)
        if os.path.exists(p):
            return open(p, 'rb').read()[:3 << 20], rel
    windir = os.environ.get('WINDIR', r'C:\Windows')
    p = os.path.join(windir, 'System32', 'kernel32.dll')
    return open(p, 'rb').read(), p


def vectors():
    rnd = random.Random(20261004)
    text = ('Deer is a web browser for Windows. ' * 50 + 'The quick brown fox jumps over the lazy dog. ').encode() * 40
    noise = bytes(rnd.getrandbits(8) for _ in range(1 << 20))
    repeats = b''.join(bytes([i % 7]) * (1 + i % 300) for i in range(4000)) + b'ab' * 70000 + b'\0' * 300000
    weights = [0xE8, 0xE9, 0x00, 0xFF, 0x0F, 0x48]
    opcodes = bytes(rnd.choice(weights) if rnd.random() < 0.7 else rnd.getrandbits(8) for _ in range(400000))
    code, origin = x86_sample()
    print('x86 sample: %s (%d bytes)' % (origin, len(code)))
    edge = [b'\xE8' * n for n in range(1, 12)] + [b'\xE8\x00\x00\x00\x00', b'\x01\xE8\x00\x00\x00', b'\xE9\xFF\xFF\xFF\xFF\xE8\x00\x00\x00\x00\xE8']
    out = [('empty', b'', False), ('one-byte', b'x', False), ('text', text, False), ('noise', noise, False), ('repeats', repeats, False),
           ('opcodes', opcodes, True), ('opcodes-plain', opcodes, False), ('x86-code', code, True), ('noise-x86', noise[:200000], True)]
    out += [('edge-%d' % i, e, True) for i, e in enumerate(edge)]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--payload', help='a payload.bin written by build.py')
    ap.add_argument('--release', help='the release folder that payload was made from')
    a = ap.parse_args()
    shutil.rmtree(TMP, ignore_errors=True)
    os.makedirs(TMP)
    probe = build_probe()

    print('\n---- 1. raw LZMA1 streams, Python encodes, the probe decodes')
    settings = [(3, 0, 2), (0, 0, 0), (4, 0, 4), (1, 3, 0), (0, 4, 2)]
    for name, data, x86 in vectors():
        for lc, lp, pb in (settings if name in ('text', 'repeats', 'x86-code') else settings[:1]):
            packed = encode(data, lc, lp, pb, x86)
            code, out = decode(probe, packed, len(data), lc, lp, pb, x86, name)
            check('%s (%d bytes, lc %d lp %d pb %d%s) decodes byte for byte' % (name, len(data), lc, lp, pb, ', x86 BCJ' if x86 else ''),
                  code == 0 and out == data, code if code != 0 else ('%d bytes, first difference at %s' % (len(out), next((i for i in range(min(len(out), len(data))) if out[i] != data[i]), min(len(out), len(data))))) if out != data else '')

    print('\n---- 2. damaged streams')
    data = vectors()[2][1]
    packed = encode(data, 3, 0, 2, False)
    cases = [('one byte flipped', packed[:len(packed) // 2] + bytes([packed[len(packed) // 2] ^ 0x55]) + packed[len(packed) // 2 + 1:], len(data)),
             ('cut short', packed[:-7], len(data)),
             ('extra bytes', packed + b'\0\0\0', len(data)),
             ('size one too small', packed, len(data) - 1),
             ('size one too large', packed, len(data) + 1),
             ('first byte not 0', b'\x01' + packed[1:], len(data)),
             ('nothing', b'', len(data))]
    for name, bad, size in cases:
        code, out = decode(probe, bad, size, 3, 0, 2, False, 'damaged')
        check('damaged stream "%s": refused or different, no crash or hang' % name, code == 2 or (code == 0 and out != data), (code, out if code != 0 else ''))

    print('\n---- 3. whole packages from build.py\'s make_payload')
    build = load_build()
    rel = os.path.join(TMP, 'release')
    rnd = random.Random(7)
    os.makedirs(os.path.join(rel, 'engine', 'sub', 'deeper'))
    os.makedirs(os.path.join(rel, 'engine', 'empty-folder'))
    code, _origin = x86_sample()
    files = {'Deer.exe': code[:300000], 'engine/deer.dll': code, 'engine/omni.ja': bytes(rnd.getrandbits(8) for _ in range(500000)) + b'pad' * 100000,
             'engine/zero.txt': b'', 'engine/sub/deeper/a.txt': b'hello\r\n' * 1000, 'engine/sub/b.json': b'{"a": 1}\n',
             'release.ini': b'[Deer]\r\nVersion=0.0.0\r\n'}
    for path, data in files.items():
        with open(os.path.join(rel, path), 'wb') as f:
            f.write(data)
    pkg = os.path.join(TMP, 'small.bin')
    info = build.make_payload(rel, pkg, block_size=1 << 18, threads=4, log=lambda *x: None)
    check('make_payload: %d files, %d blocks (x86 and plain), %d bytes' % (info['files'], info['blocks'], os.path.getsize(pkg)),
          info['files'] == len(files) and info['blocks'] > 2)
    got = os.path.join(TMP, 'small-out')
    r = subprocess.run([probe, 'unpack', pkg, got, '3'], capture_output=True, text=True, timeout=120)
    print('     ' + r.stdout.strip())
    same = r.returncode == 0 and all(open(os.path.join(got, p), 'rb').read() == d for p, d in files.items())
    check('the small package unpacks to the same files (empty file and empty folder included)', same and os.path.isdir(os.path.join(got, 'engine', 'empty-folder')),
          r.stdout + r.stderr)
    mtimes = all(abs(os.stat(os.path.join(got, p)).st_mtime - os.stat(os.path.join(rel, p)).st_mtime) < 0.001 for p in files)
    check('file times are kept', mtimes)
    raw = bytearray(open(pkg, 'rb').read())
    raw[-100] ^= 0x01  # inside the last block
    bad = os.path.join(TMP, 'small-damaged.bin')
    open(bad, 'wb').write(bytes(raw))
    r = subprocess.run([probe, 'unpack', bad, os.path.join(TMP, 'small-damaged-out'), '2'], capture_output=True, text=True, timeout=120)
    check('a package with one damaged block is refused', r.returncode == 2 and 'damaged' in r.stdout, (r.returncode, r.stdout.strip()))

    if a.payload:
        out = os.path.join(TMP, 'payload-out')
        r = subprocess.run([probe, 'unpack', a.payload, out], capture_output=True, text=True, timeout=600)
        print('     ' + r.stdout.strip())
        check('the release payload unpacks (exit 0)', r.returncode == 0, r.stdout + r.stderr)
        if a.release and r.returncode == 0:
            diff = []
            for folder, _dirs, names in os.walk(a.release):
                for n in names:
                    p = os.path.join(folder, n)
                    q = os.path.join(out, os.path.relpath(p, a.release))
                    if not os.path.exists(q) or hashlib.sha256(open(p, 'rb').read()).digest() != hashlib.sha256(open(q, 'rb').read()).digest():
                        diff.append(os.path.relpath(p, a.release))
            count = sum(len(n) for _f, _d, n in os.walk(out))
            check('every release file comes back byte for byte (SHA-256), nothing extra', not diff and count == sum(len(n) for _f, _d, n in os.walk(a.release)), diff[:10])
    shutil.rmtree(TMP, ignore_errors=True)
    print('RESULT %s' % ('ok' if not failed else '%d failed' % failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.exit(main())
