// Is an answer still the download's file? spikes/downloader/RESUME-DESIGN.md section 2 (Phase 2): the
// verdicts R1-R7 in order of strength (2.4) and which 64 KiB windows of saved bytes are compared, and
// when (2.5). Until the block hash record exists (Phase 5) the saved bytes themselves are the
// reference: they are read back from the .part through partfile readAt().
//
// Once the block hash record exists (Phase 5, ledger.ts), its recorded head hashes are the reference
// (RESUME-DESIGN.md 1, "How bytes are compared"): the windows are the heads of hashed blocks, and a
// window's SHA-256 is compared with the head hash recorded for that block (Heads), so damage in the
// .part is never taken for another file. Without a record the saved bytes are read back as before.
//
// Two users:
//   - ranged.ts, at the download's own address: judge() on the resume probe (whose answer carries
//     window 0) and on a change mid-download; compareWindows() when only headers said it changed (R6);
//   - renew.ts and the engine's "Use another address…", for a NEW address: proveAddress() asks it once
//     for window 0 with Range and no If-Range, judges that answer with every rule, and asks for the
//     other windows only when R3 or R5 does not settle it (about 256 KiB at most).
// Nothing here changes the download's state.
import {
  AbortedError, AddressRefusedError, ChangedError, DownloadError, HttpStatusError, NotTheFileError, Response, ShortBodyError, backoff, isRetryable, open,
  pageLike, parseContentRange, refusal, retryAfter, sleep, textStart, textual, type Identity,
} from './net';
import { nameFromDisposition } from './naming';
import { readAt } from './partfile';
import type { FileState, Segment } from './ranged';

/**
 * A changed file asks the person when more than this many bytes are saved; with less nothing is at
 * stake and it starts again by itself (RESUME-DESIGN.md 3 G3, the owner's decision 1). R7 uses it too.
 */
export const ASK_ABOVE = 1024 * 1024;
/** R1: an answer under this size where the saved file was over ASK_ABOVE is not the file. */
export const TINY = 64 * 1024;
/** One window (2.5); also the saved bytes a new single-stream answer must start with. */
export const WINDOW = 64 * 1024;
/** SHA-256 of bytes, hex (crypto.subtle: off the main thread; Phase 5 spike (b)). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)), (x) => x.toString(16).padStart(2, '0')).join('');
}
/** At most this many windows per candidate: about 256 KiB (2.5). */
const BUDGET = 4;
const ATTEMPTS = 3;
/** R7's sentence (RESUME-DESIGN.md 2.4): nothing could be compared, so it is handled as changed. */
export const UNSURE = 'Deer can’t confirm it is the same file';

/** What the saved download is, for R1: text (a page, JSON...) or a file; '' when not known. */
export interface Kind {
  kind: '' | 'text' | 'binary';
  /** From the server's own Content-Type; a guess or a sniff makes R1 take only a page or JSON. */
  sure: boolean;
}

/**
 * The block hash record as the proof reads it (RESUME-DESIGN.md 2.4 R4, 4.1; ledger.ts Ledger): the block
 * size, the hashed blocks, and a hashed block's head hash for a window that is exactly its head.
 */
export interface Heads {
  bs: number;
  total: number;
  blocks: Map<number, unknown>;
  head(from: number, to: number): string | undefined;
  /** False: bytes with no recorded head are never read back to compare (a finished file's damaged blocks). */
  local?: boolean;
}

/** Everything a proof reads: the record, whose requests these are, and what is saved. */
export interface ProofCtx {
  state: FileState;
  identity: Identity;
  kind: Kind;
  /** Bytes the segments hold (R1's tiny answer, R2's shorter one, R7). */
  saved: number;
  /** Connections the answers came over (tests). */
  sockets?: Set<string>;
  /** The block hash record, once there is one: windows are compared with its head hashes (Phase 5). */
  heads?: Heads | null;
}

/** What a new address answered, kept for adopting it (renew.ts adopt()) or for Start over. */
export interface Found {
  /** The address asked, where it ended up after redirects, and the hops on the way (the asked one first). */
  url: string;
  finalUrl: string;
  chain: string[];
  etag: string;
  lastModified: string;
  digest: { alg: string; value: string } | null;
  /** The file's length the answer gives; -1 when it does not say. */
  total: number;
  contentType: string;
  /** The address takes ranges (a 206 with a total). */
  ranges: boolean;
  /**
   * The name the answer's Content-Disposition gives ('' when none): a candidate from a click or a page
   * with another size and another name is not the download's (RESUME-DESIGN.md 2.4 R2, Phase 3).
   */
  disposition: string;
}

/**
 * proveAddress()'s verdict on a new address: 'same' (R3, R4 or R5 say so), 'changed' (R2, R3 or R4:
 * another version of the file), 'unknown' (R7: nothing could be compared), 'refused' (R1: a refused
 * status, a page where the file was (`page`), a tiny answer (`total`)), 'unreachable' (no answer, or a
 * server error: `status`).
 */
export type Candidate =
  | { verdict: 'same'; found: Found }
  | { verdict: 'changed'; found: Found; evidence: string }
  | { verdict: 'unknown'; found: Found }
  | { verdict: 'refused'; status: number; page: boolean; total: number }
  | { verdict: 'unreachable'; status: number };

/** The file's length an answer gives: Content-Range's total for a 206, Content-Length for a 200, 0 for a 416 on an empty file. */
export function totalOf(res: Response): number {
  if (res.status === 206) return parseContentRange(res.header('content-range'))?.total ?? -1;
  if (res.status === 416) return parseContentRange(res.header('content-range'))?.total === 0 ? 0 : -1;
  const raw = res.header('content-length');
  return raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : -1;
}

/** "24 MB", "1.2 GB", for the evidence a changed row shows. */
export function sizeText(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** The server's checksum of the whole file, when it volunteers one (Repr-Digest, Digest, Content-MD5). */
export function digestOf(res: Response): { alg: string; value: string } | null {
  const value = res.header('repr-digest') || res.header('digest');
  for (const entry of value.split(',')) {
    const [name, ...rest] = entry.split('=');
    const alg = name?.trim().toLowerCase();
    const encoded = rest.join('=').trim().replace(/^:|:$/g, '');
    if ((alg === 'sha-256' || alg === 'sha256') && encoded) return { alg: 'sha256', value: encoded };
  }
  // Content-MD5 on a 206 describes the one byte, not the file.
  const md5 = res.status === 200 ? res.header('content-md5').trim() : '';
  return md5 ? { alg: 'md5', value: md5 } : null;
}

/**
 * R3's checksum of an answer: only one that certainly describes the whole file (any of a 200's, a
 * 206's Repr-Digest), so a server that puts a range's digest in Digest never reads as another file.
 */
function fileDigest(res: Response): { alg: string; value: string } | null {
  if (res.status === 200) return digestOf(res);
  const repr = res.header('repr-digest');
  return repr ? digestOf(res) : null;
}

/**
 * Another version of the file? A strong or weak ETag decides when both answers have one; otherwise
 * Last-Modified does, so an answer that dropped its ETag is still compared (Phase 1). With etagUnstable
 * (R6) the ETag is no longer compared, only Last-Modified; with dateUnstable too, neither is.
 */
export function validatorsDiffer(s: FileState, etag: string, lastModified: string): boolean {
  if (s.etag && etag && !s.etagUnstable) return etag !== s.etag;
  return !s.dateUnstable && !!s.lastModified && !!lastModified && lastModified !== s.lastModified;
}

/**
 * A change only headers show (R6): the answer's validators ride along, adopted once the saved bytes
 * prove it is the same file (or when nothing saved can be compared). `sent` is the If-Range the
 * request carried: a whole answer to it means that validator did not hold (ranged.ts held()).
 */
export function headerChange(evidence: string, res: Response, sent = ''): ChangedError {
  const err = new ChangedError(evidence, true);
  err.validators = { etag: res.header('etag'), lastModified: res.header('last-modified'), whole: res.status === 200, sent };
  return err;
}

/**
 * What the saved download is, for R1: by its Content-Type (sure when that is the server's own), or by
 * its first saved bytes when that is not known (a sniff: never sure, review of Phase 1).
 */
export async function readKind(s: FileState, partPath: string): Promise<Kind> {
  const type = s.contentType ?? '';
  if (type) return { kind: textual(type) ? 'text' : 'binary', sure: !s.typeGuessed };
  // What reading block 0 back said (Phase 5, 4.1): a sniff, never sure.
  if (s.kind) return { kind: s.kind, sure: false };
  const first = s.segments[0];
  if (!partPath || !first || first.start !== 0 || first.received <= 0) return { kind: '', sure: false };
  const head = await readAt(partPath, 0, Math.min(64, first.received));
  return { kind: head && head.length ? (textStart(head) ? 'text' : 'binary') : '', sure: false };
}

/**
 * R1 by type: an answer of the text kind (page, JSON, XML, text) where a file was saved. When the
 * saved kind is only a guess (Firefox's type, an older record, a sniff), only a page or JSON counts:
 * a text file Firefox or a sniff took for binary must still resume (review of Phase 1).
 */
export function notFile(k: Kind, type: string): boolean {
  return k.kind === 'binary' && (k.sure ? textual(type) : pageLike(type));
}

/**
 * Is this answer at the download's own address still its file? RESUME-DESIGN.md 2.4: R1 (a page where
 * a file was; a tiny answer where a big file was), R2 (another size, or for a download whose length
 * was never known, fewer bytes than are saved), R3 (another checksum of the whole file is another
 * file), then the headers (a 200 to If-Range
 * on a server that ranged before, another ETag or Last-Modified on a 206 that would continue the saved
 * bytes) as a change the saved bytes decide (R6: ranged.ts prove()). A 200 that would replace a single
 * stream needs no header verdict: replaceSingle compares it with the saved bytes. Returns the error to
 * stop with, or null; changes nothing.
 */
export function judge(s: FileState, saved: number, k: Kind, res: Response, resuming: boolean, validator: string): Error | null {
  const type = res.header('content-type');
  if ((res.status === 200 || res.status === 206) && notFile(k, type)) return new NotTheFileError(type);
  if (!resuming) return null;
  const total = totalOf(res);
  // The size the saved file is known to have: its total, or at least the bytes saved when the total was never known.
  const known = s.total >= 0 ? s.total : saved;
  if (total >= 0 && total < TINY && known > ASK_ABOVE) return new NotTheFileError(type, 'small');
  if (total >= 0 && s.total >= 0 && total !== s.total) return new ChangedError(`was ${sizeText(s.total)}, now ${sizeText(total)}`);
  // Review of Phase 1: a length never known (a stream without Content-Length) and an answer shorter
  // than the saved bytes can't be the same file; adopting it would cut the .part.
  if (total >= 0 && total < saved) return new ChangedError(`now ${sizeText(total)}, but ${sizeText(saved)} were already saved`);
  // R3: another checksum of the same algorithm is another file. (An equal one does not skip R6 here:
  // the header check below is what lets the transfer adopt new validators.)
  const theirs = fileDigest(res);
  if (s.digest && theirs && theirs.alg === s.digest.alg && theirs.value !== s.digest.value) return new ChangedError('its checksum is different');
  if (res.status === 200 && validator && s.ranges) return headerChange('the site sent the whole file again', res, validator);
  if (res.status === 206 && validatorsDiffer(s, res.header('etag'), res.header('last-modified'))) return headerChange('the site gives it another version tag', res);
  return null;
}

/** 32 bits of FNV-1a: the seed that places a download's own window. */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * The stretches compared for a new address, a header difference or a spot check (RESUME-DESIGN.md 2.5),
 * each at most WINDOW long and inside saved bytes, in this order, at most BUDGET:
 *   - block 0: the file's first saved bytes;
 *   - the newest bytes below the lowest unfinished frontier: written last, they show a swap in the
 *     middle (the next unfinished frontier's when earlier windows already hold those);
 *   - one window placed by a seed from the download's id, in a stretch no window samples yet;
 *   - the median segment's first bytes, when there are more than 8 segments;
 *   - then, until there are 3 windows over at least min(3, stretches) stretches, the first bytes of a
 *     stretch not sampled yet, or else the first bytes no window covers.
 * A stretch is one segment's saved bytes. Review of Phase 2: a window that overlaps an earlier one is
 * cut to the part not yet covered instead of being left out, and a segment holding less than WINDOW
 * still counts, so a download paused early (a few KiB in each of 8 segments) is never proven by
 * window 0 alone (see enough()). Before the hash record the saved bytes stand in for its head hashes.
 */
export function windows(segments: Segment[], seed: string, heads: Heads | null = null): Array<[number, number]> {
  const segs = segments.filter((x) => x.received > 0).sort((a, b) => a.start - b.start);
  const out: Array<[number, number]> = [];
  if (!segs.length) return out;
  if (heads?.blocks.size) {
    // Review of Phase 5: hashed blocks in too few stretches (one segment ran ahead while every other one
    // holds less than a block) never make a proof (enough()), so a renewed link of the same file read as
    // File changed. The record's windows are used when they make one; otherwise the windows over the saved
    // bytes below, as before Phase 5 (a window that is exactly a hashed block's head is still compared with
    // its recorded hash: compareWindows()). Without local bytes to read (`local` false) only the record's.
    const rec = recordWindows(segs, seed, heads);
    if (heads.local === false || (rec.length && enough(segs, rec))) return rec;
  } else if (heads?.local === false) return out;
  const end = (x: Segment): number => x.start + x.received;
  /** The parts of [from, to) no window covers yet, in order. */
  const gaps = (from: number, to: number): Array<[number, number]> => {
    const parts: Array<[number, number]> = [];
    let at = from;
    for (const [a, b] of [...out].sort((p, q) => p[0] - q[0])) {
      if (b <= at || a >= to) continue;
      if (a > at) parts.push([at, a]);
      at = Math.max(at, b);
    }
    if (at < to) parts.push([at, to]);
    return parts;
  };
  /** [from, to) less what is covered: the free part nearest `to` when `late` (the newest bytes), else nearest `from`. */
  const add = (from: number, to: number, late = false): boolean => {
    if (out.length >= BUDGET) return false;
    const free = gaps(from, to);
    const pick = late ? free[free.length - 1] : free[0];
    if (!pick) return false;
    out.push(pick);
    return true;
  };
  const head = (x: Segment): boolean => add(x.start, x.start + Math.min(x.received, WINDOW));
  const sampled = (x: Segment): boolean => out.some(([a, b]) => a < end(x) && x.start < b);
  head(segs[0]);
  const open = segs.filter((x) => x.end < 0 || end(x) < x.end);
  for (const x of open.length ? open : [segs[segs.length - 1]]) if (add(Math.max(x.start, end(x) - WINDOW), end(x), true)) break;
  const h = fnv(seed || 'deer');
  const fresh = segs.filter((x) => !sampled(x));
  const seg = (fresh.length ? fresh : segs)[h % (fresh.length || segs.length)];
  const at = seg.start + Math.floor((((h >>> 12) % 4096) / 4096) * Math.max(0, seg.received - WINDOW));
  add(at, Math.min(end(seg), at + WINDOW));
  if (segments.length > 8) head(segs[Math.floor(segs.length / 2)]);
  const want = Math.min(3, segs.length);
  while (out.length < BUDGET && (out.length < 3 || segs.filter(sampled).length < want)) {
    const rest = segs.filter((x) => !sampled(x));
    if (rest.length) {
      head(rest[Math.floor(rest.length / 2)]);
      continue;
    }
    const next = segs.map((x) => gaps(x.start, end(x))[0]).find(Boolean);
    if (!next) break;
    out.push([next[0], Math.min(next[1], next[0] + WINDOW)]);
  }
  return out;
}

/**
 * windows() once the block hash record exists (RESUME-DESIGN.md 2.5 with 4.1): the heads of hashed blocks
 * that lie wholly under the saved bytes, in the same order: block 0; the newest hashed block below the
 * lowest unfinished frontier; one placed by the seed; the median segment's first hashed block when there
 * are more than 8 segments; then, until there are 3 windows over min(3, stretches) stretches, the first
 * hashed block of a stretch not sampled yet. Each window is [block start, + min(WINDOW, block length)): the head ledger.ts records.
 */
function recordWindows(segs: Segment[], seed: string, heads: Heads): Array<[number, number]> {
  const bs = heads.bs;
  const end = (x: Segment): number => x.start + x.received;
  const span = (b: number): [number, number] => [b * bs, Math.min(heads.total, b * bs + Math.min(WINDOW, Math.min(bs, heads.total - b * bs)))];
  const hashedIn = (x: Segment): number[] => {
    const out: number[] = [];
    for (let b = Math.ceil(x.start / bs); b * bs < end(x); b++) if (heads.blocks.has(b) && Math.min(heads.total, (b + 1) * bs) <= end(x)) out.push(b);
    return out;
  };
  const picked: number[] = [];
  const add = (b: number | undefined): boolean => {
    if (b === undefined || picked.length >= BUDGET || picked.includes(b)) return false;
    picked.push(b);
    return true;
  };
  const sampled = (x: Segment): boolean => picked.some((b) => b * bs >= x.start && b * bs < end(x));
  if (heads.blocks.has(0)) add(0);
  const open = segs.filter((x) => x.end < 0 || end(x) < x.end);
  for (const x of open.length ? open : [segs[segs.length - 1]]) {
    const inX = hashedIn(x);
    if (add(inX[inX.length - 1])) break;
  }
  const all = segs.flatMap(hashedIn);
  if (all.length) add(all[fnv(seed || 'deer') % all.length]);
  if (segs.length > 8) add(hashedIn(segs[Math.floor(segs.length / 2)])[0]);
  const want = Math.min(3, segs.filter((x) => hashedIn(x).length).length);
  while (picked.length < BUDGET && (picked.length < 3 || segs.filter(sampled).length < want)) {
    const rest = segs.filter((x) => !sampled(x) && hashedIn(x).length);
    const next = rest.length ? hashedIn(rest[Math.floor(rest.length / 2)])[0] : all.find((b) => !picked.includes(b));
    if (!add(next)) break;
  }
  return picked.map(span);
}

/**
 * Do these windows, all compared and equal, make a proof (review of Phase 2)? Every saved byte, or at
 * least 3 windows over at least min(3, stretches) stretches (RESUME-DESIGN.md 2.5: 3 or 4 windows for a
 * new address or a header difference). One window over a download paused early let another file of
 * the same size through.
 */
export function enough(segments: Segment[], wins: Array<[number, number]>): boolean {
  const segs = segments.filter((x) => x.received > 0);
  const saved = segs.reduce((n, x) => n + x.received, 0);
  const covered = wins.reduce((n, [a, b]) => n + Math.max(0, b - a), 0);
  if (saved > 0 && covered >= saved) return true;
  const hit = segs.filter((x) => wins.some(([a, b]) => a < x.start + x.received && x.start < b)).length;
  return wins.length >= 3 && hit >= Math.min(3, segs.length);
}

export function differs(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

/**
 * The bytes [from, to) at `url` in memory (Range, with If-Range when `validator`): a block Repair or the
 * server compare fetches again (RESUME-DESIGN.md 4.3). A 200 to If-Range is the file changing
 * (ChangedError); a 200 to a plain Range, a range that starts elsewhere or a short body can't be used
 * (DownloadError). A refused address or a page throws as the probe would. Lane 0, the probe's retries.
 */
export async function fetchRange(c: ProofCtx, url: string, from: number, to: number, signal: AbortSignal, validator = ''): Promise<Uint8Array> {
  for (let attempt = 1; ; attempt++) {
    try {
      const extra: Record<string, string> = { Range: `bytes=${from}-${to - 1}` };
      if (validator) extra['If-Range'] = validator;
      const res = await open(url, c.identity, extra, signal, { lane: 0 });
      c.sockets?.add(res.socket);
      if (res.status !== 200 && res.status !== 206) throw await refusal(res, retryAfter(res));
      const type = res.header('content-type');
      if (notFile(c.kind, type)) {
        res.destroy();
        throw new NotTheFileError(type);
      }
      if (res.status === 200) {
        res.destroy();
        if (validator) throw new ChangedError('the site sent the whole file again');
        throw new DownloadError('The site no longer sends parts of the file.');
      }
      const cr = parseContentRange(res.header('content-range'));
      if (!cr || cr.start !== from) {
        res.destroy();
        throw new DownloadError('The server sent a different part of the file than was asked for.');
      }
      if (cr.total >= 0 && c.state.total >= 0 && cr.total !== c.state.total) {
        res.destroy();
        throw new ChangedError(`was ${sizeText(c.state.total)}, now ${sizeText(cr.total)}`);
      }
      const bytes = await res.bytes({ max: to - from });
      if (bytes.length < to - from) throw new ShortBodyError();
      return bytes;
    } catch (err) {
      if (signal.aborted) throw new AbortedError();
      if (attempt >= ATTEMPTS || !isRetryable(err)) throw err;
      await sleep(backoff(attempt, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
    }
  }
}

/**
 * One window at `url` with Range and no If-Range: its bytes and the file's total from a 206; a 200
 * unread (the address no longer takes ranges); null when the answer can't be compared (416, another
 * range). A refused address or a page throws, as the probe would. Lane 0, the probe's retries.
 */
export async function fetchWindow(c: ProofCtx, url: string, from: number, to: number, signal: AbortSignal, attempts = ATTEMPTS): Promise<Response | { res: Response; bytes: Uint8Array; total: number } | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await open(url, c.identity, { Range: `bytes=${from}-${to - 1}` }, signal, { lane: 0 });
      c.sockets?.add(res.socket);
      if (res.status !== 200 && res.status !== 206) {
        if (res.status === 416) {
          res.destroy();
          return null;
        }
        throw await refusal(res, retryAfter(res));
      }
      const type = res.header('content-type');
      if (notFile(c.kind, type)) {
        res.destroy();
        throw new NotTheFileError(type);
      }
      if (res.status === 200) return res;
      const cr = parseContentRange(res.header('content-range'));
      if (!cr || cr.start !== from) {
        res.destroy();
        return null;
      }
      const bytes = await res.head(to - from);
      if (bytes.length < to - from) throw new ShortBodyError();
      return { res, bytes, total: cr.total };
    } catch (err) {
      if (signal.aborted) throw new AbortedError();
      if (attempt >= attempts || !isRetryable(err)) throw err;
      await sleep(backoff(attempt, err instanceof HttpStatusError ? err.retryAfter : null) * 1000, signal);
    }
  }
}

/** compareWindows()'s verdict; 'compared' counts the windows that were equal. */
export type Compared =
  | { verdict: 'same'; res: Response | null; compared: number }
  | { verdict: 'changed'; err: ChangedError }
  | { verdict: 'whole'; res: Response }
  | { verdict: 'unknown'; compared: number };

/**
 * R4 (RESUME-DESIGN.md 2.4): the windows asked for at `url`, each against the saved bytes, or against the
 * recorded head hash of its block once the record exists (Phase 5; c.heads). 'same' when
 * all are equal at the same `total` (-1: not known), with the last answer; 'changed' when one differs
 * or the total does; 'whole' for a 200 (the address no longer takes ranges: handed back unread);
 * 'unknown' when one can't be compared. A refused address or a page throws (fetchWindow()). `attempts`:
 * how many times a window is asked before its error is thrown (the completion check asks once).
 */
export async function compareWindows(c: ProofCtx, url: string, wins: Array<[number, number]>, partPath: string, signal: AbortSignal, total: number, attempts = ATTEMPTS): Promise<Compared> {
  let last: Response | null = null;
  let compared = 0;
  for (const [from, to] of wins) {
    const got = await fetchWindow(c, url, from, to, signal, attempts);
    if (!got) return { verdict: 'unknown', compared };
    if (got instanceof Response) return { verdict: 'whole', res: got };
    if (got.total >= 0 && total >= 0 && got.total !== total) return { verdict: 'changed', err: new ChangedError(`was ${sizeText(total)}, now ${sizeText(got.total)}`) };
    const recorded = c.heads?.head(from, to);
    if (recorded) {
      if ((await sha256Hex(got.bytes)) !== recorded) return { verdict: 'changed', err: new ChangedError(from === 0 ? 'its first bytes are different' : `its bytes at ${sizeText(from)} are different`) };
      compared++;
      last = got.res;
      continue;
    }
    const ours = await readAt(partPath, from, to - from);
    if (!ours || ours.length !== got.bytes.length) return { verdict: 'unknown', compared };
    if (differs(got.bytes, ours)) return { verdict: 'changed', err: new ChangedError(from === 0 ? 'its first bytes are different' : `its bytes at ${sizeText(from)} are different`) };
    compared++;
    last = got.res;
  }
  return { verdict: 'same', res: last, compared };
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host.toLowerCase() === new URL(b).host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Is a NEW address the download's file (RESUME-DESIGN.md 2.4, 2.5)? It is asked once for window 0
 * (Range: bytes=0-65535, no If-Range; Necko follows its redirects), and that answer is judged with
 * every rule in order: R1 (a refused status, a page, a tiny answer), R2 (another size, fewer bytes than
 * are saved), R3 (the server's checksum), window 0 against the saved bytes (a 200 is the whole file
 * from its start, so it carries window 0 too), R5 (the same strong ETag on the same host, window 0
 * equal), R7 (no ranges and nothing else to go on), then R4: the other windows at the new final
 * address. `segments` are the bytes certainly in the .part (ranged.ts provable() while a run writes).
 * Changes nothing; the caller adopts a 'same' address (renew.ts adopt()).
 */
export async function proveAddress(c: ProofCtx, partPath: string, segments: Segment[], seed: string, url: string, signal: AbortSignal): Promise<Candidate> {
  const s = c.state;
  let res: Response | null = null;
  for (let attempt = 1; !res; attempt++) {
    try {
      res = await open(url, c.identity, { Range: `bytes=0-${WINDOW - 1}` }, signal, { lane: 0 });
    } catch (err) {
      if (signal.aborted) throw new AbortedError();
      if (attempt >= ATTEMPTS || !isRetryable(err)) return { verdict: 'unreachable', status: 0 };
      await sleep(1000, signal);
    }
  }
  c.sockets?.add(res.socket);
  if (res.status !== 200 && res.status !== 206) {
    const err = await refusal(res, retryAfter(res));
    return err instanceof AddressRefusedError ? { verdict: 'refused', status: err.status, page: false, total: -1 } : { verdict: 'unreachable', status: err.status };
  }
  const answer = res;
  const type = answer.header('content-type');
  const total = totalOf(answer);
  const found: Found = {
    url,
    finalUrl: answer.url,
    chain: answer.chain,
    etag: answer.header('etag'),
    lastModified: answer.header('last-modified'),
    digest: digestOf(answer),
    total,
    contentType: type,
    ranges: answer.status === 206 && total > 0,
    disposition: nameFromDisposition(answer.header('content-disposition')),
  };
  const stop = <T>(v: T): T => {
    answer.destroy();
    return v;
  };
  // R1 and R2.
  if (notFile(c.kind, type)) return stop({ verdict: 'refused', status: 0, page: true, total });
  const known = s.total >= 0 ? s.total : c.saved;
  if (total >= 0 && total < TINY && known > ASK_ABOVE) return stop({ verdict: 'refused', status: 0, page: false, total });
  if (total >= 0 && s.total >= 0 && total !== s.total) return stop({ verdict: 'changed', found, evidence: `was ${sizeText(s.total)}, now ${sizeText(total)}` });
  if (total >= 0 && total < c.saved) return stop({ verdict: 'changed', found, evidence: `now ${sizeText(total)}, but ${sizeText(c.saved)} were already saved` });
  // R3.
  let sure = false;
  const theirs = fileDigest(answer);
  if (s.digest && theirs && theirs.alg === s.digest.alg) {
    if (theirs.value !== s.digest.value) return stop({ verdict: 'changed', found, evidence: 'its checksum is different' });
    sure = total >= 0 && total === s.total;
  }
  // Window 0 rides on this answer: a 206 from byte 0, or a 200 (the whole file from its start).
  const first = segments.find((x) => x.start === 0 && x.received > 0);
  const cr = answer.status === 206 ? parseContentRange(answer.header('content-range')) : null;
  let firstSame = false;
  if (first && partPath && (answer.status === 200 || cr?.start === 0)) {
    const n = Math.min(WINDOW, first.received);
    const bytes = await answer.head(n);
    // With the record (Phase 5), block 0's head hash is the reference; when the saved bytes may not be
    // read back instead (Repair proves with the good blocks only, `local` false) nothing is compared here.
    const recorded = c.heads?.head(0, n);
    const ours = recorded || c.heads?.local === false ? null : await readAt(partPath, 0, n);
    if (bytes.length >= n && recorded) {
      if ((await sha256Hex(bytes)) !== recorded) {
        if (textStart(bytes) && c.kind.kind === 'binary') return { verdict: 'refused', status: 0, page: true, total };
        return { verdict: 'changed', found, evidence: 'its first bytes are different' };
      }
      firstSame = true;
    } else if (bytes.length >= n && ours && ours.length === n) {
      // A page where the saved bytes are not one (R1): an expiry page that slipped past its type.
      if (textStart(bytes) && !textStart(ours)) return { verdict: 'refused', status: 0, page: true, total };
      if (differs(bytes, ours)) return { verdict: 'changed', found, evidence: 'its first bytes are different' };
      firstSame = true;
    }
  } else answer.destroy();
  // R5: the same strong ETag on the same host settles it once window 0 is equal; R3's same checksum at the same size too.
  const strong = !!s.etag && !s.etag.startsWith('W/') && found.etag === s.etag;
  if (sure || (strong && firstSame && sameHost(found.finalUrl, s.finalUrl))) return { verdict: 'same', found };
  // R7: no ranges, so no windows; only an equal strong ETag (another host) with window 0 still says so.
  if (!found.ranges) return strong && firstSame ? { verdict: 'same', found } : { verdict: 'unknown', found };
  // R4: the other windows at the new final address; with window 0 they must make a proof (enough()).
  const planned = windows(segments, seed, c.heads);
  const wins = planned.filter(([a]) => !(firstSame && a === 0));
  let r: Compared;
  try {
    r = await compareWindows(c, found.finalUrl, wins, partPath, signal, s.total >= 0 ? s.total : total);
  } catch (err) {
    if (signal.aborted) throw new AbortedError();
    if (err instanceof AddressRefusedError) return { verdict: 'refused', status: err.status, page: false, total: -1 };
    if (err instanceof NotTheFileError) return { verdict: 'refused', status: 0, page: true, total };
    return { verdict: 'unreachable', status: err instanceof HttpStatusError ? err.status : 0 };
  }
  if (r.verdict === 'changed') return { verdict: 'changed', found, evidence: r.err.evidence };
  if (r.verdict === 'whole') {
    r.res.destroy();
    return strong && firstSame ? { verdict: 'same', found } : { verdict: 'unknown', found };
  }
  // Review of Phase 2: never on window 0 alone while other saved bytes were not compared.
  if (r.verdict === 'same' && r.compared === wins.length && enough(segments, planned)) return { verdict: 'same', found };
  return { verdict: 'unknown', found };
}
