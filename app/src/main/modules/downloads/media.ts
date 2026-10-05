// Media the pages load: watched per tab through the session's response headers, so the
// "Download this video" pill and picker know what a video element is really playing (an MSE
// player's blob: hides an HLS playlist the page fetched). Also builds the picker's offer.
import { screen, webContents, type OnResponseStartedListenerDetails, type WebContents } from 'electron';
import type { MainContext } from '../../context';
import { findFfmpeg } from './ffmpeg';
import { Identity } from './identity';
import { extOf, isOpaque } from './naming';
import { header, open, readBody } from './net';
import { audioFor, isMaster, isPlaylist, ladder, parseMaster, parseMedia } from './playlist';
import type { MediaNotice, PageVideo, VideoOffer, VideoOption } from './types';

interface Candidate {
  url: string;
  kind: 'hls' | 'dash' | 'video' | 'audio';
  bytes: number;
  at: number;
  frameUrl: string;
}

interface TabMedia {
  items: Map<string, Candidate>;
}

interface StreamInfo {
  at: number;
  master: boolean;
  drm: boolean;
  live: boolean;
  duration: number;
  fmp4: boolean;
  options: VideoOption[];
}

const SEGMENT_EXT = /\.(ts|m4s|m4f|cmfv|cmfa|aac|vtt|webvtt|key)(\?|#|$)/i;
const HINTS = /thumb|poster|preview|sprite|favicon|emoji|\/ads?\/|doubleclick|googlesyndication/i;

export class MediaWatch {
  private tabs = new Map<number, TabMedia>();
  private timers = new Map<number, NodeJS.Timeout>();
  private streams = new Map<string, StreamInfo>();
  private sizes = new Map<string, number>();

  constructor(private ctx: MainContext) {}

  install(): void {
    const ses = this.ctx.session();
    ses.webRequest.onResponseStarted({ urls: ['http://*/*', 'https://*/*'] }, (d) => {
      try {
        this.seen(d);
      } catch {
        /* never let detection disturb loading */
      }
    });
    this.ctx.onGuest((wc) => {
      const id = wc.id;
      wc.on('did-navigate', () => {
        this.tabs.delete(id);
        this.notify(wc);
      });
      wc.once('destroyed', () => {
        this.tabs.delete(id);
        const t = this.timers.get(id);
        if (t) clearTimeout(t);
        this.timers.delete(id);
      });
    });
  }

  private seen(d: OnResponseStartedListenerDetails): void {
    const id = d.webContentsId;
    if (!id || d.statusCode < 200 || d.statusCode >= 300 || d.method !== 'GET') return;
    const type = d.resourceType;
    if (!['media', 'xhr', 'other', 'object', 'mainFrame', 'subFrame'].includes(type)) return;
    const headers = d.responseHeaders ?? {};
    const get = (name: string) => {
      const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
      return key ? (headers[key] ?? []).join(', ') : '';
    };
    const mime = get('content-type').split(';')[0].trim().toLowerCase();
    const url = d.url;
    let kind: Candidate['kind'] | null = null;
    if (/mpegurl/.test(mime) || /\.m3u8(\?|#|$)/i.test(url)) kind = 'hls';
    else if (/dash\+xml/.test(mime) || /\.mpd(\?|#|$)/i.test(url)) kind = 'dash';
    // MSE players fetch their segments as xhr; only the media element's own requests are whole files.
    else if (type !== 'xhr' && !SEGMENT_EXT.test(url) && !HINTS.test(url)) {
      if (mime.startsWith('video/') && mime !== 'video/mp2t') kind = 'video';
      else if (mime.startsWith('audio/') && !/mpegurl/.test(mime)) kind = 'audio';
      else if (mime === 'application/octet-stream' && /\.(mp4|webm|mov|mkv|m4v)(\?|#|$)/i.test(url)) kind = 'video';
    }
    if (!kind) return;
    const range = /\/(\d+)\s*$/.exec(get('content-range'));
    const bytes = range ? Number(range[1]) : Number(get('content-length')) || 0;
    if ((kind === 'video' || kind === 'audio') && bytes > 0 && bytes < 500_000) return;
    let tab = this.tabs.get(id);
    if (!tab) {
      tab = { items: new Map() };
      this.tabs.set(id, tab);
    }
    const had = tab.items.has(url);
    tab.items.set(url, { url, kind, bytes: Math.max(bytes, tab.items.get(url)?.bytes ?? 0), at: Date.now(), frameUrl: frameUrlOf(d) });
    // An endless feed keeps loading media; the oldest it showed are forgotten.
    if (tab.items.size > 200) tab.items.delete(tab.items.keys().next().value as string);
    if (bytes) remember(this.sizes, url, bytes);
    const wc = webContents.fromId(id);
    if (!had && wc) this.schedule(wc);
  }

  private schedule(wc: WebContents): void {
    if (this.timers.has(wc.id)) return;
    this.timers.set(wc.id, setTimeout(() => {
      this.timers.delete(wc.id);
      this.notify(wc);
    }, 300));
  }

  private notify(wc: WebContents): void {
    if (wc.isDestroyed()) return;
    // DASH alone isn't something Vitre can save yet, so it doesn't light the tab's download mark.
    const notice: MediaNotice = { webContentsId: wc.id, count: this.candidates(wc.id).filter((c) => c.kind !== 'dash').length };
    this.ctx.hostWindow(wc)?.webContents.send('dl:media', notice);
  }

  candidates(id: number): Candidate[] {
    const items = [...(this.tabs.get(id)?.items.values() ?? [])];
    return items.filter((c) => c.kind !== 'audio' || !items.some((v) => v.kind === 'video' || v.kind === 'hls'));
  }

  /** What the picker offers for a video: its qualities, or why it can't be saved. */
  async offer(wcId: number, video: PageVideo): Promise<VideoOffer> {
    const wc = webContents.fromId(wcId);
    const pageUrl = wc && !wc.isDestroyed() ? wc.getURL() : '';
    const title = (video.title || wc?.getTitle() || '').trim();
    const base: VideoOffer = { state: 'none', key: '', title, host: hostOf(pageUrl), duration: Number.isFinite(video.duration) ? video.duration : 0, options: [], suggested: '' };
    if (video.protected) return { ...base, state: 'protected', key: `${wcId}|${video.src}` };
    if (video.live) return { ...base, state: 'live', key: `${wcId}|${video.src}` };
    const identity = new Identity(this.ctx.session(), pageUrl, true);
    const src = /^https?:/i.test(video.src) ? video.src : '';
    // An embedded player owns the media its frame loaded; a page's own video, what the page loaded.
    const all = this.candidates(wcId);
    const inPage = all.filter((c) => !c.frameUrl || sameOrigin(c.frameUrl, pageUrl));
    const items = video.kind === 'frame' ? all.filter((c) => !!c.frameUrl && sameOrigin(c.frameUrl, video.frameSrc)) : inPage.length ? inPage : all;
    const streams = src && /\.m3u8(\?|#|$)/i.test(src) ? [src] : rankStreams(items.filter((c) => c.kind === 'hls'));
    // A player loads the master playlist and then one rendition: offer the master, which has every quality.
    let hls = '';
    let info: StreamInfo | null = null;
    for (const url of streams.slice(0, 4)) {
      const d = await this.describe(url, identity).catch(() => null);
      if (!d) continue;
      if (!info || (d.master && !info.master)) {
        hls = url;
        info = d;
      }
      if (d.master) break;
    }
    if (hls) {
      if (info?.drm) return { ...base, state: 'protected', key: `${wcId}|${hls}` };
      if (info?.live) return { ...base, state: 'live', key: `${wcId}|${hls}` };
      if (info?.options.length) {
        // A lone rendition without RESOLUTION plays at the element's size; a ladder of them keeps its bitrates apart.
        const lone = info.options.filter((o) => o.group === 'video').length === 1;
        const options = info.options.map((o) => (o.height || o.group === 'audio' || !lone ? o : { ...o, height: video.height, label: video.height ? `${video.height}p` : o.label }));
        return this.finish({ ...base, duration: base.duration || info.duration, key: `${wcId}|${hls}`, options });
      }
    }
    const dash = items.find((c) => c.kind === 'dash');
    let file = src && !/\.mpd(\?|#|$)/i.test(src) ? src : '';
    if (!file && !dash) file = items.filter((c) => c.kind === 'video').sort((a, b) => b.bytes - a.bytes)[0]?.url ?? '';
    if (file) {
      const bytes = this.sizes.get(file) ?? (await this.sizeOf(file, identity));
      const ext = (extOf(new URL(file).pathname) || 'mp4').toUpperCase();
      const option: VideoOption = {
        id: 'file',
        group: 'video',
        label: video.height ? `${video.height}p` : ext,
        detail: video.height >= 2160 ? '4K' : '',
        container: ext,
        bytes,
        height: video.height,
        url: file,
        mode: 'file',
        variantUrl: '',
        audioUrl: '',
      };
      return this.finish({ ...base, key: `${wcId}|${file}`, options: [option] });
    }
    if (dash && (await this.dashProtected(dash.url, identity))) return { ...base, state: 'protected', key: `${wcId}|${dash.url}` };
    return base;
  }

  /** The suggestion is the best quality this screen can show. */
  private finish(offer: VideoOffer): VideoOffer {
    const display = screen.getPrimaryDisplay();
    const fit = Math.round(Math.max(display.size.height, display.size.width * (9 / 16)) * display.scaleFactor);
    const videos = offer.options.filter((o) => o.group === 'video');
    const pick = videos.find((o) => o.height && o.height <= fit) ?? videos[videos.length - 1] ?? offer.options[0];
    return { ...offer, state: 'ok', suggested: pick?.id ?? '' };
  }

  private async describe(url: string, identity: Identity): Promise<StreamInfo> {
    const hit = this.streams.get(url);
    if (hit && Date.now() - hit.at < 60_000) return hit;
    const text = await fetchText(url, identity);
    const info: StreamInfo = { at: Date.now(), master: false, drm: false, live: false, duration: 0, fmp4: false, options: [] };
    const muxer = !!findFfmpeg();
    if (isMaster(text)) {
      info.master = true;
      const master = parseMaster(text, url);
      info.drm = master.drm;
      const rungs = ladder(master);
      const sample = rungs.find((v) => !v.audioOnly) ?? rungs[0];
      if (sample) {
        const media = parseMedia(await fetchText(sample.url, identity), sample.url);
        info.drm ||= media.drm;
        info.live = !media.endList;
        info.duration = media.duration;
        info.fmp4 = !!media.init;
      }
      const container = info.fmp4 || muxer ? 'MP4' : 'TS';
      for (const v of rungs) {
        // BANDWIDTH already counts the audio rendition a variant plays with.
        const bytes = info.duration ? Math.round(((v.average || v.bandwidth) / 8) * info.duration) : 0;
        if (v.audioOnly) {
          info.options.push(option(`a${v.bandwidth}`, 'audio', info.fmp4 || muxer ? 'M4A' : 'AAC', `${Math.round(v.bandwidth / 1000)} kbps`, bytes, 0, url, v.url, ''));
        } else {
          const label = v.height ? `${v.height}p` : `${Math.round(v.bandwidth / 1000)} kbps`;
          info.options.push(option(`v${v.height}-${v.bandwidth}`, 'video', label, v.height >= 2160 ? '4K' : '', bytes, v.height, url, v.url, audioFor(master, v)?.url ?? '', container));
        }
      }
      // Audio that lives in its own rendition can be saved on its own too.
      if (!info.options.some((o) => o.group === 'audio')) {
        const audio = master.renditions.find((r) => r.type === 'AUDIO' && r.url && r.isDefault) ?? master.renditions.find((r) => r.type === 'AUDIO' && r.url);
        if (audio) info.options.push(option('audio', 'audio', info.fmp4 || muxer ? 'M4A' : 'AAC', audio.name || audio.language || '', 0, 0, url, audio.url, ''));
      }
    } else {
      const media = parseMedia(text, url);
      info.drm = media.drm;
      info.live = !media.endList;
      info.duration = media.duration;
      info.fmp4 = !!media.init;
      info.options.push(option('stream', 'video', 'Original', '', 0, 0, url, url, '', info.fmp4 || muxer ? 'MP4' : 'TS'));
    }
    remember(this.streams, url, info);
    return info;
  }

  private async sizeOf(url: string, identity: Identity): Promise<number> {
    try {
      const res = await open(url, identity.headers, { Range: 'bytes=0-0' }, AbortSignal.timeout(8000));
      res.body.destroy();
      const total = /\/(\d+)\s*$/.exec(header(res.headers, 'content-range'));
      const bytes = total ? Number(total[1]) : res.status === 200 ? Number(header(res.headers, 'content-length')) || 0 : 0;
      if (bytes) remember(this.sizes, url, bytes);
      return bytes;
    } catch {
      return 0;
    }
  }

  private async dashProtected(url: string, identity: Identity): Promise<boolean> {
    try {
      const text = await fetchText(url, identity, false);
      return /<ContentProtection[^>]+(edef8ba9|9a04f079|widevine|playready|cenc)/i.test(text);
    } catch {
      return false;
    }
  }
}

function option(id: string, group: 'video' | 'audio', label: string, detail: string, bytes: number, height: number, url: string, variantUrl: string, audioUrl: string, container = label): VideoOption {
  return { id, group, label, detail, container, bytes, height, url, mode: 'hls', variantUrl, audioUrl };
}

async function fetchText(url: string, identity: Identity, playlist = true): Promise<string> {
  const res = await open(url, identity.headers, {}, AbortSignal.timeout(12_000));
  if (res.status < 200 || res.status >= 300) {
    res.body.destroy();
    throw new Error(`HTTP ${res.status}`);
  }
  const text = (await readBody(res.body, { max: 8 * 1024 * 1024 })).toString('utf8');
  if (playlist && !isPlaylist(text)) throw new Error('not a playlist');
  return text;
}

/** Streams to consider, likeliest master first, then the most recent (a page that moved on to another video). */
function rankStreams(items: Candidate[]): string[] {
  return [...items].sort((a, b) => score(b) - score(a) || b.at - a.at).map((c) => c.url);
}

function score(c: Candidate): number {
  const name = c.url.split('?')[0].split('/').pop() ?? '';
  return (/master|index|playlist|manifest/i.test(name) ? 2 : 0) + (isOpaque(name) ? 0 : 1);
}

/** The frame that loaded a response; a frame already gone (or navigated away) has no address to give. */
function frameUrlOf(d: OnResponseStartedListenerDetails): string {
  try {
    return d.frame?.url ?? '';
  } catch {
    return '';
  }
}

/** Caches that live as long as the app: the oldest entries go once there are enough. */
const CACHE_LIMIT = 400;
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > CACHE_LIMIT) map.delete(map.keys().next().value as string);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}
