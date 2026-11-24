"""After a capsule-demo run (spike S10): mp4s, side-by-side summaries and numbers.

  /usr/bin/python3 spikes/mac-glass/capsule_post.py spikes/mac-glass/logs/mac-glass-s10 [--vids DIR] [--out tests/menus/out]

From <logs>/log.txt (LAYOUT, TRACKFILE, MOTION, MEASURE, CPU lines), <logs>/cd-rec-<v>.json (where
Deer's row had every capsule in each frame) and <logs>/beh-track-<v>-<n>.json (the window server's
frames of the run's windows every ~4 ms), and the captures in <out>:

  videos     <vids>/glass-demo-motion{,-css,-24}.mkv -> <out>/....mp4 (H.264), and
             glass-demo-motion-rows.mp4: the top 120 CSS px of the three stacked (CSS, 36, 24). The
             .mkv files are deleted afterwards.
  summaries  <out>/glass-demo-summary-<state>.png: the row band of the three variants stacked (CSS on
             top, then real glass 36 px, then real glass 24 px pills), at 2x; glass-demo-summary.png:
             every state, at 1x.
  contrast   per capture and capsule: the glass (or CSS glass) tone under the capsule and the WCAG
             contrast of Deer's ink on it (<logs>/analysis.txt)
  lag        per glass window and motion step: how far the window server's frame was from where
             Deer's row had the capsule, and the delay that fits best (<logs>/analysis.txt)

Python 3.9, standard library and /opt/homebrew/bin/ffmpeg.
"""
import glob
import json
import os
import re
import struct
import subprocess
import sys

FFMPEG = '/opt/homebrew/bin/ffmpeg'
STATES = ['article', 'scrolled', 'dark', 'home', 'photo', 'hover', 'typing', 'resized', 'menu']
VARIANTS = ['css', '36', '24']
BAND = 92  # CSS px of the row band in the summaries (the row is 52, the page's label sits at 58-80)
TALL = {'typing': 330, 'menu': 330}  # the suggestions and the menu hang under the row
SCALE = 2
LINES = []


def say(*a):
    s = ' '.join(str(x) for x in a)
    LINES.append(s)
    print(s, flush=True)


def ff(args):
    r = subprocess.run([FFMPEG, '-v', 'error', '-y'] + args, capture_output=True, text=True)
    if r.returncode:
        say('ffmpeg failed:', ' '.join(args)[:300], r.stderr[:500])
    return r.returncode == 0


# ---------------------------------------------------------------- videos
def videos(vids, out):
    tags = ['glass-demo-motion', 'glass-demo-motion-css', 'glass-demo-motion-24']
    enc = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    for tag in tags:
        src = os.path.join(vids, tag + '.mkv')
        if os.path.exists(src):
            if ff(['-i', src] + enc + [os.path.join(out, tag + '.mp4')]):
                say('video:', os.path.join(out, tag + '.mp4'))
    srcs = [os.path.join(vids, t + '.mkv') for t in ['glass-demo-motion-css', 'glass-demo-motion', 'glass-demo-motion-24']]
    if all(os.path.exists(s) for s in srcs):
        band = 120 * SCALE
        fc = ';'.join('[%d:v]crop=iw:%d:0:0,pad=iw:ih+8:0:0:color=0x7f7f7f[v%d]' % (i, band, i) for i in range(3)) + ';[v0][v1][v2]vstack=inputs=3'
        args = []
        for s in srcs:
            args += ['-i', s]
        dst = os.path.join(out, 'glass-demo-motion-rows.mp4')
        if ff(args + ['-filter_complex', fc, '-shortest'] + enc + [dst]):
            say('video:', dst, '(rows: CSS, real 36, real 24)')
    for s in glob.glob(os.path.join(vids, '*.mkv')):
        os.remove(s)


# ---------------------------------------------------------------- images
class Img:
    def __init__(self, path):
        with open(path, 'rb') as f:
            head = f.read(24)
        self.w, self.h = struct.unpack('>II', head[16:24])
        self.px = subprocess.run([FFMPEG, '-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                                 capture_output=True, check=True).stdout

    def rgb(self, x, y):
        i = (y * self.w + x) * 3
        return self.px[i], self.px[i + 1], self.px[i + 2]


def lin(c):
    s = c / 255.0
    return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4


def rel_lum(rgb):
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])


def contrast(a, b):
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def parse_color(s):
    v = [float(x) for x in re.findall(r'[\d.]+', s or '')]
    if len(v) == 3:
        v.append(1.0)
    return v[:4] if len(v) >= 4 else None


def median(vals):
    s = sorted(vals)
    return s[len(s) // 2] if s else 0


def layouts(log):
    out = []
    for line in open(log, encoding='utf-8', errors='replace'):
        if line.startswith('LAYOUT '):
            try:
                out.append(json.loads(line[7:]))
            except ValueError:
                pass
    return out


def summaries(out, lays):
    inner_y = {}
    for L in lays:
        inner_y[L['name']] = int(L['inner'][1])
    made = []
    for st in STATES:
        files = [os.path.join(out, 'glass-demo-%s-%s.png' % (st, v)) for v in VARIANTS]
        if not all(os.path.exists(f) for f in files):
            continue
        band = TALL.get(st, BAND) * SCALE
        oy = inner_y.get('glass-demo-%s-css' % st, 0)
        fc = ';'.join('[%d:v]crop=iw:%d:0:%d,pad=iw:ih+10:0:0:color=0x7f7f7f[v%d]' % (i, band, oy, i) for i in range(3)) + ';[v0][v1][v2]vstack=inputs=3'
        args = []
        for f in files:
            args += ['-i', f]
        dst = os.path.join(out, 'glass-demo-summary-%s.png' % st)
        if ff(args + ['-filter_complex', fc, '-frames:v', '1', dst]):
            made.append((st, dst))
    if made:
        # Every state, the row band only, at 1x.
        args, parts = [], []
        k = 0
        for st, _ in made:
            for v in VARIANTS:
                args += ['-i', os.path.join(out, 'glass-demo-%s-%s.png' % (st, v))]
                pad = 22 if v == '24' else 4
                parts.append('[%d:v]crop=iw:%d:0:%d,scale=iw/2:ih/2,pad=iw:ih+%d:0:0:color=0x7f7f7f[s%d]' % (k, BAND * SCALE, inner_y.get('glass-demo-%s-css' % st, 0), pad, k))
                k += 1
        fc = ';'.join(parts) + ';' + ''.join('[s%d]' % i for i in range(k)) + 'vstack=inputs=%d' % k
        dst = os.path.join(out, 'glass-demo-summary.png')
        if ff(args + ['-filter_complex', fc, '-frames:v', '1', dst]):
            say('summary:', dst, '(%d states x css / 36 / 24)' % len(made))
    for st, dst in made:
        say('summary:', dst)


def contrast_report(out, lays):
    say('\n== Ink contrast on each capsule (WCAG; under 3:1 hard to read, under 4.5:1 below the text rule) ==')
    say('tone = median sRGB grey of the capsule (inset 3 CSS px), ink = Deer\'s colour blended on it')
    for L in lays:
        path = os.path.join(out, L['name'] + '.png')
        if not os.path.exists(path):
            continue
        img = Img(path)
        rows = []
        for c in L['caps']:
            x, y, w, h = c['px']
            inset = 3 * SCALE
            x0, y0, x1, y1 = max(0, x + inset), max(0, y + inset), min(img.w, x + w - inset), min(img.h, y + h - inset)
            if x1 <= x0 or y1 <= y0:
                continue
            rs, gs, bs, ls = [], [], [], []
            step = 2
            for yy in range(y0, y1, step):
                for xx in range(x0, x1, step):
                    p = img.rgb(xx, yy)
                    rs.append(p[0])
                    gs.append(p[1])
                    bs.append(p[2])
                    ls.append(rel_lum(p))
            tone = (median(rs), median(gs), median(bs))
            tl = median(ls)
            ink = parse_color(c.get('ink'))
            cr = None
            if ink:
                a = ink[3]
                eff = tuple(ink[i] * a + tone[i] * (1 - a) for i in range(3))
                cr = contrast(rel_lum(eff), tl)
            grey = round(255 * (tl ** (1 / 2.2)))
            rows.append((c.get('title', c['kind'])[:22], c['kind'], c.get('scheme', ''), grey, cr))
        bad3 = [r for r in rows if r[4] is not None and r[4] < 3]
        bad45 = [r for r in rows if r[4] is not None and r[4] < 4.5]
        say('%-30s %-11s %d capsules, under 3:1: %d, under 4.5:1: %d' % (L['name'], L.get('theme', ''), len(rows), len(bad3), len(bad45)))
        for r in rows:
            say('    %-22s %-11s %-5s tone %3d  contrast %s%s' % (r[0], r[1], r[2], r[3], '%.1f' % r[4] if r[4] else '-', '  <-- unreadable' if r[4] is not None and r[4] < 3 else ''))


# ---------------------------------------------------------------- lag
def step_at(series, t):
    """series: sorted [(t, value)]; the value at time t (the last one at or before t)."""
    lo, hi = 0, len(series) - 1
    if not series or t < series[0][0]:
        return None
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if series[mid][0] <= t:
            lo = mid
        else:
            hi = mid - 1
    return series[lo][1]


def lag_report(logs):
    """Window-relative: a glass window's x and width against Deer's window (both from the window server)
    compared with where Deer's row had the capsule (window CSS px = points) in each frame."""
    log = os.path.join(logs, 'log.txt')
    tracks = {}
    for line in open(log, encoding='utf-8', errors='replace'):
        m = re.match(r'TRACKFILE (\S+) (\S+) samples', line)
        if m:
            tracks[m.group(1)] = os.path.join(logs, m.group(2))
    for v in ['36', '24']:
        recp = os.path.join(logs, 'cd-rec-%s.json' % v)
        if not os.path.exists(recp) or v not in tracks or not os.path.exists(tracks[v]):
            continue
        rec = json.load(open(recp))
        tr = json.load(open(tracks[v]))
        if tr.get('error') or not tr.get('samples'):
            say('lag %s: no track (%s)' % (v, tr.get('error')))
            continue
        frames = rec['frames']
        events = rec['events']
        t0 = tr['t0'] * 1000.0
        # Where Deer's row had each capsule (window CSS px), a step function of time (one value per frame).
        # A capsule missing from a frame, or a window missing from a sample, is gone then (None).
        exp = {}
        for t, _cost, sx, sy, caps in frames:
            here = set()
            for key, kind, x, y, w, h, s_, o in caps:
                exp.setdefault(key, []).append((t, (x, y, w, h, kind, s_)))
                here.add(key)
            for key, ser in exp.items():
                if key not in here and ser[-1][1] is not None:
                    ser.append((t, None))
        wins = {}
        for ms, rows in tr['samples']:
            t = t0 + ms
            here = set()
            for wid, layer, x, y, w, h, alpha in rows:
                wins.setdefault(wid, []).append((t, (x, y, w, h, alpha)))
                here.add(wid)
            for wid, ser in wins.items():
                if wid not in here and ser[-1][1] is not None:
                    ser.append((t, None))
        if not wins:
            continue
        main = max(wins, key=lambda k: max(r[1][2] * r[1][3] for r in wins[k] if r[1]))
        mser = wins[main]

        def rel(wid, t):
            g = step_at(wins[wid], t)
            m = step_at(mser, t)
            if not g or not m:
                return None
            return (g[0] - m[0], g[1] - m[1], g[2], g[3])

        owner = {}
        for wid, ser in wins.items():
            if wid == main:
                continue
            votes = {}
            for t, _r in [x for x in ser if x[1]][:: max(1, len(ser) // 60)]:
                g = rel(wid, t)
                if not g:
                    continue
                best, bd = None, 1e9
                for key, es in exp.items():
                    e = step_at(es, t)
                    if not e or abs(e[5] - 1) > 0.001:
                        continue
                    d = abs(e[0] - g[0]) + abs(e[1] - g[1]) + abs(e[2] - g[2]) + abs(e[3] - g[3])
                    if d < bd:
                        best, bd = key, d
                if best is not None and bd < 60:
                    votes[best] = votes.get(best, 0) + 1
            if votes:
                owner[wid] = max(votes, key=votes.get)
        say('\n== Lag, variant %s: %d glass windows matched to capsules, %d frames of Deer\'s row, %d window-server samples ==' % (v, len(owner), len(frames), len(tr['samples'])))
        say('(off = glass window against where Deer\'s row had its capsule, both relative to Deer\'s window; delay = the shift of the row\'s timeline that fits the glass best)')
        for i in range(len(events) - 1):
            a, name = events[i]
            b = events[i + 1][0]
            res = []
            for wid, key in owner.items():
                es = exp[key]
                errs = []
                moving = False
                t = a
                while t < b:
                    e = step_at(es, t)
                    g = rel(wid, t)
                    # A window under -moz-window-transform (a capsule entering or leaving) is listed by
                    # the window server at bounds that are not where it shows (s10-probe4.js): skipped.
                    if e and g and abs(e[5] - 1) < 0.001:
                        errs.append(max(abs(g[0] - e[0]), abs(g[2] - e[2])))
                        e2 = step_at(es, t - 150)
                        if e2 and (abs(e2[0] - e[0]) > 2 or abs(e2[2] - e[2]) > 2):
                            moving = True
                    t += 2
                if not errs or (not moving and max(errs) < 2):
                    continue
                fits = {}
                for d in range(-40, 161, 4):
                    acc, n = 0.0, 0
                    t = a
                    while t < b:
                        e = step_at(es, t - d)
                        g = rel(wid, t)
                        if e and g and abs(e[5] - 1) < 0.001:
                            acc += abs(g[0] - e[0]) + abs(g[2] - e[2])
                            n += 1
                        t += 4
                    if n:
                        fits[d] = acc / n
                best = min(fits, key=fits.get) if fits and moving and max(errs) >= 2 else None
                first = step_at(es, a) or step_at(es, b)
                res.append((key, first[4] if first else '?', max(errs), sum(errs) / len(errs), best, fits.get(best) if best is not None else None, moving))
            if res:
                lags = sorted(r[4] for r in res if r[4] is not None)
                say('%-14s %5.0f ms  windows: %d, max off %.0f pt, mean off %.1f pt, best-fit delay median %s ms (%s..%s)' % (
                    name, b - a, len(res), max(r[2] for r in res), sum(r[3] for r in res) / len(res), lags[len(lags) // 2] if lags else '-', lags[0] if lags else '-', lags[-1] if lags else '-'))
                for r in sorted(res, key=lambda r: -r[2])[:3]:
                    say('      %-4s %-11s max off %5.1f pt, mean %4.1f pt, best delay %s ms, then off %s pt' % (r[0], r[1], r[2], r[3], r[4], '%.1f' % r[5] if r[5] is not None else '-'))
        # Snaps: a glass window that jumps more than 20 pt against Deer's window between two samples
        # while its capsule moved less than 8 pt over that time (Gecko putting it back somewhere).
        snaps = []
        for wid, key in owner.items():
            ser = wins[wid]
            times = sorted(set([t for t, _ in ser] + [t for t, _ in mser]))
            prev = None
            for t in times:
                g = rel(wid, t)
                e = step_at(exp[key], t)
                if e and abs(e[5] - 1) > 0.001:
                    prev = None
                    continue
                if g and e and prev:
                    (tp, gp, ep) = prev
                    if abs(g[0] - gp[0]) > 20 and abs(e[0] - ep[0]) < 8:
                        snaps.append((t, wid, key, gp[0], g[0], e[0]))
                if g and e:
                    prev = (t, g, e)
        say('snaps (window jumped > 20 pt against Deer\'s window while its capsule stood): %d' % len(snaps))
        for t, wid, key, x0, x1, ex in snaps[:8]:
            name = [n for tt, n in events if tt <= t][-1:] or ['?']
            say('      at +%.0f ms (%s): %s window x %.0f -> %.0f against Deer\'s window, capsule at %.0f' % (t - t0, name[0], key, x0, x1, ex))
        # The programmatic window move: how the glass windows followed Deer's window.
        for mv_name in ('window-move', 'window-back'):
            mv = [t for t, n in events if n == mv_name]
            if not mv:
                continue
            t = mv[0]
            ms = [(round(tt - t), r[0]) for tt, r in mser if r and t - 20 <= tt <= t + 400]
            say('%s: Deer\'s window x %s' % (mv_name, ms[:8]))
            for wid, key in [(w, k) for w, k in owner.items() if step_at(wins[w], t)][:2]:
                s2 = [(round(tt - t), round(r[0])) for tt, r in wins[wid] if r and t - 20 <= tt <= t + 400]
                say('   glass %s x %s' % (key, s2[:10]))


def misc(logs):
    log = os.path.join(logs, 'log.txt')
    for line in open(log, encoding='utf-8', errors='replace'):
        if line.startswith(('CD-CPU ', 'MOTION ', 'MEASURE ', 'CD-RECORDING ')):
            s = line.strip()
            if line.startswith('MEASURE '):
                s = re.sub(r',"report":\[.*\]\}$', '}', s)
            say(s[:700])


def main(argv):
    logs = os.path.abspath(argv[0])
    vids = argv[argv.index('--vids') + 1] if '--vids' in argv else None
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.abspath(argv[argv.index('--out') + 1]) if '--out' in argv else os.path.join(here, '..', '..', 'tests', 'menus', 'out')
    if vids and os.path.isdir(vids):
        videos(vids, out)
    lays = layouts(os.path.join(logs, 'log.txt'))
    summaries(out, lays)
    contrast_report(out, lays)
    try:
        lag_report(logs)
    except Exception as e:  # noqa: BLE001
        say('lag report failed:', e)
    misc(logs)
    with open(os.path.join(logs, 'analysis.txt'), 'w') as f:
        f.write('\n'.join(LINES) + '\n')


if __name__ == '__main__':
    main(sys.argv[1:])
