"""S3/S7 helper (spikes/mac-glass): per video frame, where the glass panel's content is against where
Deer's window says it should be.

  /usr/bin/python3 spikes/mac-glass/video_markers.py <video.mkv> [--every 1]

s3-lifetime.js draws a red 10 pt square 16 pt above and left of the place panel A should take (inside
Deer's window, so it moves with the window's own layout), and panel A's content has a blue 10 pt square
6 pt inside its top-left corner. Aligned, the blue square sits (22, 22) pt from the red one. For every
frame this prints the two squares' centres (video px, 2 per pt) and the panel's error in pt (blue - red
- 22). A frame where either square is missing says so. Python 3.9 + ffmpeg (rawvideo rgb24).
"""
import json
import subprocess
import sys


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
                          '-of', 'json', path], capture_output=True, text=True).stdout
    s = json.loads(out)['streams'][0]
    return s['width'], s['height']


def blobs(buf, w, h, test, step=2):
    xs = ys = n = 0
    for y in range(0, h, step):
        row = y * w * 3
        for x in range(0, w, step):
            i = row + x * 3
            if test(buf[i], buf[i + 1], buf[i + 2]):
                xs += x
                ys += y
                n += 1
    return (xs / n, ys / n, n) if n else None


def main(argv):
    path = argv[0]
    w, h = probe(path)
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', path, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    size = w * h * 3
    i = 0
    red = lambda r, g, b: r > 200 and g < 70 and b < 70  # noqa: E731
    blue = lambda r, g, b: b > 200 and r < 70 and g < 70  # noqa: E731
    rows = []
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        bl = blobs(buf, w, h, blue)
        # The red marker that belongs to the blue square: the red pixels above and left of it.
        rd = None
        if bl:
            bx, by = bl[0], bl[1]
            rd = blobs(buf, w, h, lambda r, g, b: red(r, g, b))
            # keep only the top-left red square (there is one at the bottom-right too)
            pts = []
            for y in range(0, h, 2):
                row = y * w * 3
                for x in range(0, w, 2):
                    k = row + x * 3
                    if red(buf[k], buf[k + 1], buf[k + 2]) and x < bx + 20 and y < by + 20:
                        pts.append((x, y))
            rd = (sum(p_[0] for p_ in pts) / len(pts), sum(p_[1] for p_ in pts) / len(pts), len(pts)) if pts else None
        if bl and rd:
            ex = (bl[0] - rd[0]) / 2 - 22
            ey = (bl[1] - rd[1]) / 2 - 22
            rows.append((i, round(bl[0], 1), round(bl[1], 1), round(rd[0], 1), round(rd[1], 1), round(ex, 1), round(ey, 1)))
        else:
            rows.append((i, bl and round(bl[0], 1), bl and round(bl[1], 1), rd and round(rd[0], 1), rd and round(rd[1], 1), None, None))
        i += 1
    print('frame blue_x blue_y red_x red_y err_x_pt err_y_pt')
    for r in rows:
        print(*r)


if __name__ == '__main__':
    main(sys.argv[1:])
