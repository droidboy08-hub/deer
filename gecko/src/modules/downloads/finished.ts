// Finished files: Check file, Repair and Restore original (spikes/downloader/RESUME-DESIGN.md 4.2, 4.3
// and 6; Phase 5). Nothing here runs by itself except the checks the engine asks for (at completion and
// after an unclean exit, 4.2): there are no periodic scans.
//
//   - checkFinished(): a file modified after it finished (later than the modified time recorded at its
//     completion, Rec.final) was changed by the person or a program: Changed after download, never damage
//     (4.2, 4.4). Otherwise, with the block hash record (<id>.done.jsonl), every block is hashed again and
//     compared with it: the ones that differ are Damaged. With no record (an older file) a stored SHA-256
//     is compared; with none, the file is compared with the site (siteCompare()).
//   - repairFinished() (4.3): the proof first, with only the good blocks as windows (proof.ts proveAddress()
//     with their head hashes; a refused or expired address goes through the original address first,
//     G1); then each bad block is fetched into memory (at most one block), checked against the record
//     BEFORE it is written, a durable repair line is written to the journal, and the block is written in
//     place (partfile.ts writeAt(): a Writer at its offset). A block the site gives otherwise means the
//     file on the site changed: Repair refuses and nothing more is written. With no record, the site's
//     bytes are the reference once 2 of 3 windows matched; under 5% of the blocks different counts as
//     local damage, more as another file. Before each block is written the file must still be as Repair
//     found it (review of Phase 5): an edit made meanwhile is never written over ('edited').
//   - restoreFinished() (Restore original, only when chosen): every block that no longer matches the
//     record, fetched, checked and kept aside before the file is touched (review of Phase 5: a refused
//     site left the person's file cut).
//   - mediaCheck(): ffmpeg reads the file through (`-v error -i f -map 0 -c copy -f null -`, nothing is
//     written) and its complaints are kept (ffmpeg.ts runFfmpeg() returns its stderr tail).
import { runFfmpeg } from './ffmpeg';
import { HEAD, MTIME_SLACK, blockSize, hashBlock, hashBytes, type BlockRec, type Ledger } from './ledger';
import { AbortedError, ChangedError, DownloadError, NotTheFileError, Response } from './net';
import { readAt, setSize, writeAt } from './partfile';
import { differs, fetchRange, fetchWindow, proveAddress, sizeText, type Heads, type ProofCtx } from './proof';

/** Under this share of blocks different, a file with no record has local damage; above it, it is another file (4.3). */
const LOCAL_SHARE = 0.05;

export interface CheckResult {
  missing: boolean;
  /** Modified after it finished: Changed after download (never damage). `changedAt`: its modified time. */
  edited: boolean;
  changedAt: number;
  /** Damaged blocks (block size `bs`). */
  bad: number[];
  bs: number;
  badBytes: number;
  /** A stored checksum did not match and no record says where: Repair compares it with the site. */
  unlocated: boolean;
  /** What was compared: the record, a stored checksum, the site, or nothing could be. */
  how: 'record' | 'digest' | 'site' | 'none';
  /** No record: the site's file differs in more than LOCAL_SHARE of the blocks (another file). */
  changed: boolean;
}

/** The size and modified time of a file, or null when it is gone. */
export async function statOf(path: string): Promise<{ size: number; mtime: number } | null> {
  try {
    const st = await IOUtils.stat(path);
    return { size: Number(st.size), mtime: Number(st.lastModified) };
  } catch {
    return null;
  }
}

/** Was the file modified after it finished (4.2: Changed after download)? `final`: what was recorded then. */
export function editedSince(mtime: number, final: { mtime: number } | null | undefined, finishedAt: number): boolean {
  const ref = final?.mtime || finishedAt;
  return !!ref && mtime > ref + MTIME_SLACK;
}

/**
 * Check file (4.2): see the header. `site` compares a file with no record and no stored checksum with
 * the site (it may ask the network); null skips that and reports 'none'. `repairing`: a repair of Deer's
 * own was cut short (a quit, a crash: its durable repair line, 4.3 step 4): the modified time its writes
 * left says nothing about the person, so the record decides (review of Phase 5: that repair read as
 * Changed after download and its blocks still damaged were never reported).
 */
export async function checkFinished(o: {
  path: string;
  ledger: Ledger | null;
  sha256: string;
  final: { size: number; mtime: number } | null | undefined;
  finishedAt: number;
  site: ((total: number) => Promise<{ bad: number[]; bs: number; changed: boolean } | null>) | null;
  repairing?: boolean;
}): Promise<CheckResult> {
  const out: CheckResult = { missing: false, edited: false, changedAt: 0, bad: [], bs: o.ledger?.bs ?? 0, badBytes: 0, unlocated: false, how: 'none', changed: false };
  const st = await statOf(o.path);
  if (!st) return { ...out, missing: true };
  const l = o.ledger;
  const own = !!o.repairing && !!l?.blocks.size;
  if (!own && editedSince(st.mtime, o.final, o.finishedAt)) return { ...out, edited: true, changedAt: st.mtime };
  if (l && l.blocks.size) {
    out.how = 'record';
    // A file shorter or longer than its record: the blocks past its end are damaged too. A repair a crash
    // cut short (its pending blocks) needs nothing more: each of its blocks is hashed again with the rest.
    const list = [...l.blocks.keys()];
    const bad = await l.verify(o.path, list);
    if (st.size !== l.total) for (let b = 0; b < l.count(); b++) if (l.span(b)[1] > st.size && !bad.includes(b)) bad.push(b);
    out.bad = bad.sort((x, y) => x - y);
    out.badBytes = out.bad.reduce((n, b) => n + (l.span(b)[1] - l.span(b)[0]), 0);
    // Bytes no hashed block covers (a block whose hashing failed, the cut end Keep partial left): the
    // whole-file SHA-256 speaks for them.
    if (!bad.length && l.blocks.size < l.count() && o.sha256) out.unlocated = (await IOUtils.computeHexDigest(o.path, 'sha256').catch(() => '')) !== o.sha256;
    return out;
  }
  if (o.sha256) {
    out.how = 'digest';
    const hex = await IOUtils.computeHexDigest(o.path, 'sha256').catch(() => '');
    out.unlocated = hex !== o.sha256;
    return out;
  }
  if (!o.site) return out;
  const r = await o.site(st.size);
  if (!r) return out;
  out.how = 'site';
  out.bs = r.bs;
  out.changed = r.changed;
  out.bad = r.changed ? [] : r.bad;
  out.badBytes = out.bad.reduce((n, b) => n + Math.min(r.bs, st.size - b * r.bs), 0);
  return out;
}

/**
 * A file with no record compared with the site (4.3, older finished files): 3 windows (the heads of the
 * first, middle and last blocks of size blockSize(total)) against the local bytes; once 2 of the 3 are
 * equal (every window, for a file of fewer than 3 blocks), every block is fetched into memory and
 * compared. Under LOCAL_SHARE of the blocks different is local damage (those blocks), as many or more is
 * another file. Null when the site can't be compared (refused, unreachable, no ranges, too few windows
 * compared). Review of Phase 5: one equal window no longer let the compare go on, and a file of under 20
 * blocks with one block different no longer counts as local damage (the 1-block floor is gone): it is
 * another file, and the person is asked.
 */
export async function siteCompare(c: ProofCtx, url: string, path: string, total: number, signal: AbortSignal): Promise<{ bad: number[]; bs: number; changed: boolean } | null> {
  const bs = blockSize(total);
  const count = Math.ceil(total / bs);
  if (!count) return null;
  const picks = [...new Set([0, Math.floor(count / 2), count - 1])];
  const need = Math.min(2, picks.length === 3 ? 2 : picks.length);
  let equal = 0;
  let different = 0;
  for (const b of picks) {
    const a = b * bs;
    const e = Math.min(total, a + Math.min(HEAD, bs));
    try {
      const got = await fetchWindow(c, url, a, e, signal);
      if (!got) continue;
      if (got instanceof Response) {
        got.destroy();
        return null;
      }
      got.res.destroy();
      if (got.total >= 0 && got.total !== total) return { bad: [], bs, changed: true };
      const ours = await readAt(path, a, e - a);
      if (!ours || ours.length !== got.bytes.length) continue;
      if (differs(ours, got.bytes)) different++;
      else equal++;
    } catch (err) {
      if (signal.aborted) throw new AbortedError();
      return null;
    }
  }
  if (equal < need) return different ? { bad: [], bs, changed: true } : null;
  const bad: number[] = [];
  for (let b = 0; b < count; b++) {
    const a = b * bs;
    const e = Math.min(total, a + bs);
    let theirs: Uint8Array;
    try {
      theirs = await fetchRange(c, url, a, e, signal);
    } catch (err) {
      if (signal.aborted) throw new AbortedError();
      return null;
    }
    const ours = await readAt(path, a, e - a);
    if (!ours || differs(ours, theirs)) bad.push(b);
    if (bad.length >= count * LOCAL_SHARE) return { bad: [], bs, changed: true };
  }
  return { bad, bs, changed: false };
}

/** Only the good blocks' head hashes, and never the local bytes (4.3 step 1: Repair proves with the good blocks). */
export function goodHeads(l: Ledger, bad: number[]): Heads {
  const skip = new Set(bad);
  const blocks = new Map([...l.blocks].filter(([b]) => !skip.has(b)));
  return {
    bs: l.bs,
    total: l.total,
    blocks,
    local: false,
    head: (from, to) => (skip.has(Math.floor(from / l.bs)) ? undefined : l.head(from, to)),
  };
}

/**
 * What Repair or Restore original came to. 'edited': the file was modified by someone else (the person,
 * another program, another file saved under the name) since the repair began, so nothing more is written
 * (review of Phase 5); `fixed` are the blocks written before that was seen.
 */
export type RepairOutcome =
  | { kind: 'repaired'; fixed: number[]; url: string }
  | { kind: 'changed'; evidence: string }
  | { kind: 'expired'; status: number }
  | { kind: 'unreachable'; status: number }
  | { kind: 'edited'; fixed: number[] };

type Stamp = { size: number; mtime: number };

/** The file is still exactly as `was` says (size and modified time). */
async function unchanged(path: string, was: Stamp | null): Promise<boolean> {
  const now = await statOf(path);
  return !!now && !!was && now.size === was.size && now.mtime === was.mtime;
}

/**
 * Step 1 of 4.3: the site still has the file the record describes, proven with `heads` (never the local
 * bytes); a refused address or a page goes through the original address first (G1, `renew`). The address
 * to fetch from, or why not.
 */
async function proveSite(o: { ctx: ProofCtx; path: string; url: string; seed: string; total: number; signal: AbortSignal; renew: () => Promise<string | null> }, heads: Heads): Promise<string | RepairOutcome> {
  const whole = [{ start: 0, end: o.total, received: o.total }];
  const prove = (at: string) => proveAddress({ ...o.ctx, heads }, o.path, whole, o.seed, at, o.signal);
  let c = await prove(o.url);
  if (c.verdict === 'refused') {
    const next = await o.renew();
    if (!next) return { kind: 'expired', status: c.status };
    c = await prove(next);
  }
  if (c.verdict === 'refused') return { kind: 'expired', status: c.status };
  if (c.verdict === 'unreachable') return { kind: 'unreachable', status: c.status };
  if (c.verdict === 'changed') return { kind: 'changed', evidence: c.evidence };
  if (c.verdict === 'unknown') return { kind: 'changed', evidence: 'Deer can’t confirm the site still has the same file' };
  return c.found.finalUrl;
}

/**
 * Steps 2 and 3 of 4.3: block b ([a, e)) fetched into memory and checked against its recorded hash before
 * anything is written: its bytes and hash, or why not (another file at the site: 'changed').
 */
async function fetchChecked(ctx: ProofCtx, url: string, l: Ledger | null, b: number, a: number, e: number, signal: AbortSignal): Promise<{ bytes: Uint8Array; rec: BlockRec } | RepairOutcome> {
  let bytes: Uint8Array;
  try {
    bytes = await fetchRange(ctx, url, a, e, signal);
  } catch (err) {
    if (signal.aborted) throw new AbortedError();
    if (err instanceof ChangedError) return { kind: 'changed', evidence: err.evidence };
    if (err instanceof NotTheFileError) return { kind: 'expired', status: 0 };
    const status = (err as { status?: number })?.status ?? 0;
    if (status === 401 || status === 403 || status === 404 || status === 410 || status === 451) return { kind: 'expired', status };
    return { kind: 'unreachable', status };
  }
  const got = await hashBytes(bytes);
  const want = l?.blocks.get(b)?.h;
  if (want && got.h !== want) return { kind: 'changed', evidence: a === 0 ? 'its first bytes are different' : `its bytes at ${sizeText(a)} are different` };
  return { bytes, rec: { h: got.h, w: got.w, a: Date.now() } };
}

/** The written blocks read back once more before the repair counts as done. */
async function readBack(path: string, l: Ledger, hashes: Map<number, BlockRec>): Promise<void> {
  for (const [b, rec] of hashes) {
    const [a, e] = l.span(b);
    const back = await hashBlock(path, a, e - a);
    if (!back || back.h !== rec.h) throw new DownloadError('Deer couldn’t write the repaired parts to the disk.');
  }
}

/**
 * Repair (4.3): see the header. `renew` looks for the file at its original address (G1) when the address
 * refuses or answers with a page: a new final address proven to be the same file, or null. `wrote` is
 * told each block written. Review of Phase 5: the file must still be as Repair found it (size and
 * modified time) before each block is written, so an edit made meanwhile is never written over.
 */
export async function repairFinished(o: {
  ctx: ProofCtx;
  path: string;
  url: string;
  seed: string;
  ledger: Ledger | null;
  bad: number[];
  bs: number;
  total: number;
  signal: AbortSignal;
  renew: () => Promise<string | null>;
  wrote?: (b: number) => void;
}): Promise<RepairOutcome> {
  const { ctx, path, signal } = o;
  const l = o.ledger;
  let expect = await statOf(path);
  let url = o.url;
  // 1. The proof, with only the good blocks as windows (no record: siteCompare() already compared 2 of 3).
  if (l) {
    const proven = await proveSite(o, goodHeads(l, o.bad));
    if (typeof proven !== 'string') return proven;
    url = proven;
  }
  const fixed: number[] = [];
  const hashes = new Map<number, BlockRec>();
  let announced = false;
  const close = async (): Promise<void> => {
    if (l && announced) await l.repaired(fixed, hashes);
  };
  for (const b of [...new Set(o.bad)].sort((x, y) => x - y)) {
    const a = b * o.bs;
    const e = Math.min(o.total, a + o.bs);
    // 2, 3. Into memory, at most one block, checked against the record BEFORE it is written.
    const got = await fetchChecked(ctx, url, l, b, a, e, signal);
    if (!('bytes' in got)) {
      await close();
      return got;
    }
    // 4. A durable repair line before the first write: a crash in the middle checks these blocks again.
    if (l && !announced) {
      await l.repairing(o.bad);
      announced = true;
    }
    // Never over a file someone changed since Repair began (the person's edit, another file of that name).
    if (!(await unchanged(path, expect))) {
      await close();
      return { kind: 'edited', fixed };
    }
    // 5. In place.
    await writeAt(path, a, got.bytes);
    expect = await statOf(path);
    fixed.push(b);
    hashes.set(b, got.rec);
    o.wrote?.(b);
  }
  if (l) {
    await readBack(path, l, hashes);
    await l.repaired(fixed, hashes);
  }
  return { kind: 'repaired', fixed, url };
}

/**
 * Restore original (4.4: only when the person chooses it): the file put back to what its record says,
 * whatever was done to it (a tag editor that grew it, an edit anywhere). Review of Phase 5: nothing of
 * the person's file changes until everything needed is in hand, so a refused, changed or unreachable
 * site leaves it exactly as it was:
 *   - the blocks that no longer match the record are found by reading the file only (a block past its
 *     end does not match); `planned` is told which;
 *   - the site is proven with the record's head hashes (never the edited bytes: 'local' false);
 *   - each of those blocks is fetched, checked against the record and kept aside in `patch` (the
 *     profile, never next to the person's files);
 *   - only then, the file still as it was found (the person may have changed it again meanwhile:
 *     'edited'), a durable repair line, the file cut or grown to the record's length, the blocks written
 *     from `patch` and read back. `patch` is removed in every case.
 */
export async function restoreFinished(o: {
  ctx: ProofCtx;
  path: string;
  url: string;
  seed: string;
  ledger: Ledger;
  patch: string;
  signal: AbortSignal;
  renew: () => Promise<string | null>;
  planned?: (bad: number[]) => Promise<void> | void;
  wrote?: (b: number) => void;
}): Promise<RepairOutcome> {
  const { ctx, path, signal } = o;
  const l = o.ledger;
  const before = await statOf(path);
  if (!before) return { kind: 'edited', fixed: [] };
  const bad = await l.verify(path, [...l.blocks.keys()]);
  await o.planned?.(bad);
  let url = o.url;
  if (bad.length) {
    const heads: Heads = { bs: l.bs, total: l.total, blocks: l.blocks, local: false, head: (from, to) => l.head(from, to) };
    const proven = await proveSite({ ...o, total: l.total }, heads);
    if (typeof proven !== 'string') return proven;
    url = proven;
  }
  await IOUtils.remove(o.patch, { ignoreAbsent: true }).catch(() => undefined);
  try {
    const hashes = new Map<number, BlockRec>();
    const kept = new Map<number, [number, number]>();
    let at = 0;
    for (const b of bad) {
      const [a, e] = l.span(b);
      const got = await fetchChecked(ctx, url, l, b, a, e, signal);
      if (!('bytes' in got)) return got;
      await IOUtils.write(o.patch, got.bytes, { mode: 'appendOrCreate' });
      kept.set(b, [at, got.bytes.length]);
      at += got.bytes.length;
      hashes.set(b, got.rec);
    }
    if (signal.aborted) throw new AbortedError();
    if (!(await unchanged(path, before))) return { kind: 'edited', fixed: [] };
    if (bad.length) await l.repairing(bad);
    if (before.size !== l.total) setSize(path, l.total);
    for (const [b, [off, n]] of kept) {
      const bytes: Uint8Array = await IOUtils.read(o.patch, { offset: off, maxBytes: n });
      if (bytes.length !== n) throw new DownloadError('Deer couldn’t read back the parts it fetched to restore the file.');
      await writeAt(path, b * l.bs, bytes);
      o.wrote?.(b);
    }
    await readBack(path, l, hashes);
    if (bad.length) await l.repaired(bad, hashes);
    return { kind: 'repaired', fixed: bad, url };
  } finally {
    await IOUtils.remove(o.patch, { ignoreAbsent: true }).catch(() => undefined);
  }
}

/** ffmpeg reads the file through and says what it found wrong ('' when nothing); null when it could not run. */
export async function mediaCheck(bin: string, path: string, signal: AbortSignal | null = null): Promise<string | null> {
  try {
    return (await runFfmpeg(bin, ['-v', 'error', '-i', path, '-map', '0', '-c', 'copy', '-f', 'null', '-'], signal)).trim();
  } catch (err) {
    if (err instanceof AbortedError) throw err;
    const text = String((err as Error)?.message ?? err);
    return text.replace(/^ffmpeg exited with -?\d+:\s*/, '').trim() || text;
  }
}

/** The 8 stretches of the connection bar for a Damaged file: the damaged stretches empty (RESUME-DESIGN.md 6). */
export function damagedFills(total: number, bad: number[], bs: number, n = 8): number[] {
  if (total <= 0 || !bs) return [];
  const block = total / n;
  const out = new Array<number>(n).fill(1);
  for (const b of bad) {
    let a = b * bs;
    const e = Math.min(total, a + bs);
    while (a < e) {
      const i = Math.min(n - 1, Math.floor(a / block));
      const edge = Math.min(e, (i + 1) * block);
      if (edge <= a) break;
      out[i] -= (edge - a) / block;
      a = edge;
    }
  }
  return out.map((v) => Math.max(0, Math.min(1, v)));
}
