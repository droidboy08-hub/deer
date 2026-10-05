// Media the pages load, watched per tab, and DRM use per tab; plus the picker's offer for a video.
// Port of spikes/downloader/verify/engine/VitreMedia.sys.mjs (with the verifier's fix, recipe
// correction 5) and of the offer half of app/src/main/modules/downloads/media.ts.
//
//   responses : the http-on-examine-response observer family gives every nsIHttpChannel as its
//               headers arrive, in the parent process. channel.loadInfo.browsingContext.top.browserId
//               keys the tab (stable across process switches).
//   documents : a tab's record belongs to one top-level DOCUMENT: the innerWindowId of the tab's
//               current top WindowGlobal when the record was made. It is dropped when the tab shows
//               another document, never on a top-level RESPONSE (a download click is one, and the
//               DRM page stays: the prototype's hole). Nothing notifies on navigation with this rule:
//               the window re-reads a tab's count on its own 'tab-navigated' event.
//   DRM       : Firefox's EncryptedMedia parent actor already forwards every "mediakeys-request"
//               (navigator.requestMediaKeySystemAccess) to the parent: its receiveMessage is wrapped
//               to mark the tab. The page module (src/actors/page/downloads.ts) also reports
//               'encrypted' events and each <video>'s mediaKeys. A protected tab offers nothing.
//
// Firefox internals used (157): resource:///actors/EncryptedMediaParent.sys.mjs (receiveMessage,
// JSON {status, keySystem}); BrowsingContext.getCurrentTopByBrowserId; loadInfo.externalContentPolicyType.
import { setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { dashAudio, dashContainer, dashLadder, parseMpd } from './dash';
import { extOf, isOpaque } from './naming';
import { Identity, fetchText, open, parseContentRange } from './net';
import { audioFor, isMaster, isPlaylist, ladder, parseMaster, parseMedia } from './playlist';
import type { MediaNotice, PageVideo, VideoOffer, VideoOption } from './types';
import { probe, ytdlpFirst, ytdlpTools } from './ytdlp';

const SEGMENT_EXT = /\.(ts|m4s|m4f|cmfv|cmfa|aac|vtt|webvtt|key)(\?|#|$)/i;
const HINTS = /thumb|poster|preview|sprite|favicon|emoji|\/ads?\/|doubleclick|googlesyndication/i;
const TOPICS = ['http-on-examine-response', 'http-on-examine-cached-response', 'http-on-examine-merged-response'];

interface Candidate {
  url: string;
  kind: 'hls' | 'dash' | 'video' | 'audio';
  bytes: number;
  at: number;
  frameUrl: string;
}

interface TabMedia {
  doc: number;
  items: Map<string, Candidate>;
  drm: Map<string, string>;
  encrypted: number;
  timer: any;
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

function option(o: Partial<VideoOption> & Pick<VideoOption, 'id' | 'group' | 'label' | 'url' | 'mode'>): VideoOption {
  return { detail: '', container: o.label, bytes: 0, height: 0, variantUrl: '', audioUrl: '', dashVideo: '', dashAudio: '', needsMux: false, ytdlpFormat: '', ytdlpExt: '', ...o } as VideoOption;
}

/** Streams to consider, likeliest master first, then the most recent (a page that moved on to another video). */
function rankStreams(items: Candidate[]): string[] {
  const score = (c: Candidate): number => {
    const name = c.url.split('?')[0].split('/').pop() ?? '';
    return (/master|index|playlist|manifest/i.test(name) ? 2 : 0) + (isOpaque(name) ? 0 : 1);
  };
  return [...items].sort((a, b) => score(b) - score(a) || b.at - a.at).map((c) => c.url);
}

/** An AbortSignal that fires after `ms`. */
function timeout(ms: number): AbortSignal {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), ms);
  return ac.signal;
}

export class MediaWatch {
  /** browserId -> top document (innerWindowId) -> what that document loaded. */
  private tabs = new Map<number, Map<number, TabMedia>>();
  private listeners = new Set<(n: MediaNotice) => void>();
  private streams = new Map<string, StreamInfo>();
  private sizes = new Map<string, number>();
  private installed = false;
  /** EncryptedMediaParent could be tapped (tests). */
  emeTap = false;
  QueryInterface = ChromeUtils.generateQI(['nsIObserver']);

  /** Whether ffmpeg is there decides the containers offered; asked at offer time. */
  constructor(private muxer: () => Promise<boolean>) {}

  install(): void {
    if (this.installed) return;
    this.installed = true;
    for (const t of TOPICS) Services.obs.addObserver(this, t);
    this.tapEme();
  }

  /** Firefox's EncryptedMedia parent actor sees every key-system request of every frame. */
  private tapEme(): void {
    try {
      const { EncryptedMediaParent } = ChromeUtils.importESModule('resource:///actors/EncryptedMediaParent.sys.mjs');
      const proto = EncryptedMediaParent.prototype;
      if (proto.vitreTapped) {
        this.emeTap = true;
        return;
      }
      const original = proto.receiveMessage;
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      proto.receiveMessage = function (this: any, message: any) {
        try {
          const bc = this.browsingContext;
          const id = bc?.top?.browserId;
          const doc = bc && bc === bc.top ? Number(this.manager?.innerWindowId) || 0 : 0;
          const { status, keySystem } = JSON.parse(message.data);
          if (id && keySystem) self.eme(id, { keySystem, status }, doc);
        } catch {
          /* not ours to judge */
        }
        return original.call(this, message);
      };
      proto.vitreTapped = true;
      this.emeTap = true;
    } catch (e) {
      console.error('Deer downloads: could not watch EME requests', e);
    }
  }

  observe(subject: any): void {
    try {
      this.seen(subject.QueryInterface(Ci.nsIHttpChannel));
    } catch {
      /* never let detection disturb loading */
    }
  }

  private docOf(browserId: number): number {
    try {
      return BrowsingContextGlobal().getCurrentTopByBrowserId(browserId)?.currentWindowGlobal?.innerWindowId ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * The tab's record for the document it is showing now. Records are kept per document (a few per
   * tab): a response can be observed before the parent has made its new document current, and a
   * late response of the previous page must not wipe the new page's record.
   */
  private current(browserId: number): TabMedia | undefined {
    return this.tabs.get(browserId)?.get(this.docOf(browserId));
  }

  /** The record of one document of a tab (doc 0: the document the tab shows now). */
  private tab(browserId: number, doc = 0): TabMedia {
    const key = doc || this.docOf(browserId);
    let docs = this.tabs.get(browserId);
    if (!docs) {
      docs = new Map();
      this.tabs.set(browserId, docs);
      // Closed tabs leave their records behind: the oldest tabs go once there are many.
      if (this.tabs.size > 300) this.tabs.delete(this.tabs.keys().next().value as number);
    }
    let tab = docs.get(key);
    if (!tab) {
      tab = { doc: key, items: new Map(), drm: new Map(), encrypted: 0, timer: null };
      docs.set(key, tab);
      while (docs.size > 3) docs.delete(docs.keys().next().value as number);
    }
    return tab;
  }

  private seen(channel: any): void {
    const info = channel.loadInfo;
    const bc = info?.browsingContext;
    // No frame: the browser's own requests, Deer's downloader among them.
    if (!bc?.top?.browserId) return;
    const P = Ci.nsIContentPolicy;
    const policy = info.externalContentPolicyType;
    const type = policy === P.TYPE_MEDIA ? 'media' : policy === P.TYPE_XMLHTTPREQUEST || policy === P.TYPE_FETCH ? 'xhr' : policy === P.TYPE_OTHER || policy === P.TYPE_OBJECT ? 'other' : policy === P.TYPE_SUBDOCUMENT ? 'subFrame' : null;
    // TYPE_DOCUMENT is ignored on purpose (see the header): it may be a download, not a new page.
    if (!type) return;
    const status = channel.responseStatus;
    if (status < 200 || status >= 300 || channel.requestMethod !== 'GET') return;
    const header = (name: string): string => {
      try {
        return channel.getResponseHeader(name);
      } catch {
        return '';
      }
    };
    const mime = header('content-type').split(';')[0].trim().toLowerCase();
    const url: string = channel.URI.spec;
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
    const range = /\/(\d+)\s*$/.exec(header('content-range'));
    const bytes = range ? Number(range[1]) : Number(header('content-length')) || 0;
    if ((kind === 'video' || kind === 'audio') && bytes > 0 && bytes < 500000) return;
    const id = bc.top.browserId;
    // The document that asked: for the top frame the load's own window (never racy), for a frame
    // the top document as it is now.
    const doc = bc === bc.top ? Number(info.innerWindowID) || 0 : 0;
    const tab = this.tab(id, doc);
    const had = tab.items.has(url);
    let frameUrl = '';
    try {
      frameUrl = bc.top === bc ? '' : (bc.currentWindowGlobal?.documentURI?.spec ?? '');
    } catch {
      frameUrl = '';
    }
    tab.items.set(url, { url, kind, bytes: Math.max(bytes, tab.items.get(url)?.bytes ?? 0), at: Date.now(), frameUrl });
    // An endless feed keeps loading media; the oldest it showed are forgotten.
    if (tab.items.size > 200) tab.items.delete(tab.items.keys().next().value as string);
    if (bytes) remember(this.sizes, url, bytes);
    if (!had) this.notify(id);
  }

  /**
   * A media element's own file, reported by the page module (src/actors/page/downloads.ts): media a
   * page got without a request of its own (a clone from Gecko's media cache) still counts.
   */
  element(browserId: number, item: { url: string; kind: 'video' | 'audio'; frameUrl: string }): void {
    if (!/^https?:/i.test(item.url) || HINTS.test(item.url)) return;
    const tab = this.tab(browserId);
    if (tab.items.has(item.url)) return;
    tab.items.set(item.url, { url: item.url, kind: item.kind, bytes: this.sizes.get(item.url) ?? 0, at: Date.now(), frameUrl: item.frameUrl });
    this.notify(browserId);
  }

  /**
   * The page moved to another address without a new document (a single-page site playing the next
   * video: YouTube, X, Instagram...). What the old address played goes; media first or last asked for
   * in the moment before the change stays, since players start fetching the next video just before
   * they update the address. Protection marks stay (safer: a protected video's state is not dropped).
   */
  pageChanged(browserId: number): void {
    const tab = this.current(browserId);
    if (!tab) return;
    const since = Date.now() - 1500;
    let dropped = 0;
    for (const [url, c] of tab.items) {
      if (c.at < since) {
        tab.items.delete(url);
        dropped++;
      }
    }
    if (dropped) this.notify(browserId);
  }

  /** A key-system request or an encrypted stream in a tab (the EME tap, or the page module). */
  eme(browserId: number, data: { keySystem?: string; status?: string; encrypted?: boolean }, doc = 0): void {
    if (data.status === 'is-capture-possible') return;
    const tab = this.tab(browserId, doc);
    if (data.encrypted) tab.encrypted++;
    if (data.keySystem) tab.drm.set(data.keySystem, data.status ?? '');
    this.notify(browserId);
  }

  isProtected(browserId: number): boolean {
    const tab = this.current(browserId);
    return !!tab && (tab.drm.size > 0 || tab.encrypted > 0);
  }

  /** What the tab's download mark counts: nothing on a protected tab. */
  candidates(browserId: number): Candidate[] {
    if (this.isProtected(browserId)) return [];
    const items = [...(this.current(browserId)?.items.values() ?? [])];
    return items.filter((c) => c.kind !== 'audio' || !items.some((v) => v.kind === 'video' || v.kind === 'hls' || v.kind === 'dash'));
  }

  notice(browserId: number): MediaNotice {
    return { browserId, count: this.candidates(browserId).length, protected: this.isProtected(browserId) };
  }

  subscribe(fn: (n: MediaNotice) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(browserId: number): void {
    const docs = this.tabs.get(browserId);
    if (docs && [...docs.values()].some((t) => t.timer)) return;
    const tab = docs ? [...docs.values()].pop() : undefined;
    const fire = (): void => {
      if (tab) tab.timer = null;
      const n = this.notice(browserId);
      for (const fn of [...this.listeners]) {
        try {
          fn(n);
        } catch (e) {
          console.error('Deer downloads: media listener failed', e);
        }
      }
    };
    if (tab) tab.timer = setTimeout(fire, 300);
    else fire();
  }

  // ---- the picker's offer ----

  /**
   * What the picker offers for a video: its qualities, or why it can't be saved.
   * `fit`: the tallest video this screen shows at full size (the suggestion is the best that fits).
   */
  async offer(browserId: number, video: PageVideo, ctx: { pageUrl: string; title: string; userContextId: number; isPrivate: boolean; fit: number; allowTools?: boolean }): Promise<VideoOffer> {
    const title = (video.title || ctx.title || '').trim();
    const muxer = await this.muxer();
    const base: VideoOffer = { state: 'none', key: '', title, host: hostOf(ctx.pageUrl), duration: Number.isFinite(video.duration) ? video.duration : 0, options: [], suggested: '', muxer };
    const key = (what: string): string => `${browserId}|${what}`;
    if (video.protected || this.isProtected(browserId)) return { ...base, state: 'protected', key: key(video.src) };
    if (video.live) return { ...base, state: 'live', key: key(video.src) };
    // Sites whose traffic has nothing downloadable (YouTube): yt-dlp, when the person asked to download.
    if (ytdlpFirst(ctx.pageUrl)) {
      if (!ctx.allowTools) return base;
      if (!ytdlpTools()) return { ...base, needsTools: true, reason: 'Saving videos from this site needs yt-dlp.' };
      return probe(ctx.pageUrl, base, muxer, ctx.fit).catch((e) => ({ ...base, reason: e instanceof Error ? e.message : String(e) }));
    }
    const identity = new Identity({ pageUrl: ctx.pageUrl, userContextId: ctx.userContextId, isPrivate: ctx.isPrivate, withOrigin: true, firstParty: false });
    const src = /^https?:/i.test(video.src) ? video.src : '';
    // An embedded player owns the media its frame loaded; a page's own video, what the page loaded.
    const all = this.candidates(browserId);
    const inPage = all.filter((c) => !c.frameUrl || sameOrigin(c.frameUrl, ctx.pageUrl));
    const items = video.kind === 'frame' ? all.filter((c) => !!c.frameUrl && sameOrigin(c.frameUrl, video.frameSrc)) : inPage.length ? inPage : all;
    const finish = (o: VideoOffer): VideoOffer => {
      const videos = o.options.filter((x) => x.group === 'video');
      const pick = videos.find((x) => x.height && x.height <= ctx.fit) ?? videos[videos.length - 1] ?? o.options[0];
      return { ...o, state: 'ok', suggested: pick?.id ?? '' };
    };

    // HLS: a player loads the master playlist and then one rendition: offer the master, which has every quality.
    const streams = src && /\.m3u8(\?|#|$)/i.test(src) ? [src] : rankStreams(items.filter((c) => c.kind === 'hls'));
    let hls = '';
    let info: StreamInfo | null = null;
    for (const url of streams.slice(0, 4)) {
      const d = await this.describe(url, identity, muxer).catch(() => null);
      if (!d) continue;
      if (!info || (d.master && !info.master)) {
        hls = url;
        info = d;
      }
      if (d.master) break;
    }
    if (hls && info) {
      if (info.drm) return { ...base, state: 'protected', key: key(hls) };
      if (info.live) return { ...base, state: 'live', key: key(hls) };
      if (info.options.length) {
        // A lone rendition without RESOLUTION plays at the element's size; a ladder keeps its bitrates apart.
        const lone = info.options.filter((o) => o.group === 'video').length === 1;
        const options = info.options.map((o) => (o.height || o.group === 'audio' || !lone ? o : { ...o, height: video.height, label: video.height ? `${video.height}p` : o.label }));
        return finish({ ...base, duration: base.duration || info.duration, key: key(hls), options });
      }
    }

    // The element's own file.
    let file = src && !/\.mpd(\?|#|$)/i.test(src) ? src : '';
    // DASH: the best video joined with the best audio.
    const dash = src && /\.mpd(\?|#|$)/i.test(src) ? src : file ? '' : (rankStreams(items.filter((c) => c.kind === 'dash'))[0] ?? '');
    if (dash) {
      const d = await this.describeDash(dash, identity, muxer).catch(() => null);
      if (d?.drm) return { ...base, state: 'protected', key: key(dash) };
      if (d?.live) return { ...base, state: 'live', key: key(dash) };
      if (d?.options.length) return finish({ ...base, duration: base.duration || d.duration, key: key(dash), options: d.options });
    }
    if (!file) file = items.filter((c) => c.kind === 'video').sort((a, b) => b.bytes - a.bytes)[0]?.url ?? '';
    if (file) {
      const bytes = this.sizes.get(file) ?? (await this.sizeOf(file, identity));
      let ext = 'mp4';
      try {
        ext = extOf(new URL(file).pathname) || 'mp4';
      } catch {
        /* keep */
      }
      const opt = option({ id: 'file', group: 'video', label: video.height ? `${video.height}p` : ext.toUpperCase(), detail: video.height >= 2160 ? '4K' : '', container: ext.toUpperCase(), bytes, height: video.height, url: file, mode: 'file' });
      return finish({ ...base, key: key(file), options: [opt] });
    }
    // Nothing readable in the page's traffic: yt-dlp knows many sites, when it is there and asked for.
    if (ctx.allowTools && ytdlpTools() && /^https?:/i.test(ctx.pageUrl)) {
      return probe(ctx.pageUrl, base, muxer, ctx.fit).catch((e) => ({ ...base, reason: e instanceof Error ? e.message : String(e) }));
    }
    return base;
  }

  private async describe(url: string, identity: Identity, muxer: boolean): Promise<StreamInfo> {
    const hit = this.streams.get(url);
    if (hit && Date.now() - hit.at < 60_000) return hit;
    const text = await fetchText(url, identity, timeout(12000));
    if (!isPlaylist(text)) throw new Error('not a playlist');
    const info: StreamInfo = { at: Date.now(), master: false, drm: false, live: false, duration: 0, fmp4: false, options: [] };
    if (isMaster(text)) {
      info.master = true;
      const master = parseMaster(text, url);
      info.drm = master.drm;
      const rungs = ladder(master);
      const sample = rungs.find((v) => !v.audioOnly) ?? rungs[0];
      if (sample) {
        const media = parseMedia(await fetchText(sample.url, identity, timeout(12000)), sample.url);
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
          info.options.push(option({ id: `a${v.bandwidth}`, group: 'audio', label: info.fmp4 || muxer ? 'M4A' : 'AAC', detail: `${Math.round(v.bandwidth / 1000)} kbps`, bytes, url, mode: 'hls', variantUrl: v.url, needsMux: !info.fmp4 }));
        } else {
          const audio = audioFor(master, v)?.url ?? '';
          const label = v.height ? `${v.height}p` : `${Math.round(v.bandwidth / 1000)} kbps`;
          info.options.push(option({ id: `v${v.height}-${v.bandwidth}`, group: 'video', label, detail: v.height >= 2160 ? '4K' : '', container, bytes, height: v.height, url, mode: 'hls', variantUrl: v.url, audioUrl: audio, needsMux: !!audio || !info.fmp4 }));
        }
      }
      // Audio that lives in its own rendition can be saved on its own too.
      if (!info.options.some((o) => o.group === 'audio')) {
        const audio = master.renditions.find((r) => r.type === 'AUDIO' && r.url && r.isDefault) ?? master.renditions.find((r) => r.type === 'AUDIO' && r.url);
        if (audio) info.options.push(option({ id: 'audio', group: 'audio', label: info.fmp4 || muxer ? 'M4A' : 'AAC', detail: audio.name || audio.language || '', url, mode: 'hls', variantUrl: audio.url, needsMux: !info.fmp4 }));
      }
    } else {
      const media = parseMedia(text, url);
      info.drm = media.drm;
      info.live = !media.endList;
      info.duration = media.duration;
      info.fmp4 = !!media.init;
      info.options.push(option({ id: 'stream', group: 'video', label: 'Original', container: info.fmp4 || muxer ? 'MP4' : 'TS', url, mode: 'hls', variantUrl: url, needsMux: !info.fmp4 }));
    }
    remember(this.streams, url, info);
    return info;
  }

  private async describeDash(url: string, identity: Identity, muxer: boolean): Promise<StreamInfo> {
    const hit = this.streams.get(url);
    if (hit && Date.now() - hit.at < 60_000) return hit;
    const mpd = parseMpd(await fetchText(url, identity, timeout(12000)), url);
    const info: StreamInfo = { at: Date.now(), master: true, drm: mpd.drm, live: mpd.live, duration: mpd.duration, fmp4: true, options: [] };
    if (!mpd.drm && !mpd.live && mpd.periods <= 1) {
      const audio = dashAudio(mpd);
      for (const v of dashLadder(mpd)) {
        const bytes = mpd.duration ? Math.round(((v.bandwidth + (audio?.bandwidth ?? 0)) / 8) * mpd.duration) : 0;
        const label = v.height ? `${v.height}p` : `${Math.round(v.bandwidth / 1000)} kbps`;
        info.options.push(option({ id: `d${v.id}`, group: 'video', label, detail: v.height >= 2160 ? '4K' : '', container: dashContainer(v), bytes, height: v.height, url, mode: 'dash', dashVideo: v.id, dashAudio: audio?.id ?? '', needsMux: !!audio }));
      }
      if (audio) {
        const bytes = mpd.duration ? Math.round((audio.bandwidth / 8) * mpd.duration) : 0;
        info.options.push(option({ id: `da${audio.id}`, group: 'audio', label: dashContainer(audio) === 'WEBM' ? 'WEBA' : 'M4A', detail: audio.bandwidth ? `${Math.round(audio.bandwidth / 1000)} kbps` : '', bytes, url, mode: 'dash', dashAudio: audio.id }));
      }
    }
    void muxer;
    remember(this.streams, url, info);
    return info;
  }

  private async sizeOf(url: string, identity: Identity): Promise<number> {
    try {
      const res = await open(url, identity, { Range: 'bytes=0-0' }, timeout(8000));
      res.destroy();
      const total = parseContentRange(res.header('content-range'))?.total ?? -1;
      const bytes = total > 0 ? total : res.status === 200 ? Math.max(0, res.contentLength) : 0;
      if (bytes) remember(this.sizes, url, bytes);
      return bytes;
    } catch {
      return 0;
    }
  }

  /** For tests and diagnostics: the tab's record as it stands. */
  debug(browserId: number): { items: string[]; drm: string[]; encrypted: number; doc: number } | null {
    const tab = this.current(browserId);
    return tab ? { items: [...tab.items.keys()], drm: [...tab.drm.keys()], encrypted: tab.encrypted, doc: tab.doc } : null;
  }
}

/** The BrowsingContext interface object (a WebIDL global in the system scope). */
function BrowsingContextGlobal(): any {
  return (globalThis as any).BrowsingContext;
}
