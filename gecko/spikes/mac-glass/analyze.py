"""Numbers from the mac-glass spike captures (S1, S2): the glass tone under each real glass piece, the
contrast of Deer's ink on it, the corner radius of the glass, and how far the glass blurs a sharp edge.

  /usr/bin/python3 spikes/mac-glass/analyze.py spikes/mac-glass/logs/s1-syslight.txt [more logs]

Reads the LAYOUT lines a run logged (glasslib.js G.layout: every open piece's rectangle in capture
pixels) and the PNGs in tests/menus/out. PNGs are decoded with ffmpeg (rawvideo rgb24). Python 3.9,
standard library only.
"""
import json
import os
import re
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'tests', 'menus', 'out')


class Img:
    def __init__(self, path):
        with open(path, 'rb') as f:
            head = f.read(24)
        self.w, self.h = struct.unpack('>II', head[16:24])
        self.px = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                                 capture_output=True, check=True).stdout

    def rgb(self, x, y):
        i = (y * self.w + x) * 3
        return self.px[i], self.px[i + 1], self.px[i + 2]

    def lum(self, x, y):
        return rel_lum(self.rgb(x, y))


def lin(c):
    s = c / 255.0
    return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4


def rel_lum(rgb):
    r, g, b = rgb
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def contrast(l1, l2):
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def parse_css_color(s):
    m = re.findall(r'[\d.]+', s or '')
    v = [float(x) for x in m]
    if len(v) == 3:
        v.append(1.0)
    return v[:4] if len(v) >= 4 else None


def median(vals):
    vals = sorted(vals)
    return vals[len(vals) // 2] if vals else float('nan')


def glass_tone(img, rect, inset=8):
    """Median colour of a piece's interior (text is a minority of its pixels)."""
    x, y, w, h = rect
    xs = range(x + inset, x + w - inset, 3)
    ys = range(y + inset, y + h - inset, 3)
    rs, gs, bs = [], [], []
    for yy in ys:
        for xx in xs:
            r, g, b = img.rgb(xx, yy)
            rs.append(r)
            gs.append(g)
            bs.append(b)
    return (median(rs), median(gs), median(bs))


def pieces_table(log_path):
    rows = []
    for line in open(log_path, encoding='utf-8'):
        if not line.startswith('LAYOUT '):
            continue
        d = json.loads(line[7:])
        png = os.path.join(OUT, d['tag'] + '.png')
        if not os.path.exists(png):
            continue
        img = Img(png)
        for p in d['pieces']:
            x, y, w, h = p['real'] or p['px']
            tone = glass_tone(img, (x, y, w, h), inset=max(4, min(10, h // 6)))
            gl = rel_lum(tone)
            ink = parse_css_color(p['ink'])
            if ink:
                a = ink[3]
                comp = tuple(ink[i] * a + tone[i] * (1 - a) for i in range(3))
                il = rel_lum(comp)
            else:
                il = float('nan')
            rows.append({
                'capture': d['tag'], 'piece': p['name'], 'scheme': p['scheme'], 'h_css': round(h / d['scale']),
                'glass_rgb': [int(c) for c in tone], 'glass_L': round(gl, 3), 'ink': p['ink'],
                'contrast': round(contrast(gl, il), 2),
            })
    return rows


def edge_profile(img, x0, y0, R_guess=40, inside=None, thresh=None):
    """Insets of the glass from its left edge, row by row from its top: [(dy, inset)]."""
    out = []
    for dy in range(0, R_guess):
        yy = y0 + dy
        for dx in range(-4, R_guess):
            v = img.lum(x0 + dx, yy)
            if (v > thresh) == inside:
                out.append((dy, max(0, dx)))
                break
    return out


def fit_radius(profile):
    best = None
    for k in range(8, 161):
        R = k * 0.25
        err = 0.0
        n = 0
        for dy, inset in profile:
            yc = dy + 0.5
            if yc >= R:
                continue
            ideal = R - (R * R - (R - yc) ** 2) ** 0.5
            err += (ideal - inset) ** 2
            n += 1
        if n >= 3:
            e = err / n
            if best is None or e < best[1]:
                best = (R, e)
    return best


def find_edges(img, rect, bg_l, in_l):
    """The glass's real left and top edges near the asked-for rectangle (half-way threshold)."""
    x, y, w, h = rect
    t = (bg_l + in_l) / 2
    inside = in_l > bg_l
    my = y + h // 2
    left = next((xx for xx in range(x - 12, x + 12) if (img.lum(xx, my) > t) == inside), x)
    mx = x + w // 2
    top = next((yy for yy in range(y - 12, y + 12) if (img.lum(mx, yy) > t) == inside), y)
    return left, top, t, inside


def corners(log_path):
    res = []
    for line in open(log_path, encoding='utf-8'):
        if not line.startswith('LAYOUT ') or 'shape' not in line:
            continue
        d = json.loads(line[7:])
        png = os.path.join(OUT, d['tag'] + '.png')
        if not os.path.exists(png):
            continue
        img = Img(png)
        for p in d['pieces']:
            x, y, w, h = p['real'] or p['px']
            bg = img.lum(x - 30, y + h // 2)
            tone = rel_lum(glass_tone(img, (x + w // 2 - 20, y + h // 2 - 4, 40, 8), inset=0))
            if abs(tone - bg) < 0.05:
                res.append({'capture': d['tag'], 'piece': p['name'], 'note': 'too little contrast to measure', 'bg_L': round(bg, 3), 'glass_L': round(tone, 3)})
                continue
            left, top, t, inside = find_edges(img, (x, y, w, h), bg, tone)
            prof = edge_profile(img, left, top, R_guess=min(48, h // 2 + 6), inside=inside, thresh=t)
            fit = fit_radius(prof)
            res.append({'capture': d['tag'], 'piece': p['name'], 'h_css': round(h / d['scale']), 'edge_px': [left, top],
                        'asked_px': [x, y], 'radius_px': fit and fit[0], 'radius_css': fit and fit[0] / d['scale'],
                        'rms': fit and round(fit[1] ** 0.5, 2), 'profile': prof[:30]})
    return res


def blur_widths(log_path):
    """10-90 % width of the stripe edges seen through the big glass pieces (scroll-*-stopped)."""
    res = []
    for line in open(log_path, encoding='utf-8'):
        if not line.startswith('LAYOUT ') or 'stopped' not in line:
            continue
        d = json.loads(line[7:])
        png = os.path.join(OUT, d['tag'] + '.png')
        if not os.path.exists(png):
            continue
        img = Img(png)
        s = d['scale']
        ref_x = int(1390 * s)  # pure stripes, right of every column
        for p in d['pieces']:
            x, y, w, h = p['real'] or p['px']
            if h < 250 * s:
                continue
            gx = x + int(w * 0.62)
            prof_ref = [img.lum(ref_x, yy) for yy in range(y, y + h)]
            prof_gl = [img.lum(gx, yy) for yy in range(y, y + h)]
            # stripe edges: where the reference column jumps
            edges = [i for i in range(1, len(prof_ref)) if abs(prof_ref[i] - prof_ref[i - 1]) > 0.15]
            widths = []
            for e in edges:
                a, b = e - 70, e + 70
                if a < 20 or b > len(prof_gl) - 20:
                    continue
                lo_v, hi_v = prof_gl[a], prof_gl[b]
                if abs(hi_v - lo_v) < 0.04:
                    continue
                seg = prof_gl[a:b]
                f = lambda v: (v - lo_v) / (hi_v - lo_v)
                try:
                    i10 = next(i for i, v in enumerate(seg) if f(v) >= 0.1)
                    i90 = next(i for i, v in enumerate(seg) if f(v) >= 0.9)
                except StopIteration:
                    continue
                widths.append(round((i90 - i10) / s, 1))
            res.append({'capture': d['tag'], 'piece': p['name'], 'edges': len(edges), 'w10_90_css': widths})
    return res


def main(argv):
    for log in argv:
        print('=== ' + os.path.basename(log))
        for r in pieces_table(log):
            if 'shape' in r['capture']:
                continue
            print('PIECE %-36s %-22s %-11s h=%-3d glassL=%.3f rgb=%s contrast=%.2f' % (
                r['capture'], r['piece'], r['scheme'], r['h_css'], r['glass_L'], r['glass_rgb'], r['contrast']))
        for r in corners(log):
            print('CORNER ' + json.dumps({k: v for k, v in r.items() if k != 'profile'}))
        for r in blur_widths(log):
            print('BLUR ' + json.dumps(r))


if __name__ == '__main__':
    main(sys.argv[1:])
