// Taking over Firefox's own downloads. The Gecko counterpart of Electron's
// session.on('will-download') + DownloadManager.adoptBrowser.
//
// Every download Firefox starts, whatever started it (a clicked link answered with
// Content-Disposition or an unshowable type, <a download>, Save Link As, Save Page/Image,
// an extension's downloads.download()), becomes a Download object added to the list
// Downloads.getList(Downloads.ALL) (toolkit/components/downloads). A view on that list sees it
// first: onDownloadAdded. From the Download we read the address, the referrer, the private flag,
// the container and the tab (browsingContextId), and the file name Firefox already worked out
// (Content-Disposition, sanitising, " (1)" de-duplication). http(s) downloads are cancelled,
// removed from Firefox's list, and started again on Vitre's engine with the same identity;
// anything else (blob:, data:, a POST's answer) stays with Firefox and is only mirrored.
import { Downloads } from "resource://gre/modules/Downloads.sys.mjs";
import { VitreDownloads } from "resource://vitre-boot/engine/VitreDownloads.sys.mjs";
import { log } from "resource://vitre-boot/engine/VitreLog.sys.mjs";
import { Identity, open } from "resource://vitre-boot/engine/VitreNet.sys.mjs";

/** The prefs that make Firefox hand downloads over quietly. Set once at startup. */
export const TAKEOVER_PREFS = {
  // Never Firefox's "where to save" picker or its "open with" dialog: Vitre asks (or not) itself.
  "browser.download.useDownloadDir": true,
  "browser.download.always_ask_before_handling_new_types": false,
  // The downloads panel is anchored to a toolbar button Vitre hides; it must never pop open.
  "browser.download.alwaysOpenPanel": false,
  "browser.download.panel.shown": true,
  // Firefox's partial file goes to the temp folder, so nothing flickers in the user's folder
  // during the moment before Vitre cancels it.
  "browser.download.start_downloads_in_tmp_dir": true,
};

export const VitreTakeover = {
  installed: false,
  /** What happened to each Firefox download, for the spike's log. */
  events: [],
  /** Firefox downloads left to Firefox: id -> Download (the panel shows them with engine 'browser'). */
  mirrored: new Map(),
  onAdopted: null,

  async install() {
    if (this.installed) return;
    this.installed = true;
    for (const [k, v] of Object.entries(TAKEOVER_PREFS)) {
      if (typeof v === "boolean") Services.prefs.setBoolPref(k, v);
      else Services.prefs.setIntPref(k, v);
    }
    const list = await Downloads.getList(Downloads.ALL);
    let live = false;
    await list.addView({
      // addView replays the downloads already in the list (earlier sessions): those are history.
      onDownloadAdded: (download) => {
        if (live) this.adopt(list, download).catch((e) => log("takeover failed", String(e), e.stack ?? ""));
      },
    });
    live = true;
  },

  async adopt(list, download) {
    const src = download.source;
    const url = src.url;
    const suggested = PathUtils.filename(download.target.path);
    const referrer = src.referrerInfo?.originalReferrer?.spec ?? "";
    const bc = src.browsingContextId ? BrowsingContext.get(src.browsingContextId) : null;
    const browser = bc?.top?.embedderElement ?? null;
    const tab = browser?.getTabBrowser?.()?.getTabForBrowser(browser) ?? null;
    const event = {
      url, suggested, referrer, isPrivate: !!src.isPrivate, userContextId: src.userContextId ?? 0,
      browsingContextId: src.browsingContextId ?? 0, tabLabel: tab?.label ?? null, contentType: download.contentType ?? "",
      saver: download.saver?.constructor?.name ?? typeof download.saver, firefoxTarget: download.target.path, action: "",
    };
    this.events.push(event);
    if (!/^https?:/i.test(url)) {
      event.action = "left to Firefox (not http)";
      this.mirrored.set(url, download);
      return;
    }
    const identity = new Identity({
      // The page that linked to it. With no referrer (typed address, no-referrer policy) the tab's own address.
      pageUrl: referrer || (bc?.top?.currentURI?.spec ?? ""),
      userContextId: src.userContextId ?? 0,
      isPrivate: !!src.isPrivate,
      firstParty: true,
    });
    // A page where Firefox had a file usually means the download needs the original request
    // (a form POST): ask once before taking it away. Firefox's own transfer keeps running meanwhile.
    let probe = null;
    try {
      probe = await open(url, identity, { Range: "bytes=0-0" }, null);
      probe.destroy();
    } catch {
      probe = null;
    }
    const type = probe?.header("content-type") ?? "";
    const ok = probe && [200, 206, 416].includes(probe.status) && !(/text\/html/i.test(type) && !/text\/html/i.test(download.contentType ?? ""));
    if (!ok) {
      event.action = `left to Firefox (probe ${probe ? probe.status + " " + type : "failed"})`;
      this.mirrored.set(url, download);
      return;
    }
    // Stop Firefox's transfer, delete what it wrote (its .part and the empty placeholder), forget it.
    await download.cancel().catch(() => {});
    await download.removePartialData().catch(() => {});
    await download.finalize(true).catch(() => {});
    await list.remove(download).catch(() => {});
    await IOUtils.remove(download.target.path, { ignoreAbsent: true }).catch(() => {});
    event.firefoxState = { canceled: download.canceled, stopped: download.stopped, succeeded: download.succeeded };
    event.action = "taken over";
    event.id = VitreDownloads.start(url, { filename: suggested, identity, title: tab?.label ?? "" });
    this.onAdopted?.(event, tab);
  },
};

/**
 * Vitre's own "ask where to save": the native Save dialog (nsIFilePicker), opened on a window's
 * BrowsingContext. Resolves with the chosen path, or null when it was cancelled.
 */
export function askWhereToSave(win, { title = "Save As", name = "", dir = "" } = {}) {
  return new Promise((resolve) => {
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(win.browsingContext, title, Ci.nsIFilePicker.modeSave);
    fp.defaultString = name;
    const ext = /\.([a-z0-9]{1,10})$/i.exec(name)?.[1];
    if (ext) {
      fp.defaultExtension = ext;
      fp.appendFilter(ext.toUpperCase(), "*." + ext);
    }
    fp.appendFilters(Ci.nsIFilePicker.filterAll);
    if (dir) {
      const d = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      d.initWithPath(dir);
      fp.displayDirectory = d;
    }
    fp.open((result) => {
      resolve(result === Ci.nsIFilePicker.returnOK || result === Ci.nsIFilePicker.returnReplace ? fp.file.path : null);
    });
  });
}

/** The folder Firefox (and so Vitre, by default) saves to: the user's Downloads, or the one set in prefs. */
export async function defaultFolder() {
  return Downloads.getPreferredDownloadsDirectory();
}
