// The window's copy of the download list, kept current from the engine's events (about four a
// second while downloading). Port of app/src/renderer/modules/downloads/store.ts: the ipc channels
// became direct calls on the VitreDownloads singleton. A window shows its own kind of downloads:
// a private window the private ones, a normal window the others (as Firefox does).
import type { Browser } from '../../browser';
import type { DownloadEvent, DownloadView, RefreshResult, StartOptions } from '../../../modules/downloads/types';
import { isDamaged, isWaiting } from './format';

const ORDER: Record<DownloadView['state'], number> = { downloading: 0, starting: 0, queued: 1, paused: 2, failed: 2, completed: 3, cancelled: 3 };

export type AddedEvent = Extract<DownloadEvent, { kind: 'added' }>;
export type AttachedEvent = Extract<DownloadEvent, { kind: 'attached' }>;
/**
 * What a row's verbs run (RESUME-DESIGN.md 6, wiring). Phase 3: refresh-address (a renewal attempt, then
 * the page opened and the row armed), stop-waiting, open-page (Open page, From page: this window opens it,
 * through the opener index.ts sets), keep-partial; use-address is the panel's own field. Phase 5, on a
 * completed row: check (Check file), repair (Damaged), restore (Restore original, Changed after download:
 * only when chosen), download-again (a new row for the same download; Repair refused: the site's file changed).
 */
export type Command =
  | 'pause' | 'resume' | 'start-now' | 'cancel' | 'remove' | 'open' | 'show-in-folder' | 'copy-address' | 'keep' | 'start-over'
  | 'refresh-address' | 'stop-waiting' | 'open-page' | 'keep-partial' | 'check' | 'repair' | 'restore' | 'download-again';

export class DownloadStore {
  private items = new Map<string, DownloadView>();
  private listeners = new Set<() => void>();
  private addedListeners = new Set<(ev: AddedEvent) => void>();
  private attachedListeners = new Set<(ev: AttachedEvent) => void>();
  /**
   * Opens a download's page in this window (Open page, From page, Refresh address: VideoUI.openPage, set
   * by index.ts), arming the row when the engine says so. False when there is no page to open.
   */
  pageOpener: ((id: string) => boolean) | null = null;
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
    } else if (e.kind === 'attached') {
      // A start again continued a waiting row (RESUME-DESIGN.md G1, Phase 3): the same row, no new one.
      if (!this.mine(e.view)) return;
      this.items.set(e.view.id, e.view);
      for (const fn of this.attachedListeners) {
        try {
          fn(e);
        } catch (err) {
          console.error('Deer downloads: attached listener failed', err);
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

  onAttached(fn: (ev: AttachedEvent) => void): void {
    this.attachedListeners.add(fn);
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
      case 'start-over': void e.decide(id, 'start-over'); break;
      case 'keep-partial': void e.decide(id, 'keep-partial'); break;
      case 'refresh-address': void this.refresh(id); break;
      case 'stop-waiting': e.stopWaiting(id); break;
      case 'open-page': this.openPage(id); break;
      case 'check': void e.checkFile(id); break;
      case 'repair': void e.repair(id); break;
      case 'restore': void e.restoreOriginal(id); break;
      case 'download-again': e.downloadAgain(id); break;
    }
  }

  /**
   * Refresh address (RESUME-DESIGN.md G1 manual fallback): the engine runs a renewal attempt at once; when
   * it finds nothing and the download has a page, this window opens the page and arms the row (Waiting
   * for link). Resolves with what happened ('none': nothing found and no page; the panel then offers the
   * address field).
   */
  async refresh(id: string): Promise<RefreshResult['kind']> {
    let r: RefreshResult;
    try {
      r = await this.engine.refreshAddress(id);
    } catch (e) {
      console.warn('Deer downloads: Refresh address failed', String(e));
      return 'busy';
    }
    if (r.kind === 'page' && !this.openPage(id)) return 'none';
    return r.kind;
  }

  /** Open page: the download's page in a foreground tab of this window (an armed row waits for its start there). */
  openPage(id: string): boolean {
    return this.pageOpener?.(id) ?? false;
  }

  /**
   * The primary verb for a row: pause, resume, start now, retry or show in folder. Decided on the
   * engine's state now, not this window's copy (which catches up a frame later): a quick second
   * press (Space Space) is then Resume, not a second Pause. None of them destroys bytes (RESUME-DESIGN.md
   * 6): on a Renewing link row it is Pause (the attempt stops, the bytes stay); on a Link expired row
   * Refresh address (Retry for a stream, whose renewal comes with Phase 6); on Waiting for link and Start
   * it again from its page, Open page; on File changed Resume, which only checks the address again (the
   * panel moves focus to the row's choice instead); on Waiting for network and Retrying, Try now (start
   * now: RESUME-DESIGN.md G4). A Damaged file (Phase 5): Repair (Download again once the site's file
   * changed); while it is repaired or checked, Show in folder. Resolves with Refresh address's outcome.
   */
  primary(seen: DownloadView): Promise<RefreshResult['kind']> | null {
    const v = this.engine.get(seen.id) ?? seen;
    if (isDamaged(v) && !v.phase) this.run(v.check?.site === 'changed' ? 'download-again' : 'repair', v.id);
    else if (v.state === 'downloading' || v.state === 'starting' || v.phase === 'renewing') this.run('pause', v.id);
    else if (v.state === 'queued' || isWaiting(v)) this.run('start-now', v.id);
    else if (v.state === 'completed' && !v.missing) this.run('show-in-folder', v.id);
    else if (v.need?.kind === 'page' || (v.need?.kind === 'address' && v.armed)) this.run('open-page', v.id);
    else if (v.need?.kind === 'address' && v.canRenew) return this.refresh(v.id);
    else this.run('resume', v.id);
    return null;
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
