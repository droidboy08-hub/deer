// The block hash record of a one-file download (spikes/downloader/RESUME-DESIGN.md section 4 and 5.7,
// Phase 5). It finds damage after a crash, a power loss, a disk error or another program writing into
// the .part, so only the bad blocks are downloaded again, and it is what a finished file is checked and
// repaired against (Check file, Repair).
//
//   - Blocks are aligned to the file: bs = clamp(pow2ceil(total / 2048), 1 MiB, 64 MiB), so a file never
//     has more than 2048 (blockSize()). ranged.ts plan() and claim() cut segments at multiples of bs, so
//     each block sits inside one segment; older, unaligned segments still work, because a block counts as
//     saved once it lies wholly inside the union of [start, start + received) (covered()).
//   - A block is hashed once it lies wholly under the bytes certainly in the .part (ranged.ts provable():
//     a writer's backlog and the chunk its copier may still be writing are left out), checked on every
//     writer.close() and on the engine's tick; at most AT_ONCE at a time. Hashing may fall behind; a stop's
//     seal drains it, and the blocks still unhashed when a download finishes are hashed from the finished
//     file (review of Phase 5). While a run goes faster than HOLD_ABOVE it waits (took()).
//   - Hash: the block is read back in CHUNK pieces (IOUtils.read: off the main thread), each through
//     crypto.subtle.digest('SHA-256') (Phase 5 spike (b): it runs off the main thread, 64 MiB in 29 ms
//     with at most 6 ms of main-thread lag, where nsICryptoHash held it 5 ms per 4 MiB piece); the block
//     hash is SHA-256 of the chunk hashes cut to 128 bits, the head hash SHA-256 of its first 64 KiB
//     (HEAD): the windows the same-file proof compares with an address (proof.ts Heads). Reading block 0
//     back also tells what the download is (a page or a file: onKind).
//   - The journal (Journal): <profile>/vitre-downloads/<id>.jsonl, append-only JSON lines (5.7): header
//     {deer, id, path, url, identity, total, bs, ct, name, etag, lm, t}, block {b, h, w, a}, seal {cov, t,
//     f}, drop {drop, why}, decision {decision, t}, repair {repair, t} and repaired {repaired, t}, and, kept
//     with a finished file as <id>.done.jsonl, fin {fin, size, mtime, path, t} (its whole-file SHA-256). A
//     torn last line is ignored; it is compacted (a tmp file, then a move) once it grows past twice what it
//     needs; a private download's stays in memory. A new header (Start over) starts the record again.
//   - Released blocks (damage found, claims given back) keep their old hash as `expect`: the bytes fetched
//     again must hash to it, otherwise the file on the site changed (RESUME-DESIGN.md 4.3: G3, mismatch).
//   - Seals (the engine's seal()): the .part flushed when it can be (flushPart(): FlushFileBuffers through
//     js-ctypes in a ChromeWorker; Phase 5 spike (a): IOUtils' zero-byte append with flush does not reach
//     the disk, 0-2 ms over 256 MiB of dirty pages where FlushFileBuffers took 65 ms), then a seal line
//     with the coverage, flushed.
import { clearTimeout, setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { ChangedError, textStart } from './net';
import { WINDOW, sha256Hex, sizeText } from './proof';
import type { Segment } from './ranged';

export const MIN_BLOCK = 1024 * 1024;
export const MAX_BLOCK = 64 * 1024 * 1024;
const MAX_BLOCKS = 2048;
/** Read and digest this much at a time. */
const CHUNK = 1024 * 1024;
/** The head window of a block (RESUME-DESIGN.md 4.1): what the same-file proof compares (proof.ts WINDOW). */
export const HEAD = WINDOW;
/** At most this many blocks are hashed at once (4.1). */
const AT_ONCE = 2;
/** Seals while running: every this long, or every SEAL_BYTES (4.1, the owner's decision 10). */
export const SEAL_EVERY = 30 * 1000;
export const SEAL_BYTES = 256 * 1024 * 1024;
/**
 * ...but the bytes never bring a seal sooner than this after the last one (review of Phase 5): above about
 * 1 GB/s every 256 MiB meant a seal (a flush of the .part, two flushed saves) back to back, which slowed the
 * download by a quarter. The design's risks (section 8) ask for an adjustable seal interval.
 */
export const SEAL_MIN_GAP = 5000;
/**
 * While a run takes bytes faster than this (over the last RATE_WINDOW), the hashing waits: it catches up as
 * soon as the run slows, at a stop's drain and from the finished file (4.1: "hashing may fall behind").
 * Review of Phase 5: hashing alongside a 2 GB/s local download slowed it by a quarter; below this rate it
 * costs nothing measurable (perf.js C, 100 MB/s on 4 GiB).
 */
const HOLD_ABOVE = 256 * 1024 * 1024;
const RATE_WINDOW = 200;
/**
 * Without a proven flush of the .part, blocks hashed this long before the last seal are checked again
 * after an unclean session (4.2): Windows writes dirty pages back within seconds; the margin is generous.
 */
export const UNFLUSHED_MARGIN = 2 * 60 * 1000;
/** A .part modified this long after its last seal, while nothing ran, was changed by another program (4.2). */
export const MTIME_SLACK = 5000;
/** Every resume checks this many hashed blocks below each frontier, and this many placed by a seed (4.2). */
const SPOT_BELOW = 2;
const SPOT_SEEDED = 2;

/** The block size for a file of `total` bytes (RESUME-DESIGN.md 4.1). */
export function blockSize(total: number): number {
  const want = total > 0 ? Math.ceil(total / MAX_BLOCKS) : 0;
  let bs = MIN_BLOCK;
  while (bs < want && bs < MAX_BLOCK) bs *= 2;
  return bs;
}

export interface Header {
  deer: 1;
  id: string;
  /** The download's file (without .part). */
  path: string;
  url: string;
  identity?: unknown;
  total: number;
  bs: number;
  ct: string;
  name: string;
  etag: string;
  lm: string;
  t: number;
}

/** A hashed block: its hash (128 bits), its head hash (the first 64 KiB) and when it was hashed. */
export interface BlockRec {
  h: string;
  w: string;
  a: number;
}

export interface Seal {
  t: number;
  cov: Array<[number, number]>;
  /** The .part was flushed (FlushFileBuffers) before the line was written. */
  f: boolean;
}

export interface Fin {
  sha256: string;
  size: number;
  mtime: number;
  path: string;
  t: number;
}

export { sha256Hex };

/**
 * A block's hash (4.1) from its bytes in memory: SHA-256 of the CHUNK hashes cut to 128 bits, and the
 * head hash. Repair checks a fetched block with it before writing (4.3).
 */
export async function hashBytes(bytes: Uint8Array): Promise<{ h: string; w: string }> {
  const parts: Uint8Array[] = [];
  for (let at = 0; at < bytes.length || at === 0; at += CHUNK) {
    parts.push(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.subarray(at, Math.min(bytes.length, at + CHUNK)) as Uint8Array<ArrayBuffer>)));
    if (bytes.length === 0) break;
  }
  return combine(parts, await sha256Hex(bytes.subarray(0, Math.min(HEAD, bytes.length))));
}

/**
 * The block hash from its chunk hashes (at most 64 x 32 bytes): nsICryptoHash on the spot, a few
 * microseconds, where another round trip through crypto.subtle would hold the block's hashing longer.
 */
async function combine(parts: Uint8Array[], w: string): Promise<{ h: string; w: string }> {
  const all = new Uint8Array(parts.length * 32);
  parts.forEach((p, i) => all.set(p, i * 32));
  const hash = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
  hash.init(Ci.nsICryptoHash.SHA256);
  hash.update(Array.from(all), all.length);
  const raw: string = hash.finish(false);
  return { h: Array.from(raw.slice(0, 16), (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(''), w };
}

/** A block of the file at `path` hashed from the disk; null when it can't be read whole. `first`: its first bytes. */
export async function hashBlock(path: string, start: number, len: number): Promise<{ h: string; w: string; first: Uint8Array } | null> {
  const parts: Uint8Array[] = [];
  let w = '';
  let first = new Uint8Array(0);
  try {
    // The next chunk is read while this one is digested; the head and the first chunk are digested together.
    const read = (at: number): Promise<Uint8Array> => {
      const p: Promise<Uint8Array> = IOUtils.read(path, { offset: start + at, maxBytes: Math.min(CHUNK, len - at) });
      // Never an unhandled rejection when the block is given up before this read is awaited.
      p.catch(() => undefined);
      return p;
    };
    let next = read(0);
    for (let at = 0; at < len; at += CHUNK) {
      const n = Math.min(CHUNK, len - at);
      const buf: Uint8Array = await next;
      if (buf.length !== n) return null;
      if (at + CHUNK < len) next = read(at + CHUNK);
      const chunk = crypto.subtle.digest('SHA-256', buf as Uint8Array<ArrayBuffer>);
      if (at === 0) {
        w = await sha256Hex(buf.subarray(0, Math.min(HEAD, n)));
        first = buf.slice(0, 64);
      }
      parts.push(new Uint8Array(await chunk));
    }
  } catch {
    return null;
  }
  return { ...(await combine(parts, w)), first };
}

/**
 * The append-only journal (5.7). Lines wait in memory and are written in one append (flush()); a seal
 * flushes them to the disk. With no path (a private download) nothing is ever written.
 */
export class Journal {
  private queue: string[] = [];
  private chain: Promise<void> = Promise.resolve();
  /** Bytes written to the file so far (compaction). */
  size = 0;
  /** The file ends in a torn line (a crash cut it): the next append starts on a line of its own. */
  torn = false;
  /**
   * Removed with its row (remove()): nothing is written again, whatever was still running (a seal or the
   * finish of a row removed or cancelled meanwhile; review of Phase 5: a later append recreated the file,
   * which fromJournals() would bring back as a row).
   */
  removed = false;

  /** Removals still running, by path: a new journal at the same path (Start over) writes only after them. */
  private static gone = new Map<string, Promise<void>>();

  constructor(public path: string) {
    const before = path ? Journal.gone.get(path) : undefined;
    if (before) this.chain = before;
  }

  add(line: object): void {
    if (this.removed) return;
    this.queue.push(JSON.stringify(line));
  }

  /** Append what waits; `durable`: flushed to the disk (a seal, a decision, a repair). */
  flush(durable = false): Promise<void> {
    const path = this.path;
    this.chain = this.chain.then(async () => {
      if (this.removed || (!this.queue.length && !durable)) return;
      const lines = this.queue.length ? this.queue.splice(0).join('\n') + '\n' : '';
      if (!path || !lines) return;
      const text = this.torn ? `\n${lines}` : lines;
      try {
        await IOUtils.writeUTF8(path, text, { mode: 'appendOrCreate', flush: durable });
        this.torn = false;
        this.size += text.length;
      } catch (e) {
        console.warn('Deer downloads: the hash record could not be written', String(e));
      }
    });
    return this.chain;
  }

  /** Replace the whole journal by `lines` (compaction, a renamed record): a tmp file, then a move. */
  replace(lines: object[]): Promise<void> {
    const path = this.path;
    this.queue = [];
    this.chain = this.chain.then(async () => {
      if (!path || this.removed) return;
      const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
      try {
        await IOUtils.writeUTF8(path, text, { tmpPath: `${path}.tmp`, flush: true });
        this.torn = false;
        this.size = text.length;
      } catch (e) {
        console.warn('Deer downloads: the hash record could not be compacted', String(e));
      }
    });
    return this.chain;
  }

  /** Move the journal (a finished file's record becomes <id>.done.jsonl). */
  moveTo(next: string): Promise<void> {
    if (this.removed) return this.chain;
    const from = this.path;
    this.path = next;
    this.chain = this.chain.then(async () => {
      if (!from || !next || from === next || this.removed) return;
      await IOUtils.move(from, next).catch(() => undefined);
    });
    return this.chain;
  }

  /** The journal goes for good (its row was removed or cancelled, or its record starts again elsewhere). */
  remove(): Promise<void> {
    const path = this.path;
    this.removed = true;
    this.queue = [];
    const done = this.chain.then(async () => {
      if (path) await IOUtils.remove(path, { ignoreAbsent: true }).catch(() => undefined);
    });
    this.chain = done;
    if (path) {
      Journal.gone.set(path, done);
      void done.then(() => {
        if (Journal.gone.get(path) === done) Journal.gone.delete(path);
      });
    }
    return done;
  }

  /** The lines of a journal on disk, in order; a torn or unreadable line is left out (5.7). */
  static async read(path: string): Promise<{ lines: any[]; size: number; torn: boolean } | null> {
    let text: string;
    try {
      text = await IOUtils.readUTF8(path);
    } catch {
      return null;
    }
    const lines: any[] = [];
    for (const raw of text.split('\n')) {
      if (!raw.trim()) continue;
      try {
        const line = JSON.parse(raw);
        if (line && typeof line === 'object') lines.push(line);
      } catch {
        /* a torn line (the last one, cut by a crash) */
      }
    }
    return { lines, size: text.length, torn: !!text && !text.endsWith('\n') };
  }
}

/** The union of what segments claim, sorted and merged: [start, end) stretches. */
export function coverage(segs: Segment[]): Array<[number, number]> {
  const parts = segs.filter((s) => s.received > 0).map((s): [number, number] => [s.start, s.start + s.received]).sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of parts) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** 32 bits of FNV-1a (the seeded blocks; proof.ts places its seeded window the same way). */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * One download's block hash record: what is hashed, what must hash again to an old value, the last seal,
 * and its journal. The engine keeps one per download (VitreDownloads ledgerFor()); a FileTransfer hashes
 * into it while it runs (attach()).
 */
export class Ledger {
  blocks = new Map<number, BlockRec>();
  /** Released blocks: the bytes fetched again must hash to these (4.3). */
  expect = new Map<number, BlockRec>();
  seal: Seal | null = null;
  /** A repair line with no repaired line after it: a crash cut that repair, so those blocks are checked again. */
  pendingRepair: number[] = [];
  fin: Fin | null = null;
  /** A released block fetched again that hashed to another value: the file on the site changed (G3). */
  mismatch: ChangedError | null = null;
  /** The block that did, whose claims the transfer gives back before it stops. */
  mismatchBlock = -1;
  onMismatch: ((err: ChangedError) => void) | null = null;
  /** Block 0 was read back: what its first bytes say the download is (4.1). */
  onKind: ((kind: 'text' | 'binary') => void) | null = null;
  /** When the last seal ran in this session (the engine's timer seals) and bytes counted since. */
  sealedAt = Date.now();
  sinceSeal = 0;
  private part = '';
  private source: (() => Segment[]) | null = null;
  private hashing = new Set<number>();
  /** Blocks whose read failed since the last attach() or use(): not tried again until then (never a busy loop). */
  private failed = new Set<number>();
  private idle: Array<() => void> = [];
  /** What the run took over the last RATE_WINDOW (took()): [when, bytes], and their sum. */
  private recent: Array<[number, number]> = [];
  private recentBytes = 0;
  /** Drains running: the hashing never waits for the run's speed then (HOLD_ABOVE). */
  private draining = 0;
  /** Counts forget() and reset(): a block hash still being read when the bytes it describes went is dropped. */
  private epoch = 0;

  private constructor(
    public header: Header,
    readonly journal: Journal
  ) {}

  get bs(): number {
    return this.header.bs;
  }

  get total(): number {
    return this.header.total;
  }

  /** How many blocks the file has. */
  count(): number {
    return this.total > 0 ? Math.ceil(this.total / this.bs) : 0;
  }

  /** Block b's bytes: [start, end). */
  span(b: number): [number, number] {
    return [b * this.bs, Math.min(this.total, (b + 1) * this.bs)];
  }

  /** A new record (a first start, Start over): its header line is written at once. */
  static create(path: string, header: Header): Ledger {
    const l = new Ledger(header, new Journal(path));
    l.journal.add(header);
    void l.journal.flush(true);
    return l;
  }

  /** A record from its journal on disk; null when there is none (or no header in it). */
  static async open(path: string): Promise<Ledger | null> {
    const read = await Journal.read(path);
    if (!read) return null;
    let l: Ledger | null = null;
    for (const line of read.lines) {
      if (line.deer === 1 && Number(line.total) > 0 && Number(line.bs) > 0) {
        // A header starts the record (again: Start over writes a new one).
        const kept = l?.journal ?? new Journal(path);
        l = new Ledger(line as Header, kept);
        continue;
      }
      if (!l) continue;
      l.apply(line);
    }
    if (l) {
      l.journal.size = read.size;
      l.journal.torn = read.torn;
    }
    return l;
  }

  /** One journal line read back (open()). */
  private apply(line: any): void {
    if (typeof line.b === 'number' && typeof line.h === 'string') {
      this.blocks.set(line.b, { h: line.h, w: String(line.w ?? ''), a: Number(line.a) || 0 });
      this.expect.delete(line.b);
    } else if (Array.isArray(line.cov)) {
      this.seal = { t: Number(line.t) || 0, cov: line.cov, f: !!line.f };
    } else if (Array.isArray(line.drop)) {
      for (const b of line.drop) {
        const rec = this.blocks.get(b);
        // A forgotten block (forget()) has no value to be fetched again as; a dropped one keeps its old one.
        if (rec && !line.forget) this.expect.set(b, rec);
        if (line.forget) this.expect.delete(b);
        this.blocks.delete(b);
      }
    } else if (Array.isArray(line.repair)) {
      this.pendingRepair = line.repair.filter((b: unknown) => typeof b === 'number');
    } else if (Array.isArray(line.repaired)) {
      this.pendingRepair = [];
    } else if (typeof line.fin === 'string') {
      this.fin = { sha256: line.fin, size: Number(line.size) || 0, mtime: Number(line.mtime) || 0, path: String(line.path ?? ''), t: Number(line.t) || 0 };
    }
  }

  /** Start the record again (Start over, a .part that went missing): a new header line. */
  reset(header: Header): void {
    this.epoch++;
    this.header = header;
    this.blocks.clear();
    this.expect.clear();
    this.seal = null;
    this.pendingRepair = [];
    this.fin = null;
    this.mismatch = null;
    this.mismatchBlock = -1;
    this.journal.add(header);
    void this.journal.flush(true);
  }

  /** A transfer writes into `part`; `source` gives the bytes certainly in it (ranged.ts provable()). */
  attach(part: string, source: () => Segment[]): void {
    this.use(part, source);
    this.mismatch = null;
    this.mismatchBlock = -1;
  }

  /** Hash from `part` what `source` says is certainly in it (a stop's seal: the exact segments, every writer closed). */
  use(part: string, source: () => Segment[]): void {
    this.part = part;
    this.source = source;
    this.failed.clear();
  }

  detach(): void {
    this.source = null;
  }

  /**
   * No new block is hashed (detach()), and this resolves once the blocks being read are done: nothing of the
   * hashing holds the .part open any more (its rename at the finish would fail on Windows). Review of Phase
   * 5: the finish no longer drains the hashing, it only waits for these (at most AT_ONCE blocks).
   */
  quiet(): Promise<void> {
    this.detach();
    if (!this.hashing.size) return Promise.resolve();
    return new Promise((resolve) => this.idle.push(resolve));
  }

  /** Hashed block b's head hash, for a window [from, to) that is exactly its head (proof.ts Heads). */
  head(from: number, to: number): string | undefined {
    if (from % this.bs) return undefined;
    const b = from / this.bs;
    const [a, e] = this.span(b);
    if (a !== from || to !== Math.min(e, a + HEAD)) return undefined;
    return this.blocks.get(b)?.w || undefined;
  }

  /** The blocks wholly inside what the segments claim. */
  covered(segs: Segment[]): number[] {
    const cov = coverage(segs);
    const out: number[] = [];
    for (const [x, y] of cov) {
      for (let b = Math.ceil(x / this.bs); b < this.count(); b++) {
        const [a, e] = this.span(b);
        if (a >= y) break;
        if (a >= x && e <= y) out.push(b);
      }
    }
    return out;
  }

  /** Bytes a run just took (ranged.ts stream()): how fast it goes (HOLD_ABOVE), then the hashing is looked at. */
  took(n: number): void {
    this.recent.push([Date.now(), n]);
    this.recentBytes += n;
    this.pump();
  }

  /** The run takes bytes faster than HOLD_ABOVE (over the last RATE_WINDOW). */
  fast(): boolean {
    const now = Date.now();
    while (this.recent.length && now - this.recent[0][0] > RATE_WINDOW) this.recentBytes -= (this.recent.shift() as [number, number])[1];
    return this.recentBytes > (HOLD_ABOVE * RATE_WINDOW) / 1000;
  }

  /** The run goes faster than HOLD_ABOVE and nothing drains: no new block is hashed now. */
  private held(): boolean {
    return !this.draining && this.fast();
  }

  /** Hash what newly lies wholly under the transfer's certain bytes, at most AT_ONCE at a time (4.1). */
  pump(): void {
    const src = this.source;
    if (!src || !this.part || this.mismatch) {
      this.wake();
      return;
    }
    if (this.hashing.size >= AT_ONCE || this.held()) return;
    for (const b of this.covered(src())) {
      if (this.hashing.size >= AT_ONCE) return;
      if (this.blocks.has(b) || this.hashing.has(b) || this.failed.has(b)) continue;
      this.hashing.add(b);
      void this.hashOne(b)
        .catch((e: unknown) => console.warn('Deer downloads: a block could not be hashed', String(e)))
        .finally(() => {
          this.hashing.delete(b);
          this.pump();
        });
    }
    if (!this.hashing.size) this.wake();
  }

  private wake(): void {
    if (this.hashing.size) return;
    for (const fn of this.idle.splice(0)) fn();
  }

  private async hashOne(b: number): Promise<void> {
    const [a, e] = this.span(b);
    const part = this.part;
    const epoch = this.epoch;
    const got = await hashBlock(part, a, e - a);
    if (part !== this.part || epoch !== this.epoch) return;
    if (!got) {
      this.failed.add(b);
      return;
    }
    if (b === 0 && got.first.length) this.onKind?.(textStart(got.first) ? 'text' : 'binary');
    const old = this.expect.get(b);
    if (old && old.h !== got.h) {
      // 4.3: bytes fetched again for a released block must be the old ones: these are another file's.
      this.mismatchBlock = b;
      this.mismatch = new ChangedError(a === 0 ? 'its first bytes are different' : `its bytes at ${sizeText(a)} are different`);
      this.onMismatch?.(this.mismatch);
      return;
    }
    this.expect.delete(b);
    const rec = { h: got.h, w: got.w, a: Date.now() };
    this.blocks.set(b, rec);
    this.journal.add({ b, ...rec });
  }

  /** A block hashed outside the pump (the server compare replaced it, 4.3): recorded with its line. */
  put(b: number, rec: BlockRec): void {
    this.expect.delete(b);
    this.blocks.set(b, rec);
    this.journal.add({ b, ...rec });
  }

  /** Resolves once nothing is being hashed and nothing more can be (a seal, the finish: 4.1). */
  drain(): Promise<void> {
    this.draining++;
    this.pump();
    if (!this.hashing.size) {
      this.draining--;
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.idle.push(() => {
        this.draining--;
        resolve();
      })
    );
  }

  /** Hash the blocks again from `path` (2 at a time); the ones that differ from their record or can't be read. */
  async verify(path: string, list: number[], onBlock?: (done: number) => void): Promise<number[]> {
    const todo = [...new Set(list)].filter((b) => this.blocks.has(b)).sort((x, y) => x - y);
    const bad: number[] = [];
    let i = 0;
    let done = 0;
    const lane = async (): Promise<void> => {
      while (i < todo.length) {
        const b = todo[i++];
        const [a, e] = this.span(b);
        const got = await hashBlock(path, a, e - a);
        if (!got || got.h !== this.blocks.get(b)?.h) bad.push(b);
        onBlock?.(++done);
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, lane));
    return bad.sort((x, y) => x - y);
  }

  /** These hashes forgotten (a drop line, no value kept): they were read from bytes that are not the download's. */
  unhash(list: number[], why: string): void {
    const gone = list.filter((b) => this.blocks.has(b));
    for (const b of gone) this.blocks.delete(b);
    if (gone.length) this.journal.add({ drop: gone, why, forget: 1 });
  }

  /**
   * Every hash forgotten (a drop line): the .part holds other bytes now (a single stream's answer replaced it,
   * a silent restart, a checksum that did not match). One still being read is dropped when it is done.
   */
  forget(why: string): void {
    this.epoch++;
    const all = [...this.blocks.keys(), ...this.expect.keys()];
    this.blocks.clear();
    this.expect.clear();
    if (all.length) this.journal.add({ drop: all, why, forget: 1 });
  }

  /** Hashed blocks that no longer lie wholly under what the segments claim go to `expect` (a drop line). */
  retain(segs: Segment[], why = 'gone'): number[] {
    const keep = new Set(this.covered(segs));
    const gone = [...this.blocks.keys()].filter((b) => !keep.has(b));
    this.drop(gone, why);
    return gone;
  }

  private drop(list: number[], why: string): void {
    if (!list.length) return;
    for (const b of list) {
      const rec = this.blocks.get(b);
      if (rec) this.expect.set(b, rec);
      this.blocks.delete(b);
    }
    this.journal.add({ drop: list, why });
  }

  /**
   * Release bad blocks for fetching again (4.3): each segment holding one is split into the received
   * part before it, the block itself with nothing received, and the rest with the prefix it still has.
   * Their old hashes are kept as `expect`. Returns the new segment list (the caller saves it, flushed,
   * before anything is fetched).
   */
  release(segs: Segment[], bad: number[], why = 'bad'): Segment[] {
    let out = segs.map((s) => ({ ...s }));
    for (const b of [...new Set(bad)].sort((x, y) => x - y)) {
      const [a, e] = this.span(b);
      const next: Segment[] = [];
      for (const s of out) {
        const got = s.start + s.received;
        if (s.received <= 0 || got <= a || s.start >= e) {
          next.push(s);
          continue;
        }
        const end = s.end < 0 ? Math.max(got, e) : s.end;
        if (s.start < a) next.push({ start: s.start, end: a, received: a - s.start });
        const cut = Math.max(s.start, a);
        const blockEnd = Math.min(e, end);
        if (blockEnd > cut) next.push({ start: cut, end: blockEnd, received: 0 });
        if (end > blockEnd) next.push({ start: blockEnd, end: s.end < 0 ? -1 : end, received: Math.max(0, got - blockEnd) });
      }
      out = next;
    }
    this.drop(bad.filter((b) => this.blocks.has(b)), why);
    return out;
  }

  /**
   * After an unclean stop (4.2): what each segment claims above its last hashed block (the hashed blocks
   * running on from its start) is given back. Returns the bytes given back; the segments change in place.
   */
  rewind(segs: Segment[]): number {
    let back = 0;
    for (const s of segs) {
      if (s.received <= 0) continue;
      let at = s.start;
      const top = s.start + s.received;
      for (let b = Math.floor(s.start / this.bs); b < this.count(); b++) {
        const [a, e] = this.span(b);
        if (e > top || a >= top || !this.blocks.has(b)) break;
        at = e;
      }
      const keep = Math.max(0, at - s.start);
      back += s.received - keep;
      s.received = keep;
    }
    return back;
  }

  /** Hashed blocks hashed after `since` (the unclean-session rule, 4.2). */
  newer(since: number): number[] {
    return [...this.blocks].filter(([, r]) => r.a > since).map(([b]) => b);
  }

  /**
   * Every resume's spot check (4.2): the last SPOT_BELOW hashed blocks below each frontier, and
   * SPOT_SEEDED hashed blocks placed by `seed` (the download's id).
   */
  spot(segs: Segment[], seed: string): number[] {
    const out = new Set<number>();
    for (const s of segs) {
      if (s.received <= 0) continue;
      const top = s.start + s.received;
      let n = 0;
      for (let b = Math.floor((top - 1) / this.bs); b >= 0 && n < SPOT_BELOW; b--) {
        const [a] = this.span(b);
        if (a < s.start && b < Math.floor(s.start / this.bs)) break;
        if (this.blocks.has(b)) {
          out.add(b);
          n++;
        }
      }
    }
    const hashed = [...this.blocks.keys()].sort((x, y) => x - y);
    let h = fnv(seed || 'deer');
    for (let i = 0; i < SPOT_SEEDED && hashed.length; i++) {
      out.add(hashed[h % hashed.length]);
      h = Math.imul(h ^ 0x9e3779b9, 0x01000193) >>> 0;
    }
    return [...out];
  }

  /**
   * A seal line (4.1): the coverage, when, and whether the .part was flushed first; written flushed. `at`
   * is when the seal began, before the flush (review of Phase 5): a block hashed while FlushFileBuffers ran
   * may hold bytes written after the flush started, so it must count as newer than the seal (newer()).
   */
  async sealed(cov: Array<[number, number]>, flushed: boolean, at = Date.now()): Promise<void> {
    this.seal = { t: at, cov, f: flushed };
    this.sealedAt = Date.now();
    this.sinceSeal = 0;
    this.journal.add({ cov, t: this.seal.t, ...(flushed ? { f: 1 } : {}) });
    await this.journal.flush(true);
    await this.compact();
  }

  /** A decision line (Start over, Keep partial, Repair), written flushed before it is carried out (5.7). */
  async decision(kind: 'restart' | 'keep' | 'repair'): Promise<void> {
    this.journal.add({ decision: kind, t: Date.now() });
    await this.journal.flush(true);
  }

  /** Repair's durable line before it writes (4.3 step 4), and the one after. */
  async repairing(list: number[]): Promise<void> {
    this.pendingRepair = [...list];
    this.journal.add({ repair: list, t: Date.now() });
    await this.journal.flush(true);
  }

  async repaired(list: number[], hashes: Map<number, BlockRec>): Promise<void> {
    for (const [b, rec] of hashes) {
      this.blocks.set(b, rec);
      this.journal.add({ b, ...rec });
    }
    this.pendingRepair = [];
    this.journal.add({ repaired: list, t: Date.now() });
    await this.journal.flush(true);
  }

  /**
   * The finished file (4.1): its whole-file SHA-256, size and modified time, after the blocks that are no
   * longer whole in it (Keep partial cut it) are dropped; the journal becomes `donePath`.
   */
  async finish(fin: Fin, donePath: string): Promise<void> {
    if (fin.size !== this.total) {
      // Only a block whose bytes are the same in the file of fin.size bytes keeps its hash: its span under
      // the old length must be its span under the new one (review of Phase 5: the spans were read after the
      // length changed, so the blocks past a Keep partial cut stayed and read as damaged).
      for (const b of [...this.blocks.keys()]) {
        const [a, e] = this.span(b);
        if (a >= fin.size || e !== Math.min(fin.size, (b + 1) * this.bs)) this.blocks.delete(b);
      }
      this.header = { ...this.header, total: fin.size };
      this.expect.clear();
      this.fin = fin;
      await this.journal.moveTo(donePath);
      await this.journal.replace(this.live());
      return;
    }
    this.fin = fin;
    this.expect.clear();
    this.journal.add({ fin: fin.sha256, size: fin.size, mtime: fin.mtime, path: fin.path, t: fin.t });
    await this.journal.flush(true);
    await this.journal.moveTo(donePath);
    await this.compact(true);
  }

  /** The file was written again (Repair, Restore original): its new modified time and hash. */
  async refinish(fin: Fin): Promise<void> {
    this.fin = fin;
    this.journal.add({ fin: fin.sha256, size: fin.size, mtime: fin.mtime, path: fin.path, t: fin.t });
    await this.journal.flush(true);
  }

  /** The lines that rebuild this record (compaction). */
  private live(): object[] {
    const lines: object[] = [this.header];
    for (const [b, r] of [...this.blocks].sort((x, y) => x[0] - y[0])) lines.push({ b, ...r });
    if (this.expect.size) {
      for (const [b, r] of this.expect) lines.push({ b, ...r });
      lines.push({ drop: [...this.expect.keys()], why: 'kept' });
    }
    if (this.seal) lines.push({ cov: this.seal.cov, t: this.seal.t, ...(this.seal.f ? { f: 1 } : {}) });
    if (this.pendingRepair.length) lines.push({ repair: this.pendingRepair, t: Date.now() });
    if (this.fin) lines.push({ fin: this.fin.sha256, size: this.fin.size, mtime: this.fin.mtime, path: this.fin.path, t: this.fin.t });
    return lines;
  }

  /** Compacted once the journal grows past twice what it needs (5.7), or when `always`. */
  private async compact(always = false): Promise<void> {
    if (!this.journal.path) return;
    const lines = this.live();
    const need = lines.reduce((n: number, l) => n + JSON.stringify(l).length + 1, 0);
    if (always || this.journal.size > 2 * need) await this.journal.replace(lines);
  }
}

let worker: any = null;
let workerBroken = false;
let asked = 0;
const answers = new Map<number, (data: any) => void>();

/**
 * FlushFileBuffers on `path`, off the main thread (a ChromeWorker with js-ctypes: Phase 5 spike (a)). True
 * once the OS says the file's dirty pages reached the disk; false when it can't be done here (the seal then
 * says so, and the unclean-session rule keeps its margin, 4.2).
 */
export function flushPart(path: string, timeout = 15000): Promise<boolean> {
  return fileOp('flush', path, timeout);
}

/**
 * Mark the .part sparse (FSCTL_SET_SPARSE, off the main thread: workers/flush.js), so writes far into a
 * big file never wait while NTFS fills the gap before them with zeros. False where the volume has no
 * sparse files (FAT, exFAT) or it can't be done: the download goes on as before. Null when the worker did
 * not answer in time: the call still runs when the worker reaches it, so the file may yet be sparse.
 */
export function sparsePart(path: string, timeout = 5000): Promise<boolean | null> {
  return fileAsk('sparse', path, timeout).then((data) => (data === null ? null : !!data.ok));
}

/**
 * Clear the sparse mark of a finished .part (workers/flush.js 'unsparse'): Windows refuses to mount a sparse
 * ISO, VHD or VHDX. False where it can't be done (the file stays as it is).
 */
export function unsparsePart(path: string, timeout = 5000): Promise<boolean> {
  return fileOp('unsparse', path, timeout);
}

/**
 * The bytes of disk `path` holds (GetCompressedFileSizeW, workers/flush.js 'held'): for a sparse .part only
 * the clusters written so far and those past its farthest write, for an ordinary one its size. -1 when it
 * can't be told.
 */
export async function heldBytes(path: string, timeout = 5000): Promise<number> {
  const data = await fileAsk('held', path, timeout);
  return data?.ok && typeof data.size === 'number' ? data.size : -1;
}

function fileOp(op: 'flush' | 'sparse' | 'unsparse', path: string, timeout: number): Promise<boolean> {
  return fileAsk(op, path, timeout).then((data) => !!data?.ok);
}

/** The worker's answer ({id, ok, ms, err, size}), or null when it can't be asked or took longer than `timeout`. */
function fileAsk(op: 'flush' | 'sparse' | 'unsparse' | 'held', path: string, timeout: number): Promise<any> {
  if (workerBroken) return Promise.resolve(null);
  try {
    if (!worker) {
      worker = new (globalThis as any).ChromeWorker('chrome://vitre/content/workers/flush.js');
      worker.onmessage = (e: any) => {
        const done = answers.get(e.data?.id);
        answers.delete(e.data?.id);
        done?.(e.data);
      };
      worker.onerror = () => {
        workerBroken = true;
        for (const done of answers.values()) done(null);
        answers.clear();
      };
    }
  } catch {
    workerBroken = true;
    return Promise.resolve(null);
  }
  const id = ++asked;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      answers.delete(id);
      resolve(null);
    }, timeout);
    answers.set(id, (data) => {
      clearTimeout(timer);
      resolve(data ?? null);
    });
    worker.postMessage({ id, path, op });
  });
}
