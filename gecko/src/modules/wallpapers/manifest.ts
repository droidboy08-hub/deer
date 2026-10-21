// Pure helpers of Deer wallpapers (VitreWallpapers.sys.ts): the checks index.json and every
// downloaded file must pass. No Gecko globals here, so the rules can be read on their own.
// The format is the one droidboy08-hub/deer-wallpapers' Action writes (index.json version 2, owner's
// plan of 2026-10-21); Deer trusts none of it: an entry that breaks a rule is skipped, never the list.
//
//   {"version": 2,
//    "wallpapers": [ photos, newest first: {id, title, added, color, width, height,
//                    file: "wallpapers/<id>.jpg", bytes, sha256, thumb: "wallpapers/thumbs/<id>.jpg",
//                    thumbBytes, thumbSha256, originSha256, author?, license?, source?} ],
//    "live":       [ videos, newest first: the same with duration (seconds), file
//                    "live-wallpapers/<id>.mp4" and thumb "live-wallpapers/thumbs/<id>.jpg" ],
//    "retired":    [ ids never to be used again ]}
//
// The list an entry is in is its kind (a "kind" field is ignored). Ids are unique across both lists;
// an id listed twice (in either list) is used once, where it is first listed (photos first). author
// and license come both or neither (the owner's own files carry no credit). originSha256 and source
// are the Action's and the credits page's business: not used here. Deer 0.1.5 to 0.1.8 read
// wallpapers.json (version 1, full/ and thumbs/) instead, which the collection keeps frozen for them.

export type WallpaperKind = 'photo' | 'video';
export const KINDS: readonly WallpaperKind[] = ['photo', 'video'];

/** One wallpaper as Deer keeps it once checked (added, originSha256 and source are not kept). */
export interface WallpaperEntry {
  id: string;
  kind: WallpaperKind;
  title: string;
  /** Both '' for the collection owner's own files: no credit. */
  author: string;
  license: string;
  /** Mean colour, '#rrggbb' (lower case): the tile's face until its thumbnail is drawn. */
  color: string;
  width: number;
  height: number;
  /** A video's length in seconds (checked, shown nowhere); 0 for a photo. */
  duration: number;
  /** The file: wallpapers/<id>.jpg (a photo) or live-wallpapers/<id>.mp4 (a video). */
  bytes: number;
  sha256: string;
  /** Its thumbnail (a video's: its poster frame), a JPEG. */
  thumbBytes: number;
  thumbSha256: string;
}

export const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const MAX_INDEX = 1024 * 1024;
/** Entries looked at in each list. */
export const MAX_ENTRIES = 500;
/** Retired ids looked at. */
export const MAX_RETIRED = 5000;
export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_THUMB_BYTES = 512 * 1024;
/** A picture's sides (the Action makes at most 3840) and area; a thumbnail's sides (480 wide). */
export const MAX_SIDE = 8192;
export const MIN_SIDE = 16;
export const MAX_PIXELS = 40_000_000;
export const MAX_THUMB_SIDE = 2048;
/**
 * A video: GitHub's limit for one file, and the Action's frame (H.264, at most 2560 x 1440). Its
 * length is not limited (owner's decision 2026-10-17: "dont cap the clips"); the size bounds the download.
 */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_SIDE = 3840;
/** The 'ftyp' box an MP4 starts with: its brands, a few dozen bytes (read whole before a byte is written). */
export const MAX_FTYP = 1024;
/**
 * Brands of an MP4 or QuickTime movie (ffmpeg, as the Action runs it, writes isom, iso2, avc1, mp41);
 * one of them must be the major or a compatible brand.
 */
const VIDEO_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9', 'mp41', 'mp42', 'avc1', 'M4V ', 'qt  ']);
/** Brands of still pictures in the same box format (AVIF, HEIF / HEIC): none may be named. */
const IMAGE_BRANDS = new Set(['avif', 'avis', 'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'mif2', 'msf1', 'miaf']);

/** The file of each kind. */
export const EXT: Record<WallpaperKind, 'jpg' | 'mp4'> = { photo: 'jpg', video: 'mp4' };
/** Each kind's folder, in the collection and in the profile alike. */
export const FOLDER: Record<WallpaperKind, 'wallpapers' | 'live-wallpapers'> = { photo: 'wallpapers', video: 'live-wallpapers' };
/** Each kind's list in index.json. */
const LIST: Record<WallpaperKind, 'wallpapers' | 'live'> = { photo: 'wallpapers', video: 'live' };

/** The file's place in the collection: wallpapers/<id>.jpg, live-wallpapers/<id>.mp4. */
export const fileOf = (id: string, kind: WallpaperKind): string => `${FOLDER[kind]}/${id}.${EXT[kind]}`;
/** The thumbnail's: wallpapers/thumbs/<id>.jpg, live-wallpapers/thumbs/<id>.jpg. */
export const thumbOf = (id: string, kind: WallpaperKind): string => `${FOLDER[kind]}/thumbs/${id}.jpg`;

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

/** Why one entry of `kind`'s list is not used, or the entry as Deer keeps it. */
export function checkEntry(raw: unknown, kind: WallpaperKind): WallpaperEntry | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'not an object';
  const e = raw as Record<string, unknown>;
  const id = typeof e.id === 'string' && ID_RE.test(e.id) ? e.id : null;
  if (!id) return 'bad id';
  const video = kind === 'video';
  if (e.file !== fileOf(id, kind)) return `file is not ${fileOf('<id>', kind)}`;
  if (e.thumb !== thumbOf(id, kind)) return `thumb is not ${thumbOf('<id>', kind)}`;
  const title = text(e.title, 120);
  if (!title) return 'title missing, too long or with control characters';
  // The owner's own files carry no credit; someone else's carry both.
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

/** An entry as kept in the profile's record (the kind and the two paths are implied). */
export function toRecord(e: WallpaperEntry): Record<string, unknown> {
  const { duration, ...rest } = e;
  return e.kind === 'video' ? { ...rest, duration } : rest;
}

/** A record read back from the profile, checked as the collection's entries are (it is shown again). */
export function checkRecord(raw: unknown): WallpaperEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const kind: WallpaperKind | null = r.kind === 'photo' ? 'photo' : r.kind === 'video' ? 'video' : null;
  if (!kind || typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
  const e = checkEntry({ ...r, file: fileOf(r.id, kind), thumb: thumbOf(r.id, kind), added: undefined }, kind);
  return typeof e === 'string' ? null : e;
}

export interface Index {
  /** Each kind's entries that pass, newest first as listed. */
  entries: Record<WallpaperKind, WallpaperEntry[]>;
  /**
   * The ids each list names (an entry skipped for another reason than its id included: a copy Deer
   * has of it is not thrown away for a field it cannot read today), retired ones left out.
   */
  listed: Record<WallpaperKind, Set<string>>;
  retired: Set<string>;
  /** Why the entries skipped were skipped. */
  skipped: string[];
}

/**
 * index.json, parsed: each kind's entries that pass (at most MAX_ENTRIES of each list are looked at;
 * an id listed twice or retired is skipped), and why the others did not. Null when it is not a
 * version 2 index at all, both lists being arrays (then nothing is taken from it).
 */
export function checkIndex(json: unknown): Index | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const m = json as Record<string, unknown>;
  if (m.version !== 2 || !Array.isArray(m.wallpapers) || !Array.isArray(m.live)) return null;
  if (m.retired !== undefined && !Array.isArray(m.retired)) return null;
  const retired = new Set((Array.isArray(m.retired) ? m.retired.slice(0, MAX_RETIRED) : []).filter((x): x is string => typeof x === 'string' && ID_RE.test(x)));
  const out: Index = { entries: { photo: [], video: [] }, listed: { photo: new Set(), video: new Set() }, retired, skipped: [] };
  const seen = new Set<string>();
  for (const kind of KINDS) {
    const list = m[LIST[kind]] as unknown[];
    for (const [i, raw] of list.slice(0, MAX_ENTRIES).entries()) {
      const rawId = (raw as { id?: unknown } | null)?.id;
      const name = `${LIST[kind]} ${typeof rawId === 'string' ? JSON.stringify(rawId.slice(0, 70)) : `#${i}`}`;
      if (typeof rawId === 'string' && ID_RE.test(rawId) && !retired.has(rawId)) out.listed[kind].add(rawId);
      const e = checkEntry(raw, kind);
      if (typeof e === 'string') out.skipped.push(`${name}: ${e}`);
      else if (retired.has(e.id)) out.skipped.push(`${name}: retired`);
      else if (seen.has(e.id)) out.skipped.push(`${name}: listed twice`);
      else {
        seen.add(e.id);
        out.entries[kind].push(e);
      }
    }
    if (list.length > MAX_ENTRIES) out.skipped.push(`${list.length - MAX_ENTRIES} ${LIST[kind]} entries past the first ${MAX_ENTRIES}`);
  }
  return out;
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
