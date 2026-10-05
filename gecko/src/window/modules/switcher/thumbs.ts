// Card pictures. Recipe: spikes/switcher/RESULT.md (1. Thumbnails) with the verifier's corrections.
//
// - Any tab with a document can be drawn, also in the background and in a minimized window:
//   b.snapshot(browser, null, scale) (WindowGlobalParent.drawSnapshot; the core multiplies the scale
//   by the page's zoom, so a zoomed page gives the same size). Scale: the deck card's share of the
//   window (0.6) x devicePixelRatio, at most MAX_WIDTH device px wide. Grid and Strip draw the same
//   picture smaller.
// - A tab without a document (discarded, or restored and never shown) cannot be drawn. It is drawn
//   AT discard (gBrowser.discardBrowser is wrapped, gecko.ts onDiscard) and, after a restart, its
//   card shows the JPEG the last session saved (VitreSwitcher.sys.ts; tab value "vitre-thumb").
// - A busy content process answers late: a card shows what is cached at once and the fresh picture
//   replaces it when it comes (listeners: onChange).
// - Memory: a decoded picture is about 2 MB (864x540). At most MAX_BITMAPS stay decoded; every
//   picture is also kept as a JPEG blob (30-120 KB) and decoded again when a card needs it.
// - A picture taken while a document is loading never replaces a good one (a mid-navigation snapshot
//   can be a blank page).
//
// When pictures are taken: the tab you leave, at once; any tab 400 ms after its page finished
// loading; a tab being discarded; the active tab when the switcher opens (before the cards show),
// then the cards on screen when theirs is older than FRESH; the active tab 300 ms after it is shown
// if it has none. Never on a timer, and never in a popup window (it has no switcher).
// Disk: normal (not private) windows save a tab's JPEG 1.5 s after its picture settles. A tab gets a
// new file id the first time it is saved in a session (duplicated tabs share restored values).
import type { Browser } from '../../browser';
import * as fx from '../../firefox';
import type { Tab } from '../../model';
import { drawable, loadingDocument, newId, onDiscard } from './gecko';
import { drawCover, type Media } from './parts';

/** The deck card is 60% of the window: pictures are taken at that size. */
const SCALE = 0.6;
const MAX_WIDTH = 1280;
const MAX_BITMAPS = 16;
const JPEG_QUALITY = 0.82;
/** A picture younger than this is fresh enough for a card on screen. */
export const FRESH = 2500;
const AFTER_LOAD = 400;
const AFTER_SHOW = 300;
const SAVE_AFTER = 1500;
/** A snapshot that has not answered in this time no longer blocks a new request for that tab. */
const STUCK = 3000;

export type CaptureWhy = 'leave' | 'load' | 'discard' | 'open' | 'visible' | 'show';

interface Entry {
  /** Unique across entries; increases with every new picture. */
  version: number;
  bitmap: ImageBitmap | null;
  jpeg: Blob | null;
  jpegVersion: number;
  decoding: Promise<void> | null;
  /** performance.now() when the picture was asked for (0 for one read from disk). */
  at: number;
  from: 'live' | 'disk';
  savedVersion: number;
}

let serial = 0;

export class Thumbs {
  private entries = new Map<number, Entry>();
  /** Ids with a decoded bitmap, least recently used first. */
  private lru: number[] = [];
  private inflight = new Map<number, { at: number; p: Promise<boolean> }>();
  private saveTimers = new Map<number, number>();
  private fileIds = new WeakMap<XULTab, string>();
  /** Tabs whose saved picture was already looked for. */
  private diskTried = new Set<number>();
  private listeners: ((id: number) => void)[] = [];
  private timers = new Map<number, number>();
  /** The tab that was active before the latest switch (its picture is taken as you leave it). */
  private lastActive: number | undefined;
  /** While true nothing is written to disk (the switcher is animating). */
  quiet = false;
  /** Counters for tests and diagnostics. */
  readonly stats = { captures: 0, failed: 0, skipped: 0, decodes: 0, encodes: 0, saved: 0, loadedFromDisk: 0, discards: 0, evicted: 0 };

  constructor(private b: Browser) {
    // A popup window (one page, window.open with features: sign-in and payment popups) never shows
    // the switcher: nothing is pictured there, and nothing is written to disk.
    if (b.isPopup) return;
    const store = this.store();
    store?.init();
    b.on('tab-activated', (t) => {
      const before = this.lastActive;
      this.lastActive = t.id;
      const prev = before !== undefined ? b.tab(before) : undefined;
      if (prev && prev !== t) void this.capture(prev, 'leave');
      this.later(t.id, AFTER_SHOW, () => {
        if (b.activeId === t.id && !this.fresh(t.id, 60_000)) void this.capture(t, 'show');
      });
    });
    b.on('tab-loading', (t, _browser, loading) => {
      if (!t || loading) return;
      this.later(t.id, AFTER_LOAD, () => {
        if (b.tabs.includes(t) && !t.loading) void this.capture(t, 'load');
      });
    });
    // Restored tabs that stay unloaded until shown: their pictures from the last session. Session
    // restore opens a tab first and marks it unloaded ("pending") a moment later: tab-updated.
    const restored = (t: Tab): void => {
      if (t.deferred && !this.entries.has(t.id) && !this.diskTried.has(t.id)) window.setTimeout(() => void this.fromDisk(t), 0);
    };
    b.on('tab-created', restored);
    b.on('tab-updated', restored);
    b.on('tab-closed', (t) => this.drop(t.id));
    b.onDestroy(onDiscard((node) => {
      const t = b.tabs.find((x) => x.node === node);
      if (!t) return;
      this.stats.discards++;
      void this.capture(t, 'discard');
    }));
    this.lastActive = b.activeId || undefined;
    b.whenReady.then(() => {
      for (const t of b.tabs) restored(t);
    });
    b.onDestroy(() => {
      for (const e of this.entries.values()) e.bitmap?.close();
      this.entries.clear();
      for (const id of this.timers.values()) clearTimeout(id);
      for (const id of this.saveTimers.values()) clearTimeout(id);
    });
  }

  onChange(fn: (id: number) => void): void {
    this.listeners.push(fn);
  }

  has(id: number): boolean {
    return this.entries.has(id);
  }

  /** How old the tab's picture is (ms), or Infinity. Pictures from disk count as old. */
  age(id: number): number {
    const e = this.entries.get(id);
    return e && e.from === 'live' ? performance.now() - e.at : Infinity;
  }

  fresh(id: number, within = FRESH): boolean {
    return this.age(id) < within;
  }

  /** What the store holds, for tests: decoded bitmaps, JPEG blobs and their bytes. */
  memory(): { entries: number; bitmaps: number; bitmapBytes: number; jpegs: number; jpegBytes: number } {
    let bitmaps = 0;
    let bitmapBytes = 0;
    let jpegs = 0;
    let jpegBytes = 0;
    for (const e of this.entries.values()) {
      if (e.bitmap) {
        bitmaps++;
        bitmapBytes += e.bitmap.width * e.bitmap.height * 4;
      }
      if (e.jpeg) {
        jpegs++;
        jpegBytes += e.jpeg.size;
      }
    }
    return { entries: this.entries.size, bitmaps, bitmapBytes, jpegs, jpegBytes };
  }

  /**
   * Paint the tab's picture into a card. A decoded picture is drawn at once; one that only exists as
   * a JPEG is decoded first and announced through onChange (the view then paints again).
   */
  paint(t: Tab, media: Media): void {
    const e = this.entries.get(t.id);
    if (!e) {
      if (media.painted < 0) media.empty(t);
      return;
    }
    if (media.painted === e.version) return;
    if (e.bitmap) {
      drawCover(media.canvas, e.bitmap);
      media.filled(e.version);
      this.touch(t.id);
      return;
    }
    if (media.painted < 0) media.empty(t);
    void this.decode(t.id);
  }

  /** Hand the tab's decoded picture to fn, if there is one now. */
  drawInto(id: number, fn: (bitmap: ImageBitmap) => void): boolean {
    const e = this.entries.get(id);
    if (!e?.bitmap) {
      void this.decode(id);
      return false;
    }
    fn(e.bitmap);
    return true;
  }

  /** Decode the JPEGs of these tabs ahead of their cards (the switcher is about to show them). */
  prepare(ids: number[]): void {
    for (const id of ids) {
      const e = this.entries.get(id);
      if (e && !e.bitmap && e.jpeg) void this.decode(id);
    }
  }

  /**
   * Take a fresh picture of a tab. Resolves true when a new picture landed. Requests for a tab whose
   * snapshot is still on its way share it.
   */
  capture(t: Tab, why: CaptureWhy): Promise<boolean> {
    const browser = t.browser;
    if (t.deferred || t.crashed || !browser || !drawable(browser)) {
      this.stats.skipped++;
      return Promise.resolve(false);
    }
    // A page on its way in must not replace the picture of the page that was there.
    if (why !== 'open' && why !== 'discard' && this.entries.has(t.id) && loadingDocument(browser)) {
      this.stats.skipped++;
      return Promise.resolve(false);
    }
    const running = this.inflight.get(t.id);
    if (running && performance.now() - running.at < STUCK) return running.p;
    const at = performance.now();
    let p: Promise<boolean>;
    try {
      // b.snapshot starts drawSnapshot synchronously, before its first await: at discard this runs
      // while the document still exists.
      p = this.b.snapshot(browser, null, this.scale(browser)).then(
        (bitmap) => this.accept(t, bitmap, at),
        () => {
          this.stats.failed++;
          return false;
        }
      );
    } catch {
      this.stats.failed++;
      return Promise.resolve(false);
    }
    const job = { at, p };
    this.inflight.set(t.id, job);
    void p.finally(() => {
      if (this.inflight.get(t.id) === job) this.inflight.delete(t.id);
    });
    return p;
  }

  private scale(browser: XULBrowser): number {
    const dpr = window.devicePixelRatio || 1;
    let width = window.innerWidth;
    try {
      width = browser.getBoundingClientRect().width || width;
    } catch {
      /* use the window's */
    }
    return Math.min(SCALE * dpr, MAX_WIDTH / Math.max(1, width));
  }

  private accept(t: Tab, bitmap: ImageBitmap | null, at: number): boolean {
    if (!bitmap) {
      this.stats.failed++;
      return false;
    }
    if (!this.b.tabs.includes(t) || !bitmap.width || !bitmap.height) {
      bitmap.close();
      return false;
    }
    let e = this.entries.get(t.id);
    if (e && e.from === 'live' && e.at > at) {
      bitmap.close(); // a newer picture landed first
      return false;
    }
    if (!e) {
      e = { version: 0, bitmap: null, jpeg: null, jpegVersion: -1, decoding: null, at, from: 'live', savedVersion: -1 };
      this.entries.set(t.id, e);
    }
    e.bitmap?.close();
    e.bitmap = bitmap;
    e.version = ++serial;
    e.at = at;
    e.from = 'live';
    this.stats.captures++;
    this.touch(t.id);
    void this.encode(t.id, e);
    this.notify(t.id);
    return true;
  }

  /** JPEG of the entry's current bitmap: kept for when the bitmap is evicted, and saved to disk. */
  private async encode(id: number, e: Entry): Promise<void> {
    const bitmap = e.bitmap;
    const version = e.version;
    if (!bitmap) return;
    let blob: Blob;
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0);
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    } catch {
      return;
    }
    if (this.entries.get(id) !== e || e.version !== version) return;
    e.jpeg = blob;
    e.jpegVersion = version;
    this.stats.encodes++;
    this.evict();
    this.saveSoon(id);
  }

  private decode(id: number): Promise<void> {
    const e = this.entries.get(id);
    if (!e || e.bitmap || !e.jpeg) return Promise.resolve();
    if (e.decoding) return e.decoding;
    const jpeg = e.jpeg;
    const version = e.version;
    e.decoding = createImageBitmap(jpeg)
      .then((bitmap) => {
        if (this.entries.get(id) !== e || e.version !== version || e.bitmap) {
          bitmap.close();
          return;
        }
        e.bitmap = bitmap;
        this.stats.decodes++;
        this.touch(id);
        this.evict();
        this.notify(id);
      })
      .catch(() => undefined)
      .finally(() => {
        e.decoding = null;
      });
    return e.decoding;
  }

  private touch(id: number): void {
    const i = this.lru.indexOf(id);
    if (i >= 0) this.lru.splice(i, 1);
    this.lru.push(id);
  }

  /** Keep at most MAX_BITMAPS decoded; only pictures that also exist as a JPEG can be let go. */
  private evict(): void {
    let decoded = this.lru.filter((id) => this.entries.get(id)?.bitmap).length;
    for (const id of [...this.lru]) {
      if (decoded <= MAX_BITMAPS) break;
      const e = this.entries.get(id);
      if (!e?.bitmap) {
        this.lru.splice(this.lru.indexOf(id), 1);
        continue;
      }
      if (e.jpegVersion !== e.version || !e.jpeg) continue;
      e.bitmap.close();
      e.bitmap = null;
      this.lru.splice(this.lru.indexOf(id), 1);
      this.stats.evicted++;
      decoded--;
    }
  }

  private drop(id: number): void {
    const e = this.entries.get(id);
    e?.bitmap?.close();
    this.entries.delete(id);
    this.diskTried.delete(id);
    this.lru = this.lru.filter((x) => x !== id);
    this.inflight.delete(id);
    const timer = this.saveTimers.get(id);
    if (timer) clearTimeout(timer);
    this.saveTimers.delete(id);
    const later = this.timers.get(id);
    if (later) clearTimeout(later);
    this.timers.delete(id);
  }

  private notify(id: number): void {
    for (const fn of this.listeners) {
      try {
        fn(id);
      } catch (err) {
        console.error('Deer switcher: thumbnail listener failed', err);
      }
    }
  }

  private later(id: number, ms: number, fn: () => void): void {
    const old = this.timers.get(id);
    if (old) clearTimeout(old);
    this.timers.set(
      id,
      window.setTimeout(() => {
        this.timers.delete(id);
        fn();
      }, ms)
    );
  }

  // ---- disk ----

  private store(): VitreSysModules['VitreSwitcher'] | null {
    try {
      return this.b.sys('VitreSwitcher');
    } catch (e) {
      console.error('Deer switcher: VitreSwitcher unavailable', e);
      return null;
    }
  }

  private saveSoon(id: number): void {
    if (this.b.isPrivate) return;
    const old = this.saveTimers.get(id);
    if (old) clearTimeout(old);
    this.saveTimers.set(
      id,
      window.setTimeout(() => {
        this.saveTimers.delete(id);
        if (this.quiet) this.saveSoon(id);
        else void this.save(id);
      }, SAVE_AFTER)
    );
  }

  private async save(id: number): Promise<void> {
    const t = this.b.tab(id);
    const e = this.entries.get(id);
    const store = this.store();
    if (!t || !e?.jpeg || e.savedVersion === e.jpegVersion || !store) return;
    const version = e.jpegVersion;
    let fileId = this.fileIds.get(t.node);
    if (!fileId) {
      fileId = newId();
      this.fileIds.set(t.node, fileId);
    }
    const bytes = new Uint8Array(await e.jpeg.arrayBuffer());
    if (!(await store.writeThumb(fileId, bytes))) return;
    e.savedVersion = version;
    this.stats.saved++;
    if (this.b.tabs.includes(t)) {
      try {
        fx.setTabValue(t.node, store.TAB_VALUE, fileId);
      } catch {
        /* the tab is closing */
      }
    }
  }

  /** A restored tab that has not loaded: its picture from the last session, if one was saved. */
  private async fromDisk(t: Tab): Promise<void> {
    if (this.entries.has(t.id) || this.b.isPrivate || this.diskTried.has(t.id)) return;
    const store = this.store();
    if (!store) return;
    // Session restore sets the tab's values with its "pending" state; until then there is nothing to read.
    const fileId = fx.getTabValue(t.node, store.TAB_VALUE);
    if (!fileId) return;
    this.diskTried.add(t.id);
    const bytes = await store.readThumb(fileId);
    if (!bytes || this.entries.has(t.id) || !this.b.tabs.includes(t)) return;
    const jpeg = new Blob([bytes as BlobPart], { type: 'image/jpeg' });
    const version = ++serial;
    this.entries.set(t.id, { version, bitmap: null, jpeg, jpegVersion: version, decoding: null, at: 0, from: 'disk', savedVersion: version });
    this.stats.loadedFromDisk++;
    this.notify(t.id);
  }

  /** Read the pictures of restored tabs now (the switcher is opening). */
  loadRestored(): void {
    for (const t of this.b.tabs) if (t.deferred && !this.entries.has(t.id)) void this.fromDisk(t);
  }
}
