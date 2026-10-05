// The window's copy of the download list, kept current from dl:update events (about four a second).
import type { AddedEvent, DownloadView, StartOptions } from '../../../main/modules/downloads/types';

const ORDER: Record<DownloadView['state'], number> = { downloading: 0, starting: 0, queued: 1, paused: 2, failed: 2, completed: 3, cancelled: 3 };

export class DownloadStore {
  private items = new Map<string, DownloadView>();
  private listeners = new Set<() => void>();
  private addedListeners = new Set<(ev: AddedEvent) => void>();
  private scheduled = false;

  constructor() {
    const ipc = window.vitre.ipc;
    ipc.on('dl:update', (views) => {
      for (const v of views as DownloadView[]) this.items.set(v.id, v);
      this.changed();
    });
    ipc.on('dl:removed', (ids) => {
      for (const id of ids as string[]) this.items.delete(id);
      this.changed();
    });
    ipc.on('dl:added', (ev) => {
      const e = ev as AddedEvent;
      this.items.set(e.view.id, e.view);
      for (const fn of this.addedListeners) fn(e);
      this.changed();
    });
    void this.reload();
  }

  async reload(): Promise<void> {
    const list = (await window.vitre.ipc.invoke('dl:list')) as DownloadView[] | null;
    if (!list) return;
    this.items = new Map(list.map((v) => [v.id, v]));
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
    return () => this.listeners.delete(fn);
  }

  onAdded(fn: (ev: AddedEvent) => void): void {
    this.addedListeners.add(fn);
  }

  /** Listeners run once per frame, however many updates arrived. */
  private changed(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      for (const fn of this.listeners) fn();
    });
  }

  // ---- commands ----

  start(url: string, opts: StartOptions = {}): Promise<string | null> {
    return window.vitre.ipc.invoke('dl:start', url, opts) as Promise<string | null>;
  }

  run(command: 'pause' | 'resume' | 'start-now' | 'cancel' | 'remove' | 'open' | 'show-in-folder' | 'copy-address', id: string): void {
    void window.vitre.ipc.invoke(`dl:${command}`, id);
  }

  /** The primary verb for a row: pause, resume, start now, retry or show in folder. */
  primary(v: DownloadView): void {
    if (v.state === 'downloading' || v.state === 'starting') this.run('pause', v.id);
    else if (v.state === 'queued') this.run('start-now', v.id);
    else if (v.state === 'completed' && !v.missing) this.run('show-in-folder', v.id);
    else this.run('resume', v.id);
  }
}
