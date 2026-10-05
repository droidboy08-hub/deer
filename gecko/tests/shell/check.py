"""Pixel checks on the shell captures: is the glass really filtering the page under each shape?

  python tests/shell/check.py tests/shell/out/look.log [more logs]

The test scripts write, next to a capture over a striped page, a line
  MEASURE <capture> {"off":[x,y],"dpr":1,"expect":"glass","probes":[{"name","x0","x1","y","max"}]}
with one short horizontal segment inside every glass shape (tests/shell/lib.js T.measure). The page
has vertical stripes with a 6 px period, so a lens (blur 1.4 px on circles, 2.4 px on the pill)
shows as lost stripe contrast on the segment compared with the same columns of the bare page at
y = 120. A shape with tint and rim but no working lens keeps 70-90 % of the contrast; a working lens
leaves under about 40 % (circles) and 20 % (pill).
A capture whose probes find no stripes under the bar is a FAIL (a stale frame, or the wrong page),
unless the MEASURE line says "stripes": false (a capture the script knows is not over stripes).
Prints PASS / FAIL lines and exits 1 on any FAIL.
"""
import json
import os
import sys

from PIL import Image

REF_Y = 120


def luma_row(px, x0, x1, y):
    out = []
    for x in range(x0, x1):
        r, g, b = px[x, y][:3]
        out.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
    return out


def contrast(px, x0, x1, y):
    """Standard deviation of luma along the segment, mean of two rows."""
    total = 0.0
    for row in (y, y + 1):
        v = luma_row(px, x0, x1, row)
        m = sum(v) / len(v)
        total += (sum((a - m) ** 2 for a in v) / len(v)) ** 0.5
    return total / 2


def check_log(path):
    out_dir = os.path.dirname(os.path.abspath(path))
    passed = failed = 0
    for line in open(path, encoding='utf-8', errors='replace'):
        if not line.startswith('MEASURE '):
            continue
        _tag, name, payload = line.rstrip('\n').split(' ', 2)
        data = json.loads(payload)
        png = os.path.join(out_dir, name + '.png')
        if not os.path.exists(png):
            print('FAIL %s: capture missing' % name)
            failed += 1
            continue
        im = Image.open(png).convert('RGB')
        px = im.load()
        dpr = data.get('dpr', 1)
        ox, oy = data['off']
        results = []
        bad = []
        skipped = 0
        for p in data['probes']:
            x0 = int(round((p['x0'] + ox) * dpr))
            x1 = int(round((p['x1'] + ox) * dpr))
            y = int(round((p['y'] + oy) * dpr))
            ry = int(round((REF_Y + oy) * dpr))
            if x1 - x0 < 6 or x0 < 0 or x1 >= im.width or y < 0 or ry + 1 >= im.height:
                skipped += 1
                continue
            ref = contrast(px, x0, x1, ry)
            if ref < 12:  # the page is not striped under this shape
                skipped += 1
                continue
            ratio = contrast(px, x0, x1, y) / ref
            results.append((p['name'], ratio))
            if data['expect'] == 'glass' and ratio > p['max']:
                bad.append('%s %.2f > %.2f' % (p['name'], ratio, p['max']))
            if data['expect'] == 'none' and ratio < 0.85:
                bad.append('%s %.2f (expected the bare page)' % (p['name'], ratio))
        if not results:
            if data.get('stripes', True):
                failed += 1
                print('FAIL %s: no stripes under the bar (%d probes skipped): stale frame or wrong page' % (name, skipped))
            else:
                print('SKIP %s: not over stripes (%d probes)' % (name, skipped))
            continue
        pill = [r for n, r in results if n == 'pill']
        rest = [r for n, r in results if n != 'pill']
        summary = '%d shapes, %s theme; contrast kept: pill %s, others %s' % (
            len(results), data.get('theme'),
            ('%.2f' % pill[0]) if pill else 'n/a',
            ('%.2f-%.2f' % (min(rest), max(rest))) if rest else 'n/a')
        if bad:
            failed += 1
            print('FAIL glass in %s (%s): %s' % (name, data['expect'], '; '.join(bad)))
        else:
            passed += 1
            print('PASS glass in %s (%s): %s' % (name, data['expect'], summary))
    return passed, failed


def main():
    passed = failed = 0
    for path in sys.argv[1:]:
        p, f = check_log(path)
        passed += p
        failed += f
    print('PIXELS pass=%d fail=%d' % (passed, failed))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
