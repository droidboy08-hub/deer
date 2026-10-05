"""Crop and upscale regions of a capture so glass details can be inspected.

  python crop.py in.png out.png scale x,y,w,h [x,y,w,h ...]

Several regions are stacked vertically (nearest-neighbour upscale, 4 px gap).
"""
import sys
from PIL import Image

src = Image.open(sys.argv[1]).convert('RGB')
scale = int(sys.argv[3])
crops = []
for spec in sys.argv[4:]:
    x, y, w, h = [int(v) for v in spec.split(',')]
    crops.append(src.crop((x, y, x + w, y + h)).resize((w * scale, h * scale), Image.NEAREST))
W = max(c.width for c in crops)
H = sum(c.height for c in crops) + 4 * (len(crops) - 1)
out = Image.new('RGB', (W, H), (255, 0, 255))
y = 0
for c in crops:
    out.paste(c, (0, y))
    y += c.height + 4
out.save(sys.argv[2])
print(sys.argv[2], out.size)
