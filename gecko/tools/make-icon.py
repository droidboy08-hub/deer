"""Build Deer's app icons from the artwork in design/icon/.

  python tools/make-icon.py

Two icons, chosen in Settings > Appearance > App icon (setting appIcon):
  gold    (default)  -> tools/runtime-overlay/browser/chrome/icons/default/vitre.ico
  orange             -> tools/runtime-overlay/browser/chrome/icons/default/deer-orange.ico
and the Settings tile previews -> src/skin/app-icons/<name>.png.

Each .ico holds 16 to 256 px. 32 px and up are reduced from design/icon/deer-<name>-1024.png (the
artwork with its plate cut to a clean rounded square). 16 to 24 px come from deer-<name>-small-1024.png
(design/icon/deer-<name>-small.svg rendered: the deer's outline on a full-size plate, no ring), because
the ring and shading turn to mush at those sizes. The white orange plate gets a faint 1 px edge so it
stays visible on a light taskbar.

tools/setup-runtime.py copies the .ico files into the runtime; VitreStartup sets the root attribute
icon="vitre" (or "deer-orange") on every chrome window and Gecko loads
<runtime>/browser/chrome/icons/default/<name>.ico. The gold .ico keeps the name vitre.ico because the
installer, the launcher and setup-engine.py (deer.exe's own icon) read it from there. Needs Pillow.
"""
import os

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ART = os.path.join(os.path.dirname(ROOT), 'design', 'icon')
ICONS = os.path.join(ROOT, 'tools', 'runtime-overlay', 'browser', 'chrome', 'icons', 'default')
PREVIEWS = os.path.join(ROOT, 'src', 'skin', 'app-icons')
VARIANTS = {'gold': 'vitre.ico', 'orange': 'deer-orange.ico'}
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
SMALL_MAX = 24        # sizes up to this use the simplified art
PLATE = 960 / 1024    # the large art's plate, centred in its canvas
RADIUS = 0.2877       # corner radius / plate size (measured on the artwork)
PREVIEW = 128         # Settings tile preview, shown at 64 CSS px


def reduce(src, size):
    """Lanczos in two steps (to 4x, then to size): sharp without ringing at 16-48 px."""
    if src.width > size * 4:
        src = src.resize((size * 4, size * 4), Image.LANCZOS)
    return src.resize((size, size), Image.LANCZOS)


def edge(size, plate):
    """A faint 1 px line just inside the plate's rim (supersampled), for the white plate."""
    ss = 8
    n = size * ss
    o = (size - size * plate) / 2 * ss
    w = max(1.0, size / 128) * ss
    layer = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle([o + w / 2, o + w / 2, n - o - w / 2, n - o - w / 2],
                                            radius=size * plate * RADIUS * ss - w / 2, outline=(0, 0, 0, 30), width=round(w))
    return layer.resize((size, size), Image.LANCZOS)


def frames(name):
    large = Image.open(os.path.join(ART, 'deer-%s-1024.png' % name)).convert('RGBA')
    small = Image.open(os.path.join(ART, 'deer-%s-small-1024.png' % name)).convert('RGBA')
    out = []
    for s in SIZES:
        if s <= SMALL_MAX:
            im = reduce(small, s)  # the small art draws its own edge
        else:
            im = reduce(large, s)
            if name == 'orange':
                im.alpha_composite(edge(s, PLATE))
        out.append(im)
    return out


def main():
    os.makedirs(ICONS, exist_ok=True)
    os.makedirs(PREVIEWS, exist_ok=True)
    for name, ico in VARIANTS.items():
        images = frames(name)
        path = os.path.join(ICONS, ico)
        images[-1].save(path, format='ICO', sizes=[(s, s) for s in SIZES], append_images=images[:-1])
        print('wrote', path)
        art = Image.open(os.path.join(ART, 'deer-%s-1024.png' % name)).convert('RGBA')
        preview = reduce(art, PREVIEW)
        if name == 'orange':
            preview.alpha_composite(edge(PREVIEW, PLATE))
        path = os.path.join(PREVIEWS, name + '.png')
        preview.save(path, optimize=True)
        print('wrote', path)


if __name__ == '__main__':
    main()
