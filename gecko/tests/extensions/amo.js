// Install uBlock Origin from addons.mozilla.org the way a person does (owner's report, 2026-10-10:
// "adding an extension from Mozilla's add-ons site is not working"; the cause was the profile's
// toolbar layout, see layout.js). Opens the real listing, clicks "Add to Firefox" with a real
// (trusted) mouse click, accepts each add-on prompt that shows, and reports every step: AddonManager
// install events, the install's observer topics, the doorhangers (popupid, anchor), script errors,
// and when no prompt comes, what Firefox and Deer have for it.
// Options (--env): AMO_AUTOHIDE=1 the bar in auto-hide with the pointer on the page; AMO_REALMOUSE=1
// the pointer travels to the prompt's button and clicks it; AMO_LINK=1 follow the button's plain
// .xpi link instead; AMO_TRACE=1 trace ExtensionsUI / PopupNotifications calls.
//   python tests/extensions/runx.py --test tests/extensions/amo.js --name extensions-amo --app build-extensions --timeout 240
// Needs the network. Downloads uBlock Origin from addons.mozilla.org into the throwaway test profile
// only (the owner asked for this to work; nothing else is installed). Captures: amo-1-listing,
// amo-2-<popupid>..., amo-3-installed.
/* global spike, gBrowser, Services, ChromeUtils, PopupNotifications, PanelUI, CustomizableUI, Ci */
spike.main(async () => {
  const { check, log, capture, sleep, waitFor } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const ID = "uBlock0@raymondhill.net";
  // AMO_AUTOHIDE=1: with the tab bar in its default mode (shown when the pointer is at the top), as a
  // person has it since 0.1.1; the pointer rests on the page, so the bar is hidden when they click.
  const autohide = Services.env.get("AMO_AUTOHIDE") === "1";
  if (autohide) {
    window.vitre.sys("VitreSettings").set({ barAutoHide: true });
    spike.EU.synthesizeMouseAtPoint(640, 500, { type: "mousemove" }, window);
  }
  const URL = "https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/";

  function inPage(fn, browser = gBrowser.selectedBrowser) {
    return new Promise((resolve) => {
      const mm = browser.messageManager;
      const id = "A:r" + Math.random();
      const on = (m) => { mm.removeMessageListener(id, on); resolve(m.data); };
      mm.addMessageListener(id, on);
      const src = "(function(){ let r; try { r = (" + fn.toString() + ")(content, content.document); } catch (e) { r = 'ERR ' + e; } sendAsyncMessage(" + JSON.stringify(id) + ", r); })()";
      mm.loadFrameScript("data:," + encodeURIComponent(src), false);
    });
  }

  // ---- what happens ----
  const events = [];
  const at = performance.now();
  const note = (what, extra) => { const e = { t: Math.round(performance.now() - at), what, ...(extra || {}) }; events.push(e); log("EVENT", JSON.stringify(e)); };
  const listener = {};
  for (const k of ["onNewInstall", "onDownloadStarted", "onDownloadProgress", "onDownloadEnded", "onDownloadFailed", "onDownloadCancelled", "onInstallStarted", "onInstallEnded", "onInstallFailed", "onInstallCancelled", "onInstallPostponed"]) {
    listener[k] = (install) => { if (k !== "onDownloadProgress") note(k, { name: install?.name, state: install?.state, error: install?.error, source: install?.sourceURI?.spec?.slice(0, 120) }); };
  }
  AddonManager.addInstallListener(listener);
  // The install's own messages (amManager / XPIInstall -> browser-addons.js / ExtensionsUI).
  const TOPICS = ["webextension-permission-prompt", "webextension-install-notify", "addon-install-started", "addon-install-blocked", "addon-install-origin-blocked", "addon-install-disabled", "addon-install-failed", "addon-install-confirmation", "addon-install-complete", "addon-install-webapi-blocked", "addon-install-policy-blocked"];
  const topicObserver = { observe(subject, topic) { let extra = {}; try { const w = subject?.wrappedJSObject; extra = { info: w?.info ? Object.keys(w.info).join(",") : undefined, installs: w?.installs?.length }; } catch {} note("topic " + topic, extra); } };
  for (const t of TOPICS) Services.obs.addObserver(topicObserver, t);
  const shown = [];
  const onShown = () => {
    const n = PopupNotifications.panel.firstElementChild;
    const anchor = PopupNotifications.panel.anchorNode;
    const e = { id: n?.getAttribute("popupid"), label: n?.getAttribute("label"), primary: n?.button?.label, anchor: anchor ? anchor.id || anchor.className : null };
    shown.push(e);
    note("doorhanger", e);
  };
  PopupNotifications.panel.addEventListener("popupshown", onShown);
  const consoleSeen = [];
  const consoleListener = {
    observe(m) {
      const t = m.message || String(m);
      let src = "";
      try {
        const e = m.QueryInterface(Ci.nsIScriptError);
        src = e.sourceName || "";
        // Script errors from the browser's own code (chrome:, resource:, moz-src:) say why a prompt never came.
        if (!(e.flags & Ci.nsIScriptError.warningFlag) && /^(chrome|resource|moz-src):/.test(src)) consoleSeen.push(`${t.slice(0, 400)} @ ${src}:${e.lineNumber}`);
        return;
      } catch {
        /* a plain console message */
      }
      if (/addon|xpi|install|AddonManager|mozAddonManager|amo/i.test(t) && !/cookie/i.test(t)) consoleSeen.push(t.slice(0, 300));
    },
  };
  Services.console.registerListener(consoleListener);

  // AMO_TRACE=1: trace ExtensionsUI's prompt path (how the 2026-10-10 bug was found).
  if (Services.env.get("AMO_TRACE") === "1") {
  const { ExtensionsUI } = ChromeUtils.importESModule("resource:///modules/ExtensionsUI.sys.mjs");
  const realShow = ExtensionsUI.showPermissionsPrompt;
  ExtensionsUI.showPermissionsPrompt = function (target, ...rest) {
    const br = target?.linkedBrowser ?? target;
    note("ExtensionsUI.showPermissionsPrompt", { pendingForBrowser: !!ExtensionsUI.pendingNotifications.get(br), pendingCount: ExtensionsUI.pendingNotifications.size ?? "?" });
    const p = realShow.call(this, target, ...rest);
    p.then((r) => note("showPermissionsPrompt resolved", { r }), (e) => note("showPermissionsPrompt threw", { e: String(e) }));
    return p;
  };
  const realGetAnchor = window.gUnifiedExtensions.getPopupAnchorID;
  window.gUnifiedExtensions.getPopupAnchorID = function (...a) {
    note("getPopupAnchorID called");
    try {
      return realGetAnchor.apply(this, a);
    } catch (e) {
      note("getPopupAnchorID threw", { e: String(e) });
      throw e;
    }
  };
  const realPNShow = PopupNotifications.show;
  PopupNotifications.show = function (...a) {
    note("PopupNotifications.show", { id: a[1], anchor: a[3] });
    try {
      return realPNShow.apply(this, a);
    } catch (e) {
      note("PopupNotifications.show threw", { e: String(e), stack: String(e.stack).replace(/\s+/g, " ").slice(0, 300) });
      throw e;
    }
  };
  }

  // ---- 1. the listing ----
  gBrowser.selectedBrowser.fixupAndLoadURIString(URL, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  const loaded = await waitFor(() => gBrowser.selectedBrowser.currentURI.spec.startsWith("https://addons.mozilla.org/") && !gBrowser.selectedBrowser.webProgress?.isLoadingDocument, { timeout: 30000, what: "AMO listing" }).catch(() => false);
  if (!loaded) {
    log("NOTE AMO not reachable: nothing checked");
    return;
  }
  await sleep(4000); // AMO renders its install button with script
  log("listing", gBrowser.selectedBrowser.currentURI.spec, "remoteType", gBrowser.selectedBrowser.remoteType);
  const page = await inPage(function (w, d) {
    const cands = [...d.querySelectorAll("a, button")].filter((el) => /add to firefox|download firefox|install/i.test(el.textContent || "")).map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.localName, text: (el.textContent || "").trim().slice(0, 60), cls: String(el.className).slice(0, 80), href: el.getAttribute("href"), x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    });
    return { mozAddonManager: !!w.navigator.wrappedJSObject.mozAddonManager, ua: w.navigator.userAgent, cands };
  });
  log("page", JSON.stringify(page));
  await capture("amo-1-listing");
  const button = (page.cands || []).find((c) => /add to firefox/i.test(c.text) && c.w > 0);
  check("AMO offers Add to Firefox (mozAddonManager present)", !!button && page.mozAddonManager, page);
  if (!button) return;

  // ---- 2. a trusted click on it, then accept every add-on prompt ----
  if (autohide) {
    spike.EU.synthesizeMouseAtPoint(640, 500, { type: "mousemove" }, window);
    await waitFor(() => window.vitre.bar.hidden, { timeout: 5000, what: "the bar hidden" }).catch(() => null);
    log("bar hidden before the click:", window.vitre.bar.hidden);
  }
  const box = gBrowser.selectedBrowser.getBoundingClientRect();
  const zoom = gBrowser.selectedBrowser.fullZoom || 1;
  if (Services.env.get("AMO_LINK") === "1") {
    // The button before AMO's script takes it over (a click while the page is still loading): a
    // plain link to the .xpi, followed with the page's principal and a user gesture.
    const principal = gBrowser.selectedBrowser.contentPrincipal;
    gBrowser.selectedBrowser.fixupAndLoadURIString(new window.URL(button.href, URL).href, { triggeringPrincipal: principal, hasValidUserGestureActivation: true });
    note("followed the link", { href: button.href });
  } else {
    spike.EU.synthesizeMouseAtPoint(box.left + button.x * zoom, box.top + button.y * zoom, {}, window);
    note("clicked", { x: Math.round(box.left + button.x), y: Math.round(box.top + button.y) });
  }
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const dlList = await Downloads.getList(Downloads.ALL);
  await dlList.addView({ onDownloadAdded: (d) => note("FIREFOX DOWNLOAD added", { source: d.source?.url?.slice(0, 120), target: d.target?.path, contentType: d.contentType }) });
  try {
    const vd = window.vitre?.sys("VitreDownloads");
    vd?.onChange?.(() => {});
    const list = vd?.list?.() ?? [];
    note("deer downloads before", { n: list.length });
  } catch (e) { note("deer downloads n/a", { e: String(e) }); }
  let installed = null;
  for (let i = 0; i < 60 && !installed; i++) {
    await sleep(500);
    const n = PopupNotifications.panel.state === "open" ? PopupNotifications.panel.firstElementChild : null;
    const id = n?.getAttribute("popupid");
    if (n && id && id !== "addon-progress") {
      await capture("amo-2-" + id);
      await sleep(700); // security.notification_enable_delay
      const btn = n.button;
      if (Services.env.get("AMO_REALMOUSE") === "1" && btn) {
        // As a person does: the pointer travels from the page to the button, then a real click.
        const r = btn.getBoundingClientRect();
        const sx = 640, sy = 520, ex = r.left + r.width / 2, ey = r.top + r.height / 2;
        for (let k = 0; k <= 12; k++) {
          spike.EU.synthesizeMouseAtPoint(sx + ((ex - sx) * k) / 12, sy + ((ey - sy) * k) / 12, { type: "mousemove" }, window);
          await sleep(60);
        }
        await sleep(600);
        const still = PopupNotifications.panel.state === "open" && PopupNotifications.panel.firstElementChild === n;
        note("pointer on the button", { panelOpen: still, barHidden: window.vitre?.bar.hidden, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], now: (() => { const q = btn.getBoundingClientRect(); return [Math.round(q.left), Math.round(q.top)]; })() });
        if (!still) {
          await capture("amo-2b-closed");
          break;
        }
        note("pressing (mouse)", { id, primary: btn.label });
        spike.EU.synthesizeMouseAtCenter(btn, {}, window);
      } else {
        note("pressing", { id, primary: btn?.label });
        btn?.click();
      }
      await sleep(800);
    }
    installed = await AddonManager.getAddonByID(ID);
    if (i === 16 && !shown.length) {
      // No prompt 8 s after the click: what Firefox and Deer have for it (diagnostics).
      const br = gBrowser.selectedBrowser;
      const pn = PopupNotifications.getNotification("addon-webext-permissions", br);
      const btn = document.getElementById("unified-extensions-button");
      const anchor = pn?.anchorElement;
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; };
      note("no prompt: diagnostics", {
        notification: !!pn, dismissed: pn?.dismissed, anchorId: pn?.anchorID,
        anchor: anchor ? (anchor.id || anchor.localName) + " " + JSON.stringify(box(anchor)) + " visible=" + (anchor.checkVisibility?.() ?? "?") : null,
        cachedAnchor: (() => { const c = br["unified-extensions-buttonpopupnotificationanchor"]; return c ? (c.id || c.localName) + " " + JSON.stringify(box(c)) : null; })(),
        button: btn ? { parent: btn.parentElement?.id || btn.parentElement?.className, hidden: btn.hidden, box: box(btn), visible: btn.checkVisibility?.() } : null,
        placement: CustomizableUI.getPlacementOfWidget("unified-extensions-button"),
        door: box(document.getElementById("vitre-ext-door")),
        overridden: String(window.gUnifiedExtensions?.getPopupAnchorID).includes("popupnotificationanchor") && !String(window.gUnifiedExtensions?.getPopupAnchorID).includes("hacky"),
        activeWindow: Services.focus.activeWindow === window,
      });
    }
  }
  await sleep(1000);
  await capture("amo-3-installed");
  log("doorhangers", JSON.stringify(shown));
  try {
    const vd = window.vitre?.sys("VitreDownloads");
    const list = vd?.list?.() ?? [];
    log("deer downloads after", JSON.stringify(list.map((x) => ({ url: (x.url || x.source || "").slice(0, 100), name: x.name || x.fileName, state: x.state }))));
  } catch (e) { log("deer downloads n/a", String(e)); }
  log("tab now", gBrowser.selectedBrowser.currentURI.spec);
  log("console", JSON.stringify(consoleSeen.slice(-15)));
  check("uBlock Origin is installed from addons.mozilla.org", !!installed && installed.isActive, installed ? { version: installed.version, active: installed.isActive, signed: installed.signedState } : events.map((e) => e.what));
  AddonManager.removeInstallListener(listener);
  for (const t of TOPICS) Services.obs.removeObserver(topicObserver, t);
  Services.console.unregisterListener(consoleListener);
  PopupNotifications.panel.removeEventListener("popupshown", onShown);
});
