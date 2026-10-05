// DASH manifests (MPD), new on Gecko (the Electron build only detected them): the best video and
// the best audio representation are fetched as two tracks with the stream machinery of hls.ts and
// joined with ffmpeg (DESIGN-NOTES, "HLS / DASH": best video + audio, joined).
//
// What is understood: one Period (static, on demand); SegmentTemplate with $Number$ or
// $Time$ (and SegmentTimeline), SegmentList, and SegmentBase / a bare BaseURL (one file per
// representation, which hls.ts fetches in byte ranges). ContentProtection anywhere means DRM:
// never offered, never downloaded. A dynamic (live) manifest is refused like a live HLS stream.
// Each representation becomes a MediaPlaylist (playlist.ts) so hls.ts treats both formats alike.
//
// Parsing uses DOMParser in the system scope (available to system modules in 157:
// browser/modules/backup/BackupService.sys.mjs does the same).
import type { MediaPlaylist, MediaSegment } from './playlist';

export interface DashRep {
  id: string;
  kind: 'video' | 'audio';
  mime: string;
  codecs: string;
  bandwidth: number;
  width: number;
  height: number;
  lang: string;
  /** The segments, or null for one file (SegmentBase / bare BaseURL): see `file`. */
  playlist: MediaPlaylist | null;
  /** The representation's single file, when it has no segment list. */
  file: string;
}

export interface Mpd {
  drm: boolean;
  live: boolean;
  /** Seconds. */
  duration: number;
  periods: number;
  reps: DashRep[];
}

function parser(): DOMParser {
  const g = globalThis as unknown as { DOMParser?: typeof DOMParser };
  if (!g.DOMParser) {
    const { XPCOMUtils } = ChromeUtils.importESModule('resource://gre/modules/XPCOMUtils.sys.mjs');
    const holder: { DOMParser?: typeof DOMParser } = {};
    XPCOMUtils.defineLazyGlobalGetters(holder, ['DOMParser']);
    return new (holder.DOMParser as typeof DOMParser)();
  }
  return new g.DOMParser();
}

const kids = (el: Element | null, name: string): Element[] => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
const kid = (el: Element | null, name: string): Element | null => kids(el, name)[0] ?? null;

/** ISO 8601 duration (PT1H2M3.5S, P1DT2H) in seconds. */
export function isoSeconds(value: string | null): number {
  if (!value) return 0;
  const m = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value.trim());
  if (!m) return 0;
  const n = (i: number): number => Number(m[i] ?? 0) || 0;
  return n(1) * 31536000 + n(2) * 2592000 + n(3) * 86400 + n(4) * 3600 + n(5) * 60 + n(6);
}

function resolveUrl(ref: string, base: string): string {
  try {
    return new URL(ref, base).toString();
  } catch {
    return '';
  }
}

/** The base URL of an element: its own BaseURL resolved against its parent's. */
function baseOf(el: Element | null, parentBase: string): string {
  const b = kid(el, 'BaseURL')?.textContent?.trim();
  return b ? resolveUrl(b, parentBase) : parentBase;
}

/** $RepresentationID$, $Bandwidth$, $Number%05d$, $Time$, $$. */
function expand(template: string, rep: { id: string; bandwidth: number }, number: number, time: number): string {
  return template.replace(/\$(RepresentationID|Bandwidth|Number|Time|)(?:%0(\d+)d)?\$/g, (_all, name: string, width: string | undefined) => {
    if (name === '') return '$';
    if (name === 'RepresentationID') return rep.id;
    const value = name === 'Bandwidth' ? rep.bandwidth : name === 'Number' ? number : time;
    const text = String(Math.trunc(value));
    return width ? text.padStart(Number(width), '0') : text;
  });
}

function rangeOf(spec: string | null): [number, number] | null {
  const m = /^(\d+)-(\d+)$/.exec((spec ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]) + 1] : null;
}

/** Attributes of the nearest SegmentTemplate up the tree (Representation over AdaptationSet over Period). */
function templateAttrs(chain: (Element | null)[]): { attrs: Map<string, string>; timeline: Element | null } | null {
  const attrs = new Map<string, string>();
  let timeline: Element | null = null;
  let found = false;
  // Outermost first, so inner levels override.
  for (const el of chain) {
    const t = kid(el, 'SegmentTemplate');
    if (!t) continue;
    found = true;
    for (const a of Array.from(t.attributes)) attrs.set(a.name, a.value);
    timeline = kid(t, 'SegmentTimeline') ?? timeline;
  }
  return found ? { attrs, timeline } : null;
}

function fromTemplate(tpl: { attrs: Map<string, string>; timeline: Element | null }, rep: { id: string; bandwidth: number }, base: string, periodSeconds: number): MediaPlaylist | null {
  const a = tpl.attrs;
  const media = a.get('media');
  if (!media) return null;
  const timescale = Number(a.get('timescale') ?? 1) || 1;
  const startNumber = Number(a.get('startNumber') ?? 1);
  const out: MediaPlaylist = { segments: [], init: null, endList: true, drm: false, iframesOnly: false, duration: 0 };
  const init = a.get('initialization');
  if (init) out.init = { url: resolveUrl(expand(init, rep, startNumber, 0), base), key: null, range: null };
  const push = (number: number, time: number, d: number): void => {
    const seg: MediaSegment = { url: resolveUrl(expand(media, rep, number, time), base), seq: number, key: null, range: null, duration: d / timescale };
    out.segments.push(seg);
    out.duration += seg.duration;
  };
  if (tpl.timeline) {
    let time = 0;
    let number = startNumber;
    const ss = kids(tpl.timeline, 'S');
    ss.forEach((s, i) => {
      if (s.hasAttribute('t')) time = Number(s.getAttribute('t'));
      const d = Number(s.getAttribute('d') ?? 0);
      if (!(d > 0)) return;
      let r = Number(s.getAttribute('r') ?? 0);
      if (r < 0) {
        // Repeat until the next S (or the end of the period).
        const nextT = ss[i + 1]?.hasAttribute('t') ? Number(ss[i + 1].getAttribute('t')) : periodSeconds * timescale;
        r = Math.max(0, Math.ceil((nextT - time) / d) - 1);
      }
      for (let k = 0; k <= r && out.segments.length < 100000; k++) {
        push(number++, time, d);
        time += d;
      }
    });
    return out;
  }
  const d = Number(a.get('duration') ?? 0);
  if (!(d > 0) || !(periodSeconds > 0)) return null;
  const count = Math.ceil((periodSeconds * timescale) / d - 1e-6);
  for (let k = 0; k < count && k < 100000; k++) push(startNumber + k, k * d, Math.min(d, periodSeconds * timescale - k * d));
  return out;
}

function fromList(list: Element, base: string): MediaPlaylist {
  const timescale = Number(list.getAttribute('timescale') ?? 1) || 1;
  const d = Number(list.getAttribute('duration') ?? 0) / timescale;
  const out: MediaPlaylist = { segments: [], init: null, endList: true, drm: false, iframesOnly: false, duration: 0 };
  const init = kid(list, 'Initialization');
  if (init) out.init = { url: resolveUrl(init.getAttribute('sourceURL') ?? '', base) || base, key: null, range: rangeOf(init.getAttribute('range')) };
  kids(list, 'SegmentURL').forEach((s, i) => {
    const url = s.getAttribute('media') ? resolveUrl(s.getAttribute('media') as string, base) : base;
    out.segments.push({ url, seq: i + 1, key: null, range: rangeOf(s.getAttribute('mediaRange')), duration: d });
    out.duration += d;
  });
  return out;
}

export function isMpd(text: string): boolean {
  return /<MPD[\s>]/.test(text.slice(0, 4096));
}

export function parseMpd(text: string, url: string): Mpd {
  const doc = parser().parseFromString(text, 'application/xml');
  const mpd = doc.documentElement;
  const out: Mpd = { drm: false, live: false, duration: 0, periods: 0, reps: [] };
  if (!mpd || mpd.localName !== 'MPD') return out;
  out.drm = doc.getElementsByTagNameNS('*', 'ContentProtection').length > 0;
  out.live = (mpd.getAttribute('type') ?? 'static') === 'dynamic';
  const total = isoSeconds(mpd.getAttribute('mediaPresentationDuration'));
  const periods = kids(mpd, 'Period');
  out.periods = periods.length;
  const period = periods[0] ?? null;
  if (!period) return out;
  const periodSeconds = isoSeconds(period.getAttribute('duration')) || Math.max(0, total - isoSeconds(period.getAttribute('start')));
  out.duration = periodSeconds || total;
  const mpdBase = baseOf(mpd, url);
  const periodBase = baseOf(period, mpdBase);
  for (const set of kids(period, 'AdaptationSet')) {
    const setBase = baseOf(set, periodBase);
    const setMime = set.getAttribute('mimeType') ?? '';
    const setType = set.getAttribute('contentType') ?? '';
    for (const r of kids(set, 'Representation')) {
      const mime = r.getAttribute('mimeType') ?? setMime;
      const codecs = (r.getAttribute('codecs') ?? set.getAttribute('codecs') ?? '').toLowerCase();
      const kind = /^video\//.test(mime) || setType === 'video' ? 'video' : /^audio\//.test(mime) || setType === 'audio' ? 'audio' : null;
      if (!kind) continue; // subtitles, thumbnails (image/jpeg)
      const rep = {
        id: r.getAttribute('id') ?? '',
        bandwidth: Number(r.getAttribute('bandwidth') ?? 0) || 0,
      };
      const base = baseOf(r, setBase);
      const tpl = templateAttrs([period, set, r]);
      let playlist: MediaPlaylist | null = null;
      if (tpl) playlist = fromTemplate(tpl, rep, base, out.duration);
      else {
        const list = kid(r, 'SegmentList') ?? kid(set, 'SegmentList');
        if (list) playlist = fromList(list, base);
      }
      out.reps.push({
        id: rep.id,
        kind,
        mime,
        codecs,
        bandwidth: rep.bandwidth,
        width: Number(r.getAttribute('width') ?? set.getAttribute('width') ?? 0) || 0,
        height: Number(r.getAttribute('height') ?? set.getAttribute('height') ?? 0) || 0,
        lang: set.getAttribute('lang') ?? '',
        playlist,
        file: playlist ? '' : base,
      });
    }
  }
  return out;
}

/** One video representation per height (the richest), best first. */
export function dashLadder(mpd: Mpd): DashRep[] {
  const best = new Map<number, DashRep>();
  for (const r of mpd.reps) {
    if (r.kind !== 'video') continue;
    const have = best.get(r.height);
    if (!have || have.bandwidth < r.bandwidth) best.set(r.height, r);
  }
  return [...best.values()].sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
}

/** The audio that goes with the video: the richest audio representation (the manifest's first language first). */
export function dashAudio(mpd: Mpd): DashRep | null {
  const audios = mpd.reps.filter((r) => r.kind === 'audio');
  if (!audios.length) return null;
  const lang = audios[0].lang;
  const same = audios.filter((a) => a.lang === lang);
  return same.sort((a, b) => b.bandwidth - a.bandwidth)[0] ?? null;
}

/** "WEBM" for WebM representations, "MP4" otherwise. */
export function dashContainer(rep: DashRep | null): string {
  return rep && /webm/i.test(rep.mime) ? 'WEBM' : 'MP4';
}
