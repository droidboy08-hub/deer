// The segment table of a stream download (spikes/downloader/RESUME-DESIGN.md 4.1 "Streams", 5.3, 5.7;
// Phase 6), and the parts of the stream proof (2.6) and of the master re-pick (G2 step 2) that need no
// network.
//
//   - The table: one line per segment written, recorded right after the in-order write loop marks it
//     (hls.ts runTrack()): {k, i, seq, off, len, h, d}: the track (0 the main one, 1 its audio), the
//     segment's place among the written ones, its media sequence in the playlist it came from, where its
//     bytes sit in the track's .part and how many, the SHA-256 of those bytes cut to 128 bits (as written:
//     decrypted and unwrapped; the bytes already pass through JS there, so the hash costs no extra read),
//     and its EXTINF duration. A header per track {deer, stream, k, seq0, count, durHash, init, keys, rung}
//     starts (or starts again) that track's lines; {k, cut} drops the lines from a place on (a track cut
//     back to its last good segment). Journal: <profile>/vitre-downloads/<id>.stream.jsonl, the same
//     append-only format as the block hash record's (ledger.ts Journal: a torn last line is ignored, a
//     private download's stays in memory, compacted past twice what it needs).
//   - mapNext(): where a resume continues in the playlist read now. By media sequence while the playlist's
//     MEDIA-SEQUENCE base is the one the track was written from; otherwise by time: the cumulative EXTINF
//     must come within 0.05 s of what was written, and the durations on either side must agree. Never by
//     position (hls.ts before Phase 6 counted segments, so a renumbered or re-cut playlist mixed bytes).
//   - repick() / matchRep(): the same quality in a master playlist or manifest read again, by its stored
//     fingerprint (rung): HLS audioOnly, then height plus codecs, then the nearest bandwidth within 10%;
//     its audio by GROUP-ID, language and name (a sound track of its own keeps them: gone, nothing is
//     picked); an audio-only download of a master's own audio rendition by that rendition's GROUP-ID,
//     language and name (review of Phase 6). DASH: the representation id first, then kind, mime, codecs
//     prefix, height and the nearest bandwidth (so renamed ids no longer end the download).
import { Journal } from './ledger';
import type { DashRep, Mpd } from './dash';
import type { MasterPlaylist, MediaPlaylist, Rendition, Variant } from './playlist';
import type { StreamRung } from './types';

/** One written segment (5.7 seg line). */
export interface SegLine {
  i: number;
  seq: number;
  off: number;
  len: number;
  h: string;
  d: number;
}

/** A track's header (5.7): the playlist it is written from, its init segment's hash, its keys and its rung. */
export interface TrackHead {
  seq0: number;
  count: number;
  durHash: string;
  init: string;
  keys: string[];
  rung: StreamRung | null;
  t: number;
}

/** Cumulative EXTINF agrees within this (2.6). */
export const TIME_SLACK = 0.05;
/** The duration of a stream read again agrees within this (2.6). */
export const DURATION_SLACK = 1;
/** The nearest bandwidth is the same rung within this share (G2 step 2). */
const BANDWIDTH_SLACK = 0.1;

/** A segment's hash: SHA-256 of its bytes (crypto.subtle, off the main thread), cut to 128 bits, hex. */
export async function segmentHash(bytes: Uint8Array): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return Array.from(raw.subarray(0, 16), (x) => x.toString(16).padStart(2, '0')).join('');
}

/** 32 bits of FNV-1a of the playlist's durations: tells a playlist re-cut into other durations. */
export function durHash(pl: MediaPlaylist): string {
  let h = 0x811c9dc5;
  const text = pl.segments.map((s) => s.duration.toFixed(3)).join(',');
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
}

/** The keys a playlist uses (they may change: a fresh copy signs them anew; 2.6). */
export function keysOf(pl: MediaPlaylist): string[] {
  return [...new Set(pl.segments.map((s) => s.key?.url ?? '').filter(Boolean))].slice(0, 8);
}

/** Origin plus path, no query (2.2 path shape). */
export function pathShape(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.replace(/[?#].*$/, '');
  }
}

export class StreamTable {
  private heads = new Map<number, TrackHead>();
  private segs = new Map<number, Map<number, SegLine>>();
  /** The journal's size the live lines needed when it was last measured (compaction: flush()). */
  private needed = 0;
  private constructor(readonly journal: Journal) {}

  /** A new table (a first start): nothing is written until a track begins. */
  static create(path: string): StreamTable {
    return new StreamTable(new Journal(path));
  }

  /** A table from its journal on disk; null when there is none. */
  static async open(path: string): Promise<StreamTable | null> {
    const read = await Journal.read(path);
    if (!read) return null;
    const t = new StreamTable(new Journal(path));
    for (const line of read.lines) t.apply(line);
    t.journal.size = read.size;
    t.journal.torn = read.torn;
    return t;
  }

  private apply(line: any): void {
    const k = Number(line.k);
    if (!Number.isInteger(k) || k < 0) return;
    if (line.deer === 1 && line.stream === 1) {
      this.heads.set(k, { seq0: Number(line.seq0) || 0, count: Number(line.count) || 0, durHash: String(line.durHash ?? ''), init: String(line.init ?? ''), keys: Array.isArray(line.keys) ? line.keys.map(String) : [], rung: line.rung ?? null, t: Number(line.t) || 0 });
      // A header starts the track's lines again; one that only follows a renewal keeps them (retarget()).
      if (!line.keep || !this.segs.has(k)) this.segs.set(k, new Map());
    } else if (typeof line.cut === 'number') {
      const m = this.segs.get(k);
      if (m) for (const i of [...m.keys()]) if (i >= line.cut) m.delete(i);
    } else if (typeof line.h === 'string' && typeof line.i === 'number') {
      let m = this.segs.get(k);
      if (!m) this.segs.set(k, (m = new Map()));
      m.set(line.i, { i: line.i, seq: Number(line.seq) || 0, off: Number(line.off) || 0, len: Number(line.len) || 0, h: line.h, d: Number(line.d) || 0 });
    } else if (typeof line.init === 'string' && this.heads.has(k)) {
      const head = this.heads.get(k) as TrackHead;
      head.init = line.init;
    }
  }

  /** Track k starts (again): its header, and no segment lines. */
  begin(k: number, head: TrackHead): void {
    this.heads.set(k, head);
    this.segs.set(k, new Map());
    this.journal.add({ deer: 1, stream: 1, k, ...head });
  }

  /**
   * Track k continues from another playlist (a renewal, or one renumbered): its header follows (the base
   * its next sequence numbers count from), its lines stay.
   */
  retarget(k: number, head: TrackHead): void {
    if (!this.heads.has(k)) {
      this.begin(k, head);
      return;
    }
    this.heads.set(k, head);
    this.journal.add({ deer: 1, stream: 1, keep: 1, k, ...head });
  }

  /** The init segment's hash, known once it is fetched (2.6). */
  setInit(k: number, hash: string): void {
    const head = this.heads.get(k);
    if (!head) return;
    head.init = hash;
    this.journal.add({ k, init: hash });
  }

  add(k: number, line: SegLine): void {
    let m = this.segs.get(k);
    if (!m) this.segs.set(k, (m = new Map()));
    m.set(line.i, line);
    this.journal.add({ k, ...line });
  }

  /** Track k was cut back to `from` written segments: the lines from there on go. */
  cut(k: number, from: number): void {
    const m = this.segs.get(k);
    if (!m) return;
    let any = false;
    for (const i of [...m.keys()]) {
      if (i >= from) {
        m.delete(i);
        any = true;
      }
    }
    if (any) this.journal.add({ k, cut: from });
  }

  head(k: number): TrackHead | undefined {
    return this.heads.get(k);
  }

  entry(k: number, i: number): SegLine | undefined {
    return this.segs.get(k)?.get(i);
  }

  /** Track k's lines below `below` written segments, in order. */
  lines(k: number, below = Infinity): SegLine[] {
    return [...(this.segs.get(k)?.values() ?? [])].filter((x) => x.i < below).sort((a, b) => a.i - b.i);
  }

  /** The newest line below `below`: the last written segment the proof fetches again (2.6). */
  last(k: number, below: number): SegLine | undefined {
    const all = this.lines(k, below);
    return all[all.length - 1];
  }

  /** Every line reaches the journal; `durable`: flushed to the disk (a stop). Compacted when it grew past twice what it needs. */
  async flush(durable = false): Promise<void> {
    await this.journal.flush(durable);
    // What the table needs is measured again only once the journal doubled since (a flush every 2 s while running).
    if (!this.journal.path || this.journal.removed || this.journal.size <= 2 * this.needed + 4096) return;
    const live = this.live();
    this.needed = live.reduce((n: number, l) => n + JSON.stringify(l).length + 1, 0);
    if (this.journal.size > 2 * this.needed + 4096) {
      await this.journal.replace(live);
      this.needed = this.journal.size;
    }
  }

  private live(): object[] {
    const out: object[] = [];
    for (const [k, head] of [...this.heads].sort((a, b) => a[0] - b[0])) {
      out.push({ deer: 1, stream: 1, k, ...head });
      for (const line of this.lines(k)) out.push({ k, ...line });
    }
    return out;
  }
}

/** What mapNext() needs of a track (hls.ts StreamTrack). */
export interface Written {
  done: number;
  secs: number;
  nextSeq?: number;
  seq0?: number;
  lastDur?: number;
}

/**
 * Where the next segment to write sits in `pl` (RESUME-DESIGN.md 2.6, G2): its index, or -1 when what is
 * written does not line up with the playlist read now. By media sequence while the MEDIA-SEQUENCE base is
 * the one the track was written from (and that place is where the time says too); otherwise by time:
 * the cumulative EXTINF within TIME_SLACK of what was written, the last written duration agreeing with the
 * one before that place. A track with nothing written starts at 0.
 */
export function mapNext(t: Written, pl: MediaPlaylist): number {
  if (!t.done) return 0;
  const segs = pl.segments;
  const cum = (k: number): number => segs.slice(0, k).reduce((n, s) => n + s.duration, 0);
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= TIME_SLACK + 1e-9;
  const neighbour = (k: number): boolean => !(t.lastDur! > 0) || (k > 0 && near(segs[k - 1].duration, t.lastDur as number));
  if (typeof t.nextSeq === 'number' && t.nextSeq >= 0 && typeof t.seq0 === 'number' && segs.length && segs[0].seq === t.seq0) {
    const k = t.nextSeq === segs[segs.length - 1].seq + 1 ? segs.length : segs.findIndex((s) => s.seq === t.nextSeq);
    // The sequence says where; the durations must not disagree (a playlist renumbered from the same base).
    if (k >= 0 && (!(t.secs > 0) || Math.abs(cum(k) - t.secs) <= Math.max(TIME_SLACK, 0.001 * t.secs)) && neighbour(k)) return k;
  }
  let sum = 0;
  for (let k = 0; k <= segs.length; k++) {
    if (k > 0) sum += segs[k - 1].duration;
    if (sum > t.secs + TIME_SLACK + 1e-9) break;
    if (k > 0 && near(sum, t.secs) && neighbour(k)) return k;
  }
  return -1;
}

/** An HLS variant's fingerprint (5.3 rung), with the audio rendition it plays with. */
export function rungOf(v: Variant, audio: Rendition | null): StreamRung {
  return {
    height: v.height,
    width: v.width,
    bandwidth: v.bandwidth,
    average: v.average,
    codecs: v.codecs,
    audioOnly: v.audioOnly,
    audioGroup: audio?.groupId ?? v.audioGroup,
    audioLang: audio?.language ?? '',
    audioName: audio?.name ?? '',
  };
}

/** A DASH representation's fingerprint (5.3 rung). */
export function repRung(rep: DashRep): StreamRung {
  return { id: rep.id, kind: rep.kind, mime: rep.mime, codecs: rep.codecs, height: rep.height, width: rep.width, bandwidth: rep.bandwidth, audioLang: rep.lang };
}

/** "1080p" -> {height: 1080} (5.8: an older row's quality). */
export function rungFromQuality(quality: string): StreamRung | undefined {
  const m = /^(\d{3,4})p/.exec(quality || '');
  return m ? { height: Number(m[1]) } : undefined;
}

function nearest<T extends { bandwidth: number }>(list: T[], bandwidth: number | undefined, within: boolean): T | null {
  if (!list.length) return null;
  if (!(Number(bandwidth) > 0)) return within ? null : list[0];
  const b = Number(bandwidth);
  const best = [...list].sort((x, y) => Math.abs(x.bandwidth - b) - Math.abs(y.bandwidth - b))[0];
  return !within || Math.abs(best.bandwidth - b) <= BANDWIDTH_SLACK * b ? best : null;
}

const codecsKey = (c: string | undefined): string => (c ?? '').toLowerCase().split(',').map((x) => x.trim().split('.')[0]).filter(Boolean).sort().join(',');

/** A rung has something to look for (an older row's may be empty: its quality said no height). */
export function fingerprinted(rung: StreamRung | undefined, audioOnly: boolean): boolean {
  if (!rung) return false;
  if (audioOnly) return !!(rung.bandwidth || rung.audioGroup || rung.audioLang || rung.audioName);
  return !!(rung.height || rung.bandwidth);
}

/** An audio rendition's fingerprint: an audio-only download made of a master's own audio (5.3; review of Phase 6). */
export function renditionRung(r: Rendition): StreamRung {
  return { audioOnly: true, audioGroup: r.groupId, audioLang: r.language, audioName: r.name };
}

/**
 * The same rung in a master playlist read again (G2 step 2): by fingerprint (audioOnly; height plus codecs;
 * the nearest bandwidth within 10%), or, with no fingerprint, the variant at the old variant's path. Its
 * audio by GROUP-ID, language and name (`strictAudio`: a stream whose sound is a track of its own keeps its
 * language and name, audioOf()). An audio-only download of a master whose audio lives only in renditions
 * (the picker's "Audio only" there) is that rendition (`rendition`; review of Phase 6: such downloads could
 * never renew). Null when the master has no such rung any more.
 */
export function repick(master: MasterPlaylist, rung: StreamRung | undefined, audioOnly: boolean, oldVariant: string, strictAudio = false): { variant: Variant | null; audio: Rendition | null; rendition: Rendition | null } {
  const all = master.variants.filter((v) => /^https?:/i.test(v.url));
  let variant: Variant | null = null;
  if (audioOnly) {
    const audios = all.filter((v) => v.audioOnly);
    if (!audios.length) return { variant: null, audio: null, rendition: renditionOf(master, rung, oldVariant) };
    variant = nearest(audios, rung?.bandwidth, !!rung?.bandwidth) ?? (rung?.bandwidth ? null : (audios[0] ?? null));
  } else if (rung && (rung.height || rung.bandwidth)) {
    const videos = all.filter((v) => !v.audioOnly);
    if (rung.height) {
      const tall = videos.filter((v) => v.height === rung.height);
      const same = rung.codecs ? tall.filter((v) => codecsKey(v.codecs) === codecsKey(rung.codecs)) : [];
      // Only a height known (an older row's quality, 5.8): the richest of that height, as the ladder offers it.
      const richest = [...tall].sort((a, b) => b.bandwidth - a.bandwidth)[0] ?? null;
      variant = (rung.bandwidth ? nearest(same, rung.bandwidth, false) : (same.sort((a, b) => b.bandwidth - a.bandwidth)[0] ?? null)) ?? nearest(tall, rung.bandwidth, true) ?? (!rung.bandwidth ? richest : null);
    } else variant = nearest(videos, rung.bandwidth, true);
  }
  if (!variant && oldVariant) {
    const shape = pathShape(oldVariant);
    variant = all.find((v) => pathShape(v.url) === shape) ?? null;
  }
  if (!variant) return { variant: null, audio: null, rendition: null };
  return { variant, audio: audioOf(master, variant, rung, strictAudio), rendition: null };
}

/**
 * The audio rendition an audio-only download was made of, in a master read again: by its GROUP-ID (when the
 * group is still there), language and name; without a fingerprint, the one at the old rendition's path, else
 * the one the picker offers (the default, else the first): the proof then decides.
 */
function renditionOf(master: MasterPlaylist, rung: StreamRung | undefined, old: string): Rendition | null {
  const all = master.renditions.filter((r) => r.type === 'AUDIO' && r.url && /^https?:/i.test(r.url));
  if (!all.length) return null;
  if (rung?.audioGroup || rung?.audioLang || rung?.audioName) {
    const pool = rung.audioGroup && all.some((r) => r.groupId === rung.audioGroup) ? all.filter((r) => r.groupId === rung.audioGroup) : all;
    const named = !!(rung.audioLang || rung.audioName);
    return (
      pool.find((r) => r.language === (rung.audioLang ?? '') && r.name === (rung.audioName ?? '')) ??
      pool.find((r) => !!rung.audioName && r.name === rung.audioName) ??
      pool.find((r) => !!rung.audioLang && r.language === rung.audioLang) ??
      (named ? null : (pool.find((r) => r.isDefault) ?? pool[0] ?? null))
    );
  }
  const shape = pathShape(old);
  return all.find((r) => pathShape(r.url) === shape) ?? all.find((r) => r.isDefault) ?? all[0];
}

/**
 * The audio rendition to go with `variant`, by GROUP-ID, language and name (G2 step 2). `strict`: when the
 * stored language and name are gone, none (review of Phase 6: the default rendition was taken silently, so
 * a sound track not yet started continued in another language); otherwise the default, as the ladder picks it.
 */
export function audioOf(master: MasterPlaylist, variant: Variant, rung: StreamRung | undefined, strict = false): Rendition | null {
  const group = master.renditions.filter((r) => r.type === 'AUDIO' && r.url && (!variant.audioGroup || r.groupId === variant.audioGroup));
  if (!group.length) return null;
  const by = (f: (r: Rendition) => boolean): Rendition | undefined => group.find(f);
  if (rung?.audioLang || rung?.audioName) {
    const hit = by((r) => r.language === (rung.audioLang ?? '') && r.name === (rung.audioName ?? '')) ?? by((r) => !!rung.audioName && r.name === rung.audioName) ?? by((r) => !!rung.audioLang && r.language === rung.audioLang);
    if (hit) return hit;
    if (strict) return null;
  }
  return group.find((r) => r.isDefault) ?? group[0];
}

/**
 * The same representation in a manifest read again (G2 step 2, DASH): its id first, then kind, mime,
 * codecs prefix and height, the nearest bandwidth. Null when the manifest has no such one.
 */
export function matchRep(mpd: Mpd, id: string, rung: StreamRung | undefined, kind: 'video' | 'audio'): DashRep | null {
  const byId = mpd.reps.find((r) => r.id === id && r.kind === kind);
  if (byId) return byId;
  if (!rung) return null;
  const pool = mpd.reps.filter(
    (r) => r.kind === kind && (!rung.mime || r.mime === rung.mime) && (!rung.codecs || codecsKey(r.codecs) === codecsKey(rung.codecs)) && (kind === 'audio' || !rung.height || r.height === rung.height) && (kind !== 'audio' || !rung.audioLang || r.lang === rung.audioLang)
  );
  return nearest(pool, rung.bandwidth, false);
}
