// HLS on Gecko: the segments of one rendition fetched on parallel connections and written in
// order into one file. A reduced port of app/src/main/modules/downloads/hls.ts (same state shape,
// same DRM/live refusals, AES-128 decryption, ffmpeg repackaging). Left out of the spike, and
// portable as plain JS because they touch nothing Gecko-specific: racing a slow segment with a
// second request, spilling early segments to disk (here the look-ahead window bounds memory
// instead), unwrapping segments disguised as images, re-reading an expired playlist.
//
// What is Gecko-specific and proven here:
//   - segments are read whole into memory with VitreNet (Response.bytes: NetUtil.readInputStream);
//   - AES-128-CBC with WebCrypto (crypto.subtle is available in system modules);
//   - in-order appends through VitrePartFile.Writer (append mode), off the main thread;
//   - ffmpeg through Subprocess (VitreFfmpeg).
import { findFfmpeg, runFfmpeg } from "resource://vitre-boot/engine/VitreFfmpeg.sys.mjs";
import { throttle } from "resource://vitre-boot/engine/VitreLimiter.sys.mjs";
import {
  AbortedError, DownloadError, HttpStatusError, ShortBodyError, backoff, isRetryable, open, retryAfter, sleep,
} from "resource://vitre-boot/engine/VitreNet.sys.mjs";
import { Writer, setSize, sizeOf } from "resource://vitre-boot/engine/VitrePartFile.sys.mjs";
import { audioFor, isMaster, isPlaylist, ladder, parseMaster, parseMedia } from "resource://vitre-boot/engine/VitrePlaylist.sys.mjs";

export const DRM_MESSAGE = "This video is protected and can’t be saved.";
export const LIVE_MESSAGE = "Live streams can’t be saved.";
const ATTEMPTS = 3;
const SEGMENT_MAX = 256 * 1024 * 1024;

export class HlsTransfer {
  live = 0;
  #inflight = 0;
  #playlists = new Map();
  #texts = new Map();
  #keys = new Map();
  #ffmpeg = null;

  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  static fresh(sourceUrl, opts = {}) {
    return { sourceUrl, variantUrl: opts.variantUrl ?? "", audioUrl: opts.audioUrl ?? "", audioOnly: !!opts.audioOnly, resolved: false, bandwidth: 0, duration: 0, expected: opts.bytes || 0, tracks: [] };
  }

  get received() {
    return this.state.tracks.reduce((n, t) => n + t.bytes, 0) + Math.max(0, this.#inflight);
  }

  /** Bytes the finished stream is likely to be: measured segments once there are some, the bitrate before. */
  get estimate() {
    const s = this.state;
    let total = 0;
    for (const t of s.tracks) {
      if (t.secs > 0 && t.length > 0) total += t.initBytes + ((t.bytes - t.initBytes) / t.secs) * t.length;
      else if (t.kind === "main" && s.bandwidth && s.duration) total += (s.bandwidth / 8) * s.duration;
    }
    return total ? Math.max(Math.round(total), this.received) : s.expected || -1;
  }

  /** Resolve a master playlist to one rendition (and its audio), then read the media playlists. */
  async prepare(signal) {
    const s = this.state;
    this.#ffmpeg = await findFfmpeg();
    if (!s.resolved) {
      const first = s.variantUrl || s.sourceUrl;
      const text = await this.#text(first, signal);
      let main = first;
      let audio = s.audioUrl;
      if (isMaster(text)) {
        const master = parseMaster(text, first);
        if (master.drm) throw new DownloadError(DRM_MESSAGE);
        const rungs = ladder(master);
        const pick = s.audioOnly ? rungs.find((v) => v.audioOnly) : (rungs.find((v) => !v.audioOnly) ?? rungs[0]);
        const rendition = pick ? audioFor(master, pick) : (master.renditions.find((r) => r.type === "AUDIO" && r.url) ?? null);
        if (s.audioOnly && !pick && rendition) main = rendition.url;
        else if (pick) {
          main = pick.url;
          s.bandwidth = pick.bandwidth;
          if (!s.audioOnly && rendition && !audio) audio = rendition.url;
        } else throw new DownloadError("This stream has nothing Vitre can save.");
      }
      const track = (kind, url) => ({ kind, url, done: 0, bytes: 0, initBytes: 0, count: 0, secs: 0, length: 0, container: "" });
      s.tracks = [track("main", main)];
      if (audio && audio !== main) s.tracks.push(track("audio", audio));
      s.resolved = true;
    }
    for (const t of s.tracks) {
      const pl = parseMedia(await this.#text(t.url, signal), t.url);
      if (pl.drm) throw new DownloadError(DRM_MESSAGE);
      if (!pl.endList) throw new DownloadError(LIVE_MESSAGE);
      if (pl.iframesOnly || !pl.segments.length) throw new DownloadError("This video can’t be saved.");
      // A playlist that changed shape since the last run can't be continued by position.
      if (t.count && t.count !== pl.segments.length) Object.assign(t, { done: 0, bytes: 0, initBytes: 0, secs: 0 });
      t.count = pl.segments.length;
      t.length = pl.duration;
      t.secs = pl.segments.slice(0, t.done).reduce((n, x) => n + x.duration, 0);
      this.#playlists.set(t.url, pl);
      if (t.kind === "main") s.duration = pl.duration;
    }
  }

  expectedExtension() {
    const main = this.state.tracks[0];
    const pl = main ? this.#playlists.get(main.url) : undefined;
    if (this.#ffmpeg || pl?.init) return this.state.audioOnly ? ".m4a" : ".mp4";
    return ".ts";
  }

  async download(partBase, signal) {
    for (const t of this.state.tracks) {
      this.#inflight = 0;
      await this.#runTrack(t, trackPart(partBase, t), signal);
    }
    this.#inflight = 0;
  }

  /** Turn the track files into the finished file; `place(ext, suffix)` gives a free path. Returns the main file's path. */
  async finish(partBase, place, signal, onProgress = null) {
    const [main, audio] = this.state.tracks;
    const mainPart = trackPart(partBase, main);
    const audioPart = audio ? trackPart(partBase, audio) : "";
    const needsMux = !!audio || main.container === "ts" || main.container === "aac";
    if (this.#ffmpeg && needsMux) {
      const out = place(this.state.audioOnly ? ".m4a" : ".mp4");
      const tmp = `${partBase}.merge.part`;
      const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", mainPart];
      if (audio) args.push("-i", audioPart, "-map", "0:v:0?", "-map", "1:a:0?");
      else args.push("-map", "0:v?", "-map", "0:a?");
      args.push("-c", "copy", "-movflags", "+faststart", "-f", "mp4", tmp);
      try {
        await runFfmpeg(this.#ffmpeg, args, signal, onProgress);
        await IOUtils.move(tmp, out);
        await IOUtils.remove(mainPart, { ignoreAbsent: true });
        if (audioPart) await IOUtils.remove(audioPart, { ignoreAbsent: true });
        return out;
      } catch (err) {
        await IOUtils.remove(tmp, { ignoreAbsent: true }).catch(() => {});
        if (signal?.aborted) throw new AbortedError();
        // Keep what downloaded rather than throw it away over the container.
        this.muxError = String(err);
      }
    }
    const out = place(main.container === "mp4" ? (this.state.audioOnly ? ".m4a" : ".mp4") : ".ts");
    await IOUtils.move(mainPart, out);
    if (audio) await IOUtils.move(audioPart, place(audio.container === "mp4" ? ".m4a" : ".ts", " (audio)"));
    return out;
  }

  /** Fetch a track's segments on parallel connections and append them in order. */
  async #runTrack(track, partPath, signal) {
    const pl = this.#playlists.get(track.url);
    if (!pl) throw new DownloadError("The stream’s playlist couldn’t be read.");
    const segs = pl.segments;
    const stop = new AbortController();
    const relay = () => stop.abort();
    signal.addEventListener("abort", relay);
    let wake = [];
    const notify = () => {
      const w = wake;
      wake = [];
      for (const f of w) f();
    };
    const wait = () => new Promise((r) => wake.push(r));
    stop.signal.addEventListener("abort", notify);

    // Resume: the part file is the truth. Longer than recorded: cut back. Shorter: start again.
    const size = await sizeOf(partPath);
    if (track.done === 0 || size < track.bytes) {
      Object.assign(track, { done: 0, bytes: 0, initBytes: 0, secs: 0 });
      setSize(partPath, 0, { truncate: true });
    } else if (size > track.bytes) {
      setSize(partPath, track.bytes);
    }
    const writer = new Writer(partPath, -1);
    const ready = new Map();
    let failure = null;
    let next = track.done;
    const conns = Math.max(1, Math.min(16, this.env.connections()));
    const ahead = Math.max(12, conns * 3);
    const worker = async () => {
      while (failure === null && !stop.signal.aborted) {
        if (next >= segs.length) return;
        if (next >= track.done + ahead) {
          await wait();
          continue;
        }
        const i = next++;
        try {
          ready.set(i, await this.#fetchPiece(segs[i], stop.signal));
          notify();
        } catch (err) {
          if (failure === null) failure = err;
          stop.abort();
        }
      }
    };
    try {
      if (track.done === 0 && pl.init) {
        const init = await this.#fetchPiece({ url: pl.init.url, seq: 0, key: pl.init.key, range: pl.init.range, duration: 0 }, stop.signal);
        writer.writeBytes(init.buf);
        this.#inflight -= init.net;
        track.bytes = track.initBytes = init.buf.length;
        track.container = "mp4";
      }
      const workers = Array.from({ length: conns }, worker);
      while (track.done < segs.length) {
        while (!ready.has(track.done) && failure === null && !stop.signal.aborted) await wait();
        if (signal.aborted) throw new AbortedError();
        if (failure !== null) throw failure;
        const piece = ready.get(track.done);
        ready.delete(track.done);
        if (!track.container) track.container = sniff(piece.buf);
        writer.writeBytes(piece.buf);
        track.bytes += piece.buf.length;
        track.secs += segs[track.done].duration;
        track.done++;
        this.#inflight -= piece.net;
        notify();
      }
      await Promise.all(workers);
    } finally {
      stop.abort();
      signal.removeEventListener("abort", relay);
      ready.clear();
      // The track's counters are only true once the writer has flushed.
      await writer.close();
    }
  }

  /** One segment: fetched with backoff and decrypted. */
  async #fetchPiece(seg, signal) {
    for (let attempt = 1; ; attempt++) {
      try {
        const got = await this.#fetchBytes(seg.url, seg.range, signal, true);
        let buf = got.buf;
        if (seg.key) buf = await decrypt(buf, await this.#key(seg.key, signal), seg.key.iv ?? sequenceIv(seg.seq));
        return { buf, net: got.net };
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
        await sleep(backoff(attempt, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
      }
    }
  }

  async #fetchBytes(url, range, signal, counts) {
    // Segments are small and many: let them share HTTP/2 connections like a player would.
    const res = await open(url, this.env.identity, range ? { Range: `bytes=${range[0]}-${range[1] - 1}` } : {}, signal, { h1: false });
    if (res.status < 200 || res.status >= 300) {
      res.destroy();
      throw new HttpStatusError(res.status, retryAfter(res));
    }
    let net = 0;
    this.live++;
    try {
      let buf = await res.bytes({
        max: SEGMENT_MAX,
        onChunk: (n) => {
          if (counts) {
            net += n;
            this.#inflight += n;
          }
          this.env.onBytes(n);
          const w = throttle(this.env.limiters, n);
          return w > 0 ? { wait: w } : undefined;
        },
      });
      if (range) {
        if (res.status === 200) {
          if (buf.length < range[1]) throw new DownloadError("The site wouldn’t send this video in parts.");
          buf = buf.subarray(range[0], range[1]);
        } else if (buf.length !== range[1] - range[0]) throw new DownloadError("The site wouldn’t send this video in parts.");
      }
      if (!buf.length) throw new ShortBodyError();
      return { buf, net };
    } catch (err) {
      this.#inflight -= net;
      throw err;
    } finally {
      this.live--;
    }
  }

  async #text(url, signal) {
    const hit = this.#texts.get(url);
    if (hit) return hit;
    for (let attempt = 1; ; attempt++) {
      try {
        const text = new TextDecoder("utf-8").decode((await this.#fetchBytes(url, null, signal, false)).buf);
        if (!isPlaylist(text)) throw new DownloadError("The stream’s playlist couldn’t be read.");
        this.#texts.set(url, text);
        return text;
      } catch (err) {
        if (signal.aborted) throw new AbortedError();
        if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
        await sleep(backoff(attempt, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
      }
    }
  }

  /** The key, fetched once however many segments ask for it at the same moment. */
  #key(ref, signal) {
    let pending = this.#keys.get(ref.url);
    if (!pending) {
      pending = (async () => {
        const { buf } = await this.#fetchBytes(ref.url, null, signal, false);
        if (buf.length !== 16) throw new DownloadError("The stream’s key couldn’t be read.");
        return crypto.subtle.importKey("raw", buf, { name: "AES-CBC" }, false, ["decrypt"]);
      })();
      this.#keys.set(ref.url, pending);
      pending.catch(() => this.#keys.delete(ref.url));
    }
    return pending;
  }
}

export function trackPart(partBase, t) {
  return `${partBase}.${t.kind === "main" ? "video" : "audio"}.part`;
}

function sequenceIv(seq) {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setBigUint64(8, BigInt(seq));
  return iv;
}

/** AES-128-CBC with PKCS#7 padding, which is what WebCrypto's AES-CBC does. */
async function decrypt(data, key, iv) {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, data));
  } catch {
    throw new DownloadError("A piece of the video couldn’t be decrypted.");
  }
}

function boxType(buf, at) {
  return buf.length >= at + 8 ? String.fromCharCode(buf[at + 4], buf[at + 5], buf[at + 6], buf[at + 7]) : "";
}

export function sniff(buf) {
  if (buf[0] === 0x47 && (buf.length < 189 || buf[188] === 0x47)) return "ts";
  if (["ftyp", "styp", "moof", "sidx"].includes(boxType(buf, 0))) return "mp4";
  if ((buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0)) return "aac";
  return "ts";
}
