// HTTP for the downloader on Gecko: Necko channels opened from the system scope, with the retry
// rules of app/src/main/modules/downloads/net.ts. Replaces Node's http/https client AND
// identity.ts: cookies, User-Agent, Accept-Language, proxy, certificates and the Referer policy
// are Necko's own, picked by the channel's origin attributes (container, private browsing) and
// its referrerInfo. Nothing here needs a window.
//
// The shape differs from Node in one way: Necko pushes data (nsIStreamListener). `open()`
// resolves at onStartRequest with the channel SUSPENDED, so the caller can look at the status and
// headers first and then either `stream()` the body (the channel is resumed) or `destroy()` it.
import { NetUtil } from "resource://gre/modules/NetUtil.sys.mjs";
import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";

/** A failure with a sentence a person can read; never retried. */
export class DownloadError extends Error {}

export class HttpStatusError extends Error {
  constructor(status, retryAfter) {
    super(statusMessage(status));
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export class AbortedError extends Error {
  constructor() {
    super("Stopped");
    this.name = "AbortError";
  }
}

/** The server turned a connection away (429, 503) while the download has others. */
export class ConnectionRefusedError extends Error {}

/** The body ended before the bytes asked for. */
export class ShortBodyError extends Error {
  constructor() {
    super("The connection closed early.");
  }
}

/** A Necko failure: `result` is the nsresult, `code` its name (NS_ERROR_NET_RESET, ...). */
export class NetError extends Error {
  constructor(result) {
    const code = ChromeUtils.getXPCOMErrorName(result);
    super(code);
    this.result = result;
    this.code = code;
  }
}

/** 403 is here on purpose: on a CDN it is usually a token that fresh cookies fix. */
export const RETRYABLE_STATUS = new Set([403, 408, 425, 429, 500, 502, 503, 504, 507, 509]);

export function refusedConnection(err) {
  return err instanceof HttpStatusError && (err.status === 429 || err.status === 503);
}

const IDLE_TIMEOUT_MS = 30000;
const system = Services.scriptSecurityManager.getSystemPrincipal();

/**
 * Whose request this is: the page a download came from and the cookie jar it lives in.
 * Serializable (toJSON) so a download resumed after a restart keeps its container and referrer.
 *
 * firstParty: the address was (or would be) loaded as a top-level navigation - a clicked link.
 *   The channel is loaded with the system principal, so the address's own unpartitioned cookies
 *   are sent. Otherwise the page is the loading principal (a page's player fetching media), and
 *   Necko applies the same cookie partitioning the page's own requests get.
 */
export class Identity {
  constructor({ pageUrl = "", userContextId = 0, isPrivate = false, withOrigin = false, firstParty = true } = {}) {
    this.pageUrl = /^https?:/i.test(pageUrl) ? pageUrl : "";
    this.userContextId = userContextId;
    this.isPrivate = isPrivate;
    this.withOrigin = withOrigin;
    this.firstParty = firstParty;
  }

  /** From a tab's BrowsingContext (parent process). */
  static fromBrowsingContext(bc, extra = {}) {
    const top = bc?.top;
    return new Identity({
      pageUrl: top?.currentURI?.spec ?? "",
      userContextId: top?.originAttributes?.userContextId ?? 0,
      isPrivate: (top?.originAttributes?.privateBrowsingId ?? 0) > 0,
      ...extra,
    });
  }

  toJSON() {
    return { pageUrl: this.pageUrl, userContextId: this.userContextId, isPrivate: this.isPrivate, withOrigin: this.withOrigin, firstParty: this.firstParty };
  }
}

/**
 * The Referer a page's own request would carry under the browsers' default policy
 * (strict-origin-when-cross-origin): the full address on the same origin, the origin across
 * origins, nothing from https to http.
 */
function referrerFor(page, target) {
  if (page.schemeIs("https") && target.schemeIs("http")) return null;
  if (page.prePath === target.prePath) return Services.io.newURI(page.specIgnoringRef);
  return Services.io.newURI(page.prePath + "/");
}

/** Options for one request. h1: never HTTP/2 or 3, so every connection of a download is its own TCP stream. */
export function makeChannel(url, identity, extra = {}, { h1 = true, lane = null, conservative = false, noH3 = false } = {}) {
  const uri = Services.io.newURI(url);
  if (!uri.schemeIs("http") && !uri.schemeIs("https")) throw new DownloadError("Vitre can’t download this kind of address.");
  const page = identity.pageUrl ? Services.io.newURI(identity.pageUrl) : null;
  let channel;
  if (page && !identity.firstParty) {
    channel = NetUtil.newChannel({
      uri,
      loadingPrincipal: Services.scriptSecurityManager.createContentPrincipal(page, {
        userContextId: identity.userContextId,
        privateBrowsingId: identity.isPrivate ? 1 : 0,
      }),
      // As DownloadCore does: a system trigger keeps the request from being treated as third-party script.
      triggeringPrincipal: system,
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
  // VERIFY: a "lane" gives the channel its own network partition (the partitionKey of its
  // cookieJarSettings), so Necko keeps a separate connection entry for it: its own sockets, its
  // own 6-per-host budget, its own HTTP/2 session. Unpartitioned cookies are not affected.
  if (lane !== null) {
    const cjs = Cc["@mozilla.org/cookieJarSettings;1"].createInstance(Ci.nsICookieJarSettings);
    // The partition key is the SITE of this address (scheme + registrable domain), so the lane
    // name must be in the registrable part: "vitre-lane-3.invalid", not "lane-3.vitre.invalid".
    cjs.initWithURI(Services.io.newURI(`https://vitre-lane-${lane}.invalid/`), !!identity.isPrivate);
    channel.loadInfo.cookieJarSettings = cjs;
  }
  channel.loadFlags |= Ci.nsIRequest.LOAD_BYPASS_CACHE | Ci.nsIRequest.INHIBIT_CACHING | Ci.nsIChannel.LOAD_BYPASS_SERVICE_WORKER;
  /**
   * The request headers and channel switches. Necko does NOT carry headers set with
   * setRequestHeader (Range, If-Range, Accept-Encoding) over a redirect, so this runs again on
   * every hop's new channel (Exchange.asyncOnChannelRedirect).
   */
  const dress = (ch) => {
    ch.QueryInterface(Ci.nsIHttpChannel);
    const referrer = page ? referrerFor(page, ch.URI) : null;
    if (referrer) {
      // The policy is applied here (referrerFor), not by Necko: with a system triggering principal
      // Necko treats every request as cross-origin and would trim a same-origin Referer to the
      // origin. UNSAFE_URL makes it send exactly the URI it is given.
      const info = Cc["@mozilla.org/referrer-info;1"].createInstance(Ci.nsIReferrerInfo);
      info.init(Ci.nsIReferrerInfo.UNSAFE_URL, true, referrer);
      ch.referrerInfo = info;
    }
    ch.setRequestHeader("Accept", "*/*", false);
    // Ranges count bytes of the stored file: never let the server compress.
    ch.setRequestHeader("Accept-Encoding", "identity", false);
    if (page && identity.withOrigin && page.prePath !== ch.URI.prePath) ch.setRequestHeader("Origin", page.prePath, false);
    for (const [k, v] of Object.entries(extra)) ch.setRequestHeader(k, v, false);
    if (ch instanceof Ci.nsIHttpChannelInternal) {
      ch.channelIsForDownload = true;
      ch.forceAllowThirdPartyCookie = true;
      if (h1) {
        ch.allowSpdy = false;
        ch.allowHttp3 = false;
      }
      if (conservative) ch.beConservative = true;
      if (noH3) ch.allowHttp3 = false;
    }
  };
  dress(channel);
  return { channel, dress };
}

/** One request/response. Implements nsIStreamListener. */
class Exchange {
  QueryInterface = ChromeUtils.generateQI(["nsIStreamListener", "nsIRequestObserver", "nsIInterfaceRequestor", "nsIChannelEventSink"]);

  // nsIInterfaceRequestor: the channel asks its notificationCallbacks for the redirect sink.
  getInterface(iid) {
    if (iid.equals(Ci.nsIChannelEventSink)) return this;
    throw Components.Exception("", Cr.NS_ERROR_NO_INTERFACE);
  }

  // nsIChannelEventSink: every redirect hop passes through here before it is followed.
  asyncOnChannelRedirect(_oldChannel, newChannel, _flags, callback) {
    let verdict = Cr.NS_OK;
    try {
      if (!newChannel.URI.schemeIs("http") && !newChannel.URI.schemeIs("https")) throw new Error("not http");
      this.dress(newChannel);
      this.hops++;
    } catch {
      this.failure = new DownloadError("The site redirected to an address Vitre can’t download.");
      verdict = Cr.NS_ERROR_ABORT;
    }
    callback.onRedirectVerifyCallback(verdict);
  }

  constructor(channel, dress, signal, resolveHead, rejectHead) {
    this.channel = channel;
    this.dress = dress;
    this.hops = 0;
    channel.notificationCallbacks = this;
    this.request = channel;
    this.signal = signal;
    this.resolveHead = resolveHead;
    this.rejectHead = rejectHead;
    this.response = null;
    this.consumer = null;
    this.body = null;
    this.suspends = 0;
    this.cancelled = false;
    this.stopped = false;
    this.done = false;
    this.failure = null;
    this.idle = null;
    this.pauseTimer = null;
    this.early = [];
    this.endError = null;
    this.onAbort = () => this.cancel(Cr.NS_BINDING_ABORTED);
    signal?.addEventListener("abort", this.onAbort, { once: true });
  }

  touch() {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      this.failure = new NetError(Cr.NS_ERROR_NET_TIMEOUT);
      this.cancel(Cr.NS_ERROR_NET_TIMEOUT);
    }, IDLE_TIMEOUT_MS);
  }

  /** Cancel and let onStopRequest through: a suspended channel never delivers it. */
  cancel(code = Cr.NS_BINDING_ABORTED) {
    if (this.done || this.cancelled) return;
    this.cancelled = true;
    try {
      this.request.cancel(code);
    } catch {}
    while (this.suspends > 0) {
      this.suspends--;
      try {
        this.request.resume();
      } catch {}
    }
  }

  /** False when the channel can't be suspended (a response with no body that already ended). */
  suspend() {
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

  resume() {
    if (this.done || this.cancelled || this.suspends <= 0) return;
    this.suspends--;
    this.request.resume();
    this.touch();
  }

  onStartRequest(request) {
    this.request = request;
    if (!Components.isSuccessCode(request.status)) return;
    let http;
    try {
      http = request.QueryInterface(Ci.nsIHttpChannel);
      void http.responseStatus;
    } catch {
      this.failure = new DownloadError("The site redirected to an address Vitre can’t download.");
      this.cancel();
      return;
    }
    try {
      // Raw bytes even if the server compresses anyway.
      request.QueryInterface(Ci.nsIEncodedChannel).applyConversion = false;
    } catch {}
    this.response = new Response(this, http);
    if (!this.cancelled) this.suspend();
    const resolve = this.resolveHead;
    this.resolveHead = this.rejectHead = null;
    resolve(this.response);
  }

  onDataAvailable(request, stream, _offset, count) {
    if (this.cancelled) return;
    this.touch();
    if (!this.consumer) {
      // The head could not be held suspended: keep what arrives until someone reads it.
      this.early.push(NetUtil.readInputStream(stream, count));
      return;
    }
    this.feed(stream, count);
  }

  feed(stream, count) {
    let verdict;
    try {
      verdict = this.consumer(stream, count);
    } catch (e) {
      this.failure = e;
      this.cancel();
      return;
    }
    if (!verdict || this.done) return;
    if (verdict.stop) {
      this.stopped = true;
      this.cancel();
    } else if (verdict.wait > 0) {
      if (this.suspend()) this.pauseTimer = setTimeout(() => this.resume(), verdict.wait);
    } else if (verdict.until) {
      if (!this.suspend()) return;
      const poll = () => {
        if (this.done || this.cancelled) return;
        if (verdict.until()) this.resume();
        else this.pauseTimer = setTimeout(poll, 10);
      };
      this.pauseTimer = setTimeout(poll, 10);
    }
  }

  onStopRequest(_request, status) {
    this.done = true;
    if (this.idle) clearTimeout(this.idle);
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.signal?.removeEventListener("abort", this.onAbort);
    let error = null;
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
  #ex;
  #http;

  constructor(exchange, http) {
    this.#ex = exchange;
    this.#http = http;
    this.status = http.responseStatus;
    /** Where the request ended up after redirects. */
    this.url = http.URI.spec;
    /** "http/1.1", "h2", "h3". */
    this.protocol = "";
    try {
      this.protocol = http.protocolVersion;
    } catch {}
  }

  /** VERIFY: the socket this response came over (distinct local ports = distinct TCP/QUIC connections). */
  get socket() {
    try {
      const i = this.#http.QueryInterface(Ci.nsIHttpChannelInternal);
      return `${i.localAddress}:${i.localPort}>${i.remoteAddress}:${i.remotePort}`;
    } catch (e) {
      return "?";
    }
  }

  /** VERIFY: Necko's connection-pool key for this request. */
  get poolKey() {
    try {
      return this.#http.QueryInterface(Ci.nsIHttpChannelInternal).connectionInfoHashKey;
    } catch (e) {
      return "?";
    }
  }

  header(name) {
    try {
      return this.#http.getResponseHeader(name);
    } catch {
      return "";
    }
  }

  /** Drop the response without reading it. */
  destroy() {
    this.#ex.cancel();
  }

  /**
   * Read the body. `consumer(inputStream, count)` runs for every chunk, synchronously, on the main
   * thread; it must take what it wants from the stream before returning. It may return
   * {stop:true} (enough: the channel is cancelled and the promise resolves), {wait: ms} (suspend
   * the channel that long: the speed limit) or {until: () => bool} (suspend until true: back-pressure).
   */
  stream(consumer) {
    const ex = this.#ex;
    if (ex.consumer) throw new Error("body already consumed");
    ex.consumer = consumer;
    return new Promise((resolve, reject) => {
      ex.body = { resolve, reject };
      for (const buf of ex.early.splice(0)) {
        const s = Cc["@mozilla.org/io/arraybuffer-input-stream;1"].createInstance(Ci.nsIArrayBufferInputStream);
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
  async bytes({ max = 0, onChunk = null } = {}) {
    const parts = [];
    let size = 0;
    const expected = this.#http.contentLength;
    await this.stream((stream, count) => {
      parts.push(new Uint8Array(NetUtil.readInputStream(stream, count)));
      size += count;
      if (max && size > max) throw new DownloadError("The response was larger than expected.");
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

  async text(opts) {
    return new TextDecoder("utf-8").decode(await this.bytes(opts));
  }
}

/**
 * GET `url`. Redirects are followed by Necko (each hop gets its own cookies; request headers,
 * Range included, are carried over). Resolves with the response head; the body waits, suspended.
 */
export function open(url, identity, extra = {}, signal = null, opts = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    let channel, dress;
    try {
      ({ channel, dress } = makeChannel(url, identity, extra, opts));
    } catch (e) {
      reject(e instanceof DownloadError ? e : new DownloadError("Vitre can’t download this address."));
      return;
    }
    const ex = new Exchange(channel, dress, signal, resolve, reject);
    ex.touch();
    try {
      channel.asyncOpen(ex);
    } catch (e) {
      ex.done = true;
      if (ex.idle) clearTimeout(ex.idle);
      reject(new NetError(e.result ?? Cr.NS_ERROR_FAILURE));
    }
  });
}

export async function fetchText(url, identity, signal = null, max = 8 * 1024 * 1024) {
  const res = await open(url, identity, {}, signal, { h1: false });
  if (res.status < 200 || res.status >= 300) {
    res.destroy();
    throw new HttpStatusError(res.status, retryAfter(res));
  }
  return res.text({ max });
}

/** `bytes 0-0/1234` -> {start 0, end 0, total 1234}; total -1 for `*`. */
export function parseContentRange(value) {
  const m = /^\s*bytes\s+(?:(\d+)-(\d+)|\*)\s*\/\s*(\d+|\*)\s*$/i.exec(value);
  if (!m) return null;
  const total = m[3] === "*" ? -1 : Number(m[3]);
  if (m[1] === undefined) return { start: -1, end: -1, total };
  return { start: Number(m[1]), end: Number(m[2]), total };
}

/** Retry-After in seconds, from either spelling: a count or an HTTP date. */
export function retryAfter(res) {
  const raw = res.header("retry-after").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const when = Date.parse(raw);
  return Number.isNaN(when) ? null : Math.max(0, (when - Date.now()) / 1000);
}

/** Seconds before retry number `attempt` (1 = the first retry). The server's own wait wins. */
export function backoff(attempt, after) {
  if (after !== null && after > 0) return Math.min(after, 60);
  return attempt <= 1 ? 2 : attempt === 2 ? 6 : 15;
}

let nssErrors = null;
function isSecurityError(result) {
  try {
    nssErrors ??= Cc["@mozilla.org/nss_errors_service;1"].getService(Ci.nsINSSErrorsService);
    return nssErrors.isNSSErrorCode(result);
  } catch {
    return false;
  }
}

export function isRetryable(err) {
  if (err instanceof HttpStatusError) return RETRYABLE_STATUS.has(err.status);
  if (err instanceof ShortBodyError) return true;
  if (err instanceof DownloadError || err instanceof AbortedError) return false;
  // Certificate and TLS failures never get another go; everything else on the network does.
  if (err instanceof NetError) return !isSecurityError(err.result) && err.code !== "NS_ERROR_MALFORMED_URI";
  return !(err instanceof TypeError);
}

export function statusMessage(status) {
  if (status === 401 || status === 403) return `The site refused the download (${status}). It may need you to be signed in.`;
  if (status === 404 || status === 410) return `The file is no longer there (${status}).`;
  if (status === 429) return "The site is limiting downloads. Try again in a few minutes.";
  if (status >= 500) return `The site had a problem serving the file (${status}).`;
  return `The site answered ${status}.`;
}

/** A sentence for the row, whatever went wrong. */
export function describeError(err) {
  if (err instanceof DownloadError || err instanceof HttpStatusError) return err.message;
  const code = err?.code ?? err?.name ?? "";
  if (/NO_DEVICE_SPACE|DISK_FULL/.test(code)) return "The disk is full.";
  if (/FILE_ACCESS_DENIED|FILE_READ_ONLY|NotAllowedError/.test(code)) return "Vitre isn’t allowed to write to the downloads folder.";
  if (/^NS_ERROR_FILE_|NotFoundError|OperationError/.test(code)) return "Couldn’t write to the downloads folder.";
  if (/UNKNOWN_HOST|OFFLINE/.test(code)) return "Couldn’t reach the site.";
  if (/NET_TIMEOUT/.test(code)) return "The connection timed out.";
  if (err instanceof NetError && isSecurityError(err.result)) return "The site’s security certificate isn’t trusted.";
  return "The connection was lost.";
}

export function sleep(ms, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    const done = () => {
      signal?.removeEventListener("abort", stop);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    signal?.addEventListener("abort", stop, { once: true });
  });
}
