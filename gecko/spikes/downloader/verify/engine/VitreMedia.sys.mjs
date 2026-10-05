// Media the pages load, watched per tab, and DRM use per tab. The Gecko counterpart of
// app/src/main/modules/downloads/media.ts (session.webRequest.onResponseStarted + the page
// preload's video report).
//
//   responses : the "http-on-examine-response" observer family gives every nsIHttpChannel as its
//               headers arrive, in the parent process. channel.loadInfo.browsingContext is the
//               frame that asked; .top is the tab's BrowsingContext; .top.embedderElement is the
//               <browser>; its window's gBrowser.getTabForBrowser() is the tab. Tabs are keyed by
//               BrowsingContext.browserId, which stays the same when the tab changes process.
//   DRM       : a JSWindowActor pair (engine/actors). Gecko notifies "mediakeys-request" in the
//               content process whenever a page asks for a key system
//               (navigator.requestMediaKeySystemAccess); the child also listens for "encrypted"
//               events and reports each <video>'s mediaKeys. A tab that used EME is protected:
//               nothing from it is offered.
import { setTimeout } from "resource://gre/modules/Timer.sys.mjs";

const SEGMENT_EXT = /\.(ts|m4s|m4f|cmfv|cmfa|aac|vtt|webvtt|key)(\?|#|$)/i;
const HINTS = /thumb|poster|preview|sprite|favicon|emoji|\/ads?\/|doubleclick|googlesyndication/i;
const TOPICS = ["http-on-examine-response", "http-on-examine-cached-response", "http-on-examine-merged-response"];
const P = Ci.nsIContentPolicy;
const TYPES = new Map([
  [P.TYPE_MEDIA, "media"], [P.TYPE_XMLHTTPREQUEST, "xhr"], [P.TYPE_FETCH, "xhr"], [P.TYPE_OTHER, "other"],
  [P.TYPE_OBJECT, "object"], [P.TYPE_DOCUMENT, "mainFrame"], [P.TYPE_SUBDOCUMENT, "subFrame"],
]);

export const VitreMedia = {
  /** browserId -> { items: Map(url -> candidate), drm: Map(keySystem -> status), encrypted: number } */
  tabs: new Map(),
  listeners: new Set(),
  installed: false,
  QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),

  /**
   * childActorURI: where the content-process half is loaded from. Content processes are sandboxed
   * (level 9 on Windows): they can only read modules that live in the application folder (where
   * Vitre ships them) or in <profile>/chrome. A dev folder elsewhere on disk fails to load there.
   */
  install({ childActorURI = "resource://vitre-boot/engine/actors/VitreMediaChild.sys.mjs" } = {}) {
    if (this.installed) return;
    this.installed = true;
    for (const t of TOPICS) Services.obs.addObserver(this, t);

    // DRM, needing no content code of ours: Firefox's own EncryptedMedia actor already forwards
    // every "mediakeys-request" to the parent (it drives Firefox's DRM info bar). Listen in.
    try {
      const { EncryptedMediaParent } = ChromeUtils.importESModule("resource:///actors/EncryptedMediaParent.sys.mjs");
      const original = EncryptedMediaParent.prototype.receiveMessage;
      const self = this;
      EncryptedMediaParent.prototype.receiveMessage = function (message) {
        try {
          const id = this.browsingContext?.top?.browserId;
          const { status, keySystem } = JSON.parse(message.data);
          if (id && keySystem) self.eme(id, { keySystem, status, via: "EncryptedMediaParent" });
        } catch {}
        return original.call(this, message);
      };
      this.emeTap = true;
    } catch (e) {
      this.emeTap = false;
    }

    ChromeUtils.registerWindowActor("VitreMedia", {
      parent: { esModuleURI: "resource://vitre-boot/engine/actors/VitreMediaParent.sys.mjs" },
      child: {
        esModuleURI: childActorURI,
        observers: ["mediakeys-request"],
        events: { encrypted: { capture: true } },
      },
      allFrames: true,
      messageManagerGroups: ["browsers"],
      // Firefox 157 refuses to create an actor in a web content process without this
      // ("Window protocol doesn't match remote type").
      safeForUntrustedWebProcess: true,
    });
  },

  observe(subject) {
    try {
      this.seen(subject.QueryInterface(Ci.nsIHttpChannel));
    } catch {
      /* never let detection disturb loading */
    }
  },

  // VERIFY FIX (VITRE_V_MEDIAFIX=1): a tab's record belongs to one top-level DOCUMENT, identified by
  // the inner window id of the tab's current top WindowGlobal. It is dropped when the tab shows
  // another document, not when a top-level RESPONSE arrives (which may be a download).
  fixed: Services.env.get("VITRE_V_MEDIAFIX") === "1",
  docOf(browserId) {
    return BrowsingContext.getCurrentTopByBrowserId(browserId)?.currentWindowGlobal?.innerWindowId ?? 0;
  },
  /** The tab's record if it still describes the document the tab is showing. */
  current(browserId) {
    const tab = this.tabs.get(browserId);
    if (tab && this.fixed && tab.doc !== this.docOf(browserId)) {
      this.tabs.delete(browserId);
      return undefined;
    }
    return tab;
  },

  tab(browserId) {
    let tab = this.current(browserId);
    if (!tab) {
      tab = { items: new Map(), drm: new Map(), encrypted: 0, doc: this.docOf(browserId) };
      this.tabs.set(browserId, tab);
    }
    return tab;
  },

  seen(channel) {
    const info = channel.loadInfo;
    const bc = info?.browsingContext;
    // No frame: the browser's own requests, Vitre's downloader among them.
    if (!bc?.top?.browserId) return;
    const type = TYPES.get(info.externalContentPolicyType);
    if (!type) return;
    const status = channel.responseStatus;
    if (status < 200 || status >= 300 || channel.requestMethod !== "GET") return;
    const id = bc.top.browserId;
    if (type === "mainFrame") {
      if (this.fixed) return; // the response may be a download: see current()
      // A new top-level document: what the previous page loaded no longer applies.
      this.tabs.delete(id);
      this.notify(id);
      return;
    }
    const header = (name) => {
      try {
        return channel.getResponseHeader(name);
      } catch {
        return "";
      }
    };
    const mime = header("content-type").split(";")[0].trim().toLowerCase();
    const url = channel.URI.spec;
    let kind = null;
    if (/mpegurl/.test(mime) || /\.m3u8(\?|#|$)/i.test(url)) kind = "hls";
    else if (/dash\+xml/.test(mime) || /\.mpd(\?|#|$)/i.test(url)) kind = "dash";
    // MSE players fetch their segments as xhr; only the media element's own requests are whole files.
    else if (type !== "xhr" && !SEGMENT_EXT.test(url) && !HINTS.test(url)) {
      if (mime.startsWith("video/") && mime !== "video/mp2t") kind = "video";
      else if (mime.startsWith("audio/") && !/mpegurl/.test(mime)) kind = "audio";
      else if (mime === "application/octet-stream" && /\.(mp4|webm|mov|mkv|m4v)(\?|#|$)/i.test(url)) kind = "video";
    }
    if (!kind) return;
    const range = /\/(\d+)\s*$/.exec(header("content-range"));
    const bytes = range ? Number(range[1]) : Number(header("content-length")) || 0;
    if ((kind === "video" || kind === "audio") && bytes > 0 && bytes < 500000) return;
    const tab = this.tab(id);
    const had = tab.items.has(url);
    tab.items.set(url, {
      url, kind, type, mime, bytes: Math.max(bytes, tab.items.get(url)?.bytes ?? 0), at: Date.now(),
      frameUrl: bc.top === bc ? "" : (bc.currentWindowGlobal?.documentURI?.spec ?? ""),
      pageUrl: bc.top.currentURI?.spec ?? "",
    });
    // An endless feed keeps loading media; the oldest it showed are forgotten.
    if (tab.items.size > 200) tab.items.delete(tab.items.keys().next().value);
    if (!had) this.notify(id);
  },

  /** Called by the parent actor. */
  eme(browserId, data) {
    const tab = this.tab(browserId);
    if (data.encrypted) tab.encrypted++;
    if (data.keySystem) tab.drm.set(data.keySystem, data.status ?? "");
    (tab.sources ??= new Set()).add(data.via ?? "VitreMediaChild");
    this.notify(browserId);
  },

  isProtected(browserId) {
    const tab = this.current(browserId);
    return !!tab && (tab.drm.size > 0 || tab.encrypted > 0);
  },

  /** What the tab's download mark counts: nothing on a protected tab; DASH alone doesn't count. */
  candidates(browserId) {
    if (this.isProtected(browserId)) return [];
    const items = [...(this.current(browserId)?.items.values() ?? [])];
    return items.filter((c) => c.kind !== "audio" || !items.some((v) => v.kind === "video" || v.kind === "hls"));
  },

  /** The gBrowser tab for a browserId (any window), or null. */
  tabFor(browserId) {
    const browser = BrowsingContext.getCurrentTopByBrowserId(browserId)?.embedderElement;
    return browser?.getTabBrowser?.()?.getTabForBrowser(browser) ?? null;
  },

  /** The <video> elements of a tab's top frame, asked from its content process. */
  async videos(browserId) {
    const wgp = BrowsingContext.getCurrentTopByBrowserId(browserId)?.currentWindowGlobal;
    return wgp ? wgp.getActor("VitreMedia").sendQuery("VitreMedia:Videos") : [];
  },

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  notify(browserId) {
    const tab = this.tabs.get(browserId);
    if (tab?.timer) return;
    const fire = () => {
      if (tab) tab.timer = null;
      const count = this.candidates(browserId).filter((c) => c.kind !== "dash").length;
      for (const fn of this.listeners) fn({ browserId, count, protected: this.isProtected(browserId) });
    };
    if (tab) tab.timer = setTimeout(fire, 300);
    else fire();
  },
};
