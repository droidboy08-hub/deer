// Vitre Peek on Gecko (spike).
//
// Primitive: a peek IS a real tab. gBrowser.addTab() creates it in the background, it is hidden
// from the tab strip (gBrowser.hideTab), and its panel (the .browserSidebarContainer that lives in
// #tabbrowser-tabpanels) is shown as a floating sheet above the selected tab's panel with CSS:
// tabpanels hides non-selected panels with `-moz-subtree-hidden-only-visually: 1`, so one class that
// resets it and positions the panel absolutely is enough. The docshell is kept active while it is
// not the selected tab through gBrowser.activateBrowserForPrintPreview() (the tab switcher leaves
// such browsers alone). Promotion = remove the class, showTab(), select: the same <browser>, the
// same content process, nothing reloads.
/* global Services, Ci, Cu, gBrowser, ChromeUtils, XULBrowserWindow */
window.VitrePeek = (() => {
  const H = "http://www.w3.org/1999/xhtml";
  const el = (tag, cls, text) => {
    const n = document.createElementNS(H, tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const log = (...a) => window.spike && window.spike.log("[peek]", ...a);
  const SVGNS = "http://www.w3.org/2000/svg";
  const icon = (d) => {
    const s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("viewBox", "0 0 16 16");
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("d", d);
    s.appendChild(p);
    return s;
  };

  const CSS = `
  #tabbrowser-tabpanels > .vp-scrim { -moz-subtree-hidden-only-visually: 0; visibility: inherit; position: absolute; inset: 0; z-index: 3;
    background: rgba(0,0,0,0.22); opacity: 0; transition: opacity 240ms ease; }
  #tabbrowser-tabpanels > .vp-scrim.on { opacity: 1; }
  #tabbrowser-tabpanels > .vp-panel { -moz-subtree-hidden-only-visually: 0; visibility: inherit; position: absolute; z-index: 4;
    left: var(--vp-x); top: var(--vp-y); width: var(--vp-w); height: var(--vp-h); min-width: 0; max-width: none;
    border-radius: 22px; overflow: clip; background: #fff;
    box-shadow: 0 30px 80px rgba(0,0,0,0.38), 0 2px 8px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.35);
    transform-origin: var(--vp-ox, 50%) var(--vp-oy, 50%);
    transition: transform 400ms cubic-bezier(0.2,0.9,0.3,1.05), opacity 200ms ease, left 380ms cubic-bezier(0.2,0,0,1), top 380ms cubic-bezier(0.2,0,0,1), width 380ms cubic-bezier(0.2,0,0,1), height 380ms cubic-bezier(0.2,0,0,1), border-radius 380ms; }
  #tabbrowser-tabpanels > .vp-panel.vp-from { transform: scale(0.2); opacity: 0; }
  #tabbrowser-tabpanels > .vp-panel.vp-expand { left: 0; top: 0; width: 100%; height: 100%; border-radius: 0; }
  #tabbrowser-tabpanels > .vp-panel .browserContainer { border-radius: 0 !important; margin: 0 !important; }
  /* .browserContainer is a CSS grid (notificationbox / rdm-toolbar / browserstack / findbar / devtools).
     The header takes the responsive-design-mode toolbar row, which is empty outside RDM. */
  #tabbrowser-tabpanels > .vp-panel > .browserContainer { --rdm-toolbar-height: 44px; }
  .vp-header { grid-area: rdm-toolbar; height: 44px; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 12px; position: relative;
    font: 13px "Segoe UI Variable Text", "Segoe UI", sans-serif; color: #1b1b1f; background: rgba(246,246,248,0.92); border-bottom: 1px solid rgba(0,0,0,0.08); user-select: none; }
  .vp-header .vp-fav { width: 16px; height: 16px; flex: none; }
  .vp-header .vp-host { font-weight: 600; }
  .vp-header .vp-path { color: rgba(27,27,31,0.55); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vp-header .vp-addr { display: flex; gap: 2px; min-width: 0; flex: 1; align-items: center; }
  .vp-header .vp-slot { flex: 1; min-width: 0; display: flex; align-items: center; }
  .vp-btn { width: 28px; height: 28px; border-radius: 14px; border: 0; background: transparent; color: inherit; display: flex; align-items: center; justify-content: center; flex: none; padding: 0; }
  .vp-btn:hover { background: rgba(0,0,0,0.06); }
  .vp-btn[hidden] { display: none; }
  .vp-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .vp-load { position: absolute; left: 0; bottom: -1px; height: 2px; width: 0; background: #005fb8; transition: width 300ms ease, opacity 300ms ease 200ms; }
  .vp-header[busy] .vp-load { width: 70%; opacity: 1; }
  .vp-header:not([busy]) .vp-load { width: 100%; opacity: 0; }
  `;

  const WARM_MS = 60000;
  let styled = false;
  let peek = null; // { tab, browser, panel, header, scrim, sourceTab, origin }
  let warm = null; // { tab, sourceTab, timer, origin }
  let lastEsc = 0;
  const system = () => Services.scriptSecurityManager.getSystemPrincipal();
  const tabpanels = () => gBrowser.tabpanels;

  function ensureStyle() {
    if (styled) return;
    styled = true;
    const s = el("style");
    s.textContent = CSS;
    document.documentElement.appendChild(s);
  }

  function sheetRect() {
    // Centred, 72% of the width clamped to 720..1120; full sheet with 8 px margins when small.
    const r = tabpanels().getBoundingClientRect();
    if (r.width < 900 || r.height < 600) return { x: 8, y: 8, w: r.width - 16, h: r.height - 16 };
    const w = Math.max(720, Math.min(1120, Math.round(r.width * 0.72)));
    return { x: Math.round((r.width - w) / 2), y: 16, w, h: r.height - 40 };
  }

  function place() {
    if (!peek) return;
    const s = sheetRect();
    const st = peek.panel.style;
    st.setProperty("--vp-x", s.x + "px");
    st.setProperty("--vp-y", s.y + "px");
    st.setProperty("--vp-w", s.w + "px");
    st.setProperty("--vp-h", s.h + "px");
    if (peek.origin) {
      // Grow from the link: transform-origin at the link's centre, in sheet coordinates.
      const tp = tabpanels().getBoundingClientRect();
      st.setProperty("--vp-ox", peek.origin.x - tp.left - s.x + "px");
      st.setProperty("--vp-oy", peek.origin.y - tp.top - s.y + "px");
    }
  }

  function buildHeader(p) {
    const header = el("div", "vp-header");
    const back = el("button", "vp-btn vp-back");
    back.append(icon("M10 3L5 8l5 5"));
    back.setAttribute("title", "Back  Alt+Left");
    back.hidden = true;
    back.addEventListener("click", () => p.browser.goBack());
    const fav = el("img", "vp-fav");
    const addr = el("div", "vp-addr");
    const host = el("span", "vp-host");
    const path = el("span", "vp-path");
    addr.append(host, path);
    const slot = el("div", "vp-slot"); // the find capsule mounts here and replaces the address
    slot.hidden = true;
    const promoteBtn = el("button", "vp-btn vp-promote");
    promoteBtn.append(icon("M6 3H3v10h10v-3M9 3h4v4M13 3L7.5 8.5"));
    promoteBtn.setAttribute("title", "Open as tab  Alt+Enter");
    promoteBtn.addEventListener("click", () => promote());
    const closeBtn = el("button", "vp-btn vp-close");
    closeBtn.append(icon("M4 4l8 8M12 4l-8 8"));
    closeBtn.setAttribute("title", "Close  Esc");
    closeBtn.addEventListener("click", () => close("button"));
    const load = el("div", "vp-load");
    header.append(back, fav, addr, slot, promoteBtn, closeBtn, load);
    for (const b of [back, promoteBtn, closeBtn]) b.addEventListener("mousedown", (e) => e.preventDefault());
    header.addEventListener("dblclick", (e) => !e.target.closest("button") && promote());
    header.addEventListener("contextmenu", (e) => {
      if (!window.VitreMenu) return;
      window.VitreMenu.showForChrome(e, [
        { label: "Open as tab", accel: "Alt+Enter", key: "t", run: () => promote() },
        { label: "Copy address", key: "a", run: () => Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(p.browser.currentURI.spec) },
        { label: "Open in new window", key: "w", run: () => { const t = promote(); if (t) gBrowser.replaceTabWithWindow(t); } },
        "-",
        { label: "Close peek", accel: "Esc", key: "c", run: () => close("menu") },
      ]);
    });
    header.addEventListener("vitre-find-closed", () => {
      slot.hidden = true;
      addr.style.display = "";
    });
    p.header = header;
    p.ui = { back, fav, host, path, addr, slot };
    return header;
  }

  function refreshHeader() {
    if (!peek) return;
    const { browser, tab, ui, header } = peek;
    let uri = browser.currentURI;
    let h = "";
    let rest = "";
    try {
      h = uri.host;
      rest = uri.pathQueryRef;
    } catch (e) {
      h = uri.spec;
    }
    ui.host.textContent = h;
    ui.path.textContent = rest === "/" ? "" : rest;
    ui.back.hidden = !browser.canGoBack;
    const image = tab.getAttribute("image");
    if (image) ui.fav.src = image;
    ui.fav.style.visibility = image ? "visible" : "hidden";
    header.toggleAttribute("busy", tab.hasAttribute("busy"));
  }

  // DOM focus on the <browser> is not enough: keys are forwarded to the remote frame the focus
  // manager considers active. Focusing the peek's browser before its remote frame exists (right
  // after addTab) or across a process switch leaves key events going to the tab underneath, so
  // focus is re-asserted once the first document commits and after any remoteness change.
  function focusPeek(force) {
    if (!peek || !peek.sourceTab.selected) return;
    const ae = document.activeElement;
    if (!force && ae !== peek.browser && ae !== peek.sourceTab.linkedBrowser) return; // focus is elsewhere in chrome: leave it
    if (ae === peek.browser) Services.focus.clearFocus(window);
    peek.browser.focus();
  }

  const progress = {
    onLocationChange(browser, webProgress) {
      if (peek && browser === peek.browser) {
        refreshHeader();
        if (webProgress.isTopLevel && !peek.focusedOnce) {
          peek.focusedOnce = true;
          focusPeek(false);
        }
      }
    },
    onStateChange(browser) {
      if (peek && browser === peek.browser) refreshHeader();
    },
  };

  /** Turn an existing background tab into the peek sheet over `sourceTab`. */
  function adopt(tab, { sourceTab = gBrowser.selectedTab, origin = null, animate = true } = {}) {
    ensureStyle();
    if (peek) close("replaced", { instant: true });
    const browser = tab.linkedBrowser;
    gBrowser.hideTab(tab, "vitre-peek"); // out of the tab strip, Ctrl+Tab and visibleTabs
    tab.setAttribute("vitre-peek", "true");
    const panel = document.getElementById(tab.linkedPanel);
    const p = (peek = { tab, browser, panel, sourceTab, origin });
    const container = panel.querySelector(".browserContainer");
    container.insertBefore(buildHeader(p), container.firstChild);
    const scrim = (p.scrim = el("div", "vp-scrim"));
    scrim.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (e.button === 0 && !e.shiftKey) close("scrim");
    });
    tabpanels().appendChild(scrim);
    place();
    if (animate) panel.classList.add("vp-from");
    panel.classList.add("vp-panel");
    // Keep rendering and running while it is not the selected tab.
    gBrowser.activateBrowserForPrintPreview(browser);
    void panel.offsetWidth;
    panel.classList.remove("vp-from");
    scrim.classList.add("on");
    refreshHeader();
    p.focusedOnce = browser.currentURI.spec !== "about:blank" && !browser.webProgress?.isLoadingDocument;
    focusPeek(true);
    log("opened", browser.currentURI.spec, "over", sourceTab.linkedBrowser.currentURI.spec);
    return p;
  }

  /**
   * Open a URL in the peek. opts: { opener (browser), params (openLinkIn-style: triggeringPrincipal,
   * referrerInfo, policyContainer, userContextId), origin {x,y} }. A second call while a peek is
   * open "hops": the same sheet navigates.
   */
  function open(url, opts = {}) {
    const params = opts.params || {};
    const sourceTab = opts.opener ? gBrowser.getTabForBrowser(opts.opener) || gBrowser.selectedTab : gBrowser.selectedTab;
    if (peek) {
      peek.browser.fixupAndLoadURIString(url, {
        triggeringPrincipal: params.triggeringPrincipal || system(),
        referrerInfo: params.referrerInfo,
        policyContainer: params.policyContainer,
      });
      log("hop", url);
      return peek;
    }
    if (warm && warm.tab.linkedBrowser.currentURI.spec === url && !warm.tab.closing) {
      const w = warm;
      clearTimeout(w.timer);
      warm = null;
      log("rewarmed");
      return adopt(w.tab, { sourceTab, origin: opts.origin });
    }
    const tab = gBrowser.addTab(url, {
      inBackground: true,
      skipAnimation: true,
      ownerTab: sourceTab,
      openerBrowser: opts.opener || null,
      triggeringPrincipal: params.triggeringPrincipal || system(),
      referrerInfo: params.referrerInfo,
      policyContainer: params.policyContainer,
      userContextId: params.userContextId ?? sourceTab.userContextId,
    });
    return adopt(tab, { sourceTab, origin: opts.origin });
  }

  function detach(p) {
    p.panel.classList.remove("vp-panel", "vp-from", "vp-expand");
    for (const k of ["--vp-x", "--vp-y", "--vp-w", "--vp-h", "--vp-ox", "--vp-oy"]) p.panel.style.removeProperty(k);
    p.header.remove();
    p.scrim.remove();
    gBrowser._printPreviewBrowsers.delete(p.browser);
  }

  /** Close. The tab stays alive (hidden, inactive) for 60 s so Ctrl+Shift+T can bring it back. */
  function close(reason, { instant = false, discard = false } = {}) {
    if (!peek) return;
    const p = peek;
    peek = null;
    if (window.VitreFind) window.VitreFind.close(p.browser);
    detach(p);
    p.browser.docShellIsActive = false;
    p.tab.removeAttribute("vitre-peek");
    if (discard) gBrowser.removeTab(p.tab, { animate: false });
    else {
      if (warm) gBrowser.removeTab(warm.tab, { animate: false });
      warm = { tab: p.tab, sourceTab: p.sourceTab, origin: p.origin, timer: setTimeout(() => { if (warm && warm.tab === p.tab) { gBrowser.removeTab(p.tab, { animate: false }); warm = null; } }, WARM_MS) };
    }
    if (p.sourceTab.selected) p.sourceTab.linkedBrowser.focus();
    log("closed", reason, discard ? "(discarded)" : "(warm)");
  }

  function reopen() {
    if (!warm || warm.tab.closing || warm.sourceTab !== gBrowser.selectedTab) return null;
    const w = warm;
    clearTimeout(w.timer);
    warm = null;
    return adopt(w.tab, { sourceTab: w.sourceTab, origin: w.origin });
  }

  /** Open as tab: the same browser becomes a normal, selected tab. Nothing is reloaded. */
  function promote({ animate = false } = {}) {
    if (!peek) return null;
    const p = peek;
    const finish = () => {
      if (peek !== p) return;
      peek = null;
      if (window.VitreFind) window.VitreFind.close(p.browser);
      detach(p);
      p.tab.removeAttribute("vitre-peek");
      gBrowser.showTab(p.tab);
      if (!p.tab.closing && p.sourceTab.isConnected) gBrowser.moveTabAfter(p.tab, p.sourceTab);
      gBrowser.selectedTab = p.tab;
      log("promoted", p.browser.currentURI.spec, "tab index", gBrowser.tabs.indexOf(p.tab), "source index", gBrowser.tabs.indexOf(p.sourceTab));
    };
    if (animate) {
      p.scrim.classList.remove("on");
      p.panel.classList.add("vp-expand");
      setTimeout(finish, 390);
    } else finish();
    return p.tab;
  }

  /**
   * Ctrl+Q / Shift+Enter: peek the focused link, else the link under the pointer.
   * The VitrePage actor gives the link and its rectangles; without it the hovered or focused link's
   * URL is still known in chrome as XULBrowserWindow.overLink (what the status bubble shows).
   */
  async function peekLink(browser = gBrowser.selectedBrowser) {
    let info = null;
    if (window.VitreActors && window.VitreActors.registered) {
      try {
        info = await window.VitreActors.query(browser, "Vitre:Link");
      } catch (e) {}
    }
    const href = (info && info.href) || XULBrowserWindow.overLink;
    if (!href) return null;
    const principal = browser.contentPrincipal;
    try {
      // The URL came from the page: load it as the page, never as chrome.
      Services.scriptSecurityManager.checkLoadURIStrWithPrincipal(principal, href, Ci.nsIScriptSecurityManager.DISALLOW_INHERIT_PRINCIPAL);
    } catch (e) {
      return null;
    }
    let origin = null;
    if (info && info.rects && info.rects.length) {
      const br = browser.getBoundingClientRect();
      const r = info.rects[0];
      origin = { x: br.left + r.x + r.w / 2, y: br.top + r.y + r.h / 2 };
    }
    log("peekLink", href, info ? "via actor (" + info.how + ")" : "via overLink");
    return open(href, { opener: browser, origin, params: { triggeringPrincipal: principal } });
  }

  const isPeekBrowser = (b) => !!peek && peek.browser === b;
  /** The browser commands should go to: the peek if one is open over the selected tab. */
  const activeBrowser = () => (peek && peek.sourceTab.selected ? peek.browser : null);

  function onKeydown(e) {
    if (!peek || !peek.sourceTab.selected) return;
    if (window.VitreMenu && window.VitreMenu.isOpen) return;
    const inPeek = e.target === peek.browser;
    // Browser-first keys: never reach the page.
    if (e.key === "Enter" && e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      promote({ animate: e.shiftKey ? false : VitrePeek.animatePromote });
      return;
    }
    if (e.key.toLowerCase() === "w" && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      close("ctrl+w");
      return;
    }
    if (e.key === "ArrowLeft" && e.altKey && !peek.browser.canGoBack && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      close("alt+left on first entry");
      return;
    }
    if (e.key === "Escape") {
      if (e.target && e.target.closest && e.target.closest(".vf-pill")) return; // find field handles its own Esc
      VitrePeek.escTrace.push({ inPeek, reply: e.isReplyEventFromRemoteContent, waiting: e.isWaitingReplyFromRemoteContent, prevented: e.defaultPrevented, phase: e.eventPhase });
      // Page-first: ask for the event back after the page has seen it.
      if (inPeek && peek.browser.isRemoteBrowser && !e.isReplyEventFromRemoteContent) {
        const now = Date.now();
        if (now - lastEsc < 400 && !e.repeat) {
          // Esc Esc closes even when the page eats Esc.
          e.preventDefault();
          e.stopPropagation();
          close("esc esc");
          return;
        }
        lastEsc = now;
        if (!e.isWaitingReplyFromRemoteContent) e.requestReplyFromRemoteContent();
        return;
      }
      if (!e.defaultPrevented) {
        e.preventDefault();
        close(e.isReplyEventFromRemoteContent ? "esc (page did not use it)" : "esc");
      } else log("esc consumed by the page");
    }
  }

  function install() {
    ensureStyle();
    gBrowser.addTabsProgressListener(progress);
    gBrowser.tabContainer.addEventListener("TabAttrModified", (e) => peek && e.target === peek.tab && refreshHeader());
    gBrowser.tabContainer.addEventListener("TabSelect", () => {
      // A peek belongs to its source tab: hide it while another tab is selected.
      if (!peek) return;
      const on = peek.sourceTab.selected;
      peek.panel.classList.toggle("vp-panel", on);
      peek.scrim.hidden = !on;
      if (on) gBrowser.activateBrowserForPrintPreview(peek.browser);
      else {
        gBrowser._printPreviewBrowsers.delete(peek.browser);
        peek.browser.docShellIsActive = false;
      }
    });
    gBrowser.tabContainer.addEventListener("TabRemotenessChange", (e) => {
      if (peek && e.target === peek.tab) {
        gBrowser.activateBrowserForPrintPreview(peek.browser);
        focusPeek(false);
      }
    });
    gBrowser.tabContainer.addEventListener("TabClose", (e) => {
      if (peek && e.target === peek.sourceTab) close("source closed", { discard: true });
      if (warm && e.target === warm.tab) warm = null;
    });
    window.addEventListener("resize", place);
    window.addEventListener("keydown", onKeydown, true);
    // Content calling window.focus() (and Finder.focusContent(), which does the same) fires
    // "framefocusrequested" on the <browser>; tabbrowser answers by SELECTING that tab, which would
    // silently turn the peek into the active tab. Stop it before tabbrowser's listener (bubble phase
    // on the window) sees it; the focus manager then just focuses the browser.
    window.addEventListener("framefocusrequested", (e) => {
      if (peek && e.target === peek.browser) {
        e.stopPropagation();
        VitrePeek.blockedFocusRequests++;
      }
    }, true);
    // alert()/confirm() from a tab that is not selected makes tabbrowser switch to it (or flag it for
    // attention). The dialog itself lives in the panel's .browserStack, i.e. inside the sheet already.
    window.addEventListener("DOMWillOpenModalDialog", (e) => {
      if (peek && (e.originalTarget === peek.browser || e.target === peek.browser)) {
        e.stopPropagation();
        VitrePeek.blockedDialogSwitches++;
      }
    }, true);
    // Ctrl+Q is a page-first key: ask for the event back after the page has had it.
    window.addEventListener("keydown", (e) => {
      if (!(e.key.toLowerCase() === "q" && e.ctrlKey && !e.shiftKey && !e.altKey)) return;
      const b = gBrowser.selectedBrowser;
      if (e.target === b && b.isRemoteBrowser && !e.isReplyEventFromRemoteContent) {
        if (!e.isWaitingReplyFromRemoteContent) e.requestReplyFromRemoteContent();
        return;
      }
      if (e.defaultPrevented || (peek && peek.sourceTab.selected && e.target === peek.browser)) return;
      e.preventDefault();
      peekLink(b);
    }, true);
    // Hop: while Shift is held the scrim lets clicks through, so Shift+click on a link of the
    // dimmed page reaches it (and comes back through ClickHandlerParent below).
    const shift = (e) => peek && e.key === "Shift" && (peek.scrim.style.pointerEvents = e.type === "keydown" ? "none" : "");
    window.addEventListener("keydown", shift, true);
    window.addEventListener("keyup", shift, true);

    // ---- Shift+click on a link -> peek ---------------------------------------------------------
    // ClickHandlerChild only reports clicks the page did not preventDefault, so pages that use
    // Shift+click themselves keep it. BrowserUtils.whereToOpenLink() maps Shift+click to "window".
    const { ClickHandlerParent } = ChromeUtils.importESModule("resource:///actors/ClickHandlerParent.sys.mjs");
    const { E10SUtils } = ChromeUtils.importESModule("resource://gre/modules/E10SUtils.sys.mjs");
    if (!ClickHandlerParent.prototype.__vitreOrig) {
      const orig = (ClickHandlerParent.prototype.__vitreOrig = ClickHandlerParent.prototype.contentAreaClick);
      ClickHandlerParent.prototype.contentAreaClick = function (data) {
        const browser = this.manager.browsingContext.top.embedderElement;
        const win = browser && browser.documentGlobal;
        const P = win && win.VitrePeek;
        if (P && P.shiftClickPeeks && data.href && data.button === 0 && data.shiftKey && !data.ctrlKey && !data.altKey && !data.metaKey && win.gBrowser.getTabForBrowser(browser)) {
          const fromPeek = P.isPeekBrowser(browser);
          P.open(data.href, {
            // Shift+click inside the sheet hops in place; on the dimmed page it also hops.
            opener: fromPeek ? P.current.sourceTab.linkedBrowser : browser,
            params: {
              triggeringPrincipal: data.triggeringPrincipal,
              referrerInfo: E10SUtils.deserializeReferrerInfo(data.referrerInfo),
              policyContainer: data.policyContainer ? E10SUtils.deserializePolicyContainer(data.policyContainer) : null,
              userContextId: data.originAttributes.userContextId,
            },
            origin: P.pointer,
          });
          return;
        }
        orig.call(this, data);
      };
    }
    // Remember where the pointer is (chrome px) so a peek can grow from the link.
    window.addEventListener("mousedown", (e) => (VitrePeek.pointer = { x: e.clientX, y: e.clientY }), true);

    // ---- target=_blank / window.open -----------------------------------------------------------
    // Content asks the window's nsIBrowserDOMWindow for a new browser. Wrap the two entry points
    // remote content uses; the original creates the tab (with openWindowInfo, so window.opener and
    // the name survive), and we decide what the tab becomes.
    // window.browserDOMWindow is an XPConnect wrapper; properties set on it never reach the JS object
    // that C++ calls. The real BrowserDOMWindow instance is .wrappedJSObject.
    const bdw = window.browserDOMWindow.wrappedJSObject;
    for (const m of ["createContentWindowInFrame", "openURIInFrame"]) {
      const orig = bdw[m].bind(bdw);
      bdw[m] = (aURI, aParams, aWhere, aFlags, aName) => {
        const mode = VitrePeek.newWindowMode; // "tab" | "peek"
        const NEWTAB = Ci.nsIBrowserDOMWindow.OPEN_NEWTAB;
        const BG = Ci.nsIBrowserDOMWindow.OPEN_NEWTAB_BACKGROUND;
        const FG = Ci.nsIBrowserDOMWindow.OPEN_NEWTAB_FOREGROUND;
        const tabby = aWhere === NEWTAB || aWhere === BG || aWhere === FG;
        const wantPeek = tabby && mode === "peek" && aWhere !== BG && !!aParams.openerBrowser;
        const browser = orig(aURI, aParams, wantPeek ? BG : aWhere, aFlags, aName);
        VitrePeek.routed.push({ method: m, where: aWhere, uri: aURI ? aURI.spec : null, hasOpenWindowInfo: !!aParams.openWindowInfo, peek: wantPeek });
        if (wantPeek && browser) {
          const tab = gBrowser.getTabForBrowser(browser);
          const src = gBrowser.getTabForBrowser(aParams.openerBrowser);
          const srcTab = peek && peek.browser === aParams.openerBrowser ? peek.sourceTab : src;
          if (tab) adopt(tab, { sourceTab: srcTab || gBrowser.selectedTab, origin: VitrePeek.pointer });
        }
        return browser;
      };
    }
  }

  const VitrePeek = {
    install,
    open,
    adopt,
    close,
    reopen,
    promote,
    peekLink,
    isPeekBrowser,
    activeBrowser,
    /** Where the find capsule mounts for a peek browser (replaces the domain and path). */
    findHost(b) {
      if (!isPeekBrowser(b)) return null;
      peek.ui.addr.style.display = "none";
      peek.ui.slot.hidden = false;
      return peek.ui.slot;
    },
    get current() { return peek; },
    get warm() { return warm; },
    shiftClickPeeks: true,
    newWindowMode: "tab",
    animatePromote: false,
    pointer: null,
    routed: [],
    blockedFocusRequests: 0,
    blockedDialogSwitches: 0,
    escTrace: [],
  };
  return VitrePeek;
})();
