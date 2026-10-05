// The window's copy of the download list, kept current from the engine's events (about four a
// second while downloading). Port of app/src/renderer/modules/downloads/store.ts: the ipc channels
// became direct calls on the VitreDownloads singleton. A window shows its own kind of downloads:
// a private window the private ones, a normal window the others (as Firefox does).
import type { Browser } from '../../browser';
import type { DownloadEvent, DownloadView, StartOptions } from '../../../modules/downloads/types';

const ORDER: Record<DownloadView['state'], number> = { downloading: 0, starting: 0, queued: 1, paused: 2, failed: 2, completed: 3, cancelled: 3 };

export type AddedEvent = Extract<DownloadEvent, { kind: 'added' }>;
export type Command = 'pause' | 'resume' | 'start-now' | 'cancel' | 'remove' | 'open' | 'show-in-folder' | 'copy-address' | 'keep';

export class DownloadStore {
  private items = new Map<string, DownloadView>();
  private listeners = new Set<() => void>();
  private addedListeners = new Set<(ev: AddedEvent) => void>();
  private scheduled = false;
  /** The last 'open' that failed, with why (the panel shows it). */
  lastError = '';

  constructor(private b: Browser) {
    const engine = this.engine;
    b.onDestroy(engine.subscribe((e) => this.onEvent(e)));
    void engine.ready.then(() => this.reload());
  }

  get engine(): VitreSysModules['VitreDownloads'] {
    return this.b.sys('VitreDownloads');
  }

  private mine(v: DownloadView): boolean {
    return v.isPrivate === this.b.isPrivate;
  }

  private onEvent(e: DownloadEvent): void {
    if (e.kind === 'update') {
      for (const v of e.views) if (this.mine(v)) this.items.set(v.id, v);
    } else if (e.kind === 'removed') {
      for (const id of e.ids) this.items.delete(id);
    } else if (e.kind === 'added') {
      if (!this.mine(e.view)) return;
      this.items.set(e.view.id, e.view);
      for (const fn of this.addedListeners) {
        try {
          fn(e);
        } catch (err) {
          console.error('Deer downloads: added listener failed', err);
        }
      }
    }
    this.changed();
  }

  reload(): void {
    this.items = new Map(this.engine.list(this.b.isPrivate).map((v) => [v.id, v]));
    this.changed();
  }

  get(id: string): DownloadView | undefined {
    return this.items.get(id);
  }

  /** Running first, then queued, paused and failed, then finished; newest first within each. */
  all(): DownloadView[] {
    return [...this.items.values()].sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.startedAt - a.startedAt);
  }

  byVideo(key: string): DownloadView | undefined {
    if (!key) return undefined;
    let best: DownloadView | undefined;
    for (const v of this.items.values()) if (v.videoKey === key && (!best || v.startedAt > best.startedAt)) best = v;
    return best;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  onAdded(fn: (ev: AddedEvent) => void): void {
    this.addedListeners.add(fn);
  }

  /** Listeners run once per frame, however many updates arrived (a timer when no frame comes). */
  private changed(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    const run = (): void => {
      if (!this.scheduled) return;
      this.scheduled = false;
      for (const fn of [...this.listeners]) {
        try {
          fn();
        } catch (err) {
          console.error('Deer downloads: store listener failed', err);
        }
      }
    };
    requestAnimationFrame(run);
    // A minimized window gets no frames; its taskbar progress still follows.
    window.setTimeout(run, 250);
  }

  // ---- commands ----

  /** Start a download; the id, or null when it can't be downloaded. */
  start(url: string, opts: StartOptions = {}): string | null {
    try {
      return this.engine.start(url, { ...opts, identity: { isPrivate: this.b.isPrivate, ...(opts.identity ?? {}) } });
    } catch (e) {
      console.warn('Deer downloads: could not start', String(e));
      return null;
    }
  }

  run(command: Command, id: string): void {
    const e = this.engine;
    switch (command) {
      case 'pause': e.pause(id); break;
      case 'resume': e.resume(id); break;
      case 'start-now': e.resume(id, true); break;
      case 'cancel': e.cancel(id); break;
      case 'remove': e.remove(id); break;
      case 'open': this.lastError = e.open(id); break;
      case 'show-in-folder': e.showInFolder(id); break;
      case 'copy-address': e.copyAddress(id); break;
      case 'keep': void e.keep(id); break;
    }
  }

  /**
   * The primary verb for a row: pause, resume, start now, retry or show in folder. Decided on the
   * engine's state now, not this window's copy (which catches up a frame later): a quick second
   * press (Space Space) is then Resume, not a second Pause.
   */
  primary(seen: DownloadView): void {
    const v = this.engine.get(seen.id) ?? seen;
    if (v.state === 'downloading' || v.state === 'starting') this.run('pause', v.id);
    else if (v.state === 'queued') this.run('start-now', v.id);
    else if (v.state === 'completed' && !v.missing) this.run('show-in-folder', v.id);
    else this.run('resume', v.id);
  }

  pauseAll(): void {
    this.engine.pauseAll(this.b.isPrivate);
  }

  resumeAll(): void {
    this.engine.resumeAll(this.b.isPrivate);
  }

  clearFinished(): void {
    this.engine.clearFinished(this.b.isPrivate);
  }
}
