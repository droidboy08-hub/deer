"""Montage of the 64x64 window-icon dumps (<capture>.icon.png) of one run, scaled x3, so they can be
looked at in one image:  python spikes/packaging/verify/montage.py <out dir>   -> <out dir>/montage.png"""
import glob
import os
import struct
import sys
import zlib


def read_png(p):
    d = open(p, 'rb').read()
    pos, idat, w, h = 8, b'', 0, 0
    while pos < len(d):
        ln, tag = struct.unpack('>I4s', d[pos:pos + 8])
        body = d[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if tag == b'IHDR':
            w, h = struct.unpack('>II', body[:8])
        elif tag == b'IDAT':
            idat += body
    raw = zlib.decompress(idat)
    stride = w * 4
    return w, h, [raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)] for y in range(h)]


def main():
    out = sys.argv[1]
    files = sorted(glob.glob(os.path.join(out, '*.icon.png')))
    S = 3
    W = sum(64 * S + 8 for _ in files)
    H = 64 * S
    canvas = [bytearray(b'\x80\x80\x80\xff' * W) for _ in range(H)]
    x0 = 0
    for f in files:
        w, h, rows = read_png(f)
        for y in range(h):
            for x in range(w):
                px = rows[y][x * 4:x * 4 + 4]
                for dy in range(S):
                    for dx in range(S):
                        X = x0 + x * S + dx
                        canvas[y * S + dy][X * 4:X * 4 + 4] = px
        x0 += 64 * S + 8
    raw = b''.join(b'\x00' + bytes(r) for r in canvas)

    def chunk(t, b):
        c = struct.pack('>I', len(b)) + t + b
        return c + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)

    with open(os.path.join(out, 'montage.png'), 'wb') as fh:
        fh.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))
                 + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
    print('montage of', [os.path.basename(f) for f in files])


if __name__ == '__main__':
    main()
