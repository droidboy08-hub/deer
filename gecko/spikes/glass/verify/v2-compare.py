"""Compare v2-neutral captures against the 'none' variant.

  python v2-compare.py            (reads out/v2-neutral-*/neutral-*.png)

For each variant prints:
  works   = mean abs difference inside the invert(1) tile vs the base capture (big = backdrop sampled the page)
  page    = pixels of the page OUTSIDE the tiles (and outside the frame counter) that differ from base, and max diff
"""
import glob
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))


def load(v):
    p = os.path.join(HERE, 'out', 'v2-neutral-' + v, 'neutral-' + v + '.png')
    return np.asarray(Image.open(p).convert('RGB')).astype(np.int16) if os.path.exists(p) else None


base = load('none')
H, W, _ = base.shape
mask = np.ones((H, W), bool)
mask[280:400, 30:790] = False      # the three tiles
mask[H - 50:, W - 140:] = False    # frame counter
mask[:, :10] = False               # window frame
mask[:, W - 10:] = False
mask[H - 10:, :] = False
for d in sorted(glob.glob(os.path.join(HERE, 'out', 'v2-neutral-*'))):
    v = os.path.basename(d)[len('v2-neutral-'):]
    img = load(v)
    if img is None or img.shape != base.shape:
        print('%-10s (no capture)' % v)
        continue
    diff = np.abs(img - base).max(axis=2)
    inv = diff[310:370, 70:230].mean()          # centre of the invert tile
    blur = diff[310:370, 330:490].mean()
    out = diff[mask]
    print('%-10s works(invert)=%6.1f works(blur)=%5.1f | page pixels changed=%7d (%.3f%%) max diff=%3d mean=%.4f' % (
        v, inv, blur, int((out > 0).sum()), 100.0 * (out > 0).mean(), int(out.max()), out.mean()))
