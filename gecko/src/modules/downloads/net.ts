// HTTP for the downloader: Necko channels opened from the system scope, with the retry rules of
// app/src/main/modules/downloads/net.ts. Port of the verified prototype
// spikes/downloader/verify/engine/VitreNet.sys.mjs. Cookies, User-Agent, Accept-Language, proxy and
// certificates are Necko's own, picked by the channel's origin attributes (container, private
// browsing); the Referer policy is Deer's (see dress()).
//
// Connections ("lanes", recipe correction 1): a channel given a lane gets its own network partition
// (loadInfo.cookieJarSettings initialised for https://vitre-lane-<n>.invalid/), so Necko keeps a
// separate connection-pool entry for it: its own socket, its own 6-per-host budget, its own HTTP/2
// session. No global pref is touched. Unpartitioned cookies are not affected (verified for the
// default jar, containers, private jars and a page as loading principal). With a lane, HTTP/3 is
// switched off (allowHttp3 = false); HTTP/2 stays allowed (recipe correction 2).
//
// Page-derived downloads (identity.principal, from the 'downloads' service): the page's principal is
// the loading and triggering principal, its cookie jar settings and referrer policy go with it, and
// third-party cookies are forced as Firefox's own Save Link As does (nsContextMenu.sys.mjs
// saveHelper). The page's jar replaces a lane's when the address is another site than the jar's
// partition (its partitioned cookies must not be traded for the lane's): such a connection shares
// the pool like a page's request.
//
// Necko pushes data (nsIStreamListener). open() resolves at onStartRequest with the channel
// SUSPENDED, so the caller looks at the status and headers first and then either stream()s the
// body (the channel is resumed) or destroy()s it.
//
// Firefox internals used (157, reference/omni):
//   NetUtil.newChannel / readInputStream        gre/modules/NetUtil.sys.mjs
//   nsIHttpChannelInternal channelIsForDownload, forceAllowThirdPartyCookie, allowHttp3
//                                               (DownloadCore.sys.mjs sets the first two for its own saver)
//   loadInfo.cookieJarSettings assignment       gre/modules/DownloadCore.sys.mjs (same assignment)
//   nsIChannelEventSink via notificationCallbacks (headers are not carried over a redirect)
//   E10SUtils.deserializePrincipal / deserializeCookieJarSettings  gre/modules/E10SUtils.sys.mjs
//   nsICookieJarSettings.partitionKey            netwerk/cookie/nsICookieJarSettings.idl
import { E10SUtils } from 'resource://gre/modules/E10SUtils.sys.mjs';
import { NetUtil } from 'resource://gre/modules/NetUtil.sys.mjs';
import { clearTimeout, setTimeout } from 'resource://gre/modules/Timer.sys.mjs';
import { asPolicy, referrerFor, type ReferrerPolicy } from './referrer';
import type { IdentityJSON } from './types';

/** A failure with a sentence a person can read; never retried. */
export class DownloadError extends Error {}

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: number | null
  ) {
    super(statusMessage(status));
  }
}

export class AbortedError extends Error {
  constructor() {
    super('Stopped');
    this.name = 'AbortError';
  }
}

/** The server turned a connection away (429, 503) while the download has others. */
export class ConnectionRefusedError extends Error {}

/** The body ended before the bytes asked for. */
export class ShortBodyError extends Error {
  constructor() {
    super('The connection closed early.');
  }
}

/** A Necko failure: `result` is the nsresult, `code` its name (NS_ERROR_NET_RESET, ...). */
export class NetError extends Error {
  readonly code: string;
  constructor(readonly result: number) {
    const code = ChromeUtils.getXPCOMErrorName(result);
    super(code);
    this.code = code;
  }
}

/**
 * Writing the file failed (disk full, access denied, a locked range). Never retried, never shown as
 * a network problem (recipe correction 6). Defined here so every module classifies it the same way.
 */
export class DiskError extends Error {
  readonly code: string;
  constructor(readonly result: number) {
    const code = ChromeUtils.getXPCOMErrorName(result);
    super(code);
    this.code = code;
  }
}

/** 403 is here on purpose: on a CDN it is usually a token that fresh cookies fix. */
export const RETRYABLE_STATUS = new Set([403, 408, 425, 429, 500, 502, 503, 504, 507, 509]);

export function refusedConnection(err: unknown): boolean {
  return err instanceof HttpStatusError && (err.status === 429 || err.status === 503);
}

const IDLE_TIMEOUT_MS = 30000;
const system = (): any => Services.scriptSecurityManager.getSystemPrincipal();

/**
 * Whose request this is: the page a download came from and the cookie jar it lives in.
 * firstParty: the address was (or would be) loaded as a top-level navigation (a clicked link): the
 * channel uses the system principal, so the address's own cookies are sent. Otherwise the page is the
 * loading principal (a page's player fetching media) and Necko applies the page's cookie rules.
 */
export class Identity implements IdentityJSON {
  pageUrl: string;
  userContextId: number;
  isPrivate: boolean;
  withOrigin: boolean;
  firstParty: boolean;
  pageRules: boolean;
  principal: string;
  referrerPolicy: ReferrerPolicy;
  cookieJarSettings: string;

  constructor(o: Partial<IdentityJSON> = {}) {
    this.pageUrl = /^https?:/i.test(o.pageUrl ?? '') ? (o.pageUrl as string) : '';
    this.userContextId = Number(o.userContextId) || 0;
    this.isPrivate = !!o.isPrivate;
    this.withOrigin = !!o.withOrigin;
    this.principal = typeof o.principal === 'string' ? o.principal : '';
    // A page's own principal is never a first-party (system principal) request.
    this.firstParty = !this.principal && o.firstParty !== false;
    this.pageRules = !this.firstParty && !!o.pageRules;
    this.referrerPolicy = asPolicy(o.referrerPolicy);
    this.cookieJarSettings = this.principal && typeof o.cookieJarSettings === 'string' ? o.cookieJarSettings : '';
  }

  /** From a tab's BrowsingContext (parent process). */
  static fromBrowsingContext(bc: any, extra: Partial<IdentityJSON> = {}): Identity {
    const top = bc?.top;
    return new Identity({
      pageUrl: top?.currentURI?.spec ?? '',
      userContextId: top?.originAttributes?.userContextId ?? 0,
      isPrivate: (top?.originAttributes?.privateBrowsingId ?? 0) > 0,
      ...extra,
    });
  }

  toJSON(): IdentityJSON {
    return {
      pageUrl: this.pageUrl,
      userContextId: this.userContextId,
      isPrivate: this.isPrivate,
      withOrigin: this.withOrigin,
      firstParty: this.firstParty,
      ...(this.pageRules ? { pageRules: true } : {}),
      ...(this.principal ? { principal: this.principal } : {}),
      ...(this.referrerPolicy ? { referrerPolicy: this.referrerPolicy } : {}),
      ...(this.cookieJarSettings ? { cookieJarSettings: this.cookieJarSettings } : {}),
    };
  }
}

/** A serialized principal or cookie jar back as the object (null when it does not read). */
function revive<T>(fn: () => T): T | null {
  try {
    return fn() ?? null;
  } catch {
    return null;
  }
}

/** The registrable domain of a host (eTLD+1), the host itself for IPs and single labels. */
function baseDomain(host: string): string {
  try {
    return Services.eTLD.getBaseDomainFromHost(host);
  } catch {
    return host;
  }
}

/**
 * The page's cookie jar is partitioned for another site than `uri`'s ("(https,a.example)" against
 * b.example): a lane's jar would replace that partition, so the connection keeps the page's jar.
 */
function partitionedAway(jar: any, uri: any): boolean {
  let key = '';
  try {
    key = String(jar.partitionKey ?? '');
  } catch {
    key = '';
  }
  const m = /^\(([a-z][\w+.-]*),([^,)]+)/i.exec(key);
  if (!m) return false;
  return baseDomain(m[2]) !== baseDomain(uri.host);
}

export interface ChannelOptions {
  /** Own network partition (connection) number; null = share the pool like a page would. */
  lane?: number | null;
}

/** A Necko channel for `url`, dressed with Deer's headers. */
export function makeChannel(url: string, identity: Identity, extra: Record<string, string> = {}, opts: ChannelOptions = {}): { channel: any; dress: (ch: any) => void } {
  let uri: any;
  try {
    uri = Services.io.newURI(url);
  } catch {
    throw new DownloadError('Deer can’t download this address.');
  }
  if (!uri.schemeIs('http') && !uri.schemeIs('https')) throw new DownloadError('Deer can’t download this kind of address.');
  const page = identity.pageUrl ? Services.io.newURI(identity.pageUrl) : null;
  const ownPrincipal: any = identity.principal ? revive(() => E10SUtils.deserializePrincipal(identity.principal)) : null;
  const pageJar: any = ownPrincipal && identity.cookieJarSettings ? revive(() => E10SUtils.deserializeCookieJarSettings(identity.cookieJarSettings)) : null;
  let channel: any;
  if (ownPrincipal && !ownPrincipal.isSystemPrincipal) {
    // The page's own principal (a link, an image the page shows): as Firefox's Save Link As.
    channel = NetUtil.newChannel({
      uri,
      loadingPrincipal: ownPrincipal,
      triggeringPrincipal: ownPrincipal,
      securityFlags: Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
      contentPolicyType: Ci.nsIContentPolicy.TYPE_SAVEAS_DOWNLOAD,
    });
  } else if (identity.principal) {
    // A page principal that no longer reads: never fall back to the system one.
    throw new DownloadError('Deer can\u2019t download this address any more. Start it again from the page.');
  } else if (page && !identity.firstParty) {
    const pagePrincipal = Services.scriptSecurityManager.createContentPrincipal(page, {
      userContextId: identity.userContextId,
      privateBrowsingId: identity.isPrivate ? 1 : 0,
    });
    channel = NetUtil.newChannel({
      uri,
      loadingPrincipal: pagePrincipal,
      // As DownloadCore does: a system trigger keeps the request from being treated as third-party
      // script. With pageRules the page triggers it, so its cross-site cookie rules apply.
      triggeringPrincipal: identity.pageRules ? pagePrincipal : system(),
      securityFlags: Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
      contentPolicyType: Ci.nsIContentPolicy.TYPE_SAVEAS_DOWNLOAD,
    });
  } else {
    channel = NetUtil.newChannel({ uri, loadUsingSystemPrincipal: true, contentPolicyType: Ci.nsIContentPolicy.TYPE_SAVEAS_DOWNLOAD });
    if (identity.userContextId) {
      // Getters and setters only exist on originAttributes: clone, change, set back.
      channel.loadInfo.originAttributes = { ...channel.loadInfo.originAttributes, userContextId: identity.userContextId };
    }
  }
  if (channel instanceof Ci.nsIPrivateBrowsingChannel) channel.setPrivate(identity.isPrivate);
  channel.QueryInterface(Ci.nsIHttpChannel);
  // The page's jar wins over a lane where the lane would trade its partition away (see the header).
  const lane = pageJar && partitionedAway(pageJar, uri) ? null : (opts.lane ?? null);
  if (pageJar && lane === null) channel.loadInfo.cookieJarSettings = pageJar;
  if (lane !== null) {
    const cjs = Cc['@mozilla.org/cookieJarSettings;1'].createInstance(Ci.nsICookieJarSettings);
    // The partition key is the SITE of this address (scheme + registrable domain), so the lane name
    // must be in the registrable part: "vitre-lane-3.invalid", never "lane-3.vitre.invalid".
    cjs.initWithURI(Services.io.newURI(`https://vitre-lane-${lane}.invalid/`), identity.isPrivate);
    channel.loadInfo.cookieJarSettings = cjs;
  }
  channel.loadFlags |= Ci.nsIRequest.LOAD_BYPASS_CACHE | Ci.nsIRequest.INHIBIT_CACHING | Ci.nsIChannel.LOAD_BYPASS_SERVICE_WORKER;
  /**
   * Headers and channel switches. Necko does NOT carry headers set with setRequestHeader over a
   * redirect, so this runs again on every hop's new channel (Exchange.asyncOnChannelRedirect).
   */
  const dress = (ch: any): void => {
    ch.QueryInterface(Ci.nsIHttpChannel);
    const referrer = page ? referrerFor(page, ch.URI, identity.referrerPolicy) : null;
    if (referrer) {
      // The policy is applied here (referrer.ts), not by Necko: with a system triggering principal
      // Necko treats every request as cross-origin and would trim a same-origin Referer. UNSAFE_URL
      // sends exactly this.
      const info = Cc['@mozilla.org/referrer-info;1'].createInstance(Ci.nsIReferrerInfo);
      info.init(Ci.nsIReferrerInfo.UNSAFE_URL, true, referrer);
      ch.referrerInfo = info;
    }
    ch.setRequestHeader('Accept', '*/*', false);
    // Ranges count bytes of the stored file: never let the server compress.
    ch.setRequestHeader('Accept-Encoding', 'identity', false);
    if (page && identity.withOrigin && page.prePath !== ch.URI.prePath) ch.setRequestHeader('Origin', page.prePath, false);
    for (const [k, v] of Object.entries(extra)) ch.setRequestHeader(k, v, false);
    if (ch instanceof Ci.nsIHttpChannelInternal) {
      ch.channelIsForDownload = true;
      ch.forceAllowThirdPartyCookie = !identity.pageRules;
      if (lane !== null) ch.allowHttp3 = false;
    }
  };
  dress(channel);
  return { channel, dress };
}

type Verdict = { stop: true } | { wait: number } | { until: () => boolean } | undefined;
type Consumer = (stream: any, count: number) => Verdict;

/** One request/response. Implements nsIStreamListener. */
class Exchange {
  QueryInterface = ChromeUtils.generateQI(['nsIStreamListener', 'nsIRequestObserver', 'nsIInterfaceRequestor', 'nsIChannelEventSink']);
  request: any;
  response: Response | null = null;
  consumer: Consumer | null = null;
  body: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  suspends = 0;
  cancelled = false;
  stopped = false;
  done = false;
  failure: unknown = null;
  idle: any = null;
  lastData = 0;
  pauseTimer: any = null;
  early: ArrayBuffer[] = [];
  endError: unknown = null;
  hops = 0;
  private onAbort = (): void => this.cancel(Cr.NS_BINDING_ABORTED);

  constructor(
    readonly channel: any,
    readonly dress: (ch: any) => void,
    readonly signal: AbortSignal | null,
    public resolveHead: ((r: Response) => void) | null,
    public rejectHead: ((e: unknown) => void) | null
  ) {
    channel.notificationCallbacks = this;
    this.request = channel;
    signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  // nsIInterfaceRequestor: the channel asks its notificationCallbacks for the redirect sink.
  getInterface(iid: any): any {
    if (iid.equals(Ci.nsIChannelEventSink)) return this;
    throw Components.Exception('', Cr.NS_ERROR_NO_INTERFACE);
  }

  // nsIChannelEventSink: every redirect hop passes through here before it is followed.
  asyncOnChannelRedirect(_old: any, next: any, _flags: number, callback: any): void {
    let verdict = Cr.NS_OK;
    try {
      if (!next.URI.schemeIs('http') && !next.URI.schemeIs('https')) throw new Error('not http');
      this.dress(next);
      this.hops++;
    } catch {
      this.failure = new DownloadError('The site redirected to an address Deer can’t download.');
      verdict = Cr.NS_ERROR_ABORT;
    }
    callback.onRedirectVerifyCallback(verdict);
  }

  /**
   * Data arrived (or the channel was resumed): the idle timer starts over. One timer per idle
   * period, not one per chunk: a fast connection delivers thousands of chunks a second.
   */
  touch(): void {
    this.lastData = Date.now();
    if (!this.idle) this.arm(IDLE_TIMEOUT_MS);
  }

  private arm(ms: number): void {
    this.idle = setTimeout(() => {
      this.idle = null;
      if (this.done || this.cancelled) return;
      const quiet = Date.now() - this.lastData;
      if (quiet < IDLE_TIMEOUT_MS) {
        this.arm(IDLE_TIMEOUT_MS - quiet);
        return;
      }
      this.failure = new NetError(Cr.NS_ERROR_NET_TIMEOUT);
      this.cancel(Cr.NS_ERROR_NET_TIMEOUT);
    }, ms);
  }

  /** Cancel and let onStopRequest through: a suspended channel never delivers it (gotcha 3). */
  cancel(code = Cr.NS_BINDING_ABORTED): void {
    if (this.done || this.cancelled) return;
    this.cancelled = true;
    try {
      this.request.cancel(code);
    } catch {
      /* already finished */
    }
    while (this.suspends > 0) {
      this.suspends--;
      try {
        this.request.resume();
      } catch {
        /* nothing to resume */
      }
    }
  }

  /** False when the channel can't be suspended (a response with no body that already ended). */
  suspend(): boolean {
    try {
      this.request.suspend();
    } catch {
      return false;
    }
    this.suspends++;
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    return true;
  }

  resume(): void {
    if (this.done || this.cancelled || this.suspends <= 0) return;
    this.suspends--;
    this.request.resume();
    this.touch();
  }

  onStartRequest(request: any): void {
    this.request = request;
    if (!Components.isSuccessCode(request.status)) return;
    let http: any;
    try {
      http = request.QueryInterface(Ci.nsIHttpChannel);
      void http.responseStatus;
    } catch {
      this.failure = new DownloadError('The site redirected to an address Deer can’t download.');
      this.cancel();
      return;
    }
    try {
      // Raw bytes even if the server compresses anyway.
      request.QueryInterface(Ci.nsIEncodedChannel).applyConversion = false;
    } catch {
      /* not an encoded channel */
    }
    this.response = new Response(this, http);
    if (!this.cancelled) this.suspend();
    const resolve = this.resolveHead;
    this.resolveHead = this.rejectHead = null;
    resolve?.(this.response);
  }

  onDataAvailable(_request: any, stream: any, _offset: number, count: number): void {
    if (this.cancelled) return;
    this.touch();
    if (!this.consumer) {
      // The head could not be held suspended: keep what arrives until someone reads it.
      this.early.push(NetUtil.readInputStream(stream, count));
      return;
    }
    this.feed(stream, count);
  }

  feed(stream: any, count: number): void {
    let verdict: Verdict;
    try {
      verdict = (this.consumer as Consumer)(stream, count);
    } catch (e) {
      this.failure = e;
      this.cancel();
      return;
    }
    if (!verdict || this.done) return;
    if ('stop' in verdict) {
      this.stopped = true;
      this.cancel();
    } else if ('wait' in verdict) {
      if (verdict.wait > 0 && this.suspend()) this.pauseTimer = setTimeout(() => this.resume(), verdict.wait);
    } else if ('until' in verdict) {
      if (!this.suspend()) return;
      const poll = (): void => {
        if (this.done || this.cancelled) return;
        if (verdict.until()) this.resume();
        else this.pauseTimer = setTimeout(poll, 10);
      };
      this.pauseTimer = setTimeout(poll, 10);
    }
  }

  onStopRequest(_request: any, status: number): void {
    this.done = true;
    if (this.idle) clearTimeout(this.idle);
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.signal?.removeEventListener('abort', this.onAbort);
    let error: unknown = null;
    if (this.signal?.aborted) error = new AbortedError();
    else if (this.failure) error = this.failure;
    else if (this.stopped) error = null;
    else if (!Components.isSuccessCode(status)) error = status === Cr.NS_BINDING_ABORTED ? new AbortedError() : new NetError(status);
    this.endError = error;
    if (this.rejectHead) {
      const reject = this.rejectHead;
      this.resolveHead = this.rejectHead = null;
      reject(error ?? new NetError(Cr.NS_ERROR_FAILURE));
      return;
    }
    if (this.body) {
      if (error) this.body.reject(error);
      else this.body.resolve();
    }
  }
}

export class Response {
  readonly status: number;
  /** Where the request ended up after redirects. */
  readonly url: string;
  /** "http/1.1", "h2", "h3". */
  readonly protocol: string = '';

  constructor(
    private ex: Exchange,
    private http: any
  ) {
    this.status = http.responseStatus;
    this.url = http.URI.spec;
    try {
      this.protocol = http.protocolVersion;
    } catch {
      /* not known */
    }
  }

  /** The socket this response came over (tests: distinct local ports = distinct connections). */
  get socket(): string {
    try {
      const i = this.http.QueryInterface(Ci.nsIHttpChannelInternal);
      return `${i.localAddress}:${i.localPort}>${i.remoteAddress}:${i.remotePort}`;
    } catch {
      return '?';
    }
  }

  header(name: string): string {
    try {
      return this.http.getResponseHeader(name);
    } catch {
      return '';
    }
  }

  get contentLength(): number {
    try {
      return Number(this.http.contentLength);
    } catch {
      return -1;
    }
  }

  /** Drop the response without reading it. */
  destroy(): void {
    this.ex.cancel();
  }

  /**
   * Read the body. `consumer(inputStream, count)` runs for every chunk, synchronously, on the main
   * thread; it must take what it wants from the stream before returning. It may return {stop:true}
   * (enough: the channel is cancelled and the promise resolves), {wait: ms} (suspend the channel
   * that long: the speed limit) or {until: () => bool} (suspend until true: disk back-pressure).
   */
  stream(consumer: Consumer): Promise<void> {
    const ex = this.ex;
    if (ex.consumer) throw new Error('body already consumed');
    ex.consumer = consumer;
    return new Promise((resolve, reject) => {
      ex.body = { resolve, reject };
      for (const buf of ex.early.splice(0)) {
        const s = Cc['@mozilla.org/io/arraybuffer-input-stream;1'].createInstance(Ci.nsIArrayBufferInputStream);
        s.setData(buf, 0, buf.byteLength);
        ex.feed(s, buf.byteLength);
      }
      if (ex.done) {
        // The channel already ended: a body-less answer, or one cancelled while it waited.
        if (ex.failure || ex.endError) reject(ex.failure ?? ex.endError);
        else resolve();
        return;
      }
      ex.resume();
    });
  }

  /** The whole (small) body: playlists, keys and stream segments. */
  async bytes({ max = 0, onChunk = null as ((n: number) => Verdict) | null } = {}): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    let size = 0;
    const expected = this.contentLength;
    await this.stream((stream, count) => {
      parts.push(new Uint8Array(NetUtil.readInputStream(stream, count)));
      size += count;
      if (max && size > max) throw new DownloadError('The response was larger than expected.');
      return onChunk ? onChunk(count) : undefined;
    });
    if (expected >= 0 && this.status !== 206 && size < expected) throw new ShortBodyError();
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  async text(opts: { max?: number } = {}): Promise<string> {
    return new TextDecoder('utf-8').decode(await this.bytes(opts));
  }
}

/**
 * GET `url`. Redirects are followed by Necko (each hop gets its own cookies; Deer's headers, Range
 * included, are put back on every hop). Resolves with the response head; the body waits, suspended.
 */
export function open(url: string, identity: Identity, extra: Record<string, string> = {}, signal: AbortSignal | null = null, opts: ChannelOptions = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    let made: { channel: any; dress: (ch: any) => void };
    try {
      made = makeChannel(url, identity, extra, opts);
    } catch (e) {
      reject(e instanceof DownloadError ? e : new DownloadError('Deer can’t download this address.'));
      return;
    }
    const ex = new Exchange(made.channel, made.dress, signal, resolve, reject);
    ex.touch();
    try {
      made.channel.asyncOpen(ex);
    } catch (e) {
      ex.done = true;
      if (ex.idle) clearTimeout(ex.idle);
      reject(new NetError((e as { result?: number }).result ?? Cr.NS_ERROR_FAILURE));
    }
  });
}

/** A small text body (playlists, manifests), with a status check. */
export async function fetchText(url: string, identity: Identity, signal: AbortSignal | null = null, max = 8 * 1024 * 1024): Promise<string> {
  const res = await open(url, identity, {}, signal);
  if (res.status < 200 || res.status >= 300) {
    res.destroy();
    throw new HttpStatusError(res.status, retryAfter(res));
  }
  return res.text({ max });
}

/** `bytes 0-0/1234` -> {start 0, end 0, total 1234}; total -1 for `*`. */
export function parseContentRange(value: string): { start: number; end: number; total: number } | null {
  const m = /^\s*bytes\s+(?:(\d+)-(\d+)|\*)\s*\/\s*(\d+|\*)\s*$/i.exec(value);
  if (!m) return null;
  const total = m[3] === '*' ? -1 : Number(m[3]);
  if (m[1] === undefined) return { start: -1, end: -1, total };
  return { start: Number(m[1]), end: Number(m[2]), total };
}

/** Retry-After in seconds, from either spelling: a count or an HTTP date. */
export function retryAfter(res: Response): number | null {
  const raw = res.header('retry-after').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const when = Date.parse(raw);
  return Number.isNaN(when) ? null : Math.max(0, (when - Date.now()) / 1000);
}

/** Seconds before retry number `attempt` (1 = the first retry). The server's own wait wins. */
export function backoff(attempt: number, after: number | null): number {
  if (after !== null && after > 0) return Math.min(after, 60);
  return attempt <= 1 ? 2 : attempt === 2 ? 6 : 15;
}

let nssErrors: any = null;
function isSecurityError(result: number): boolean {
  try {
    nssErrors ??= Cc['@mozilla.org/nss_errors_service;1'].getService(Ci.nsINSSErrorsService);
    return nssErrors.isNSSErrorCode(result);
  } catch {
    return false;
  }
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof HttpStatusError) return RETRYABLE_STATUS.has(err.status);
  if (err instanceof ShortBodyError) return true;
  if (err instanceof DownloadError || err instanceof AbortedError || err instanceof DiskError) return false;
  // Certificate and TLS failures never get another go; everything else on the network does.
  if (err instanceof NetError) return !isSecurityError(err.result) && err.code !== 'NS_ERROR_MALFORMED_URI';
  return !(err instanceof TypeError);
}

export function statusMessage(status: number): string {
  if (status === 401 || status === 403) return `The site refused the download (${status}). It may need you to be signed in.`;
  if (status === 404 || status === 410) return `The file is no longer there (${status}).`;
  if (status === 429) return 'The site is limiting downloads. Try again in a few minutes.';
  if (status >= 500) return `The site had a problem serving the file (${status}).`;
  return `The site answered ${status}.`;
}

/** A sentence for the row, whatever went wrong. A disk error is always about the disk. */
export function describeError(err: unknown): string {
  if (err instanceof DownloadError || err instanceof HttpStatusError) return err.message;
  const code = String((err as { code?: string; name?: string })?.code ?? (err as { name?: string })?.name ?? '');
  if (err instanceof DiskError || /^NS_ERROR_FILE_|NotFoundError|NotAllowedError|OperationError/.test(code)) {
    if (/NO_DEVICE_SPACE|DISK_FULL/.test(code)) return 'The disk is full.';
    if (/ACCESS_DENIED|READ_ONLY|NotAllowedError/.test(code)) return 'Deer isn’t allowed to write to the downloads folder.';
    if (/IS_LOCKED/.test(code)) return 'Another program is using the file.';
    return 'Couldn’t write to the downloads folder.';
  }
  if (/UNKNOWN_HOST|OFFLINE/.test(code)) return 'Couldn’t reach the site.';
  if (/NET_TIMEOUT/.test(code)) return 'The connection timed out.';
  if (err instanceof NetError && isSecurityError(err.result)) return 'The site’s security certificate isn’t trusted.';
  return 'The connection was lost.';
}

export function sleep(ms: number, signal: AbortSignal | null = null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    const stop = (): void => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
}
