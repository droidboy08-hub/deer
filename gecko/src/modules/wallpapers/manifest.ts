// Pure helpers of Deer wallpapers (VitreWallpapers.sys.ts): the checks wallpapers.json and every
// downloaded file must pass. No Gecko globals here, so the rules can be read on their own.
// The format is the one droidboy08-hub/deer-wallpapers' add.py writes (its --check runs the same
// file and size rules); Deer trusts none of it: an entry that breaks a rule is skipped, never the list.
// Two kinds of entry (owner's decision 2026-10-17, live wallpapers): a photo (no "kind", or "photo":
// full/<id>.jpg, as Deer 0.1.5 reads it) and a video ("kind": "video": full/<id>.mp4, its "duration"
// in seconds, any length); any other kind is skipped. Deer 0.1.5 skips a video entry itself (its file
// rule wants full/<id>.jpg), so the same list serves both.

export type WallpaperKind = 'photo' | 'video';

/** One wallpaper as Deer keeps it once checked (added and source are not used). */
export interface WallpaperEntry {
  id: string;
  kind: WallpaperKind;
  title: string;
  /** Both '' for the collection owner's own photos (add.py without --author / --license): no credit. */
  author: string;
  license: string;
  /** Mean colour, '#rrggbb' (lower case): the tile's face until its thumbnail is in. */
  color: string;
  width: number;
  height: number;
  /** A video's length in seconds (checked, shown nowhere); 0 for a photo. */
  duration: number;
  /** full/<id>.jpg (a photo) or full/<id>.mp4 (a video) */
  bytes: number;
  sha256: string;
  /** thumbs/<id>.jpg (a video's: its poster frame) */
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
/**
 * A video: GitHub's limit for one file, and add.py's frame (H.264, the long side at most 2560). Its
 * length is not limited (owner's decision 2026-10-17: "dont cap the clips"); the size bounds the download.
 */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_SIDE = 3840;
/** The 'ftyp' box an MP4 starts with: its brands, a few dozen bytes (read whole before a byte is written). */
export const MAX_FTYP = 1024;
/**
 * Brands of an MP4 or QuickTime movie (ffmpeg, as add.py runs it, writes isom, iso2, avc1, mp41); one
 * of them must be the major or a compatible brand.
 */
const VIDEO_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9', 'mp41', 'mp42', 'avc1', 'M4V ', 'qt  ']);
/** Brands of still pictures in the same box format (AVIF, HEIF / HEIC): none may be named. */
const IMAGE_BRANDS = new Set(['avif', 'avis', 'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'mif2', 'msf1', 'miaf']);

/** The file of each kind, in full/ and in the profile. */
export const EXT: Record<WallpaperKind, 'jpg' | 'mp4'> = { photo: 'jpg', video: 'mp4' };

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
  const kind: WallpaperKind | null = e.kind === undefined || e.kind === 'photo' ? 'photo' : e.kind === 'video' ? 'video' : null;
  if (!kind) return 'kind is neither photo nor video';
  const video = kind === 'video';
  if (e.file !== `full/${id}.${EXT[kind]}`) return `file is not full/<id>.${EXT[kind]}`;
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
  const width = whole(e.width, MIN_SIDE, video ? MAX_VIDEO_SIDE : MAX_SIDE);
  const height = whole(e.height, MIN_SIDE, video ? MAX_VIDEO_SIDE : MAX_SIDE);
  if (!width || !height || width * height > MAX_PIXELS) return 'width or height out of range';
  const d = e.duration;
  // Any length: only a number of seconds above 0 (no upper bound, see MAX_VIDEO_BYTES).
  const duration = !video ? 0 : typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : null;
  if (duration === null) return 'duration is not a number of seconds';
  const bytes = whole(e.bytes, 4, video ? MAX_VIDEO_BYTES : MAX_BYTES);
  const thumbBytes = whole(e.thumbBytes, 4, MAX_THUMB_BYTES);
  if (!bytes || !thumbBytes) return 'bytes or thumbBytes out of range';
  if (typeof e.sha256 !== 'string' || !HEX64.test(e.sha256) || typeof e.thumbSha256 !== 'string' || !HEX64.test(e.thumbSha256)) return 'sha256 or thumbSha256 is not 64 hex digits';
  return {
    id,
    kind,
    title,
    author,
    license,
    color: e.color.toLowerCase(),
    width,
    height,
    duration,
    bytes,
    sha256: e.sha256.toLowerCase(),
    thumbBytes,
    thumbSha256: e.thumbSha256.toLowerCase(),
  };
}

/** An entry in the manifest's own format again (the cached copy is checked as the site's when read back). */
export function toManifest(e: WallpaperEntry): Record<string, unknown> {
  const { kind, duration, ...rest } = e;
  const out: Record<string, unknown> = { ...rest, file: `full/${e.id}.${EXT[kind]}`, thumb: `thumbs/${e.id}.jpg` };
  if (kind === 'video') Object.assign(out, { kind, duration });
  return out;
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

const fourcc = (b: Uint8Array, at: number): string => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

/**
 * The start of an MP4 video (ISO/IEC 14496-12), in a file of `total` bytes: the first box is 'ftyp'
 * (a major brand, a minor version, the compatible brands, 4 bytes each), 16 bytes to MAX_FTYP, whose
 * brands name an MP4 or QuickTime movie and no still picture (an AVIF or HEIC picture starts with an
 * 'ftyp' box too). True or false once `head` holds the whole box; null while it is shorter (feed it
 * more of the file's start). Whether the rest plays is Gecko's media stack's business.
 */
export function mp4Start(head: Uint8Array, total: number): boolean | null {
  if (head.length < 8) return null;
  const size = head[0] * 0x1000000 + ((head[1] << 16) | (head[2] << 8) | head[3]);
  if (fourcc(head, 4) !== 'ftyp' || size < 16 || size > MAX_FTYP || size > total || (size - 16) % 4) return false;
  if (head.length < size) return null;
  const brands = [fourcc(head, 8)];
  for (let at = 16; at < size; at += 4) brands.push(fourcc(head, at));
  return brands.some((x) => VIDEO_BRANDS.has(x)) && !brands.some((x) => IMAGE_BRANDS.has(x));
}
