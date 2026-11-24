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
import { HttpStatusError, Identity, fetchText, open, parseContentRange } from './net';
import { audioFor, isMaster, isPlaylist, ladder, parseMaster, parseMedia } from './playlist';
import { renditionRung, repRung, rungOf } from './table';
import type { MediaNotice, PageVideo, VideoOffer, VideoOption } from './types';
import {
  decompressResponse,
  decryptFlixManifest,
  embedFallback,
  getCachedPlaylist,
  isEncryptedFlixManifest,
  isFlixcloud,
  isReanime,
  looseFramePlaylist,
  reanimeCandidates,
  rememberPlaylist,
  setFlixPk,
} from './webdownfix';
import { probe, ytdlpFirst, ytdlpTools } from './ytdlp';

function deerLog(msg: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    dump(line);
    console.warn(msg);
    IOUtils.writeUTF8('/Users/droid/Documents/Projects/Deer browser/gecko/deer-debug.log', line, { mode: 'append' }).catch(() => {});
  } catch {}
}

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

/**
 * Streams to consider, likeliest master first, then the most recent (a page that moved on to another video).
 * Also the order the background page step tries a hidden page's streams in (RESUME-DESIGN.md G2 step 4).
 */
export function rankStreams(items: Pick<Candidate, 'url' | 'at'>[]): string[] {
  const score = (c: Pick<Candidate, 'url'>): number => {
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
  /** Media address -> the embedded player's frame it had to be asked for as (see offer()). */
  private framePages = new Map<string, string>();
  /** Media address -> the Referer the page actually sent for it. */
  private sentReferrer = new Map<string, string>();
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

  private teedUrls = new Set<string>();

  private teePlaylist(channel: any, url: string): void {
    if (this.teedUrls.has(url)) return;
    this.teedUrls.add(url);
    try {
      if (!(channel instanceof Ci.nsITraceableChannel)) return;
      const pipe = Cc['@mozilla.org/pipe;1'].createInstance(Ci.nsIPipe);
      pipe.init(false, false, 0, 0xffffffff, null);
      const tee = Cc['@mozilla.org/network/stream-listener-tee;1'].createInstance(Ci.nsIStreamListenerTee);
      const observer = {
        QueryInterface: ChromeUtils.generateQI(['nsIRequestObserver']),
        onStartRequest: () => {},
        onStopRequest: () => {
          try {
            pipe.outputStream.close();
            const len = pipe.inputStream.available();
            if (len > 0) {
              const sin = Cc['@mozilla.org/scriptableinputstream;1'].createInstance(Ci.nsIScriptableInputStream);
              sin.init(pipe.inputStream);
              const raw = sin.readBytes(len);
              sin.close();
              let encoding = '';
              try {
                encoding = channel.getResponseHeader('Content-Encoding') || '';
              } catch {}
              const body = decompressResponse(raw, encoding);
              deerLog(`[Tee captured] url=${url} rawLen=${len} finalLen=${body.length} isPlaylist=${isPlaylist(body)} startsWith: ${body.slice(0, 80).replace(/\r?\n/g, ' ')}`);
              rememberPlaylist(url, body);
            }
          } catch (e) {
            deerLog(`tee onStopRequest error for ${url}: ${e}`);
          }
        },
      };
      const orig = channel.setNewListener(tee);
      tee.init(orig, pipe.outputStream, observer);
      deerLog(`teePlaylist successfully attached for ${url}`);
    } catch (e) {
      deerLog(`teePlaylist failed for ${url}: ${e}`);
    }
  }

  private async findFlixPk(browserId = 0): Promise<string | null> {
    try {
      const top = browserId ? BrowsingContextGlobal().getCurrentTopByBrowserId(browserId) : null;
      const contexts = top ? [top] : Array.from(this.tabs.keys()).map((id) => BrowsingContextGlobal().getCurrentTopByBrowserId(id)).filter(Boolean);
      for (const t of contexts) {
        if (!t?.children) continue;
        for (const child of t.children) {
          try {
            const actor = child.currentWindowGlobal?.getActor('VitrePage');
            if (actor) {
              const pk = await actor.query('downloads:flix-pk');
              if (pk) {
                deerLog(`findFlixPk: found pk in child frame: ${pk}`);
                setFlixPk(String(pk));
                return String(pk);
              }
            }
          } catch {}
        }
      }
    } catch (e) {
      deerLog(`findFlixPk error: ${e}`);
    }
    return null;
  }

  private seen(channel: any): void {
    const info = channel.loadInfo;
    const bc = info?.browsingContext;
    const rawUrl = String(channel.URI?.spec ?? '');
    const isTarget = rawUrl.includes('reanime') || rawUrl.includes('flixcloud') || rawUrl.includes('m3u8') || rawUrl.includes('/api/');
    if (isTarget) {
      deerLog(`seen raw: url=${rawUrl} status=${channel.responseStatus} method=${channel.requestMethod} policy=${info?.externalContentPolicyType} bc=${!!bc} inFrame=${bc?.top !== bc} browserId=${bc?.top?.browserId}`);
    }
    // No frame: the browser's own requests, Deer's downloader among them.
    if (!bc?.top?.browserId) return;
    const P = Ci.nsIContentPolicy;
    const policy = info.externalContentPolicyType;
    // TYPE_DOCUMENT is ignored on purpose (see the header): it may be a download, not a new page.
    if (policy === P.TYPE_DOCUMENT) return;
    const type = policy === P.TYPE_MEDIA ? 'media' : policy === P.TYPE_XMLHTTPREQUEST || policy === P.TYPE_FETCH ? 'xhr' : policy === P.TYPE_OTHER || policy === P.TYPE_OBJECT ? 'other' : policy === P.TYPE_SUBDOCUMENT ? 'subFrame' : 'other';
    const status = channel.responseStatus;
    if ((status < 200 || status >= 300) && status !== 304) return;
    if (channel.requestMethod !== 'GET') return;
    const header = (name: string): string => {
      try {
        return channel.getResponseHeader(name);
      } catch {
        return '';
      }
    };
    const mime = header('content-type').split(';')[0].trim().toLowerCase();
    const url: string = channel.URI.spec;
    // The document that made this request. Read once: a subframe also counts a playlist address the
    // end-of-path test misses (webdownfix.ts), and the same value is the frame address below.
    let documentUrl = '';
    try {
      documentUrl = bc.currentWindowGlobal?.documentURI?.spec ?? '';
    } catch {
      documentUrl = '';
    }
    let played = '';
    try {
      played = channel.getRequestHeader('Referer');
    } catch {
      played = '';
    }
    // If the iframe is sandboxed without allow-same-origin, documentURI may be empty or about:blank.
    // Fall back to the Referer header the player actually sent, or the loading principal.
    if ((!documentUrl || !/^https?:/i.test(documentUrl)) && played && /^https?:/i.test(played)) {
      documentUrl = played;
    }
    if (!documentUrl || !/^https?:/i.test(documentUrl)) {
      try {
        const lp = info?.loadingPrincipal?.URI?.spec;
        if (lp && /^https?:/i.test(lp)) documentUrl = lp;
      } catch {
        /* ignore */
      }
    }
    let originalUrl = '';
    try {
      originalUrl = String(channel.originalURI?.spec ?? '');
    } catch {
      originalUrl = '';
    }
    let kind: Candidate['kind'] | null = null;
    if (
      (!/json/.test(mime) && (/mpegurl/.test(mime) || /\.m3u8(\?|#|$)/i.test(url))) ||
      looseFramePlaylist(url, bc.top !== bc, documentUrl, played, mime) ||
      (originalUrl && looseFramePlaylist(originalUrl, bc.top !== bc, documentUrl, played, mime))
    ) {
      kind = 'hls';
    } else if (/dash\+xml/.test(mime) || /\.mpd(\?|#|$)/i.test(url)) kind = 'dash';
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
    if (kind === 'hls' && (isFlixcloud(documentUrl) || isFlixcloud(played) || isFlixcloud(url) || isReanime(documentUrl))) {
      this.teePlaylist(channel, url);
    }
    const id = bc.top.browserId;
    // The document that asked: for the top frame the load's own window (never racy), for a frame
    // the top document as it is now.
    const doc = bc === bc.top ? Number(info.innerWindowID) || 0 : 0;
    const tab = this.tab(id, doc);
    const had = tab.items.has(url);
    const frameUrl = bc.top === bc ? '' : documentUrl;
    if (/^https?:/i.test(played)) remember(this.sentReferrer, url, played);
    // A redirect's final address often drops `.m3u8`. Remember the referer on that address too.
    if (originalUrl && originalUrl !== url && /^https?:/i.test(played)) remember(this.sentReferrer, originalUrl, played);
    tab.items.set(url, { url, kind, bytes: Math.max(bytes, tab.items.get(url)?.bytes ?? 0), at: Date.now(), frameUrl });
    // An endless feed keeps loading media; the oldest it showed are forgotten.
    if (tab.items.size > 200) tab.items.delete(tab.items.keys().next().value as string);
    if (bytes) remember(this.sizes, url, bytes);
    deerLog(`[Deer media seen] url: ${url} kind: ${kind} mime: ${mime} frame: ${frameUrl} played: ${played}`);
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
    const tab = this.current(browserId) ?? [...(this.tabs.get(browserId)?.values() ?? [])].pop();
    const items = [...(tab?.items.values() ?? [])];
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
    const all = this.candidates(browserId);
    const hasStream = all.some((c) => c.kind === 'hls' || c.kind === 'dash');
    if (video.live && !video.src.startsWith('blob:') && !hasStream && !isReanime(ctx.pageUrl)) {
      return { ...base, state: 'live', key: key(video.src) };
    }
    // Sites whose traffic has nothing downloadable (YouTube): yt-dlp, when the person asked to download.
    if (ytdlpFirst(ctx.pageUrl)) {
      if (!ctx.allowTools) return base;
      if (!ytdlpTools()) return { ...base, needsTools: true, reason: 'Saving videos from this site needs yt-dlp.' };
      return probe(ctx.pageUrl, base, muxer, ctx.fit).catch((e) => ({ ...base, reason: e instanceof Error ? e.message : String(e) }));
    }
    const identity = new Identity({ pageUrl: ctx.pageUrl, userContextId: ctx.userContextId, isPrivate: ctx.isPrivate, withOrigin: true, firstParty: false });
    const src = /^https?:/i.test(video.src) ? video.src : '';
    // An embedded player owns the media its frame loaded; a page's own video, what the page loaded.
    deerLog(`offer start: browserId=${browserId} pageUrl=${ctx.pageUrl} videoKind=${video.kind} videoSrc=${video.src} frameSrc=${video.frameSrc} allCandidates=${all.length}`);
    for (const c of all) {
      deerLog(`offer candidate: url=${c.url} kind=${c.kind} frameUrl=${c.frameUrl}`);
    }
    const inPage = all.filter((c) => !c.frameUrl || sameOrigin(c.frameUrl, ctx.pageUrl));
    let items = video.kind === 'frame' ? all.filter((c) => !!c.frameUrl && sameOrigin(c.frameUrl, video.frameSrc)) : inPage.length ? inPage : all;
    let directFrame = false;

    // Site-specific rule for reanime: watch host reanime.cz/reanime.to, player host flixcloud.cc
    if (isReanime(ctx.pageUrl)) {
      const reanimeItems = reanimeCandidates(ctx.pageUrl, all);
      deerLog(`offer reanimeItems=${reanimeItems ? reanimeItems.length : 0}`);
      if (reanimeItems && reanimeItems.length) {
        items = reanimeItems;
        directFrame = true;
        deerLog(`offer: reanime rule ACTIVATED, ${items.length} candidates, directFrame=true`);
      }
    }
    const finish = (o: VideoOffer): VideoOffer => {
      const videos = o.options.filter((x) => x.group === 'video');
      const pick = videos.find((x) => x.height && x.height <= ctx.fit) ?? videos[videos.length - 1] ?? o.options[0];
      return { ...o, state: 'ok', suggested: pick?.id ?? '' };
    };
    // An embedded player's media is asked for as the tab's page first. Only when its server refuses that
    // (4xx: hotlink rules that want the player's own site in Referer / Origin) is it asked again as the
    // player's frame, the way the player itself asked; the download then goes out the same way
    // (VideoOffer.requestPage). Media that works as the tab's page never takes this path. A second pass
    // (webdownfix.ts) runs only when this one found nothing, and that pass also retries a refusal that
    // was not a 4xx. Each address is asked as the page once and as the frame once.
    let picked = items;
    let soft = false;
    const pageFailed = new Set<string>();
    const frameTried = new Set<string>();
    const frameOf = (url: string): string => {
      const frame = picked.find((c) => c.url === url)?.frameUrl || (video.kind === 'frame' ? video.frameSrc : '');
      return /^https?:/i.test(frame) && !sameOrigin(frame, ctx.pageUrl) ? frame : '';
    };
    const asFrame = (frame: string): Identity => {
      // The tab's own cookie jar: an iframe's cookies are stored under the watch page, not under the player.
      const jar = tabJar(browserId);
      return new Identity({
        pageUrl: ctx.pageUrl,
        requestPage: frame,
        userContextId: ctx.userContextId,
        isPrivate: ctx.isPrivate,
        withOrigin: true,
        firstParty: false,
        referrerPolicy: 'unsafe-url',
        ...(jar.cookieJarSettings ? { cookieJarSettings: jar.cookieJarSettings } : {}),
      });
    };
    const read = async <T>(url: string, fn: (id: Identity) => Promise<T>): Promise<{ value: T; page: string } | null> => {
      const frame = frameOf(url);
      const known = frame && this.framePages.get(url) === frame;
      const asPlayer = async (): Promise<{ value: T; page: string } | null> => {
        if (!frame || frameTried.has(url)) return null;
        frameTried.add(url);
        const played = this.sentReferrer.get(url) || '';
        const sent = played && !sameOrigin(played, ctx.pageUrl) ? played : frame;
        deerLog(`read asPlayer START: url=${url} frame=${frame} played=${played} sent=${sent}`);
        try {
          const value = await fn(asFrame(sent));
          remember(this.framePages, url, sent);
          deerLog(`read asPlayer SUCCESS: url=${url}`);
          return { value, page: sent };
        } catch (err) {
          deerLog(`read asPlayer FAILED: url=${url} error: ${String(err)} status=${(err as any)?.status}`);
          return null;
        }
      };
      if (known || (directFrame && frame)) {
        deerLog(`read: using asPlayer directly (known=${known}, directFrame=${directFrame}, frame=${frame})`);
        return asPlayer();
      }
      if (!pageFailed.has(url)) {
        try {
          deerLog(`read asPage START: url=${url}`);
          return { value: await fn(identity), page: '' };
        } catch (e) {
          deerLog(`read asPage FAILED: url=${url} error: ${String(e)} status=${(e as any)?.status}`);
          pageFailed.add(url);
          const hotlink = e instanceof HttpStatusError && e.status >= 400 && e.status < 500;
          if (!frame || (!hotlink && !soft)) return null;
        }
      } else if (!soft || !frame) {
        return null;
      }
      return asPlayer();
    };
    const via = (page: string): Partial<VideoOffer> => (page ? { requestPage: page } : {});
    // One pass over a candidate set. `useSrc` is the element's own address (the first pass only).
    // `again` is the fallback: a refusal that was not a 4xx is asked again as the player frame.
    const consider = async (list: Candidate[], useSrc: boolean, again: boolean): Promise<VideoOffer | null> => {
      picked = list;
      soft = again;
      // HLS: a player loads the master playlist and then one rendition: offer the master, which has every quality.
      const streams = useSrc && src && /\.m3u8(\?|#|$)/i.test(src) ? [src] : rankStreams(list.filter((c) => c.kind === 'hls'));
      let hls = '';
      let hlsPage = '';
      let info: StreamInfo | null = null;
      for (const url of streams.slice(0, 4)) {
        const got = await read(url, (id) => this.describe(url, id, muxer, false, browserId));
        if (!got) continue;
        const d = got.value;
        if (!info || (d.master && !info.master)) {
          hls = url;
          hlsPage = got.page;
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
          return finish({ ...base, duration: base.duration || info.duration, key: key(hls), options, ...via(hlsPage) });
        }
      }

      // The element's own file.
      let file = useSrc && src && !/\.mpd(\?|#|$)/i.test(src) ? src : '';
      // DASH: the best video joined with the best audio.
      const dash = useSrc && src && /\.mpd(\?|#|$)/i.test(src) ? src : file ? '' : (rankStreams(list.filter((c) => c.kind === 'dash'))[0] ?? '');
      if (dash) {
        const got = await read(dash, (id) => this.describeDash(dash, id, muxer));
        const d = got?.value;
        if (d?.drm) return { ...base, state: 'protected', key: key(dash) };
        if (d?.live) return { ...base, state: 'live', key: key(dash) };
        if (d?.options.length) return finish({ ...base, duration: base.duration || d.duration, key: key(dash), options: d.options, ...via(got?.page ?? '') });
      }
      if (!file) file = list.filter((c) => c.kind === 'video').sort((a, b) => b.bytes - a.bytes)[0]?.url ?? '';
      if (file) {
        let bytes = this.sizes.get(file) ?? 0;
        let filePage = '';
        if (frameOf(file)) {
          // A frame's file: one small request tells whether its server takes the tab's page.
          const target = file;
          const got = await read(target, (id) => this.probeSize(target, id));
          bytes ||= got?.value ?? 0;
          filePage = got?.page ?? '';
        } else if (!bytes) bytes = await this.sizeOf(file, identity);
        let ext = 'mp4';
        try {
          ext = extOf(new URL(file).pathname) || 'mp4';
        } catch {
          /* keep */
        }
        const opt = option({ id: 'file', group: 'video', label: video.height ? `${video.height}p` : ext.toUpperCase(), detail: video.height >= 2160 ? '4K' : '', container: ext.toUpperCase(), bytes, height: video.height, url: file, mode: 'file' });
        return finish({ ...base, key: key(file), options: [opt], ...via(filePage) });
      }
      return null;
    };
    const found = await consider(items, true, false);
    if (found) return found;
    // The first pass found nothing. A cross-origin player (the reanime shape, on any site) is asked
    // as itself. Addresses the first pass already sent as the frame are not sent again.
    const embedded = embedFallback(ctx.pageUrl, all);
    if (embedded) {
      const again = await consider(embedded, false, true);
      if (again) return again;
    }
    // Nothing readable in the page's traffic: yt-dlp knows many sites, when it is there and asked for.
    if (ctx.allowTools && ytdlpTools() && /^https?:/i.test(ctx.pageUrl)) {
      return probe(ctx.pageUrl, base, muxer, ctx.fit).catch((e) => ({ ...base, reason: e instanceof Error ? e.message : String(e) }));
    }
    return base;
  }

  /**
   * A stream a hidden page loaded, described fresh (RESUME-DESIGN.md G2 step 4, Phase 7: the 60 s cache is
   * skipped, since the page step looks for addresses that work now): its length, DRM and whether it is live.
   * Throws when it does not read as a playlist or manifest.
   */
  async streamInfo(url: string, kind: 'hls' | 'dash', identity: Identity): Promise<{ duration: number; drm: boolean; live: boolean }> {
    const muxer = await this.muxer();
    const info = kind === 'dash' ? await this.describeDash(url, identity, muxer, true) : await this.describe(url, identity, muxer, true);
    return { duration: info.duration, drm: info.drm, live: info.live };
  }

  private async describe(url: string, identity: Identity, muxer: boolean, fresh = false, browserId = 0): Promise<StreamInfo> {
    const hit = this.streams.get(url);
    if (hit && !fresh && Date.now() - hit.at < 60_000) return hit;
    let text = (!fresh && getCachedPlaylist(url)) || '';
    if (text) {
      deerLog(`describe: using cached teed playlist for ${url} (${text.length} chars, isPlaylist=${isPlaylist(text)})`);
    } else {
      deerLog(`describe: fetching playlist text for ${url} (requestPage=${identity.requestPage}, refPolicy=${identity.referrerPolicy})`);
      try {
        text = await fetchText(url, identity, timeout(12000));
        deerLog(`describe: fetched playlist text (${text.length} chars, isPlaylist=${isPlaylist(text)}, isMaster=${isMaster(text)})`);
      } catch (err) {
        deerLog(`describe: fetchText FAILED for ${url}: ${String(err)} status=${(err as any)?.status}`);
        throw err;
      }
    }
    if (!isPlaylist(text) && isEncryptedFlixManifest(text)) {
      deerLog(`describe: encrypted flix manifest detected, searching for flix pk...`);
      const pk = await this.findFlixPk(browserId);
      if (pk) {
        const dec = decryptFlixManifest(text, pk);
        if (isPlaylist(dec)) {
          deerLog(`describe: successfully decrypted manifest! (${dec.length} chars) content: ${dec.slice(0, 500).replace(/\r?\n/g, '\\n')}`);
          text = dec;
          rememberPlaylist(url, text);
        }
      }
    }
    if (!isPlaylist(text)) {
      deerLog(`describe: NOT A PLAYLIST! First 300 chars: ${text.slice(0, 300)}`);
      throw new Error('not a playlist');
    }
    const info: StreamInfo = { at: Date.now(), master: false, drm: false, live: false, duration: 0, fmp4: false, options: [] };
    if (isMaster(text)) {
      info.master = true;
      const master = parseMaster(text, url);
      info.drm = master.drm;
      const rungs = ladder(master);
      const sample = rungs.find((v) => !v.audioOnly) ?? rungs[0];
      if (sample) {
        deerLog(`describe: fetching variant sample ${sample.url}`);
        try {
          let sampleText = (!fresh && getCachedPlaylist(sample.url)) || '';
          if (sampleText) {
            deerLog(`describe: using cached teed playlist for variant sample ${sample.url}`);
          } else {
            sampleText = await fetchText(sample.url, identity, timeout(12000));
          }
          if (!isPlaylist(sampleText) && isEncryptedFlixManifest(sampleText)) {
            const pk = await this.findFlixPk(browserId);
            if (pk) {
              const dec = decryptFlixManifest(sampleText, pk);
              if (isPlaylist(dec)) {
                sampleText = dec;
                rememberPlaylist(sample.url, sampleText);
              }
            }
          }
          const media = parseMedia(sampleText, sample.url);
          info.drm ||= media.drm;
          info.live = !media.endList;
          info.duration = media.duration;
          info.fmp4 = !!media.init;
          deerLog(`describe: variant sample parsed, duration=${media.duration}, live=${info.live}`);
        } catch (err) {
          deerLog(`describe: variant sample FAILED: ${sample.url}: ${String(err)}`);
          throw err;
        }
      }
      const container = info.fmp4 || muxer ? 'MP4' : 'TS';
      for (const v of rungs) {
        // BANDWIDTH already counts the audio rendition a variant plays with.
        // Some players (like FlixCloud) write BANDWIDTH in kbps (e.g. 5184 for 1080p, instead of 5184000).
        const rawBw = v.average || v.bandwidth;
        const bw = rawBw > 0 && rawBw < 50_000 ? rawBw * 1000 : rawBw;
        const bytes = info.duration ? Math.round((bw / 8) * info.duration) : 0;
        // RESUME-DESIGN.md 5.3 (Phase 6): each quality's fingerprint goes with the download (StartOptions.rung).
        if (v.audioOnly) {
          info.options.push(option({ id: `a${v.bandwidth}`, group: 'audio', label: info.fmp4 || muxer ? 'M4A' : 'AAC', detail: `${Math.round(bw / 1000)} kbps`, bytes, url, mode: 'hls', variantUrl: v.url, needsMux: !info.fmp4, rung: rungOf(v, null) }));
        } else {
          const rendition = audioFor(master, v);
          const audio = rendition?.url ?? '';
          const label = v.height ? `${v.height}p` : `${Math.round(bw / 1000)} kbps`;
          info.options.push(option({ id: `v${v.height}-${v.bandwidth}`, group: 'video', label, detail: v.height >= 2160 ? '4K' : '', container, bytes, height: v.height, url, mode: 'hls', variantUrl: v.url, audioUrl: audio, needsMux: !!audio || !info.fmp4, rung: rungOf(v, rendition) }));
        }
      }
      // Audio that lives in its own rendition can be saved on its own too.
      if (!info.options.some((o) => o.group === 'audio')) {
        const audio = master.renditions.find((r) => r.type === 'AUDIO' && r.url && r.isDefault) ?? master.renditions.find((r) => r.type === 'AUDIO' && r.url);
        // Its fingerprint too (review of Phase 6: without it a master read again could never find it).
        if (audio) info.options.push(option({ id: 'audio', group: 'audio', label: info.fmp4 || muxer ? 'M4A' : 'AAC', detail: audio.name || audio.language || '', url, mode: 'hls', variantUrl: audio.url, needsMux: !info.fmp4, rung: renditionRung(audio) }));
      }
      deerLog(`describe: finish with ${info.options.length} options: ${info.options.map((o) => o.label).join(', ')}`);
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

  private async describeDash(url: string, identity: Identity, muxer: boolean, fresh = false): Promise<StreamInfo> {
    const hit = this.streams.get(url);
    if (hit && !fresh && Date.now() - hit.at < 60_000) return hit;
    const mpd = parseMpd(await fetchText(url, identity, timeout(12000)), url);
    const info: StreamInfo = { at: Date.now(), master: true, drm: mpd.drm, live: mpd.live, duration: mpd.duration, fmp4: true, options: [] };
    if (!mpd.drm && !mpd.live && mpd.periods <= 1) {
      const audio = dashAudio(mpd);
      for (const v of dashLadder(mpd)) {
        const bytes = mpd.duration ? Math.round(((v.bandwidth + (audio?.bandwidth ?? 0)) / 8) * mpd.duration) : 0;
        const label = v.height ? `${v.height}p` : `${Math.round(v.bandwidth / 1000)} kbps`;
        info.options.push(option({ id: `d${v.id}`, group: 'video', label, detail: v.height >= 2160 ? '4K' : '', container: dashContainer(v), bytes, height: v.height, url, mode: 'dash', dashVideo: v.id, dashAudio: audio?.id ?? '', needsMux: !!audio, rung: { ...repRung(v), ...(audio ? { audio: repRung(audio) } : {}) } }));
      }
      if (audio) {
        const bytes = mpd.duration ? Math.round((audio.bandwidth / 8) * mpd.duration) : 0;
        info.options.push(option({ id: `da${audio.id}`, group: 'audio', label: dashContainer(audio) === 'WEBM' ? 'WEBA' : 'M4A', detail: audio.bandwidth ? `${Math.round(audio.bandwidth / 1000)} kbps` : '', bytes, url, mode: 'dash', dashAudio: audio.id, rung: repRung(audio) }));
      }
    }
    void muxer;
    remember(this.streams, url, info);
    return info;
  }

  private async sizeOf(url: string, identity: Identity): Promise<number> {
    return this.probeSize(url, identity).catch(() => 0);
  }

  /** The file's size from a one-byte request (0 when the server does not say); an HttpStatusError when it refuses. */
  private async probeSize(url: string, identity: Identity): Promise<number> {
    const res = await open(url, identity, { Range: 'bytes=0-0' }, timeout(8000));
    res.destroy();
    if (res.status >= 400) throw new HttpStatusError(res.status, null);
    const total = parseContentRange(res.header('content-range'))?.total ?? -1;
    const bytes = total > 0 ? total : res.status === 200 ? Math.max(0, res.contentLength) : 0;
    if (bytes) remember(this.sizes, url, bytes);
    return bytes;
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

/** The tab's principal and cookie jar, so a player iframe's media is asked for in the same jar the iframe used. */
function tabJar(browserId: number): { principal: string; cookieJarSettings: string } {
  const empty = { principal: '', cookieJarSettings: '' };
  try {
    const top = BrowsingContextGlobal().getCurrentTopByBrowserId(browserId);
    const wgp = top?.currentWindowGlobal;
    const principal = wgp?.documentPrincipal;
    if (!principal || principal.isSystemPrincipal) return empty;
    const { E10SUtils } = ChromeUtils.importESModule('resource://gre/modules/E10SUtils.sys.mjs');
    const serialized = String(E10SUtils.serializePrincipal(principal) ?? '');
    if (!serialized) return empty;
    const cookieJarSettings = wgp.cookieJarSettings ? String(E10SUtils.serializeCookieJarSettings(wgp.cookieJarSettings) ?? '') : '';
    return { principal: serialized, cookieJarSettings };
  } catch {
    return empty;
  }
}
