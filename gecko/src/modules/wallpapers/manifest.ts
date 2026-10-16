// Pure helpers of Deer wallpapers (VitreWallpapers.sys.ts): the checks wallpapers.json and every
// downloaded file must pass. No Gecko globals here, so the rules can be read on their own.
// The format is the one droidboy08-hub/deer-wallpapers' add.py writes (its --check runs the same
// file and size rules); Deer trusts none of it: an entry that breaks a rule is skipped, never the list.

/** One wallpaper as Deer keeps it once checked (added and source are not used). */
export interface WallpaperEntry {
  id: string;
  title: string;
  /** Both '' for the collection owner's own photos (add.py without --author / --license): no credit. */
  author: string;
  license: string;
  /** Mean colour, '#rrggbb' (lower case): the tile's face until its thumbnail is in. */
  color: string;
  width: number;
  height: number;
  /** full/<id>.jpg */
  bytes: number;
  sha256: string;
  /** thumbs/<id>.jpg */
  thumbBytes: number;
  thumbSha256: string;
}

export const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const MAX_MANIFEST = 1024 * 1024;
export const MAX_ENTRIES = 500;
export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_THUMB_BYTES = 512 * 1024;
/** A picture's sides (add.py makes at most 3840) and area; a thumbnail's sides (add.py: 480 wide). */
export const MAX_SIDE = 8192;
export const MIN_SIDE = 16;
export const MAX_PIXELS = 40_000_000;
export const MAX_THUMB_SIDE = 2048;

const HEX64 = /^[0-9a-f]{64}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** C0 and C1 controls, and the bidirectional formatting characters (a title could reorder the credit). */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/;

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t && t.length <= max && !UNSAFE.test(t) ? t : null;
}

/** An optional text: '' when absent or empty, null when it breaks the rules. */
function optional(v: unknown, max: number): string | null {
  return v === undefined || v === null || v === '' ? '' : text(v, max);
}

function whole(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : null;
}

/** Why one entry is not used, or the entry as Deer keeps it. */
export function checkEntry(raw: unknown): WallpaperEntry | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'not an object';
  const e = raw as Record<string, unknown>;
  const id = typeof e.id === 'string' && ID_RE.test(e.id) ? e.id : null;
  if (!id) return 'bad id';
  if (e.file !== `full/${id}.jpg`) return 'file is not full/<id>.jpg';
  if (e.thumb !== `thumbs/${id}.jpg`) return 'thumb is not thumbs/<id>.jpg';
  const title = text(e.title, 120);
  if (!title) return 'title missing, too long or with control characters';
  // The owner's own photos carry no credit; someone else's carry both (add.py --check says the same).
  const author = optional(e.author, 120);
  const license = optional(e.license, 64);
  if (author === null || license === null) return 'author or license too long or with control characters';
  if (!author !== !license) return 'author and license go together';
  if (e.added !== undefined && !(typeof e.added === 'string' && DATE.test(e.added))) return 'added is not a date';
  if (typeof e.color !== 'string' || !COLOR.test(e.color)) return 'color is not #rrggbb';
  const width = whole(e.width, MIN_SIDE, MAX_SIDE);
  const height = whole(e.height, MIN_SIDE, MAX_SIDE);
  if (!width || !height || width * height > MAX_PIXELS) return 'width or height out of range';
  const bytes = whole(e.bytes, 4, MAX_BYTES);
  const thumbBytes = whole(e.thumbBytes, 4, MAX_THUMB_BYTES);
  if (!bytes || !thumbBytes) return 'bytes or thumbBytes out of range';
  if (typeof e.sha256 !== 'string' || !HEX64.test(e.sha256) || typeof e.thumbSha256 !== 'string' || !HEX64.test(e.thumbSha256)) return 'sha256 or thumbSha256 is not 64 hex digits';
  return {
    id,
    title,
    author,
    license,
    color: e.color.toLowerCase(),
    width,
    height,
    bytes,
    sha256: e.sha256.toLowerCase(),
    thumbBytes,
    thumbSha256: e.thumbSha256.toLowerCase(),
  };
}

/**
 * wallpapers.json, parsed: the entries that pass, newest first as listed (at most MAX_ENTRIES are
 * looked at; an id listed twice or retired is skipped), and why the others did not. Null when it is
 * not a version 1 list at all (then it is not a good manifest and the cached one stays).
 */
export function checkManifest(json: unknown): { entries: WallpaperEntry[]; skipped: string[] } | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const m = json as Record<string, unknown>;
  if (m.version !== 1 || !Array.isArray(m.wallpapers)) return null;
  const retired = new Set(Array.isArray(m.retired) ? m.retired.filter((x): x is string => typeof x === 'string') : []);
  const entries: WallpaperEntry[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const [i, raw] of m.wallpapers.slice(0, MAX_ENTRIES).entries()) {
    const e = checkEntry(raw);
    const name = typeof (raw as any)?.id === 'string' ? JSON.stringify(String((raw as any).id).slice(0, 70)) : `#${i}`;
    if (typeof e === 'string') skipped.push(`${name}: ${e}`);
    else if (retired.has(e.id)) skipped.push(`${name}: retired`);
    else if (seen.has(e.id)) skipped.push(`${name}: listed twice`);
    else {
      seen.add(e.id);
      entries.push(e);
    }
  }
  if (m.wallpapers.length > MAX_ENTRIES) skipped.push(`${m.wallpapers.length - MAX_ENTRIES} entries past the first ${MAX_ENTRIES}`);
  return { entries, skipped };
}

/**
 * The size in a JPEG's frame header (SOFn), walking the marker segments from the start; null when
 * the bytes are not a JPEG (no FF D8 FF at the start) or no frame header comes before the scan.
 */
export function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) {
      i++; // fill byte
      continue;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
      i += 2; // markers without a length
      continue;
    }
    if (m === 0xd9 || m === 0xda) return null; // end of image, or the scan, before any frame header
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC): precision, height, width.
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (len < 7) return null;
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      return width && height ? { width, height } : null;
    }
    i += 2 + len;
  }
  return null;
}
