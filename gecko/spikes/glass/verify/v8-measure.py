"""Measure lens-vs-rim offset in v8-morph captures.

The page is white, the lens inverts it to black, the parent draws a 1 px red outline.
On the scan line through the middle of the pill (y = 122) report:
  rim   = x of the left / right red outline pixels
  lens  = x of the first / last black (inverted) pixel
  off   = lens edge minus rim edge (0 or +-1 = in step)
"""
import glob
import os
import sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
for side in sys.argv[1:] or ['parent', 'content-msg', 'content-css']:
    for p in sorted(glob.glob(os.path.join(HERE, 'out', 'v8-morph-' + side, 'morph-*.png'))):
        img = np.asarray(Image.open(p).convert('RGB')).astype(int)
        row = img[122, 20:1260]
        red = np.nonzero((row[:, 0] > 200) & (row[:, 1] < 80) & (row[:, 2] < 80))[0]
        blk = np.nonzero(row.sum(axis=1) < 60)[0]
        if len(red) == 0 or len(blk) == 0:
            print('%-28s rim %s lens %s' % (os.path.basename(p), red[[0, -1]] if len(red) else None, blk[[0, -1]] if len(blk) else None))
            continue
        print('%-28s rim %4d..%4d  lens %4d..%4d  off left %+d right %+d' % (
            os.path.basename(p), red[0] + 20, red[-1] + 20, blk[0] + 20, blk[-1] + 20, blk[0] - red[0] - 1, blk[-1] - red[-1] + 1))
