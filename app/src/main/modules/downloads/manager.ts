// The download list: queue, state, persistence (userData/downloads.json) and progress events.
// Two downloads run at once; the rest wait their turn. Each one is Vitre's engine (ranged file or
// HLS stream) or, for what Node can't fetch (blob:, data:, POST-only answers), Chromium's own.
import { BrowserWindow, app, clipboard, dialog, shell, webContents, type DownloadItem, type WebContents } from 'electron';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { MainContext } from '../../context';
import { Store } from '../../store';
import { HlsTransfer, hlsEstimate, hlsFills, trackPart, type HlsState } from './hls';
import { Identity } from './identity';
import { RateLimiter } from './limiter';
import { categoryOf, chooseName, extOf, nameFromUrl, sanitize, uniquePath } from './naming';
import { AbortedError, DownloadError, describeError } from './net';
import { FileTransfer, fileFills, type FileState, type ProbeInfo, type TransferEnv } from './ranged';
import type { AddedEvent, DownloadState, DownloadView, StartOptions } from './types';

const MAX_ACTIVE = 2;
const TICK = 250;

/** The person closed the save dialog: the download never happened. */
class SaveDeclined extends Error {}

/** The server refused Node's client (some hosts reset non-browser TLS); Chromium's own stack gets one try. */
class HandOff extends Error {
  constructor(readonly cause: unknown) {
    super('hand off');
  }
}

interface Rec {
  id: string;
  url: string;
  pageUrl: string;
  title: string;
  filename: string;
  /** The name came from the person (or the picker) and must not be replaced by the server's. */
  named: boolean;
  dir: string;
  path: string;
  mime: string;
  state: DownloadState;
  mode: 'file' | 'hls' | 'browser';
  file: FileState | null;
  hls: HlsState | null;
  received: number;
  total: number;
  netBytes: number;
  activeMs: number;
  peak: number;
  error: string;
  startedAt: number;
  finishedAt: number;
  queuedAt: number;
  quality: string;
  videoKey: string;
  limitKBps: number;
  withOrigin: boolean;
  askWhere: boolean;
  overwrite: boolean;
  /** Paused while its first answer was still being read. */
  hold: boolean;
  /** Chromium was already asked to fetch this after Vitre's engine was refused. */
  triedBrowser?: boolean;
}

interface Run {
  ac: AbortController;
  reason: 'pause' | 'cancel' | 'quit' | null;
  transfer: FileTransfer | HlsTransfer | null;
  item: DownloadItem | null;
  samples: { t: number; bytes: number }[];
  speed: number;
  phase: '' | 'probing' | 'merging';
  last: number;
}

interface Persisted {
  version: number;
  items: Rec[];
}

const ACTIVE: DownloadState[] = ['starting', 'queued', 'downloading'];
const FINISHED: DownloadState[] = ['completed', 'cancelled', 'failed'];

export class DownloadManager {
  private recs: Rec[] = [];
  private runs = new Map<string, Run>();
  private envs = new Map<string, { env: TransferEnv; identity: Identity }>();
  /** A transfer whose probe already ran (Chromium's download, handed over), waiting to start. */
  private warm = new Map<string, FileTransfer>();
  /** Address → download handed to Chromium, waiting for its will-download. */
  private handoffs = new Map<string, string>();
  private store: Store<Persisted>;
  private dirty = new Set<string>();
  private ticker: NodeJS.Timeout | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private lastSave = 0;
  private global: RateLimiter;
  private staging: string;

  constructor(private ctx: MainContext) {
    this.store = new Store<Persisted>(path.join(ctx.userData, 'downloads.json'), { version: 1, items: [] });
    this.global = new RateLimiter(() => this.ctx.settings.get().speedLimitKBps || 0);
    this.staging = path.join(ctx.userData, 'download-staging');
    fs.rmSync(this.staging, { recursive: true, force: true });
    this.load();
  }

  // ---- list ----

  list(): DownloadView[] {
    return this.recs.map((r) => this.view(r, true));
  }

  private find(id: string): Rec | undefined {
    return this.recs.find((r) => r.id === id);
  }

  private load(): void {
    const saved = this.store.get();
    if (!saved || !Array.isArray(saved.items)) return;
    for (const r of saved.items) {
      if (!r?.id || !r.url) continue;
      if (ACTIVE.includes(r.state)) {
        // Chromium's own downloads don't survive a restart; Vitre's carry on from their .part files.
        if (r.mode === 'browser' || r.state === 'starting') {
          r.state = 'failed';
          r.error = 'Interrupted when Vitre closed.';
        } else r.state = 'paused';
      }
      r.hold = false;
      this.recs.push(r);
    }
  }

  // ---- starting ----

  private newRec(url: string, opts: StartOptions): Rec {
    const s = this.ctx.settings.get();
    const dir = opts.dir || s.downloadsFolder || app.getPath('downloads');
    const title = (opts.title ?? '').trim();
    return {
      id: randomUUID(),
      url,
      pageUrl: opts.pageUrl ?? pageOf(opts.webContentsId),
      title,
      filename: opts.filename ? sanitize(opts.filename) : sanitize(nameFromUrl(url) || title || 'download'),
      named: !!opts.filename,
      dir,
      path: '',
      mime: '',
      state: 'queued',
      mode: 'file',
      file: null,
      hls: null,
      received: 0,
      total: -1,
      netBytes: 0,
      activeMs: 0,
      peak: 0,
      error: '',
      startedAt: Date.now(),
      finishedAt: 0,
      queuedAt: Date.now(),
      quality: opts.quality ?? '',
      videoKey: opts.videoKey ?? '',
      limitKBps: 0,
      withOrigin: opts.mode === 'hls' || !!opts.videoKey,
      askWhere: s.askWhereToSave && !opts.dir,
      overwrite: false,
      hold: false,
    };
  }

  /** A download Vitre starts itself (the video picker, Add link, menus). */
  start(url: string, opts: StartOptions = {}, host: WebContents | null = null): string {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only web addresses can be downloaded.');
    const rec = this.newRec(url, opts);
    const hls = opts.mode === 'hls' || (opts.mode !== 'file' && /\.m3u8(\?|#|$)/i.test(url));
    if (hls) {
      rec.mode = 'hls';
      rec.hls = HlsTransfer.fresh(url, { variantUrl: opts.variantUrl, audioUrl: opts.audioUrl, audioOnly: opts.audioOnly, bytes: opts.bytes });
      rec.filename = sanitize(`${rec.title || streamTitle(url)}${opts.audioOnly ? '.m4a' : '.mp4'}`);
    } else if (!opts.filename && rec.title && (opts.videoKey || !extOf(rec.filename))) {
      rec.filename = chooseName({ url, title: rec.title });
    }
    this.recs.unshift(rec);
    this.added(rec, opts.origin ?? null, host);
    this.pump();
    return rec.id;
  }

  /**
   * Chromium started a download (a link, a redirect, Save image as…). Hold it, ask the server
   * ourselves, and take it over when Vitre's engine can fetch it; otherwise let Chromium finish.
   */
  adoptBrowser(item: DownloadItem, wc: WebContents | undefined): void {
    const url = item.getURL();
    const handed = this.handoffs.get(item.getURLChain()[0] ?? url) ?? this.handoffs.get(url);
    const prior = handed ? this.find(handed) : undefined;
    if (prior) {
      this.handoffs.delete(item.getURLChain()[0] ?? url);
      this.handoffs.delete(url);
      if (prior.state !== 'starting') {
        item.cancel();
        return;
      }
      fs.mkdirSync(this.staging, { recursive: true });
      const staging = path.join(this.staging, prior.id);
      item.setSavePath(staging);
      prior.mime = prior.mime || item.getMimeType();
      if (!prior.path && !prior.named && item.getFilename()) prior.filename = sanitize(item.getFilename());
      void this.runBrowser(prior, item, staging);
      return;
    }
    const pageUrl = wc && !wc.isDestroyed() && wc.getType() === 'webview' ? wc.getURL() : '';
    const rec = this.newRec(url, { pageUrl });
    rec.mime = item.getMimeType();
    rec.filename = sanitize(item.getFilename() || chooseName({ url, mime: rec.mime }));
    rec.total = item.getTotalBytes() > 0 ? item.getTotalBytes() : -1;
    rec.state = 'starting';
    rec.queuedAt = 0;
    fs.mkdirSync(this.staging, { recursive: true });
    const staging = path.join(this.staging, rec.id);
    item.setSavePath(staging);
    this.recs.unshift(rec);
    const host = wc ? (this.ctx.hostWindow(wc)?.webContents ?? null) : null;
    this.added(rec, null, host);
    if (/^https?:/i.test(url)) {
      item.pause();
      void this.decide(rec, item, staging);
    } else {
      void this.runBrowser(rec, item, staging);
    }
  }

  private async decide(rec: Rec, item: DownloadItem, staging: string): Promise<void> {
    const run = this.makeRun();
    run.item = item;
    run.phase = 'probing';
    this.runs.set(rec.id, run);
    this.ensureTicker();
    const transfer = new FileTransfer(FileTransfer.fresh(rec.url), this.env(rec));
    let info: ProbeInfo | null = null;
    try {
      info = await transfer.probe(run.ac.signal);
    } catch {
      info = null;
    }
    this.runs.delete(rec.id);
    if (run.reason === 'quit') return;
    if (run.reason === 'cancel') {
      transfer.dropPending();
      item.cancel();
      this.markCancelled(rec);
      return;
    }
    // A page where Chromium had a file usually means the download needs the original request (a form post).
    const html = !!info && /text\/html/i.test(info.contentType) && !/text\/html/i.test(rec.mime);
    if (!info || html) {
      void this.runBrowser(rec, item, staging);
      return;
    }
    item.cancel();
    rec.file = transfer.state;
    rec.total = transfer.state.total;
    if (!rec.mime) rec.mime = info.contentType;
    rec.state = rec.hold ? 'paused' : 'queued';
    rec.queuedAt = Date.now();
    rec.hold = false;
    if (rec.state === 'queued') this.warm.set(rec.id, transfer);
    else transfer.dropPending();
    this.touch(rec);
    this.pump();
  }

  /** Chromium moves the bytes (blob:, data:, or a server that only answers the original request). */
  private async runBrowser(rec: Rec, item: DownloadItem, staging: string): Promise<void> {
    rec.mode = 'browser';
    if (!(await this.confirmPath(rec))) {
      item.cancel();
      this.remove(rec.id);
      return;
    }
    const run = this.makeRun();
    run.item = item;
    this.runs.set(rec.id, run);
    rec.state = rec.hold ? 'paused' : 'downloading';
    rec.hold = false;
    item.on('updated', (_e, st) => {
      rec.received = item.getReceivedBytes();
      rec.total = item.getTotalBytes() > 0 ? item.getTotalBytes() : -1;
      if (st === 'progressing' && rec.state !== 'cancelled') rec.state = item.isPaused() ? 'paused' : 'downloading';
      if (st === 'interrupted') {
        // Chromium can sometimes carry on from where it stopped; otherwise it is over.
        rec.state = rec.received > 0 && item.canResume() ? 'paused' : 'failed';
        rec.error = 'The connection was lost.';
      } else rec.error = '';
      this.touch(rec);
    });
    item.once('done', (_e, st) => {
      this.runs.delete(rec.id);
      if (st === 'completed') {
        rec.received = item.getReceivedBytes();
        rec.total = rec.received;
        void this.placeBrowserFile(rec, staging);
        return;
      }
      if (st === 'cancelled') this.markCancelled(rec);
      else {
        rec.state = 'failed';
        rec.error = 'The download was interrupted.';
        this.touch(rec);
        this.save();
      }
    });
    if (rec.state === 'downloading' && item.isPaused()) item.resume();
    else if (rec.state === 'paused' && !item.isPaused()) item.pause();
    this.touch(rec);
    this.ensureTicker();
  }

  private async placeBrowserFile(rec: Rec, staging: string): Promise<void> {
    try {
      fs.mkdirSync(rec.dir, { recursive: true });
      const target = rec.overwrite ? path.join(rec.dir, rec.filename) : uniquePath(rec.dir, rec.filename, (p) => this.taken(p, rec.id));
      if (rec.overwrite) await fs.promises.rm(target, { force: true });
      await moveFile(staging, target);
      rec.path = target;
      rec.filename = path.basename(target);
      this.complete(rec);
    } catch (err) {
      rec.state = 'failed';
      rec.error = describeError(err);
      this.touch(rec);
      this.save();
    }
  }

  // ---- queue ----

  private pump(): void {
    let active = [...this.runs.entries()].filter(([id]) => this.find(id)?.mode !== 'browser' && this.find(id)?.state === 'downloading').length;
    const waiting = this.recs.filter((r) => r.state === 'queued').sort((a, b) => a.queuedAt - b.queuedAt);
    for (const r of waiting) {
      if (active >= MAX_ACTIVE) {
        // Still waiting: its place in the queue may have moved.
        this.dirty.add(r.id);
        continue;
      }
      this.launch(r);
      active++;
    }
    for (const [id, t] of this.warm) {
      if (this.find(id)?.state !== 'downloading') {
        t.dropPending();
        this.warm.delete(id);
      }
    }
    this.flushSoon();
  }

  private launch(rec: Rec): void {
    const run = this.makeRun();
    this.runs.set(rec.id, run);
    rec.state = 'downloading';
    rec.error = '';
    if (!rec.startedAt) rec.startedAt = Date.now();
    this.touch(rec);
    this.ensureTicker();
    const job = rec.mode === 'hls' ? this.runHls(rec, run) : this.runFile(rec, run);
    job.then(
      () => {
        this.runs.delete(rec.id);
        this.complete(rec);
        this.pump();
      },
      (err) => this.stopped(rec, run, err),
    );
  }

  private async runFile(rec: Rec, run: Run): Promise<void> {
    const transfer = this.warm.get(rec.id) ?? new FileTransfer(rec.file ?? FileTransfer.fresh(rec.url), this.env(rec));
    this.warm.delete(rec.id);
    rec.file = transfer.state;
    run.transfer = transfer;
    if (!transfer.state.probed || transfer.received > 0) {
      run.phase = 'probing';
      this.touch(rec);
      let info: ProbeInfo;
      try {
        info = await transfer.probe(run.ac.signal);
      } catch (err) {
        if (run.ac.signal.aborted || rec.triedBrowser || transfer.received > 0 || err instanceof DownloadError) throw err;
        throw new HandOff(err);
      }
      if (!rec.path && !rec.named) {
        rec.filename = chooseName({ disposition: info.disposition, url: info.finalUrl, mime: info.contentType, title: rec.videoKey ? rec.title : '', suggested: nameFromUrl(rec.url) || undefined });
        rec.mime = info.contentType;
      }
    }
    run.phase = '';
    if (!rec.path) {
      if (!(await this.confirmPath(rec))) throw new SaveDeclined();
      this.reserve(rec);
    }
    this.touch(rec);
    const part = `${rec.path}.part`;
    await transfer.download(part, run.ac.signal);
    await this.placeFinished(rec, part);
  }

  private async runHls(rec: Rec, run: Run): Promise<void> {
    const state = rec.hls ?? HlsTransfer.fresh(rec.url);
    rec.hls = state;
    const transfer = new HlsTransfer(state, this.env(rec));
    run.transfer = transfer;
    run.phase = 'probing';
    this.touch(rec);
    await transfer.prepare(run.ac.signal);
    run.phase = '';
    if (!rec.path) {
      rec.filename = rec.filename.replace(/\.(mp4|m4a|ts|aac)$/i, '') + transfer.expectedExtension();
      if (!(await this.confirmPath(rec))) throw new SaveDeclined();
      this.reserve(rec);
    }
    const base = stem(rec.path);
    await transfer.download(base, run.ac.signal);
    run.phase = 'merging';
    this.touch(rec);
    const out = await transfer.finish(base, (ext, suffix = '') => this.freePath(rec, `${path.basename(base)}${suffix}${ext}`), run.ac.signal);
    rec.path = out;
    rec.filename = path.basename(out);
  }

  /** Rename the finished .part into place; if something took the name meanwhile, take the next free one. */
  private async placeFinished(rec: Rec, part: string): Promise<void> {
    let target = rec.path;
    if (rec.overwrite) await fs.promises.rm(target, { force: true });
    else if (fs.existsSync(target)) target = uniquePath(rec.dir, rec.filename, (p) => this.taken(p, rec.id));
    await fs.promises.rename(part, target);
    rec.path = target;
    rec.filename = path.basename(target);
  }

  private freePath(rec: Rec, name: string): string {
    const wanted = path.join(rec.dir, name);
    if (!fs.existsSync(wanted)) return wanted;
    return uniquePath(rec.dir, name, (p) => this.taken(p, rec.id));
  }

  private reserve(rec: Rec): void {
    fs.mkdirSync(rec.dir, { recursive: true });
    if (rec.overwrite) {
      rec.path = path.join(rec.dir, rec.filename);
      return;
    }
    rec.path = uniquePath(rec.dir, rec.filename, (p) => this.taken(p, rec.id) || (rec.mode === 'hls' && hlsPartsExist(p)));
    rec.filename = path.basename(rec.path);
  }

  private taken(p: string, except: string): boolean {
    const key = p.toLowerCase();
    return this.recs.some((r) => r.id !== except && r.path.toLowerCase() === key && !FINISHED.includes(r.state));
  }

  /** "Ask where to save each file": the Windows save dialog, once, before the first byte is written. */
  private async confirmPath(rec: Rec): Promise<boolean> {
    if (!rec.askWhere) return true;
    rec.askWhere = false;
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const ext = extOf(rec.filename);
    const opts: Electron.SaveDialogOptions = { defaultPath: path.join(rec.dir, rec.filename), filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }] : undefined };
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (res.canceled || !res.filePath) return false;
    rec.dir = path.dirname(res.filePath);
    rec.filename = path.basename(res.filePath);
    rec.named = true;
    rec.overwrite = true;
    return true;
  }

  private complete(rec: Rec): void {
    rec.state = 'completed';
    rec.finishedAt = Date.now();
    rec.error = '';
    try {
      rec.total = rec.received = fs.statSync(rec.path).size;
    } catch {
      /* keep the counted bytes */
    }
    this.envs.delete(rec.id);
    this.touch(rec);
    this.save();
  }

  private stopped(rec: Rec, run: Run, err: unknown): void {
    this.runs.delete(rec.id);
    if (err instanceof SaveDeclined) {
      this.remove(rec.id);
      this.pump();
      return;
    }
    if (err instanceof HandOff && !run.reason) {
      this.handToChromium(rec, err.cause);
      this.pump();
      return;
    }
    if (err instanceof HandOff) err = err.cause;
    if (run.transfer) rec.received = run.transfer.received;
    if (run.reason === 'pause' || run.reason === 'quit') rec.state = 'paused';
    else if (run.reason === 'cancel' || (err instanceof AbortedError && !run.reason)) this.markCancelled(rec);
    else {
      rec.state = 'failed';
      rec.error = describeError(err);
      if (!(err instanceof DownloadError)) console.warn('download failed', rec.url, err);
    }
    this.touch(rec);
    this.save();
    this.pump();
  }

  /** Ask Chromium to fetch it; its will-download comes back to adoptBrowser for this row. */
  private handToChromium(rec: Rec, cause: unknown): void {
    rec.triedBrowser = true;
    rec.state = 'starting';
    rec.file = null;
    this.handoffs.set(rec.url, rec.id);
    this.touch(rec);
    const headers: Record<string, string> = {};
    if (/^https?:/i.test(rec.pageUrl)) headers.Referer = rec.pageUrl;
    try {
      this.ctx.session().downloadURL(rec.url, { headers });
    } catch {
      /* falls through to the timeout below */
    }
    setTimeout(() => {
      if (this.handoffs.get(rec.url) !== rec.id) return;
      this.handoffs.delete(rec.url);
      rec.state = 'failed';
      rec.error = describeError(cause);
      this.touch(rec);
      this.save();
    }, 20_000);
  }

  private markCancelled(rec: Rec): void {
    rec.state = 'cancelled';
    rec.finishedAt = Date.now();
    this.removeParts(rec);
    this.rewind(rec);
    this.touch(rec);
    this.save();
  }

  /** Back to the start: no partial file, no place on disk, no measurements (Retry after Cancel, Download again). */
  private rewind(rec: Rec): void {
    rec.file = null;
    if (rec.hls) rec.hls = HlsTransfer.fresh(rec.hls.sourceUrl, { variantUrl: rec.hls.variantUrl, audioUrl: rec.hls.audioUrl, audioOnly: rec.hls.audioOnly });
    rec.received = 0;
    rec.path = '';
    rec.netBytes = 0;
    rec.activeMs = 0;
    rec.peak = 0;
    this.envs.delete(rec.id);
  }

  /** Vitre's own unfinished files, never the finished one. */
  private removeParts(rec: Rec): void {
    if (!rec.path) return;
    const parts = rec.mode === 'hls' && rec.hls
      ? [...rec.hls.tracks.map((t) => trackPart(stem(rec.path), t)), `${stem(rec.path)}.merge.part`]
      : [`${rec.path}.part`];
    for (const p of parts) fs.rm(p, { force: true }, () => undefined);
  }

  // ---- commands ----

  pause(id: string): void {
    const rec = this.find(id);
    if (!rec) return;
    const run = this.runs.get(id);
    if (rec.state === 'queued') {
      rec.state = 'paused';
      this.warm.get(id)?.dropPending();
      this.warm.delete(id);
    } else if (rec.state === 'starting') {
      rec.hold = true;
      return;
    } else if (run && rec.state === 'downloading') {
      if (rec.mode === 'browser') {
        run.item?.pause();
        rec.state = 'paused';
      } else {
        run.reason = 'pause';
        run.ac.abort();
        return;
      }
    } else return;
    this.touch(rec);
    this.save();
  }

  resume(id: string, now = false): void {
    const rec = this.find(id);
    if (!rec) return;
    if (rec.state === 'completed') {
      // Download again: only when the finished file is gone.
      if (rec.path && fs.existsSync(rec.path)) return;
      this.rewind(rec);
      rec.startedAt = Date.now();
      rec.finishedAt = 0;
      rec.state = 'failed';
    }
    if (!/^https?:/i.test(rec.url)) {
      // blob: and data: addresses only ever lived in the page that made them.
      if (!this.runs.has(id) && rec.state !== 'paused') {
        rec.state = 'failed';
        rec.error = 'Start this download again from its page.';
        this.touch(rec);
        this.save();
        return;
      }
    }
    if (rec.mode === 'browser') {
      const item = this.runs.get(id)?.item;
      if (item && rec.state === 'paused' && item.canResume()) {
        item.resume();
        rec.state = 'downloading';
        this.touch(rec);
        return;
      }
      if (this.runs.has(id)) return;
      // Chromium can't carry on: start over with Vitre's engine.
      rec.mode = 'file';
      rec.file = null;
    }
    if (!['paused', 'failed', 'cancelled', 'queued'].includes(rec.state)) return;
    rec.state = 'queued';
    rec.queuedAt = now ? 1 : Date.now();
    rec.error = '';
    this.touch(rec);
    if (now && !this.runs.has(id)) this.launch(rec);
    this.pump();
    this.save();
  }

  cancel(id: string): void {
    const rec = this.find(id);
    if (!rec || FINISHED.includes(rec.state)) return;
    const run = this.runs.get(id);
    if (run) {
      run.reason = 'cancel';
      if (rec.mode === 'browser' && run.item) run.item.cancel();
      else run.ac.abort();
      return;
    }
    this.warm.get(id)?.dropPending();
    this.warm.delete(id);
    this.markCancelled(rec);
    this.pump();
  }

  /** Take the row off the list (never the finished file). */
  remove(id: string): void {
    const rec = this.find(id);
    if (!rec) return;
    if (!FINISHED.includes(rec.state)) this.cancel(id);
    this.recs = this.recs.filter((r) => r.id !== id);
    this.dirty.delete(id);
    this.ctx.broadcast('dl:removed', [id]);
    this.save();
  }

  clearFinished(): void {
    const gone = this.recs.filter((r) => FINISHED.includes(r.state)).map((r) => r.id);
    if (!gone.length) return;
    this.recs = this.recs.filter((r) => !gone.includes(r.id));
    this.ctx.broadcast('dl:removed', gone);
    this.save();
  }

  pauseAll(): void {
    for (const r of [...this.recs]) if (ACTIVE.includes(r.state)) this.pause(r.id);
  }

  resumeAll(): void {
    for (const r of [...this.recs].reverse()) if (r.state === 'paused') this.resume(r.id);
  }

  setLimit(id: string, kbps: number): void {
    const rec = this.find(id);
    if (!rec) return;
    rec.limitKBps = Math.max(0, Math.round(kbps));
    this.touch(rec);
    this.save();
  }

  async open(id: string): Promise<string> {
    const rec = this.find(id);
    if (!rec || rec.state !== 'completed') return 'The file isn’t ready.';
    if (!fs.existsSync(rec.path)) {
      this.reportMissing(rec);
      return 'The file was moved or deleted.';
    }
    return shell.openPath(rec.path);
  }

  /** A finished file that is no longer there: its row turns into "Deleted" with Download again. */
  private reportMissing(rec: Rec): void {
    this.ctx.broadcast('dl:update', [this.view(rec, true)]);
  }

  showInFolder(id: string): void {
    const rec = this.find(id);
    if (!rec) return;
    if (rec.state === 'completed' && rec.path && !fs.existsSync(rec.path)) this.reportMissing(rec);
    const part = rec.mode === 'hls' && rec.hls?.tracks[0] ? trackPart(stem(rec.path), rec.hls.tracks[0]) : `${rec.path}.part`;
    if (rec.path && fs.existsSync(rec.path)) shell.showItemInFolder(rec.path);
    else if (rec.path && fs.existsSync(part)) shell.showItemInFolder(part);
    else void shell.openPath(rec.dir);
  }

  openFolder(): void {
    const dir = this.ctx.settings.get().downloadsFolder || app.getPath('downloads');
    fs.mkdirSync(dir, { recursive: true });
    void shell.openPath(dir);
  }

  copyAddress(id: string): void {
    const rec = this.find(id);
    if (rec) void clipboard.writeText(rec.url);
  }

  // ---- progress ----

  private makeRun(): Run {
    return { ac: new AbortController(), reason: null, transfer: null, item: null, samples: [], speed: 0, phase: '', last: Date.now() };
  }

  /** Everything a transfer needs from its download, kept per download so a handed-over transfer still reports here. */
  private env(rec: Rec): TransferEnv {
    let e = this.envs.get(rec.id);
    if (!e) {
      const identity = new Identity(this.ctx.session(), rec.pageUrl, rec.withOrigin);
      const own = new RateLimiter(() => rec.limitKBps);
      e = {
        identity,
        env: {
          headers: identity.headers,
          refreshHeaders: identity.refresh,
          limiters: [this.global, own],
          connections: () => Math.max(1, Math.min(32, this.ctx.settings.get().connections || 8)),
          onBytes: (n) => {
            rec.netBytes += n;
          },
        },
      };
      this.envs.set(rec.id, e);
    }
    return e.env;
  }

  private ensureTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), TICK);
  }

  private tick(): void {
    const now = Date.now();
    for (const [id, run] of this.runs) {
      const rec = this.find(id);
      if (!rec) continue;
      const dt = now - run.last;
      run.last = now;
      if (run.item) {
        rec.received = run.item.getReceivedBytes();
        run.speed = rec.state === 'downloading' ? run.item.getCurrentBytesPerSecond() : 0;
      } else if (run.transfer) {
        rec.received = run.transfer.received;
        rec.total = run.transfer instanceof HlsTransfer ? run.transfer.estimate : run.transfer.state.total;
        run.samples.push({ t: now, bytes: rec.netBytes });
        while (run.samples.length > 2 && now - run.samples[0].t > 3000) run.samples.shift();
        const first = run.samples[0];
        const span = (now - first.t) / 1000;
        run.speed = span >= 0.5 ? (rec.netBytes - first.bytes) / span : run.speed;
      }
      if (rec.state === 'downloading' && !run.phase) {
        rec.activeMs += dt;
        rec.peak = Math.max(rec.peak, run.speed);
      }
      this.dirty.add(id);
    }
    this.flush();
    if (now - this.lastSave > 2000 && this.runs.size) this.save();
    if (!this.runs.size && this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private touch(rec: Rec): void {
    this.dirty.add(rec.id);
    this.flushSoon();
  }

  private flushSoon(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 60);
  }

  private flush(): void {
    if (!this.dirty.size) return;
    const views = [...this.dirty].map((id) => this.find(id)).filter((r): r is Rec => !!r).map((r) => this.view(r, false));
    this.dirty.clear();
    if (views.length) this.ctx.broadcast('dl:update', views);
  }

  private added(rec: Rec, origin: { x: number; y: number } | null, host: WebContents | null): void {
    const ev: AddedEvent = { view: this.view(rec, false), origin };
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.isDestroyed()) continue;
      if (!host || w.webContents.id === host.id) w.webContents.send('dl:added', ev);
      else w.webContents.send('dl:update', [ev.view]);
    }
    this.save();
  }

  private view(r: Rec, checkDisk: boolean): DownloadView {
    const run = this.runs.get(r.id);
    const t = run?.transfer ?? null;
    const settings = this.ctx.settings.get();
    const speed = run && r.state === 'downloading' ? run.speed : 0;
    const total = t instanceof HlsTransfer ? t.estimate : r.mode === 'hls' && r.hls ? hlsEstimate(r.hls) : r.total;
    const received = t ? t.received : r.received;
    const left = total > 0 ? total - received : -1;
    const queued = this.recs.filter((x) => x.state === 'queued').sort((a, b) => a.queuedAt - b.queuedAt);
    const fills = r.mode === 'hls' && r.hls ? hlsFills(r.hls) : r.file ? fileFills(r.file) : [];
    const multi = r.mode === 'hls' || (!!r.file?.ranges && r.file.total >= 8 * 1024 * 1024);
    return {
      id: r.id,
      url: r.url,
      pageUrl: r.pageUrl,
      filename: r.filename,
      dir: r.dir,
      path: r.path,
      category: categoryOf(r.filename, r.mime),
      state: r.state,
      phase: run?.phase ?? '',
      received,
      total,
      speed,
      peak: r.peak,
      average: r.activeMs >= 250 ? (r.mode === 'browser' ? r.received : r.netBytes) / (r.activeMs / 1000) : 0,
      eta: speed > 0 && left >= 0 ? Math.round(left / speed) : -1,
      connections: run?.item ? (r.state === 'downloading' ? 1 : 0) : (t?.live ?? 0),
      maxConnections: r.mode === 'browser' ? 1 : multi ? Math.min(r.mode === 'hls' ? 16 : 32, settings.connections || 8) : 1,
      resumable: r.mode === 'hls' || (r.mode === 'file' ? !r.file?.probed || !!r.file.ranges : !!run?.item?.canResume()),
      stream: r.mode === 'hls',
      segments: fills,
      error: r.error,
      missing: checkDisk && r.state === 'completed' && !!r.path && !fs.existsSync(r.path),
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      quality: r.quality,
      videoKey: r.videoKey,
      limitKBps: r.limitKBps,
      queuePos: r.state === 'queued' ? queued.indexOf(r) + 1 : 0,
      engine: r.mode === 'browser' ? 'browser' : 'vitre',
    };
  }

  // ---- persistence ----

  private save(): void {
    this.lastSave = Date.now();
    this.store.set({ version: 1, items: this.recs.map((r) => ({ ...r })) });
  }

  /** Vitre is closing: stop every transfer where it is, so it resumes next time. */
  shutdown(): void {
    for (const [id, run] of this.runs) {
      const rec = this.find(id);
      if (!rec) continue;
      if (run.transfer) rec.received = run.transfer.received;
      if (rec.mode === 'browser') {
        rec.state = 'failed';
        rec.error = 'Interrupted when Vitre closed.';
      } else {
        run.reason = 'quit';
        rec.state = 'paused';
        run.ac.abort();
      }
    }
    this.flushSync();
  }

  flushSync(): void {
    this.save();
    this.store.flush();
  }
}

function pageOf(webContentsId?: number): string {
  if (!webContentsId) return '';
  const wc = webContents.fromId(webContentsId);
  return wc && !wc.isDestroyed() ? wc.getURL() : '';
}

function stem(p: string): string {
  return p.replace(/\.[^.\\/]+$/, '');
}

function hlsPartsExist(p: string): boolean {
  const base = stem(p);
  return ['.video.part', '.audio.part', '.ts', '.m4a', '.aac'].some((ext) => fs.existsSync(base + ext));
}

/** A readable name for a stream whose address says nothing (master.m3u8). */
function streamTitle(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p).replace(/\.m3u8$/i, ''));
    const useful = parts.reverse().find((p) => p && !/^(master|index|playlist|hls|video|stream|manifest|main|\d+p?)$/i.test(p) && !/^[0-9a-f-]{16,}$/i.test(p));
    return useful || u.hostname.replace(/^www\./, '');
  } catch {
    return 'video';
  }
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.promises.rename(from, to);
  } catch (err) {
    if ((err as { code?: string }).code !== 'EXDEV') throw err;
    await fs.promises.copyFile(from, to);
    await fs.promises.rm(from, { force: true });
  }
}
