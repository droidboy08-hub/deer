// One page shown in the peek sheet: a webview from b.makeWebview(), kept directly in #views so
// promoting it to a tab never re-parents (and so never reloads) it.
import type { WebviewTag } from 'electron';
import type { Browser } from '../../app';
import type { Chord } from './chord';

export interface ViewEvents {
  /** URL, title, favicon, loading or history changed. */
  changed(v: PeekView): void;
  /** The page has painted at least once (or failed): the cover can go. */
  painted(v: PeekView): void;
  /** The page's first load ended without a page: it was a download. */
  aborted(v: PeekView): void;
  ipc(v: PeekView, channel: string, args: unknown[]): void;
  fullscreen(v: PeekView, on: boolean): void;
  /** The current Open as tab key, for the page module. */
  promoteKey(): Chord;
}

export class PeekView {
  readonly wv: WebviewTag;
  /** The address the peek was opened with (navigation inside it changes `url`). */
  readonly openedUrl: string;
  url: string;
  title = '';
  favicon: string | null = null;
  loading = true;
  painted = false;
  failure: string | null = null;
  zoom = 1;
  private attached = false;
  private started = false;
  private committed = false;
  private released = false;
  private paintTimer: number | null = null;

  constructor(b: Browser, url: string, private on: ViewEvents) {
    this.openedUrl = url;
    this.url = url;
    this.wv = b.makeWebview(url);
    this.wv.classList.add('vt-peek-view');
    this.wv.setAttribute('aria-label', 'Peek');
    this.listen();
    b.viewsRoot().append(this.wv);
  }

  private listen(): void {
    const wv = this.wv;
    const live = () => !this.released;
    wv.addEventListener('dom-ready', () => {
      if (!live()) return;
      this.attached = true;
      if (this.zoom !== 1) wv.setZoomFactor(this.zoom);
      // Ask the page to report its first paint; fall back on a timer.
      this.send('peek:role', true, this.on.promoteKey());
      if (!this.painted && this.paintTimer === null) this.paintTimer = window.setTimeout(() => this.markPainted(), 1200);
      this.on.changed(this);
    });
    wv.addEventListener('did-start-loading', () => {
      if (!live()) return;
      this.started = true;
      this.loading = true;
      this.on.changed(this);
    });
    wv.addEventListener('did-stop-loading', () => {
      if (!live()) return;
      this.loading = false;
      if (this.started && !this.committed && this.failure === null) {
        this.on.aborted(this);
        return;
      }
      this.markPainted();
      this.on.changed(this);
    });
    // Pages read in a peek go into history like a tab's (and a promoted page is already there).
    wv.addEventListener('did-navigate', (e) => {
      if (!live()) return;
      this.committed = true;
      this.url = e.url;
      this.favicon = null;
      this.failure = null;
      window.vitre.history.add(e.url, this.title);
      this.on.changed(this);
    });
    wv.addEventListener('did-navigate-in-page', (e) => {
      if (!live() || !e.isMainFrame) return;
      this.url = e.url;
      window.vitre.history.add(e.url, this.title);
      this.on.changed(this);
    });
    wv.addEventListener('page-title-updated', (e) => {
      if (!live()) return;
      this.title = e.title;
      window.vitre.history.title(this.url, e.title);
      this.on.changed(this);
    });
    wv.addEventListener('page-favicon-updated', (e) => {
      if (!live()) return;
      this.favicon = e.favicons[0] ?? null;
      this.on.changed(this);
    });
    wv.addEventListener('did-fail-load', (e) => {
      if (!live() || !e.isMainFrame || e.errorCode === -3) return;
      this.committed = true;
      this.failure = `${e.errorDescription || 'The page didn’t load'} (${e.validatedURL})`;
      this.markPainted();
      this.on.changed(this);
    });
    wv.addEventListener('ipc-message', (e) => {
      if (!live()) return;
      if (e.channel === 'peek:painted') this.markPainted();
      else this.on.ipc(this, e.channel, e.args);
    });
    wv.addEventListener('enter-html-full-screen', () => live() && this.on.fullscreen(this, true));
    wv.addEventListener('leave-html-full-screen', () => live() && this.on.fullscreen(this, false));
  }

  private markPainted(): void {
    if (this.paintTimer !== null) {
      clearTimeout(this.paintTimer);
      this.paintTimer = null;
    }
    if (this.painted || this.released) return;
    this.painted = true;
    this.on.painted(this);
  }

  /** The guest is attached and has reached dom-ready at least once. */
  ready(): boolean {
    return this.attached;
  }

  send(channel: string, ...args: unknown[]): void {
    if (!this.attached) return;
    try {
      this.wv.send(channel, ...args);
    } catch {
      /* detached */
    }
  }

  webContentsId(): number | null {
    try {
      return this.wv.getWebContentsId();
    } catch {
      return null;
    }
  }

  canGoBack(): boolean {
    try {
      return this.attached && this.wv.canGoBack();
    } catch {
      return false;
    }
  }

  canGoForward(): boolean {
    try {
      return this.attached && this.wv.canGoForward();
    } catch {
      return false;
    }
  }

  /** Run a webview method once the page is attached; ignored before that. */
  act(fn: (wv: WebviewTag) => void): void {
    if (!this.attached) return;
    try {
      fn(this.wv);
    } catch {
      /* the page went away */
    }
  }

  muted(on: boolean): void {
    this.act((wv) => wv.setAudioMuted(on));
  }

  /** Hand the webview over to the tab model: stop listening, leave it in place. */
  release(): void {
    this.released = true;
    if (this.paintTimer !== null) clearTimeout(this.paintTimer);
    this.send('peek:role', false);
    this.wv.removeAttribute('aria-label');
  }

  destroy(): void {
    this.released = true;
    if (this.paintTimer !== null) clearTimeout(this.paintTimer);
    this.wv.remove();
  }
}
