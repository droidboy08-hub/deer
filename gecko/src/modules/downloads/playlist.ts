// HLS playlist parsing, ported from app/src/main/modules/downloads/playlist.ts (HLSDownload.swift).
// Pure functions: no I/O. Buffer became Uint8Array.

export interface KeyRef {
  url: string;
  /** null: the IV is the segment's media sequence number. */
  iv: Uint8Array | null;
}

export interface MediaSegment {
  url: string;
  seq: number;
  key: KeyRef | null;
  /** EXT-X-BYTERANGE: [start, end) of `url`. */
  range: [number, number] | null;
  duration: number;
}

export interface MediaPlaylist {
  segments: MediaSegment[];
  init: { url: string; key: KeyRef | null; range: [number, number] | null } | null;
  endList: boolean;
  drm: boolean;
  iframesOnly: boolean;
  duration: number;
}

export interface Variant {
  url: string;
  bandwidth: number;
  /** AVERAGE-BANDWIDTH, 0 when absent: the better size estimate. */
  average: number;
  width: number;
  height: number;
  codecs: string;
  audioGroup: string;
  audioOnly: boolean;
}

export interface Rendition {
  type: string;
  groupId: string;
  name: string;
  language: string;
  url: string;
  isDefault: boolean;
}

export interface MasterPlaylist {
  variants: Variant[];
  renditions: Rendition[];
  drm: boolean;
}

/** Key systems that mean DRM: Widevine, PlayReady, FairPlay (and anything not plain AES-128). */
const DRM_FORMATS = /widevine|edef8ba9|playready|9a04f079|streamingkeydelivery|fairplay|com\.microsoft/i;

export function lines(text: string): string[] {
  return text
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function isPlaylist(text: string): boolean {
  return text.replace(/^﻿/, '').trimStart().startsWith('#EXTM3U');
}

export function isMaster(text: string): boolean {
  return lines(text).some((l) => l.startsWith('#EXT-X-STREAM-INF:'));
}

/** NAME= inside an attribute list, quoted or bare; the match must start an attribute (BANDWIDTH ≠ AVERAGE-BANDWIDTH). */
export function attr(line: string, name: string): string | null {
  const needle = `${name}=`;
  let from = 0;
  for (;;) {
    const i = line.indexOf(needle, from);
    if (i < 0) return null;
    const before = i === 0 ? ':' : line[i - 1];
    if (before !== ',' && before !== ':') {
      from = i + needle.length;
      continue;
    }
    const rest = line.slice(i + needle.length);
    if (rest.startsWith('"')) {
      const close = rest.indexOf('"', 1);
      return close < 0 ? null : rest.slice(1, close);
    }
    const comma = rest.indexOf(',');
    return comma < 0 ? rest : rest.slice(0, comma);
  }
}

function resolve(ref: string, base: string): string | null {
  try {
    return new URL(ref, base).toString();
  } catch {
    return null;
  }
}

function keyIsDrm(line: string): boolean {
  const method = (attr(line, 'METHOD') ?? 'NONE').toUpperCase();
  const format = attr(line, 'KEYFORMAT') ?? 'identity';
  if (method === 'NONE') return false;
  if (method !== 'AES-128') return true;
  return format.toLowerCase() !== 'identity' || DRM_FORMATS.test(format);
}

function byteRange(spec: string, last: number): [number, number] | null {
  const [len, off] = spec.split('@');
  const length = Number(len);
  if (!Number.isFinite(length) || length <= 0) return null;
  const start = off !== undefined && off !== '' ? Number(off) : last;
  return Number.isFinite(start) ? [start, start + length] : null;
}

function hexBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '').padStart(32, '0').slice(-32);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  return out;
}

export function parseMaster(text: string, base: string): MasterPlaylist {
  const variants: Variant[] = [];
  const renditions: Rendition[] = [];
  let drm = false;
  let pending: Omit<Variant, 'url'> | null = null;
  for (const line of lines(text)) {
    if (line.startsWith('#EXT-X-SESSION-KEY:') && keyIsDrm(line)) drm = true;
    else if (line.startsWith('#EXT-X-MEDIA:')) {
      const uri = attr(line, 'URI');
      renditions.push({
        type: (attr(line, 'TYPE') ?? '').toUpperCase(),
        groupId: attr(line, 'GROUP-ID') ?? '',
        name: attr(line, 'NAME') ?? '',
        language: attr(line, 'LANGUAGE') ?? '',
        url: uri ? (resolve(uri, base) ?? '') : '',
        isDefault: (attr(line, 'DEFAULT') ?? '').toUpperCase() === 'YES',
      });
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const [w, h] = (attr(line, 'RESOLUTION') ?? '').toLowerCase().split('x').map(Number);
      const codecs = (attr(line, 'CODECS') ?? '').toLowerCase();
      const height = Number.isFinite(h) ? h : 0;
      pending = {
        bandwidth: Number(attr(line, 'BANDWIDTH') ?? 0) || 0,
        average: Number(attr(line, 'AVERAGE-BANDWIDTH') ?? 0) || 0,
        width: Number.isFinite(w) ? w : 0,
        height,
        codecs,
        audioGroup: attr(line, 'AUDIO') ?? '',
        // No resolution and only audio codecs: an audio rendition, not a tiny video.
        audioOnly: !height && !!codecs && !/avc|hvc|hev|av01|vp0?9|dvh/.test(codecs),
      };
    } else if (!line.startsWith('#') && pending) {
      const url = resolve(line, base);
      if (url) variants.push({ url, ...pending });
      pending = null;
    }
  }
  return { variants, renditions, drm };
}

/** One row per resolution (the richest version of it), best first, audio-only last. */
export function ladder(master: MasterPlaylist): Variant[] {
  const best = new Map<string, Variant>();
  for (const v of master.variants) {
    if (!/^https?:/i.test(v.url)) continue;
    const rung = v.audioOnly ? `a${v.bandwidth}` : v.height ? `h${v.height}` : `b${v.bandwidth}`;
    const have = best.get(rung);
    if (!have || have.bandwidth < v.bandwidth) best.set(rung, v);
  }
  return [...best.values()].sort((a, b) => (a.audioOnly !== b.audioOnly ? (a.audioOnly ? 1 : -1) : b.height - a.height || b.bandwidth - a.bandwidth));
}

/** The audio rendition a variant plays with, when its audio lives in a separate playlist. */
export function audioFor(master: MasterPlaylist, variant: Variant): Rendition | null {
  if (!variant.audioGroup) return null;
  const group = master.renditions.filter((r) => r.type === 'AUDIO' && r.groupId === variant.audioGroup && r.url);
  return group.find((r) => r.isDefault) ?? group[0] ?? null;
}

export function parseMedia(text: string, base: string): MediaPlaylist {
  const out: MediaPlaylist = { segments: [], init: null, endList: false, drm: false, iframesOnly: false, duration: 0 };
  let key: KeyRef | null = null;
  let seq = 0;
  let duration = -1;
  let pendingRange: [number, number] | null = null;
  let lastEnd = 0;
  for (const line of lines(text)) {
    if (line.startsWith('#EXT-X-I-FRAMES-ONLY')) out.iframesOnly = true;
    else if (line.startsWith('#EXT-X-ENDLIST')) out.endList = true;
    else if (line.startsWith('#EXT-X-PLAYLIST-TYPE:') && /VOD/i.test(line)) out.endList = true;
    else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = Number(line.slice(22)) || 0;
    else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = byteRange(line.slice(17), lastEnd);
      if (pendingRange) lastEnd = pendingRange[1];
    } else if (line.startsWith('#EXT-X-KEY:')) {
      if (keyIsDrm(line)) out.drm = true;
      const method = (attr(line, 'METHOD') ?? 'NONE').toUpperCase();
      const uri = attr(line, 'URI');
      if (method === 'AES-128' && uri) {
        const ivHex = attr(line, 'IV');
        const url = resolve(uri, base);
        key = url ? { url, iv: ivHex ? hexBytes(ivHex) : null } : null;
      } else if (method === 'NONE') key = null;
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const uri = attr(line, 'URI');
      const url = uri ? resolve(uri, base) : null;
      // A MAP byte range with no offset starts at 0.
      const spec = attr(line, 'BYTERANGE');
      if (url) out.init = { url, key, range: spec ? byteRange(spec.includes('@') ? spec : `${spec}@0`, 0) : null };
    } else if (line.startsWith('#EXTINF:')) {
      duration = Number(line.slice(8).split(',')[0]) || 0;
    } else if (!line.startsWith('#') && duration >= 0) {
      const url = resolve(line, base);
      if (url) {
        out.segments.push({ url, seq: seq + out.segments.length, key, range: pendingRange, duration });
        out.duration += duration;
      }
      duration = -1;
      pendingRange = null;
    }
  }
  return out;
}
