"""Generate lens displacement maps for rounded-rect glass surfaces.

R channel = x offset, G channel = y offset, 128 = no offset. Offsets point
inward along the surface normal and fall off across the bezel, so the edge
bends the backdrop while the middle stays clear.
"""
import struct
import sys
import zlib

import numpy as np


def write_png(path, rgb):
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def lens_map(w, h, radius, bezel, power):
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)
    px = xs + 0.5 - w / 2
    py = ys + 0.5 - h / 2
    qx = np.abs(px) - (w / 2 - radius)
    qy = np.abs(py) - (h / 2 - radius)
    outside = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0))
    sdf = outside + np.minimum(np.maximum(qx, qy), 0) - radius
    depth = -sdf

    corner = (qx > 0) & (qy > 0)
    safe = np.maximum(outside, 1e-6)
    nx = np.where(corner, qx / safe, np.where(qx > qy, 1.0, 0.0)) * np.sign(px)
    ny = np.where(corner, qy / safe, np.where(qx > qy, 0.0, 1.0)) * np.sign(py)

    t = np.clip(depth / bezel, 0, 1)
    strength = (1 - t) ** power
    strength[depth < 0] = 0

    r = np.clip(np.round(128 - nx * strength * 127), 0, 255).astype(np.uint8)
    g = np.clip(np.round(128 - ny * strength * 127), 0, 255).astype(np.uint8)
    b = np.full_like(r, 128)
    return np.dstack([r, g, b])


if __name__ == "__main__":
    # name w h radius bezel power
    out, w, h, radius, bezel, power = sys.argv[1], *map(float, sys.argv[2:7])
    write_png(out, lens_map(int(w), int(h), radius, bezel, power))
    print(out, int(w), int(h))
