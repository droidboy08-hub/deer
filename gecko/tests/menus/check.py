"""Pixel check of the menu's frost (from gecko/):  python tests/menus/check.py tests/menus/out/log-look.txt

tests/menus/look.js opens a menu over a page of vertical stripes (3 px black / 3 px white), hides
the menu's text and logs, next to each capture,
  MEASURE <capture> {"dpr": 1, "expect": "frost" | "tint", "probe": {x0, x1, y}, "ref": {x0, x1, y}}
with a segment inside the menu and the same columns on the bare page. The contrast (standard
deviation of luma) under the menu is compared with the bare stripes:
  frost  the real material, blur(24px) saturate(1.6) under the 0.80 tint: the stripes must be gone,
         under 4 % of the bare contrast;
  tint   the same menu with backdrop-filter: none: the 0.80 tint alone keeps them visible, over 10 %.
So a menu whose backdrop-filter silently stops sampling the page (the spike's finding before the
tab-box filter) fails here. Prints PASS / FAIL lines and exits 1 on any FAIL.
"""
import json
import os
import sys

from PIL import Image


def contrast(px, x0, x1, y):
    total = 0.0
    for row in (y, y + 1):
        v = []
        for x in range(x0, x1):
            r, g, b = px[x, row][:3]
            v.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
        m = sum(v) / len(v)
        total += (sum((a - m) ** 2 for a in v) / len(v)) ** 0.5
    return total / 2


def main(path):
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
        px = Image.open(png).convert('RGB').load()
        dpr = data.get('dpr', 1)
        sc = lambda v: int(round(v * dpr))
        p, r = data['probe'], data['ref']
        under = contrast(px, sc(p['x0']), sc(p['x1']), sc(p['y']))
        bare = contrast(px, sc(r['x0']), sc(r['x1']), sc(r['y']))
        ratio = under / bare if bare else 1.0
        if bare < 60:
            ok = False
            why = 'no stripes on the bare page (contrast %.1f)' % bare
        elif data['expect'] == 'frost':
            ok = ratio < 0.04
            why = 'frost keeps %.1f%% of the stripe contrast (bare %.1f, under %.2f); want < 4%%' % (ratio * 100, bare, under)
        else:
            ok = ratio > 0.10
            why = 'tint alone keeps %.1f%% of the stripe contrast (bare %.1f, under %.2f); want > 10%%' % (ratio * 100, bare, under)
        print('%s %s: %s' % ('PASS' if ok else 'FAIL', name, why))
        if ok:
            passed += 1
        else:
            failed += 1
    if passed + failed < 2:
        print('FAIL expected two measured captures, found %d' % (passed + failed))
        failed += 1
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
