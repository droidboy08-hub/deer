import type { HistoryEntry } from '../shared/types';
import { Store } from './store';

const MAX = 5000;

/** Browsing history: one entry per URL, ranked by visits and recency. */
export class History {
  private store: Store<HistoryEntry[]>;
  private byUrl = new Map<string, HistoryEntry>();

  constructor(file: string) {
    this.store = new Store<HistoryEntry[]>(file, []);
    for (const e of this.store.get()) this.byUrl.set(e.url, e);
  }

  add(url: string, title: string): void {
    if (!/^https?:/i.test(url)) return;
    const e = this.byUrl.get(url);
    if (e) {
      e.visits += 1;
      e.last = Date.now();
      if (title) e.title = title;
    } else {
      this.byUrl.set(url, { url, title, visits: 1, last: Date.now() });
    }
    this.save();
  }

  title(url: string, title: string): void {
    const e = this.byUrl.get(url);
    if (e && title && e.title !== title) {
      e.title = title;
      this.save();
    }
  }

  remove(url: string): void {
    if (this.byUrl.delete(url)) this.save();
  }

  /** Forget everything visited since `since` (ms); 0 clears all. */
  clear(since = 0): void {
    for (const [url, e] of this.byUrl) if (e.last >= since) this.byUrl.delete(url);
    this.save();
  }

  query(text: string, limit: number): HistoryEntry[] {
    const q = text.trim().toLowerCase();
    const now = Date.now();
    const score = (e: HistoryEntry) => e.visits * 2 + 10 / (1 + (now - e.last) / 86_400_000);
    const all = [...this.byUrl.values()];
    const hits = q
      ? all.filter((e) => {
          const u = e.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
          return u.includes(q) || e.title.toLowerCase().includes(q);
        })
      : all;
    return hits
      .map((e) => {
        const u = e.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
        const prefix = q && u.startsWith(q) ? 50 : 0;
        return { e, s: score(e) + prefix };
      })
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.e);
  }

  flush(): void {
    this.store.flush();
  }

  private save(): void {
    let list = [...this.byUrl.values()];
    if (list.length > MAX) {
      list = list.sort((a, b) => b.last - a.last).slice(0, MAX);
      this.byUrl = new Map(list.map((e) => [e.url, e]));
    }
    this.store.set(list);
  }
}
