/* Vitre shell UI for one browser window. Loaded into the window's own scope with
 * Services.scriptloader.loadSubScript("chrome://vitre/content/bar.js", window) by VitreShell.
 * Everything is driven from gBrowser; nothing here keeps its own tab model.
 *
 * global gBrowser, BrowserCommands, SessionStore, Services, Ci */
/* eslint-env browser */
"use strict";

(function () {
  const HTML = "http://www.w3.org/1999/xhtml";
  const PILL = 480;
  const PILL_MIN = 220;
  const CIRCLE = 44;
  const GAP = 8;
  const TOP = 12;
  const WINCTL = 108;

  // XML: an attribute may appear only once, so the stroke width is a parameter, not an override.
  const svg = (size, body, sw = 1.6) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const icons = {
    back: svg(18, '<path d="M12 4.8 6.8 10l5.2 5.2"/>'),
    forward: svg(18, '<path d="M8 4.8 13.2 10 8 15.2"/>'),
    reload: svg(17, '<path d="M15.3 10a5.3 5.3 0 1 1-1.55-3.75"/><path d="M15.4 4v3.4H12"/>'),
    stop: svg(13, '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>'),
    plus: svg(18, '<path d="M10 4.5v11M4.5 10h11"/>'),
    home: svg(18, '<path d="M3.5 9.5 10 4l6.5 5.5V16a1 1 0 0 1-1 1H12v-4.5H8V17H4.5a1 1 0 0 1-1-1z"/>'),
    search: svg(16, '<circle cx="8.8" cy="8.8" r="5.3"/><path d="m12.8 12.8 3.6 3.6"/>'),
    globe: svg(16, '<circle cx="10" cy="10" r="7"/><path d="M3 10h14M10 3c2 2.2 2.8 4.6 2.8 7s-.8 4.8-2.8 7c-2-2.2-2.8-4.6-2.8-7S8 5.2 10 3z"/>', 1.3),
    closeSmall: svg(10, '<path d="M6 6l8 8M14 6l-8 8"/>', 2.2),
    minimize: svg(14, '<path d="M4.5 10h11"/>', 1.2),
    maximize: svg(13, '<rect x="4" y="4" width="12" height="12" rx="2"/>', 1.3),
    restore: svg(13, '<rect x="4" y="6.5" width="9.5" height="9.5" rx="1.8"/><path d="M7 6.5V5.8A1.8 1.8 0 0 1 8.8 4h5.4A1.8 1.8 0 0 1 16 5.8v5.4a1.8 1.8 0 0 1-1.8 1.8h-.7"/>', 1.3),
    closeWin: svg(13, '<path d="M4.5 4.5l11 11M15.5 4.5l-11 11"/>', 1.3),
  };

  /** Markup -> DOM. The chrome document is XML, so markup is parsed as XHTML (well-formed, SVG with
   * its xmlns) and imported; this also sidesteps the innerHTML sanitizer of privileged documents. */
  const parser = new DOMParser();
  function frag(markup) {
    const doc = parser.parseFromString(`<div xmlns="${HTML}">${markup}</div>`, "application/xhtml+xml");
    if (doc.documentElement.localName === "parsererror" || doc.getElementsByTagName("parsererror").length) {
      throw new Error("vitre markup is not well-formed: " + doc.documentElement.textContent.slice(0, 300));
    }
    const f = document.createDocumentFragment();
    for (const n of [...doc.documentElement.childNodes]) f.append(document.importNode(n, true));
    return f;
  }
  function el(tag, props = {}, markup = "") {
    const e = document.createElementNS(HTML, tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") e.className = v;
      else e.setAttribute(k, v);
    }
    if (markup) e.append(frag(markup));
    return e;
  }
  const GLASS = '<div class="lens"/><div class="tint"/><div class="rim"/>';

  function displayHost(uri) {
    if (!uri) return "";
    try {
      if (uri.schemeIs("about")) return uri.spec;
      if (uri.schemeIs("file")) return decodeURIComponent(uri.filePath.split("/").pop() || uri.spec);
      return uri.host.replace(/^www\./, "");
    } catch (e) {
      return uri.spec;
    }
  }
  /** The address a tab stands for. A tab restored from a session but not loaded yet ("pending")
   * still has about:blank in its browser; its real address is in the session state. */
  function tabURI(tab) {
    if (tab.hasAttribute("pending")) {
      try {
        const state = JSON.parse(SessionStore.getTabState(tab));
        const entry = state.entries?.[(state.index || state.entries.length) - 1];
        if (entry?.url) return Services.io.newURI(entry.url);
      } catch (e) {}
    }
    return tab.linkedBrowser?.currentURI;
  }
  const isBlank = (uri) => !uri || ["about:blank", "about:newtab", "about:home"].includes(uri.spec);

  class Bar {
    constructor(root, log) {
      this.root = root;
      this.log = log;
      this.items = new Map(); // <tab> -> element
      this.progress = new WeakMap(); // <browser> -> 0..1
      this.layout = { pillRect: null, left: 0, right: 0, compact: false };
      this.events = []; // evidence trail for the spike
      this.plus = null;
      this.popup = document.documentElement.hasAttribute("popup-window");

      const tc = gBrowser.tabContainer;
      for (const type of ["TabOpen", "TabClose", "TabSelect", "TabAttrModified", "TabMove", "TabPinned", "TabUnpinned", "TabShow", "TabHide"]) {
        tc.addEventListener(type, this);
      }
      // One listener for every tab's web progress: location, load state, load fraction.
      this.progressListener = {
        onLocationChange: (browser, webProgress) => {
          if (webProgress.isTopLevel) this.updateFor(browser, "location");
        },
        onStateChange: (browser, webProgress, request, flags) => {
          if (!webProgress.isTopLevel || !(flags & Ci.nsIWebProgressListener.STATE_IS_NETWORK)) return;
          if (flags & Ci.nsIWebProgressListener.STATE_START) this.progress.set(browser, 0.1);
          if (flags & Ci.nsIWebProgressListener.STATE_STOP) {
            this.progress.delete(browser);
            if (browser === gBrowser.selectedBrowser) setTimeout(() => this.sampleTheme(), 150);
          }
          this.updateFor(browser, flags & Ci.nsIWebProgressListener.STATE_START ? "start" : "stop");
        },
        onProgressChange: (browser, webProgress, request, curSelf, maxSelf, curTotal, maxTotal) => {
          if (maxTotal > 0) this.progress.set(browser, Math.max(0.1, Math.min(1, curTotal / maxTotal)));
          this.updateFor(browser, "progress");
        },
      };
      gBrowser.addTabsProgressListener(this.progressListener);
      window.addEventListener("resize", () => this.render(true));
      window.addEventListener("unload", () => this.destroy(), { once: true });
      this.render(true);
      this.sampleTimer = setInterval(() => this.sampleTheme(), 1500);
      this.sampleTheme();
    }

    /** Light or dark glass, from what the page shows under the bar (a 1/10 scale snapshot of the
     * viewport taken by the compositor side: no script runs in the page). */
    async sampleTheme() {
      if (this.sampling || document.hidden) return;
      this.sampling = true;
      try {
        const browser = gBrowser.selectedBrowser;
        const scale = 0.1;
        const bmp = await browser.drawSnapshot(0, 0, 0, 0, scale, "rgb(255,255,255)", true);
        if (!bmp || browser !== gBrowser.selectedBrowser) return;
        const canvas = el("canvas");
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        bmp.close?.();
        const x0 = Math.max(0, Math.floor(this.layout.left * scale));
        const w = Math.max(1, Math.min(bmp.width - x0, Math.ceil((this.layout.right - this.layout.left) * scale)));
        const data = ctx.getImageData(x0, 0, w, Math.max(1, Math.round(68 * scale))).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        this.luma = sum / (data.length / 4);
        const light = this.luma > 150;
        const root = document.getElementById("vitre-root");
        const changed = root.classList.contains("theme-light") !== light;
        root.classList.toggle("theme-light", light);
        root.classList.toggle("theme-dark", !light);
        if (changed) for (const [tab, item] of this.items) this.updateTab(item, tab, tab.selected, parseFloat(item.style.width) || CIRCLE);
      } catch (e) {
        this.sampleError = String(e);
      } finally {
        this.sampling = false;
      }
    }

    destroy() {
      clearInterval(this.sampleTimer);
      try {
        gBrowser.removeTabsProgressListener(this.progressListener);
      } catch (e) {}
    }

    handleEvent(event) {
      const tab = event.target;
      this.events.push(event.type + (event.type === "TabAttrModified" ? ":" + event.detail.changed.join("+") : ""));
      if (this.events.length > 400) this.events.splice(0, 200);
      switch (event.type) {
        case "TabClose":
          // Fired while the tab is still in gBrowser.tabs; tab.closing is already true.
          this.render();
          break;
        case "TabAttrModified": {
          const item = this.items.get(tab);
          if (item) this.updateTab(item, tab, tab.selected, parseFloat(item.style.width) || CIRCLE);
          break;
        }
        default:
          this.render();
      }
      if (event.type === "TabSelect") this.sampleTheme();
    }

    updateFor(browser, why) {
      const tab = gBrowser.getTabForBrowser(browser);
      const item = tab && this.items.get(tab);
      if (item) this.updateTab(item, tab, tab.selected, parseFloat(item.style.width) || CIRCLE);
    }

    tabs() {
      return gBrowser.tabs.filter((t) => !t.closing && !t.hidden);
    }

    scheme() {
      return document.getElementById("vitre-root")?.classList.contains("theme-light") ? "light" : "dark";
    }

    render(instant = false) {
      const tabs = this.tabs();
      const active = gBrowser.selectedTab;
      const W = window.innerWidth;
      // Centre in the window; when that would run under the window controls, centre in the free span.
      const freeLeft = 16;
      const freeRight = W - (12 + WINCTL + 16);
      const symmetric = W - 2 * (12 + WINCTL + 16);
      const nCircles = this.popup ? 0 : tabs.length; // other tabs + the plus circle
      let circle = CIRCLE;
      let gap = GAP;
      let pillW = Math.max(PILL_MIN, Math.min(PILL, symmetric - nCircles * (circle + gap)));
      const totalOf = () => (tabs.length - 1) * (circle + gap) + pillW + (this.popup ? 0 : gap + circle);
      let compact = false;
      if (totalOf() > freeRight - freeLeft) {
        // Not in the design yet: many tabs in a narrow window. Shrink the circles (44 -> 28) and gaps.
        compact = true;
        const slot = Math.floor((freeRight - freeLeft - pillW - gap) / Math.max(1, nCircles));
        gap = Math.max(4, Math.min(GAP, slot - 28));
        circle = Math.max(28, Math.min(CIRCLE, slot - gap));
      }
      const total = totalOf();
      let x = Math.round((W - total) / 2);
      if (x + total > freeRight) x = Math.max(freeLeft, Math.round(freeLeft + (freeRight - freeLeft - total) / 2));
      this.layout = { pillRect: null, left: x, right: x + total, compact, circle, gap, pillW };
      this.root.classList.toggle("static", instant);

      const seen = new Set();
      for (const tab of tabs) {
        seen.add(tab);
        const isActive = tab === active;
        const w = isActive ? pillW : circle;
        let item = this.items.get(tab);
        if (!item) {
          item = this.createTab(tab);
          item.style.left = `${x + (w - circle) / 2}px`;
          item.style.width = `${circle}px`;
          if (!instant) {
            item.classList.add("entering");
            requestAnimationFrame(() => item.classList.remove("entering"));
          }
          this.root.append(item);
        }
        this.updateTab(item, tab, isActive, w);
        item.style.left = `${x}px`;
        item.style.width = `${w}px`;
        item.style.height = `${isActive ? CIRCLE : circle}px`;
        item.style.top = `${TOP + (isActive ? 0 : (CIRCLE - circle) / 2)}px`;
        if (isActive) this.layout.pillRect = new DOMRect(x, TOP, w, CIRCLE);
        x += w + gap;
      }

      if (!this.popup) {
        if (!this.plus) {
          this.plus = el("div", { class: "item glass circle plus" }, `${GLASS}<button type="button" class="face" aria-label="New tab" title="New tab  Ctrl+T">${icons.plus}</button>`);
          this.plus.querySelector("button").addEventListener("click", () => this.newTab());
          this.root.append(this.plus);
        }
        this.plus.style.left = `${x}px`;
        this.plus.style.width = `${circle}px`;
        this.plus.style.height = `${circle}px`;
        this.plus.style.top = `${TOP + (CIRCLE - circle) / 2}px`;
      }

      for (const [tab, item] of this.items) {
        if (!seen.has(tab)) {
          this.items.delete(tab);
          if (instant) item.remove();
          else {
            item.classList.add("leaving");
            setTimeout(() => item.remove(), 400);
          }
        }
      }
      if (instant) requestAnimationFrame(() => this.root.classList.remove("static"));
    }

    createTab(tab) {
      const item = el(
        "div",
        { class: "item glass tab" },
        `${GLASS}
        <div class="pill-face">
          <button type="button" class="nav back" aria-label="Back" title="Back  Alt+Left">${icons.back}</button>
          <button type="button" class="nav forward" aria-label="Forward" title="Forward  Alt+Right">${icons.forward}</button>
          <button type="button" class="address" aria-label="Edit address"><span class="fav"/><span class="host"/></button>
          <input type="text" class="address-input" spellcheck="false" autocomplete="off" aria-label="Search or enter address"/>
          <button type="button" class="nav reload" aria-label="Reload" title="Reload  Ctrl+R">${icons.reload}</button>
        </div>
        <button type="button" class="circle-face" aria-label=""><span class="fav"/></button>
        <button type="button" class="close-badge" aria-label="Close tab" title="Close tab">${icons.closeSmall}</button>
        <div class="load-line"/>`
      );
      item.vitreTab = tab;
      item.querySelector(".back").addEventListener("click", () => gBrowser.goBack());
      item.querySelector(".forward").addEventListener("click", () => gBrowser.goForward());
      item.querySelector(".reload").addEventListener("click", () => (tab.hasAttribute("busy") ? BrowserCommands.stop() : BrowserCommands.reload()));
      item.querySelector(".address").addEventListener("click", () => this.editAddress(item, tab));
      item.querySelector(".circle-face").addEventListener("click", () => this.activate(tab));
      item.querySelector(".close-badge").addEventListener("click", (e) => {
        e.stopPropagation();
        this.close(tab);
      });
      item.addEventListener("auxclick", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          this.close(tab);
        }
      });
      const input = item.querySelector(".address-input");
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const value = input.value.trim();
          this.endEdit(item);
          if (value) this.navigate(tab, value);
        } else if (e.key === "Escape") {
          this.endEdit(item);
        }
        e.stopPropagation();
      });
      input.addEventListener("blur", () => this.endEdit(item, false));
      this.items.set(tab, item);
      return item;
    }

    updateTab(item, tab, active, w) {
      const browser = tab.linkedBrowser;
      const uri = tabURI(tab);
      const busy = tab.hasAttribute("busy");
      const blank = isBlank(uri) && !busy;
      item.classList.toggle("active", active);
      item.classList.toggle("loading", busy);
      item.classList.toggle("home", blank);
      item.classList.toggle("pending", tab.hasAttribute("pending"));
      item.classList.toggle("crashed", tab.hasAttribute("crashed"));
      item.style.setProperty("--progress", String(this.progress.get(browser) ?? 0.1));

      const label = tab.label || displayHost(uri) || "New tab";
      const face = item.querySelector(".circle-face");
      face.setAttribute("aria-label", label);
      face.title = label;
      item.querySelector(".close-badge").setAttribute("aria-label", `Close ${label}`);

      // tab.image is always a local URL in 157 (data:, chrome:, moz-remote-image:): the content
      // process hands the favicon over as data, so the chrome document never fetches it itself.
      let image = blank ? "" : tab.getAttribute("image") || "";
      // SVG favicons are rasterised remotely for the CHROME's colour scheme (moz-remote-image:
      // ...&colorScheme=dark). The glass follows the page instead, so ask for the scheme of the glass.
      if (image.startsWith("moz-remote-image:")) image = image.replace(/colorScheme=(dark|light)/, "colorScheme=" + this.scheme());
      const key = blank ? "blank" : image || "globe";
      for (const f of item.querySelectorAll(".fav")) {
        const inPill = !!f.closest(".address");
        const want = blank && inPill ? "search" : key;
        if (f.dataset.src === want) continue;
        f.dataset.src = want;
        f.replaceChildren();
        if (blank) f.append(frag(inPill ? icons.search : icons.home));
        else if (image) {
          const img = el("img", { alt: "", draggable: "false" });
          img.addEventListener("error", () => f.replaceChildren(frag(icons.globe)), { once: true });
          img.src = image;
          f.append(img);
        } else f.append(frag(icons.globe));
      }

      const host = item.querySelector(".host");
      const addr = item.querySelector(".address");
      host.textContent = blank ? "Search or enter address" : displayHost(uri);
      addr.classList.toggle("placeholder", blank);
      addr.setAttribute("aria-label", blank ? "Search or enter address" : `${displayHost(uri)}, edit address`);

      if (active) {
        const back = item.querySelector(".back");
        const fwd = item.querySelector(".forward");
        back.setAttribute("aria-disabled", String(!browser.canGoBack));
        fwd.setAttribute("aria-disabled", String(!browser.canGoForward));
        const reload = item.querySelector(".reload");
        if (reload.dataset.busy !== String(busy)) {
          reload.dataset.busy = String(busy);
          reload.replaceChildren(frag(busy ? icons.stop : icons.reload));
          reload.setAttribute("aria-label", busy ? "Stop" : "Reload");
        }
        back.style.visibility = fwd.style.visibility = reload.style.visibility = blank ? "hidden" : "visible";
      }
    }

    // ---- actions ----
    activate(tab) {
      gBrowser.selectedTab = tab;
    }
    close(tab) {
      gBrowser.removeTab(tab, { animate: false });
    }
    newTab() {
      BrowserCommands.openTab();
    }
    navigate(tab, text) {
      tab.linkedBrowser.fixupAndLoadURIString(text, {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
        loadFlags: Ci.nsIWebNavigation.LOAD_FLAGS_ALLOW_THIRD_PARTY_FIXUP | Ci.nsIWebNavigation.LOAD_FLAGS_FIXUP_SCHEME_TYPOS,
      });
      tab.linkedBrowser.focus();
    }
    editAddress(item = this.items.get(gBrowser.selectedTab), tab = gBrowser.selectedTab) {
      if (this.popup || !item) return;
      const input = item.querySelector(".address-input");
      const uri = tab.linkedBrowser.currentURI;
      input.value = isBlank(uri) ? "" : uri.spec;
      item.classList.add("editing");
      input.focus();
      input.select();
    }
    endEdit(item, refocus = true) {
      if (!item.classList.contains("editing")) return;
      item.classList.remove("editing");
      if (refocus) gBrowser.selectedBrowser.focus();
    }
  }

  class WindowControls {
    constructor(root) {
      this.el = el(
        "div",
        { id: "vitre-winctl", class: "glass", role: "group", "aria-label": "Window" },
        `${GLASS}<div class="winctl-buttons">
          <button id="vitre-win-min" type="button" aria-label="Minimize">${icons.minimize}</button>
          <button id="vitre-win-max" type="button" aria-label="Maximize"><span/></button>
          <button id="vitre-win-close" type="button" aria-label="Close window">${icons.closeWin}</button>
        </div>`
      );
      root.append(this.el);
      this.max = this.el.querySelector("#vitre-win-max");
      this.el.querySelector("#vitre-win-min").addEventListener("click", () => window.minimize());
      this.max.addEventListener("click", () => this.toggleMaximize());
      this.el.querySelector("#vitre-win-close").addEventListener("click", () => BrowserCommands.tryToCloseWindow());
      // These rectangles are HTMINBUTTON / HTMAXBUTTON / HTCLOSE to Windows (see shell.css), so a real
      // click arrives as non-client messages. Gecko turns them into DOM mouse events, and when the
      // mouseup is not consumed it ALSO lets Windows run the button's own action. Without this
      // preventDefault the maximize button toggles twice (measured in boot-ncprobe.js).
      for (const b of this.el.querySelectorAll("button")) b.addEventListener("mouseup", (e) => e.preventDefault());
      window.addEventListener("sizemodechange", () => this.sync());
      this.sync();
    }
    get maximized() {
      return window.windowState === window.STATE_MAXIMIZED;
    }
    toggleMaximize() {
      if (window.fullScreen) BrowserCommands.fullScreen();
      else if (this.maximized) window.restore();
      else window.maximize();
    }
    sync() {
      const big = this.maximized || window.fullScreen;
      if (this.max.dataset.big === String(big)) return;
      this.max.dataset.big = String(big);
      this.max.replaceChildren(frag(big ? icons.restore : icons.maximize));
      this.max.setAttribute("aria-label", big ? "Restore" : "Maximize");
    }
  }

  window.VitreUI = {
    HTML,
    frag,
    el,
    icons,
    /** Build the Vitre layer in this window. Idempotent. */
    mount(log = () => {}) {
      if (this.root) return this;
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const root = el("div", { id: "vitre-root", class: dark ? "theme-dark" : "theme-light" });
      const drag = el("div", { id: "vitre-drag" });
      const reveal = el("div", { id: "vitre-reveal" });
      const barEl = el("nav", { id: "vitre-bar", "aria-label": "Tabs" });
      root.append(drag, reveal, barEl);
      // Last child of <body>: after #browser and every native overlay that is not in the top layer.
      document.body.append(root);
      this.root = root;
      this.bar = new Bar(barEl, log);
      this.controls = new WindowControls(root);
      // Double-click on the drag strip maximizes, like a caption (the OS also does this for HTCAPTION).
      return this;
    },
    /** The element Firefox panels should hang from, by purpose: "site" (the active pill) or "menu" (the + circle). */
    anchor(kind) {
      const item = this.bar?.items.get(gBrowser.selectedTab);
      if (kind === "menu") return this.bar?.plus || item || this.root;
      return item || this.root;
    },
  };
})();
