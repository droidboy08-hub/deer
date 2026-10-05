// The deck's background: the picture Home shows (Settings > Home background), blurred by the deck's
// CSS. It is decoded ahead of time so the deck never waits for it:
//   - 'windows' and 'image': VitreHome.picture(window, path, screen box), the same screen-sized copy
//     Home itself shows (src/modules/VitreHome.sys.ts; the box must match Home's so they share the
//     one cached file);
//   - 'video': the last picture of a Home tab when there is one (a video is not decoded here);
//   - 'none', or nothing readable: the deck's plain dark background.
import type { Browser } from '../../browser';
import type { Thumbs } from './thumbs';
import { drawCover, el } from './parts';

export class Wallpaper {
  private img: HTMLImageElement | null = null;
  private key = '';
  private serial = 0;

  constructor(private b: Browser, private thumbs: Thumbs) {
    b.whenReady.then(() => window.setTimeout(() => void this.refresh(), 500));
    b.on('settings', (_s, changed) => {
      if (changed.some((k) => k.startsWith('homeBackground'))) void this.refresh();
    });
  }

  /** The element to put behind the deck now (the same decoded picture every time). */
  element(): HTMLElement {
    if (this.img) return this.img;
    if (this.b.settings.homeBackground.kind === 'video') {
      const home = this.b.tabs.find((t) => t.kind === 'home' && this.thumbs.has(t.id));
      if (home) {
        const canvas = document.createElement('canvas');
        const w = Math.max(1, Math.round(window.innerWidth / 4));
        const h = Math.max(1, Math.round(window.innerHeight / 4));
        canvas.width = w;
        canvas.height = h;
        const ok = this.thumbs.drawInto(home.id, (bitmap) => drawCover(canvas, bitmap));
        if (ok) return canvas;
      }
    }
    return el('');
  }

  /**
   * The deck is about to show (Ctrl+Tab went down, 150 ms ahead): ask for the picture's pixels again.
   * Gecko lets an image that is not on screen lose its decoded copy after a while (the surface cache,
   * image.mem.surfacecache.min_expiration_ms), and an async-decoding <img> paints nothing until it
   * has one again, so the wallpaper would pop in under the opening motion.
   */
  warm(): void {
    this.img?.decode().catch(() => undefined);
  }

  /** Decode the current background picture (once per setting). */
  async refresh(): Promise<void> {
    const bg = this.b.settings.homeBackground;
    const key = `${bg.kind}|${bg.path}`;
    if (key === this.key && this.img) return;
    this.key = key;
    const mine = ++this.serial;
    let url: string | null = null;
    try {
      if (bg.kind === 'windows' || bg.kind === 'image') {
        const home = this.b.sys('VitreHome');
        const path = bg.kind === 'windows' ? (await home.windowsWallpaper())?.path : bg.path;
        if (path) {
          const box = { width: window.screen.width * window.devicePixelRatio, height: window.screen.height * window.devicePixelRatio };
          url = (await home.picture(window, path, box))?.url ?? null;
        }
      }
    } catch (e) {
      console.error('Deer switcher: background picture unavailable', e);
      url = null;
    }
    if (mine !== this.serial) return;
    if (!url) {
      this.img = null;
      return;
    }
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.src = url;
    try {
      await img.decode();
    } catch {
      if (mine === this.serial) this.img = null;
      return;
    }
    if (mine === this.serial) this.img = img;
  }
}
