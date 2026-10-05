"""Crop a horizontal slice out of a PNG written by tools/run.py's capture() and enlarge it 4x.

  python crop_png.py in.png out.png x0 x1

Used to keep only the runtime's own taskbar button from a taskbar screenshot (the full strip
shows every app the user has open, which has no business in the repo).
"""
import struct
import sys
import zlib


def read_png(path):
    d = open(path, 'rb').read()
    pos, idat, w, h = 8, b'', 0, 0
    while pos < len(d):
        n, = struct.unpack('>I', d[pos:pos + 4])
        tag, body = d[pos + 4:pos + 8], d[pos + 8:pos + 8 + n]
        if tag == b'IHDR':
            w, h = struct.unpack('>II', body[:8])
        if tag == b'IDAT':
            idat += body
        pos += 12 + n
    raw = zlib.decompress(idat)
    stride = w * 4 + 1
    return w, h, [raw[y * stride + 1:(y + 1) * stride] for y in range(h)]


def write_png(path, w, h, rows):
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    raw = b''.join(b'\x00' + r for r in rows)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                           + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def main():
    src, dst, x0, x1 = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    w, h, rows = read_png(src)
    out = []
    for r in rows:
        seg = r[x0 * 4:x1 * 4]
        big = b''.join(seg[i:i + 4] * 4 for i in range(0, len(seg), 4))
        out += [big] * 4
    write_png(dst, (x1 - x0) * 4, h * 4, out)


if __name__ == '__main__':
    main()
