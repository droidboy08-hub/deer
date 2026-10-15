// Phase 7 spike (spikes/downloader/RESUME-DESIGN.md section 7, "Background page resolver"): the source page
// opened out of sight, on real public sites. Read-only page loads only: no clicks, no sign-in, no forms, no
// downloads (nothing here starts one; cookie banners are left alone, Firefox's own banner rejection is on
// through cookiebanners.service.mode=1 on the command line).
//
//   python tools/run.py --test spikes/downloader/boot-pagestep.js --name p7-spike --app build-p7-base \
//     --timeout 900 --pref cookiebanners.service.mode=1 --pref cookiebanners.service.mode.privateBrowsing=1
//
// For each site: a hidden tab (b.openHidden with the page's own content principal and userContextId 0),
// muted (browser.mute(), peek/gecko.ts setMuted) and kept active (gBrowser.activateBrowserForPrintPreview,
// peek/gecko.ts keepActive). Measured:
//   - the load: time, the top-level addresses it committed, whether its BrowsingContext was replaced on the
//     way (a process switch: http -> https, a cross-site redirect) and what useGlobalHistory read then;
//   - history: the visits Places has since the load began (moz_historyvisits), with the switch
//     (browsingContext.useGlobalHistory = false and the disableglobalhistory attribute, set in TabOpen before
//     the load starts) and, once, without it (the control: the measure does catch a visit);
//   - media: what MediaWatch saw under the hidden tab's browserId (kind, bytes), each <video>/<audio>'s state
//     (paused, currentTime, readyState, networkState), whether audio started (DOMAudioPlaybackStarted) and the
//     tab's MediaController (isPlaying);
//   - consent: elements that look like a cookie or consent banner (id/class names), and password fields;
//   - closing: removeTab(skipSessionStore, skipPermitUnload) leaves b.tabs and the closed-tab list as they were.
/* global spike, Services, ChromeUtils, gBrowser */
spike.main(async () => {
  const { log, sleep } = spike;
  const b = window.vitre;
  const engine = b.sys("VitreDownloads");
  await engine.ready;
  await spike.resize(1440, 900);
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const SS = window.SessionStore;

  const SITES = [
    // http -> https: a process switch on the first load (BrowsingContext replacement).
    { url: "http://www.w3schools.com/html/html5_video.asp", history: "control" },
    { url: "http://www.w3schools.com/html/html5_video.asp?again=1" },
    { url: "https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video" },
    { url: "https://commons.wikimedia.org/wiki/File:Big_Buck_Bunny_4K.webm" },
    { url: "https://archive.org/details/BigBuckBunny_124" },
    { url: "https://hls-js.netlify.app/demo/" },
    { url: "https://vimeo.com/76979871" },
    { url: "https://www.dailymotion.com/video/x7tgad0" },
    { url: "https://www.theguardian.com/uk" },
    { url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" },
  ];

  const db = await PlacesUtils.promiseDBConnection();
  const visitsSince = async (t) => {
    const rows = await db.execute("SELECT h.url AS url, v.visit_type AS type FROM moz_historyvisits v JOIN moz_places h ON h.id = v.place_id WHERE v.visit_date >= :d", { d: t * 1000 });
    return rows.map((r) => `${r.getResultByName("type")} ${String(r.getResultByName("url")).slice(0, 90)}`);
  };

  /** A frame script in the hidden page (read-only): its media elements, banner-like elements, password fields. */
  const inspect = (browser) =>
    new Promise((resolve) => {
      const mm = browser.messageManager;
      const name = "p7-spike-" + Date.now() + "-" + Math.round(Math.random() * 1e9);
      const timer = setTimeout(() => resolve({ error: "timed out" }), 8000);
      mm.addMessageListener(name, function on(m) {
        mm.removeMessageListener(name, on);
        clearTimeout(timer);
        resolve(m.data);
      });
      const body = `(() => {
        let out;
        try {
          const doc = content.document;
          const media = Array.from(doc.querySelectorAll("video, audio")).map((m) => ({ tag: m.localName, src: String(m.currentSrc || m.src || "").slice(0, 120), paused: m.paused, t: Math.round(m.currentTime * 10) / 10, ready: m.readyState, net: m.networkState, muted: m.muted, autoplay: m.autoplay, preload: m.preload }));
          const banners = Array.from(doc.querySelectorAll("[id],[class]")).filter((e) => /consent|cookie|gdpr|onetrust|sp_message|cmp|didomi|qc-cmp|truste/i.test((e.id || "") + " " + (typeof e.className === "string" ? e.className : ""))).filter((e) => { const r = e.getBoundingClientRect(); const s = content.getComputedStyle(e); return r.width > 200 && r.height > 40 && s.visibility !== "hidden" && s.display !== "none"; }).slice(0, 4).map((e) => (e.id ? "#" + e.id : "." + String(e.className).split(/\\s+/)[0]).slice(0, 50));
          out = { title: doc.title.slice(0, 80), visibility: doc.visibilityState, hidden: doc.hidden, links: doc.querySelectorAll("a[href]").length, frames: content.frames.length, password: !!doc.querySelector("input[type=password]"), media, banners };
        } catch (e) { out = { error: String(e) }; }
        sendAsyncMessage(${JSON.stringify(name)}, out);
      })()`;
      mm.loadFrameScript("data:application/javascript," + encodeURIComponent(body), false);
    });

  const results = [];
  for (const site of SITES) {
    const off = site.history !== "control";
    const tabsBefore = b.tabs.map((t) => t.id).join();
    const gTabsBefore = gBrowser.tabs.length;
    const closedBefore = SS.getClosedTabCountForWindow(window);
    const start = Date.now();
    const principal = Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI(site.url), { userContextId: 0 });
    // The switch goes on the new tab's BrowsingContext in TabOpen, which tabbrowser fires after the browser is
    // inserted and before it starts the load (Tabbrowser.sys.mjs addTab: #insertBrowser, #fireTabOpen,
    // #kickOffBrowserLoad).
    let seenInOpen = null;
    const onOpen = (e) => {
      const br = e.target.linkedBrowser;
      seenInOpen = br?.browsingContext?.useGlobalHistory;
      if (off && br) {
        br.setAttribute("disableglobalhistory", "true");
        try {
          br.browsingContext.useGlobalHistory = false;
        } catch (err) {
          seenInOpen = "set failed: " + err;
        }
      }
    };
    gBrowser.tabContainer.addEventListener("TabOpen", onOpen, { capture: true, once: true });
    let made;
    try {
      made = b.openHidden(site.url, { triggeringPrincipal: principal, userContextId: 0 });
    } finally {
      gBrowser.tabContainer.removeEventListener("TabOpen", onOpen, { capture: true });
    }
    const { node, browser } = made;
    try {
      browser.mute();
    } catch {
      /* none */
    }
    gBrowser.activateBrowserForPrintPreview(browser);
    const browserId = Number(browser.browsingContext?.browserId) || 0;
    const bcs = [{ id: browser.browsingContext?.id, gh: browser.browsingContext?.useGlobalHistory }];
    let audio = 0;
    const onAudio = () => audio++;
    browser.addEventListener("DOMAudioPlaybackStarted", onAudio);
    const commits = [];
    const listener = {
      QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
      onLocationChange(webProgress, _request, location) {
        if (webProgress?.isTopLevel) commits.push(location.spec.slice(0, 90));
      },
      onStateChange() {},
      onProgressChange() {},
      onStatusChange() {},
      onSecurityChange() {},
      onContentBlockingEvent() {},
    };
    browser.addProgressListener(listener, Ci.nsIWebProgress.NOTIFY_LOCATION);
    const note = () => {
      const bc = browser.browsingContext;
      if (bc && bcs[bcs.length - 1].id !== bc.id) bcs.push({ id: bc.id, gh: bc.useGlobalHistory });
    };
    let loadMs = -1;
    for (let i = 0; i < 300; i++) {
      note();
      if (!browser.webProgress?.isLoadingDocument && browser.currentURI.spec !== "about:blank") {
        loadMs = Date.now() - start;
        break;
      }
      await sleep(100);
    }
    // The collect window: 10 s for the player to ask for its media.
    for (let i = 0; i < 20; i++) {
      note();
      await sleep(500);
    }
    const page = await inspect(browser);
    const media = engine.media.candidates(browserId).map((c) => `${c.kind} ${c.bytes} ${c.url.slice(0, 80)}`);
    let playing = null;
    try {
      playing = browser.browsingContext?.mediaController?.isPlaying ?? null;
    } catch {
      playing = "n/a";
    }
    const ghEnd = browser.browsingContext?.useGlobalHistory;
    const finalUrl = browser.currentURI.spec.slice(0, 90);
    try {
      browser.removeProgressListener(listener);
    } catch {
      /* gone */
    }
    browser.removeEventListener("DOMAudioPlaybackStarted", onAudio);
    gBrowser.removeTab(node, { animate: false, skipSessionStore: true, skipPermitUnload: true });
    await sleep(3000);
    const visits = await visitsSince(start);
    const r = {
      url: site.url,
      history: off ? "off" : "on (control)",
      seenInOpen,
      loadMs,
      finalUrl,
      commits,
      bcs,
      ghEnd,
      visits,
      media,
      playing,
      audio,
      page,
      tabsSame: b.tabs.map((t) => t.id).join() === tabsBefore && gBrowser.tabs.length === gTabsBefore,
      closedSame: SS.getClosedTabCountForWindow(window) === closedBefore,
    };
    results.push(r);
    log("SITE " + JSON.stringify(r));
  }
  log("SUMMARY " + JSON.stringify(results.map((r) => ({ url: r.url, history: r.history, visits: r.visits.length, replaced: r.bcs.length > 1, ghEnd: r.ghEnd, load: r.loadMs, media: r.media.length, playing: r.playing, audio: r.audio, banners: r.page?.banners, password: r.page?.password, tabs: r.tabsSame, closed: r.closedSame }))));
});
