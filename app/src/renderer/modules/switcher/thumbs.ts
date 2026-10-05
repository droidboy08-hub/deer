// Card thumbnails. A hidden page can't be captured (it paints nothing), so the visible tab is
// captured while you use it: after it loads, after scrolling settles, a moment after it is shown,
// every few seconds while it stays in front, and fresh when the switcher opens. That way a tab's
// card shows it as you left it, and the switcher never renders live pages.
import type { IpcMessageEvent, WebviewTag } from 'electron';
import type { Browser } from '../../app';
import type { Tab } from '../../model';

const AFTER_SHOW = 600;
const AFTER_LOAD = 400;
const AFTER_SCROLL = 700;
const REFRESH_EVERY = 10_000;

export class Thumbs {
  private cache = new Map<number, string>();
  private takenAt = new Map<number, number>();
  private inflight = new Map<number, Promise<string | null>>();
  private timer: number | null = null;
  private listeners: ((id: number) => void)[] = [];

  constructor(private b: Browser) {
    b.on('tab-activated', () => this.soon(AFTER_SHOW));
    b.on('tab-updated', (t: Tab) => {
      if (t.id === b.activeId && !t.loading) this.soon(AFTER_LOAD);
    });
    b.on('tab-closed', (t: Tab) => {
      this.cache.delete(t.id);
      this.takenAt.delete(t.id);
    });
    b.on('webview-created', (t: Tab, wv: WebviewTag) => {
      wv.addEventListener('ipc-message', (e: IpcMessageEvent) => {
        if (e.channel === 'page-scroll' && t.id === b.activeId) this.soon(AFTER_SCROLL);
      });
    });
    window.setInterval(() => {
      const t = b.active();
      if (t && Date.now() - (this.takenAt.get(t.id) ?? 0) >= REFRESH_EVERY) void this.capture(t);
    }, REFRESH_EVERY);
  }

  get(id: number): string | null {
    return this.cache.get(id) ?? null;
  }

  onChange(fn: (id: number) => void): void {
    this.listeners.push(fn);
  }

  /** Capture the tab in front now (the switcher calls this as it opens). */
  captureActive(): Promise<string | null> {
    const t = this.b.active();
    return t ? this.capture(t) : Promise.resolve(null);
  }

  private soon(delay: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      const t = this.b.active();
      if (t) void this.capture(t);
    }, delay);
  }

  private capture(t: Tab): Promise<string | null> {
    if (!capturable(t, this.b.activeId)) return Promise.resolve(null);
    const running = this.inflight.get(t.id);
    if (running) return running;
    const width = Math.min(1920, Math.round(window.innerWidth * window.devicePixelRatio * 0.75));
    const p = window.vitre.ipc
      .invoke('switcher:thumb', (t.webview as WebviewTag).getWebContentsId(), width)
      .then(async (url) => {
        // Keep the old picture if the tab went away or the capture failed.
        if (typeof url !== 'string' || !this.b.tabs.includes(t)) return this.get(t.id);
        // Decoded up front, so the card that grows from (or into) the window never paints empty.
        const img = new Image();
        img.src = url;
        await img.decode().catch(() => undefined);
        this.cache.set(t.id, url);
        this.takenAt.set(t.id, Date.now());
        for (const fn of this.listeners) fn(t.id);
        return url;
      })
      .catch(() => this.get(t.id))
      .finally(() => this.inflight.delete(t.id));
    this.inflight.set(t.id, p);
    return p;
  }
}

/** Only the tab in front, attached and without an error, can be captured; a minimized window paints nothing. */
function capturable(t: Tab, activeId: number): boolean {
  return t.id === activeId && t.kind === 'web' && !!t.webview && t.ready && !t.error && document.visibilityState === 'visible';
}
