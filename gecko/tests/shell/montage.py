"""Contact sheets of the shell captures, for looking at many states at once (from gecko/):

  python tests/shell/montage.py

Writes into tests/shell/out/:
  sheet-look-1280.png, sheet-look-900.png   the top strip of every look-<tabs>-<page>-<width> capture
  sheet-states.png                          hover, tooltips, motion, plates, close badges, loading
  sheet-chrome.png                          maximized, auto-hide, full screen, windows, navigation
  zoom-light.png, zoom-dark.png, zoom-stripes.png   3x crops of the bar and the window controls
Captures that do not exist are skipped. tests/shell/zoom.py crops any region of one capture.
"""
import os

from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
GAP = (255, 0, 255)


def load(name):
    path = os.path.join(OUT, name + '.png')
    return Image.open(path).convert('RGB') if os.path.exists(path) else None


def sheet(names, out, box=(0, 0, 1280, 76), width=1280):
    rows = []
    for name in names:
        im = load(name)
        if im is None:
            continue
        im = im.crop((box[0], box[1], min(box[2], im.width) if im.width <= 1600 else im.width, box[3]))
        if im.width > width:
            im = im.resize((width, max(1, int(im.height * width / im.width))), Image.LANCZOS)
        rows.append(im)
    if not rows:
        return
    total = Image.new('RGB', (max(r.width for r in rows), sum(r.height + 4 for r in rows)), GAP)
    y = 0
    for r in rows:
        total.paste(r, (0, y))
        y += r.height + 4
    total.save(os.path.join(OUT, out))
    print(out, total.size)


def zoom(name, out, boxes, scale=3):
    im = load(name)
    if im is None:
        return
    crops = [im.crop(b).resize(((b[2] - b[0]) * scale, (b[3] - b[1]) * scale), Image.NEAREST) for b in boxes]
    total = Image.new('RGB', (max(c.width for c in crops), sum(c.height + 4 for c in crops)), GAP)
    y = 0
    for c in crops:
        total.paste(c, (0, y))
        y += c.height + 4
    total.save(os.path.join(OUT, out))
    print(out, total.size)


def main():
    for width in (1280, 900):
        sheet(['look-%d-%s-%d' % (n, page, width) for n in (1, 3, 12) for page in ('wiki', 'white', 'dark')], 'sheet-look-%d.png' % width)
    sheet(['states-hover-circle', 'states-hover-back', 'states-hover-plus', 'states-hover-close-window', 'states-motion-mid', 'states-plates-light',
           'states-plates-dark', 'states-close-always', 'states-loading', 'states-30-1280'], 'sheet-states.png', box=(0, 0, 1280, 100))
    sheet(['chrome-maximized', 'chrome-autohide-hidden', 'chrome-autohide-revealed', 'chrome-f11-hidden', 'chrome-f11-revealed', 'chrome-second-window',
           'chrome-private-window', 'chrome-popup-window', 'chrome-nav-0', 'chrome-nav-2', 'chrome-nav-4', 'chrome-nav-done', 'chrome-scale-150',
           'chrome-notification'], 'sheet-chrome.png', box=(0, 0, 1280, 112))
    # 3 tabs at 1280: the group spans x 314..950 in the client area; captures carry an 8 px frame on the left.
    zoom('look-3-wiki-1280', 'zoom-light.png', [(316, 4, 966, 68), (1144, 10, 1272, 60)])
    zoom('look-3-dark-1280', 'zoom-dark.png', [(316, 4, 966, 68), (1144, 10, 1272, 60)])
    zoom('look-stripes-3-1280', 'zoom-stripes.png', [(316, 4, 966, 68), (1144, 10, 1272, 60)])


if __name__ == '__main__':
    main()
