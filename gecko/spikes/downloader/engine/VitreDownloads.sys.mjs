// The download list on Gecko: queue, state, persistence (<profile>/vitre-downloads.json),
// progress ticks and lifecycle. A process-wide singleton in the system scope: it belongs to no
// window, so downloads carry on when windows close. A trimmed port of
// app/src/main/modules/downloads/manager.ts (the Electron ipc layer becomes plain method calls:
// chrome windows import this module directly and subscribe()).
import { AsyncShutdown } from "resource://gre/modules/AsyncShutdown.sys.mjs";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "resource://gre/modules/Timer.sys.mjs";
import { HlsTransfer } from "resource://vitre-boot/engine/VitreHls.sys.mjs";
import { RateLimiter } from "resource://vitre-boot/engine/VitreLimiter.sys.mjs";
import { log } from "resource://vitre-boot/engine/VitreLog.sys.mjs";
import { categoryOf, chooseName, sanitize, uniquePath } from "resource://vitre-boot/engine/VitreNaming.sys.mjs";
import { AbortedError, Identity, describeError } from "resource://vitre-boot/engine/VitreNet.sys.mjs";
import { FileTransfer, fileFills } from "resource://vitre-boot/engine/VitreRanged.sys.mjs";

const TICK = 250;
const SAVE_EVERY = 1000;
const ACTIVE = ["starting", "queued", "downloading"];

class Manager {
  recs = [];
  runs = new Map();
  listeners = new Set();
  settled = new Map();
  settings = { dir: "", connections: 8, speedLimitKBps: 0, maxActive: 2, keepAliveWithoutWindows: true, raiseHostLimit: true };
  storePath = "";
  #ticker = null;
  #saveTimer = null;
  #saving = Promise.resolve();
  #global = new RateLimiter(() => this.settings.speedLimitKBps || 0);
  #survival = false;
  #raisedTo = 0;
  #quitting = false;
  #lifecycle = false;
  /** Asked before quitting while downloads run; replaced by the chrome UI. Returns true to quit. */
  confirmQuit = (count, _lastWindow) => Services.prompt.confirm(null, "Vitre", `${count} download${count === 1 ? " is" : "s are"} still in progress. Quit anyway? They can be resumed next time.`);

  // ---- persistence ----

  /** Load the list from the profile. Unfinished downloads come back paused, resumable from their .part files. */
  async init(overrides = {}) {
    Object.assign(this.settings, overrides);
    if (!this.settings.dir) this.settings.dir = Services.dirsvc.get("DfltDwnld", Ci.nsIFile).path;
    this.storePath = PathUtils.join(PathUtils.profileDir, "vitre-downloads.json");
    let saved = null;
    try {
      saved = await IOUtils.readJSON(this.storePath);
    } catch {
      saved = null;
    }
    this.recs = [];
    for (const r of saved?.items ?? []) {
      if (!r?.id || !r.url) continue;
      if (ACTIVE.includes(r.state)) r.state = r.state === "starting" ? "failed" : "paused";
      if (r.state === "failed" && !r.error) r.error = "Interrupted when Vitre closed.";
      this.recs.push(r);
    }
    this.installLifecycle();
    return this.list();
  }

  #persisted() {
    return {
      version: 1,
      items: this.recs.filter((r) => !r.identity?.isPrivate).map((r) => {
        const t = this.runs.get(r.id)?.transfer;
        // A running transfer is saved as what is certainly on disk, not what is still in a pipe.
        if (!(t instanceof FileTransfer)) return r;
        const file = t.snapshot();
        return { ...r, file, received: file.segments.reduce((n, seg) => n + seg.received, 0) };
      }),
    };
  }

  /** Atomic: written to a temp file, then moved over the store. */
  save() {
    const data = this.#persisted();
    this.#saving = this.#saving
      .then(() => IOUtils.writeJSON(this.storePath, data, { tmpPath: this.storePath + ".tmp" }))
      .catch((e) => log("store write failed", String(e)));
    return this.#saving;
  }

  #saveSoon() {
    if (this.#saveTimer) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.save();
    }, SAVE_EVERY);
  }

  // ---- list ----

  list() {
    return this.recs.map((r) => this.view(r));
  }

  find(id) {
    return this.recs.find((r) => r.id === id);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #emit(kind, rec) {
    const view = rec ? this.view(rec) : null;
    for (const fn of this.listeners) {
      try {
        fn(kind, view);
      } catch (e) {
        log("listener failed", String(e));
      }
    }
    if (rec && !ACTIVE.includes(rec.state)) {
      for (const resolve of this.settled.get(rec.id) ?? []) resolve(view);
      this.settled.delete(rec.id);
    }
  }

  /** Resolves with the download's view once it is paused, finished, failed or cancelled. */
  whenSettled(id) {
    const rec = this.find(id);
    if (!rec || !ACTIVE.includes(rec.state)) return Promise.resolve(rec ? this.view(rec) : null);
    return new Promise((resolve) => {
      if (!this.settled.has(id)) this.settled.set(id, []);
      this.settled.get(id).push(resolve);
    });
  }

  view(r) {
    const run = this.runs.get(r.id);
    const t = run?.transfer;
    const received = t ? t.received : r.received;
    const total = r.mode === "hls" ? (t?.estimate ?? r.total) : (r.file?.total ?? r.total);
    const speed = run?.speed ?? 0;
    return {
      id: r.id, url: r.url, pageUrl: r.identity?.pageUrl ?? "", filename: r.filename, dir: r.dir, path: r.path,
      category: categoryOf(r.filename, r.mime), state: r.state, phase: run?.phase ?? "", received, total, speed,
      eta: speed > 0 && total > 0 ? Math.max(0, (total - received) / speed) : -1,
      connections: t?.live ?? 0, maxConnections: this.settings.connections, resumable: r.mode === "hls" || !!r.file?.ranges,
      stream: r.mode === "hls", segments: r.file ? fileFills(r.file) : [], error: r.error, startedAt: r.startedAt,
      finishedAt: r.finishedAt, limitKBps: r.limitKBps, engine: "vitre",
    };
  }

  // ---- starting ----

  /**
   * opts: filename (suggested), named (the name must be kept), title, identity (Identity or its
   * JSON), dir, mode ('file' | 'hls'), variantUrl, audioUrl, audioOnly.
   */
  start(url, opts = {}) {
    const identity = opts.identity instanceof Identity ? opts.identity.toJSON() : (opts.identity ?? new Identity().toJSON());
    const mode = opts.mode === "hls" || (opts.mode !== "file" && /\.m3u8(\?|#|$)/i.test(url)) ? "hls" : "file";
    const rec = {
      id: Services.uuid.generateUUID().toString().slice(1, -1),
      url, identity, title: opts.title ?? "", filename: opts.filename ? sanitize(opts.filename) : "", named: !!opts.named,
      dir: opts.dir || this.settings.dir, path: "", mime: "", state: "queued", mode,
      file: null, hls: mode === "hls" ? HlsTransfer.fresh(url, opts) : null,
      received: 0, total: -1, error: "", startedAt: Date.now(), finishedAt: 0, queuedAt: Date.now(), limitKBps: 0,
    };
    this.recs.unshift(rec);
    this.#emit("added", rec);
    this.save();
    this.#pump();
    return rec.id;
  }

  #pump() {
    this.#keepAlive();
    if (this.#quitting) return;
    const running = this.recs.filter((r) => this.runs.has(r.id)).length;
    let free = this.settings.maxActive - running;
    const waiting = this.recs.filter((r) => r.state === "queued" && !this.runs.has(r.id)).sort((a, b) => a.queuedAt - b.queuedAt);
    for (const rec of waiting) {
      if (free-- <= 0) break;
      this.#launch(rec);
    }
    this.#keepAlive();
  }

  #launch(rec) {
    const run = { ac: new AbortController(), reason: null, transfer: null, samples: [], speed: 0, phase: "probing", bytes: 0 };
    this.runs.set(rec.id, run);
    rec.state = "starting";
    rec.error = "";
    this.#ensureTicker();
    const job = rec.mode === "hls" ? this.#runHls(rec, run) : this.#runFile(rec, run);
    // The run is over before anyone hears about it, so a listener may resume or restart at once.
    const finish = (ok, err) => {
      rec.received = run.transfer?.received ?? rec.received;
      this.runs.delete(rec.id);
      if (ok) this.#complete(rec);
      else this.#stopped(rec, run, err);
      this.save();
      this.#pump();
    };
    job.then(() => finish(true, null), (err) => finish(false, err));
  }

  #env(rec, run) {
    const own = new RateLimiter(() => rec.limitKBps || 0);
    return {
      identity: new Identity(rec.identity),
      limiters: [this.#global, own],
      connections: () => this.settings.connections,
      onBytes: (n) => {
        run.bytes += n;
      },
      onRetry: (err, n) => log(`[${rec.filename || rec.id}] retry ${n} after ${err.code || err.status || err.message}`),
    };
  }

  async #runFile(rec, run) {
    const transfer = new FileTransfer(rec.file ?? FileTransfer.fresh(rec.url), this.#env(rec, run));
    run.transfer = transfer;
    rec.file = transfer.state;
    const info = await transfer.probe(run.ac.signal);
    run.phase = "";
    rec.total = transfer.state.total;
    rec.mime = rec.mime || info.contentType;
    if (!rec.path) {
      const name = rec.named && rec.filename ? rec.filename : chooseName({ disposition: info.disposition, suggested: rec.filename, url: info.finalUrl, mime: rec.mime, title: rec.title });
      await IOUtils.makeDirectory(rec.dir, { ignoreExisting: true, createAncestors: true });
      rec.path = uniquePath(rec.dir, name, (p) => this.recs.some((o) => o.id !== rec.id && o.path === p));
      rec.filename = PathUtils.filename(rec.path);
    }
    rec.state = "downloading";
    this.#emit("update", rec);
    this.save();
    await transfer.download(rec.path + ".part", run.ac.signal);
    await IOUtils.move(rec.path + ".part", rec.path);
    await this.#markOrigin(rec);
  }

  /**
   * Mark of the Web: the Zone.Identifier stream Windows (SmartScreen, Office) reads to know a file
   * came from the internet. Firefox's own service writes it, the same call its downloads make.
   */
  async #markOrigin(rec) {
    try {
      const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      file.initWithPath(rec.path);
      let referrer = null;
      if (rec.identity?.pageUrl) {
        referrer = Cc["@mozilla.org/referrer-info;1"].createInstance(Ci.nsIReferrerInfo);
        referrer.init(Ci.nsIReferrerInfo.EMPTY, true, Services.io.newURI(rec.identity.pageUrl));
      }
      const platform = Cc["@mozilla.org/toolkit/download-platform;1"].getService(Ci.mozIDownloadPlatform);
      await platform.maybeWriteDownloadOriginInformation(file, Services.io.newURI(rec.url), referrer, !!rec.identity?.isPrivate);
    } catch (e) {
      log("mark of the web failed", String(e));
    }
  }

  async #runHls(rec, run) {
    const transfer = new HlsTransfer(rec.hls, this.#env(rec, run));
    run.transfer = transfer;
    await transfer.prepare(run.ac.signal);
    run.phase = "";
    if (!rec.path) {
      const base = rec.named && rec.filename ? rec.filename : chooseName({ suggested: rec.filename, url: rec.url, title: rec.title });
      const name = base.replace(/\.(m3u8|ts|mp4)$/i, "") + transfer.expectedExtension();
      await IOUtils.makeDirectory(rec.dir, { ignoreExisting: true, createAncestors: true });
      rec.path = uniquePath(rec.dir, name, (p) => this.recs.some((o) => o.id !== rec.id && o.path === p));
      rec.filename = PathUtils.filename(rec.path);
    }
    rec.state = "downloading";
    this.#emit("update", rec);
    const stem = rec.path.replace(/\.[^.\\]+$/, "");
    await transfer.download(stem, run.ac.signal);
    run.phase = "merging";
    this.#emit("update", rec);
    const out = await transfer.finish(stem, (ext, suffix = "") => uniquePath(rec.dir, PathUtils.filename(stem) + suffix + ext), run.ac.signal);
    rec.path = out;
    rec.filename = PathUtils.filename(out);
    rec.received = rec.total = (await IOUtils.stat(out)).size;
  }

  #complete(rec) {
    rec.state = "completed";
    rec.finishedAt = Date.now();
    if (rec.file) rec.total = rec.file.total;
    this.#emit("done", rec);
  }

  #stopped(rec, run, err) {
    if (run.reason === "pause" || run.reason === "quit") rec.state = "paused";
    else if (run.reason === "cancel") {
      rec.state = "cancelled";
      rec.finishedAt = Date.now();
      if (rec.path) IOUtils.remove(rec.path + ".part", { ignoreAbsent: true }).catch(() => {});
      rec.file = null;
    } else {
      rec.state = "failed";
      rec.error = err instanceof AbortedError ? "Stopped" : describeError(err);
      log(`[${rec.filename || rec.url}] failed: ${rec.error} (${err?.code || err?.message || err})`);
    }
    this.#emit("update", rec);
  }

  // ---- commands ----

  pause(id) {
    const rec = this.find(id);
    const run = this.runs.get(id);
    if (!rec) return;
    if (run) {
      run.reason = "pause";
      run.ac.abort();
    } else if (rec.state === "queued") {
      rec.state = "paused";
      this.#emit("update", rec);
    }
  }

  resume(id) {
    const rec = this.find(id);
    if (!rec || this.runs.has(id) || !["paused", "failed", "cancelled"].includes(rec.state)) return;
    rec.state = "queued";
    rec.queuedAt = Date.now();
    this.#emit("update", rec);
    this.#pump();
  }

  cancel(id) {
    const rec = this.find(id);
    const run = this.runs.get(id);
    if (!rec) return;
    if (run) {
      run.reason = "cancel";
      run.ac.abort();
    } else if (rec.state !== "completed") {
      this.#stopped(rec, { reason: "cancel", transfer: null }, null);
      this.save();
    }
  }

  remove(id) {
    this.cancel(id);
    this.recs = this.recs.filter((r) => r.id !== id || this.runs.has(id));
    this.#emit("removed", null);
    this.save();
  }

  setLimit(id, kbps) {
    const rec = this.find(id);
    if (rec) rec.limitKBps = Math.max(0, kbps | 0);
  }

  get activeCount() {
    return this.recs.filter((r) => ACTIVE.includes(r.state)).length;
  }

  // ---- progress ----

  #ensureTicker() {
    if (this.#ticker) return;
    this.#ticker = setInterval(() => this.#tick(), TICK);
  }

  #tick() {
    if (!this.runs.size) {
      clearInterval(this.#ticker);
      this.#ticker = null;
      return;
    }
    const now = Date.now();
    for (const [id, run] of this.runs) {
      run.samples.push({ t: now, bytes: run.bytes });
      while (run.samples.length > 2 && now - run.samples[0].t > 3000) run.samples.shift();
      const first = run.samples[0];
      run.speed = now > first.t ? ((run.bytes - first.bytes) * 1000) / (now - first.t) : 0;
      const rec = this.find(id);
      if (rec) this.#emit("update", rec);
    }
    this.#saveSoon();
  }

  // ---- lifecycle ----

  /**
   * While a download runs, the process may outlive its last window (Windows normally quits then):
   * nsIAppStartup's "last window closing survival area". Left again when nothing is running.
   */
  #keepAlive() {
    this.#hostLimit();
    const want = this.settings.keepAliveWithoutWindows && this.runs.size > 0;
    if (want && !this.#survival) {
      Services.startup.enterLastWindowClosingSurvivalArea();
      this.#survival = true;
    } else if (!want && this.#survival) {
      this.#survival = false;
      Services.startup.exitLastWindowClosingSurvivalArea();
      for (const fn of this.listeners) fn("idle", null);
    }
  }

  /**
   * Necko allows 6 connections per host (network.http.max-persistent-connections-per-server);
   * more channels simply wait in its queue. While downloads run the limit is raised so every
   * connection of every running download gets a socket; it is put back when they stop.
   */
  #hostLimit() {
    if (!this.settings.raiseHostLimit) return;
    const pref = "network.http.max-persistent-connections-per-server";
    const want = this.runs.size > 0 ? Math.min(64, this.settings.maxActive * Math.min(32, this.settings.connections) + 6) : 0;
    if (want && want !== this.#raisedTo) {
      Services.prefs.setIntPref(pref, want);
      this.#raisedTo = want;
    } else if (!want && this.#raisedTo) {
      Services.prefs.clearUserPref(pref);
      this.#raisedTo = 0;
    }
  }

  installLifecycle() {
    if (this.#lifecycle) return;
    this.#lifecycle = true;
    // Asked before a quit: by the menu's Exit and Ctrl+Shift+Q (no data), and by closing the last
    // window (data "lastwindow"; browser.js closeWindow -> canQuitApplication). Setting the
    // nsISupportsPRBool refuses the quit / keeps the window open.
    Services.obs.addObserver((subject, _topic, data) => {
      const cancel = subject.QueryInterface(Ci.nsISupportsPRBool);
      if (cancel.data || !this.runs.size) return;
      const lastWindow = data === "lastwindow";
      // The last window may close while downloads carry on in the background (the survival area).
      if (lastWindow && this.settings.keepAliveWithoutWindows) return;
      if (!this.confirmQuit(this.runs.size, lastWindow)) cancel.data = true;
    }, "quit-application-requested");
    // The quit is going ahead. While the survival area is held Gecko waits for it (it would let
    // the downloads finish first), so stop them here, resumable; #keepAlive then lets go.
    Services.obs.addObserver(() => {
      this.#quitting = true;
      this.shutdown();
    }, "quit-application-granted");
    // Whatever happens, the list (with every segment's progress) is on disk before the profile closes.
    AsyncShutdown.profileBeforeChange.addBlocker("Vitre downloads: pause transfers and save the list", () => this.shutdown());
  }

  /** Stop every transfer where it is (resumable) and write the store. */
  async shutdown() {
    const waits = [];
    for (const [id, run] of this.runs) {
      run.reason = "quit";
      run.ac.abort();
      waits.push(this.whenSettled(id));
    }
    await Promise.all(waits);
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    await this.save();
  }
}

export const VitreDownloads = new Manager();
