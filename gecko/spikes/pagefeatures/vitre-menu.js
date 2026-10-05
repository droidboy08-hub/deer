// Vitre right-click menus on Gecko (spike). One HTML glass menu replaces #contentAreaContextMenu.
//
// How it hooks in:
//   ContextMenuChild (content) -> ContextMenuParent sets nsContextMenu.contentData and calls
//   popup.openPopupAtScreen() -> "popupshowing" on #contentAreaContextMenu -> Firefox's own listener
//   (browser-context.js) builds gContextMenu = new nsContextMenu(popup). Our listener is added later
//   on the same node, so it runs after it: it reads everything from gContextMenu, cancels the native
//   popup with preventDefault(), and shows the HTML menu at the same point.
//   When the HTML menu closes we dispatch popuphiding + popuphidden on the XUL popup so Firefox's
//   own cleanup runs (gContextMenu.hiding() -> ContextMenu:Hiding to content, spellchecker uninit,
//   extension menu cleanup + menus.onHidden).
/* global Services, gBrowser, gContextMenu, goDoCommand, openLinkIn, internalSave, BrowserCommands, PrintUtils, saveBrowser */
window.VitreMenu = (() => {
  const H = "http://www.w3.org/1999/xhtml";
  const el = (tag, cls, text) => {
    const n = document.createElementNS(H, tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const CSS = `
  .vm-layer { position: fixed; inset: 0; z-index: 2147483000; -moz-window-dragging: no-drag; }
  .vm-layer[hidden] { display: none; }
  .vm-shell { position: absolute; box-sizing: border-box; padding: 6px; border-radius: 12px; min-width: 264px; max-width: 360px;
    color: #fff; font: 14px/20px "Segoe UI Variable Text", "Segoe UI", sans-serif;
    background: rgba(32,32,38,0.80); backdrop-filter: blur(24px) saturate(1.6);
    box-shadow: 0 18px 44px rgba(0,0,0,0.32), 0 1px 3px rgba(0,0,0,0.30), inset 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.30);
    opacity: 0; transform: scale(0.96); transform-origin: var(--vm-origin, top left);
    transition: opacity 90ms cubic-bezier(0.2,0,0,1), transform 200ms cubic-bezier(0.2,0.9,0.3,1.2); user-select: none; }
  .vm-shell.open { opacity: 1; transform: none; }
  .vm-row { position: relative; display: flex; align-items: center; height: 34px; border-radius: 6px; padding: 0 16px 0 38px; white-space: nowrap; }
  .vm-row.cur { background: rgba(255,255,255,0.12); box-shadow: inset 0 0.5px 0 rgba(255,255,255,0.22); }
  .vm-row[aria-disabled="true"] { color: rgba(255,255,255,0.36); }
  .vm-row[aria-disabled="true"].cur { background: rgba(255,255,255,0.05); box-shadow: none; }
  .vm-row.strong .vm-label { font-weight: 600; }
  .vm-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .vm-accel { margin-left: 32px; font-size: 12px; color: rgba(255,255,255,0.70); }
  .vm-check { position: absolute; left: 10px; top: 9px; width: 16px; height: 16px; }
  .vm-icon { position: absolute; left: 10px; top: 9px; width: 16px; height: 16px; object-fit: contain; }
  .vm-sep { height: 1px; margin: 4px 12px; background: rgba(255,255,255,0.10); }
  .vm-caption { height: 28px; line-height: 28px; padding: 0 10px; font-size: 12px; color: rgba(255,255,255,0.70); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vm-wash { position: absolute; border-radius: 4px; background: rgba(76,194,255,0.14); pointer-events: none; }
  `;

  let layer = null;
  let shell = null;
  let open = null; // { items, index, native, restoreFocus }
  const log = (...a) => window.spike && window.spike.log("[menu]", ...a);

  function ensure() {
    if (layer) return;
    const style = el("style");
    style.textContent = CSS;
    document.documentElement.appendChild(style);
    layer = el("div", "vm-layer");
    layer.hidden = true;
    shell = el("div", "vm-shell");
    shell.setAttribute("role", "menu");
    layer.appendChild(shell);
    (document.body || document.documentElement).appendChild(layer);

    // The layer covers the window, so the click that dismisses the menu never reaches the page.
    layer.addEventListener("mousedown", (e) => {
      if (e.target.closest(".vm-shell")) {
        e.preventDefault(); // never take focus from the page / field
        return;
      }
      e.preventDefault();
      close("outside");
      // A right-click outside: with the layer gone, the mouseup + contextmenu that follow land on
      // whatever is underneath, so the next menu opens there with no replay needed.
    });
    layer.addEventListener("contextmenu", (e) => e.preventDefault());
    shell.addEventListener("mousemove", (e) => {
      const row = e.target.closest(".vm-row");
      if (row) setCurrent(open.rows.indexOf(row));
    });
    shell.addEventListener("mouseleave", () => setCurrent(-1));
    shell.addEventListener("mouseup", (e) => {
      const row = e.target.closest(".vm-row");
      if (row) activate(open.rows.indexOf(row), e);
    });
    // Keys are caught in the chrome document before they are forwarded to the content process.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keypress", swallow, true);
    window.addEventListener("keyup", swallow, true);
    window.addEventListener("blur", (e) => e.target === window && api.closeOnBlur && close("blur"));
    window.addEventListener("resize", () => close("resize"));
    gBrowser.tabContainer.addEventListener("TabSelect", () => close("tabselect"));
  }

  function swallow(e) {
    if (!open) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onKey(e) {
    if (!open) return;
    e.preventDefault();
    e.stopPropagation();
    const n = open.rows.length;
    const step = (d) => {
      if (!n) return;
      let i = open.index;
      i = i < 0 ? (d > 0 ? 0 : n - 1) : (i + d + n) % n;
      setCurrent(i);
    };
    switch (e.key) {
      case "ArrowDown": return step(1);
      case "ArrowUp": return step(-1);
      case "Tab": return step(e.shiftKey ? -1 : 1);
      case "Home": return setCurrent(0);
      case "End": return setCurrent(n - 1);
      case "Enter":
      case " ": return open.index >= 0 ? activate(open.index, e) : undefined;
      case "Escape":
      case "Alt":
      case "F10": return close("key");
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      const i = open.items.filter((it) => it !== "-" && !it.caption).findIndex((it) => it.key && it.key.toLowerCase() === k);
      if (i >= 0) activate(i, e);
    }
  }

  function setCurrent(i) {
    if (!open) return;
    open.index = i;
    open.rows.forEach((r, j) => r.classList.toggle("cur", j === i));
  }

  function activate(i, event) {
    const item = open.rowItems[i];
    if (!item || item.enabled === false) return;
    const run = item.run;
    log("activate", item.label);
    // Run first (the native model, e.g. gContextMenu, is still alive), then close.
    try {
      run(event);
    } catch (e) {
      log("action error", String(e), e.stack || "");
    }
    close("activate");
  }

  function normalize(items) {
    // Separators never lead, trail or double; empty entries dropped.
    const out = [];
    for (const it of items) {
      if (!it) continue;
      if (it === "-") {
        if (out.length && out[out.length - 1] !== "-") out.push("-");
      } else out.push(it);
    }
    while (out.length && out[out.length - 1] === "-") out.pop();
    return out;
  }

  /** Show a menu. x/y are chrome-window CSS px. opts: { native: XUL popup to clean up, byKeyboard, hangBelow } */
  function show(items, x, y, opts = {}) {
    ensure();
    if (open) close("replaced");
    items = normalize(items);
    if (!items.length) return null;
    shell.replaceChildren();
    const rows = [];
    const rowItems = [];
    for (const it of items) {
      if (it === "-") {
        shell.appendChild(el("div", "vm-sep")).setAttribute("role", "separator");
        continue;
      }
      if (it.caption) {
        shell.appendChild(el("div", "vm-caption", it.caption));
        continue;
      }
      const row = el("div", "vm-row" + (it.strong ? " strong" : ""));
      row.setAttribute("role", it.checked !== undefined ? "menuitemcheckbox" : "menuitem");
      if (it.enabled === false) row.setAttribute("aria-disabled", "true");
      if (it.checked !== undefined) row.setAttribute("aria-checked", String(!!it.checked));
      if (it.checked) {
        const c = el("div", "vm-check", "✓");
        row.appendChild(c);
      } else if (it.icon) {
        const img = el("img", "vm-icon");
        img.src = it.icon;
        row.appendChild(img);
      }
      row.appendChild(el("span", "vm-label", it.label));
      if (it.accel) {
        row.appendChild(el("span", "vm-accel", it.accel));
        row.setAttribute("aria-keyshortcuts", it.accel);
      }
      shell.appendChild(row);
      rows.push(row);
      rowItems.push(it);
    }
    layer.hidden = false;
    shell.classList.remove("open");
    // Measure, then place: top-left at the hotspot; flip left / up when crossing the 8 px margin.
    const w = shell.offsetWidth;
    const hgt = shell.offsetHeight;
    const W = window.innerWidth;
    const Hh = window.innerHeight;
    let left = x;
    let top = y;
    let ox = "left";
    let oy = "top";
    if (left + w > W - 8) {
      left = Math.max(8, x - w);
      ox = "right";
    }
    if (top + hgt > Hh - 8) {
      top = Math.max(8, y - hgt);
      oy = "bottom";
    }
    shell.style.left = Math.round(left) + "px";
    shell.style.top = Math.round(top) + "px";
    shell.style.setProperty("--vm-origin", oy + " " + ox);
    open = { items, rows, rowItems, index: -1, native: opts.native || null, onClose: opts.onClose || null, placed: { left, top, w, h: hgt, ox, oy } };
    void shell.offsetWidth;
    shell.classList.add("open");
    if (opts.byKeyboard) setCurrent(0);
    return open.placed;
  }

  function close(reason) {
    if (!open) return;
    const { native, onClose } = open;
    open = null;
    layer.hidden = true;
    shell.classList.remove("open");
    for (const w of layer.querySelectorAll(".vm-wash")) w.remove();
    if (native) {
      // Let Firefox run its own teardown for the popup that never showed.
      native.dispatchEvent(new Event("popuphiding", { bubbles: true }));
      native.dispatchEvent(new Event("popuphidden", { bubbles: true }));
    }
    if (onClose) onClose(reason);
    log("closed", reason);
  }

  // ---------------------------------------------------------------------------------------------
  // Page menus, built from gContextMenu (the nsContextMenu instance Firefox made for this click).

  const cmdEnabled = (id) => {
    try {
      const ctl = document.commandDispatcher.getControllerForCommand(id);
      return !!ctl && ctl.isCommandEnabled(id);
    } catch (e) {
      return false;
    }
  };
  const quote = (s) => {
    const line = s.split(/\r?\n/)[0].trim();
    return "“" + (line.length > 24 ? line.slice(0, 24) + "…" : line) + "”";
  };

  /** Everything the Electron menus used from 'context-menu' params, from Gecko's context. */
  function describe(cm) {
    const c = cm.contentData.context;
    const dpr = window.devicePixelRatio;
    return {
      x: c.screenXDevPx / dpr - window.mozInnerScreenX,
      y: c.screenYDevPx / dpr - window.mozInnerScreenY,
      screenX: c.screenXDevPx / dpr,
      screenY: c.screenYDevPx / dpr,
      contentX: c.clientX,
      contentY: c.clientY,
      inputSource: c.inputSource, // MouseEvent.MOZ_SOURCE_MOUSE / KEYBOARD / TOUCH / PEN
      pageURL: cm.browser.currentURI.spec,
      frameURL: cm.contentData.docLocation,
      inFrame: !!cm.inFrame,
      frameID: cm.frameID,
      frameBrowsingContextID: c.frameBrowsingContextID,
      linkURL: cm.onLink ? cm.linkURL : "",
      linkText: cm.onLink ? cm.linkTextStr : "",
      linkProtocol: cm.linkProtocol || "",
      linkDownload: cm.linkDownload || "",
      onSaveableLink: !!cm.onSaveableLink,
      onImage: !!cm.onImage,
      onCanvas: !!cm.onCanvas,
      onVideo: !!cm.onVideo,
      onAudio: !!cm.onAudio,
      onDRMMedia: !!cm.onDRMMedia,
      mediaURL: cm.mediaURL || "",
      imageInfo: cm.imageInfo || null, // { currentSrc, width, height, imageText }
      contentType: cm.contentData.contentType,
      contentDisposition: cm.contentData.contentDisposition,
      media: cm.onVideo || cm.onAudio ? { paused: cm.target.paused, muted: cm.target.muted, loop: cm.target.loop, controls: cm.target.controls, ended: cm.target.ended } : null,
      selectionText: cm.isTextSelected ? cm.selectionInfo.fullText : "",
      selectionLinkURL: cm.selectionInfo?.linkURL || "",
      isEditable: !!(cm.onTextInput || cm.onEditable),
      onPassword: !!cm.onPassword,
      isDesignMode: !!cm.isDesignMode,
      spellcheckable: !!cm.onSpellcheckable,
      misspelling: window.InlineSpellCheckerUI.overMisspelling ? cm.contentData.spellInfo?.misspelling || "" : "",
      suggestions: window.InlineSpellCheckerUI.overMisspelling ? (cm.spellSuggestions || []).slice() : [],
      edit: {
        undo: cmdEnabled("cmd_undo"),
        redo: cmdEnabled("cmd_redo"),
        cut: cmdEnabled("cmd_cut"),
        copy: cmdEnabled("cmd_copy"),
        paste: cmdEnabled("cmd_paste"),
        selectAll: cmdEnabled("cmd_selectAll"),
      },
      canGoBack: cm.browser.canGoBack,
      canGoForward: cm.browser.canGoForward,
      charset: cm.contentData.charSet,
      userContextId: cm.contentData.userContextId,
      targetIdentifier: cm.targetIdentifier, // ContentDOMReference for inspect / media commands
    };
  }

  /** Extension items that ext-menus.js inserted into the hidden XUL popup for this click. */
  function extensionItems(popup) {
    const out = [];
    const walk = (node, depth) => {
      for (const n of node.children) {
        if (!n.id || !n.id.includes("-menuitem-") || n.hidden) continue;
        if (n.localName === "menuitem") {
          out.push({
            label: (depth ? " ".repeat(depth) : "") + n.getAttribute("label"),
            icon: n.getAttribute("image") || null,
            checked: n.getAttribute("type") ? n.hasAttribute("checked") : undefined,
            enabled: !n.hasAttribute("disabled"),
            ext: n.id,
            // ext-menus.js listens for "command" on the element; doCommand() fires it.
            run: () => n.doCommand(),
          });
        } else if (n.localName === "menu") {
          // A root with children: Vitre has no submenus, so flatten under a caption.
          out.push({ caption: n.getAttribute("label") });
          const mp = n.querySelector("menupopup");
          if (mp) walk(mp, depth);
        }
      }
    };
    walk(popup, 0);
    return out;
  }

  /**
   * Extension items for one of Vitre's own surfaces (for example contexts: ["tab"] on a tab circle).
   * ext-menus.js builds its XUL items into whatever menupopup the "on-build-contextmenu" subject
   * names, so give it a scratch popup that is never shown, then read the items out of it.
   * Pass the returned `native` to show()/showForChrome() so closing cleans the scratch popup up.
   */
  function extensionItemsFor(data) {
    let scratch = document.getElementById("vitre-ext-scratch");
    if (!scratch) {
      scratch = document.createXULElement("menupopup");
      scratch.id = "vitre-ext-scratch";
      document.getElementById("mainPopupSet").appendChild(scratch);
    }
    const subject = { menu: scratch, ...data };
    subject.wrappedJSObject = subject;
    Services.obs.notifyObservers(subject, "on-build-contextmenu");
    return { items: extensionItems(scratch), native: scratch };
  }

  function pageItems(cm, d, popup) {
    const b = cm.browser;
    const peek = window.VitrePeek;
    const inPeek = !!(peek && peek.isPeekBrowser && peek.isPeekBrowser(b));
    const edit = (label, cmd, accel, key, on = d.edit[cmd.replace("cmd_", "")]) => ({ label, accel, key, enabled: on, run: () => goDoCommand(cmd) });
    // nsContextMenu.inspectNode() always targets gBrowser.selectedTab; a peek is not the selected tab,
    // so name the tab that owns the clicked browser.
    const inspect = {
      label: "Inspect",
      key: "n",
      run: () => {
        const { DevToolsShim } = ChromeUtils.importESModule("chrome://devtools-startup/content/DevToolsShim.sys.mjs");
        return DevToolsShim.inspectNode(gBrowser.getTabForBrowser(b) || gBrowser.selectedTab, cm.targetIdentifier);
      },
    };
    const openTab = (url) => openLinkIn(url, "tab", cm._openLinkInParameters({ inBackground: true }));
    const copyText = (s) => Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(s);
    const ext = extensionItems(popup);
    const tail = ext.length ? ["-", ...ext, "-", inspect] : ["-", inspect];

    // 1. misspelled word
    if (d.misspelling) {
      const ui = window.InlineSpellCheckerUI;
      return [
        ...d.suggestions.slice(0, 3).map((s) => ({ label: s, strong: true, run: () => ui.replaceMisspelling(s) })),
        { label: "Add to dictionary", key: "d", run: () => ui.addToDictionary() },
        "-",
        edit("Cut", "cmd_cut", "", "t"),
        edit("Copy", "cmd_copy", "", "c"),
        edit("Paste", "cmd_paste", "", "p"),
        edit("Select all", "cmd_selectAll", "", "a"),
        ...tail,
      ];
    }
    // 2. editable field
    if (d.isEditable) {
      return [
        edit("Undo", "cmd_undo", "Ctrl+Z", "u"),
        edit("Redo", "cmd_redo", "Ctrl+Y", "r"),
        "-",
        edit("Cut", "cmd_cut", "Ctrl+X", "t", d.edit.cut && !d.onPassword),
        edit("Copy", "cmd_copy", "Ctrl+C", "c", d.edit.copy && !d.onPassword),
        edit("Paste", "cmd_paste", "Ctrl+V", "p"),
        d.isDesignMode ? edit("Paste as plain text", "cmd_pasteNoFormatting", "Ctrl+Shift+V", "l", d.edit.paste) : null,
        edit("Select all", "cmd_selectAll", "Ctrl+A", "a"),
        ...tail,
      ];
    }
    // 3. video / audio
    if (d.media) {
      const m = d.media;
      return [
        { label: m.paused ? "Play" : "Pause", key: "p", run: () => cm.mediaCommand(m.paused ? "play" : "pause") },
        { label: m.muted ? "Unmute" : "Mute", key: "m", run: () => cm.mediaCommand(m.muted ? "unmute" : "mute") },
        { label: "Loop", key: "l", checked: !!m.loop, run: () => cm.mediaCommand("loop") },
        { label: "Show controls", key: "c", checked: !!m.controls, run: () => cm.mediaCommand(m.controls ? "hidecontrols" : "showcontrols") },
        d.onVideo ? { label: "Picture in picture", key: "i", checked: !!cm.onPiPVideo, run: () => cm.mediaCommand("pictureinpicture") } : null,
        "-",
        { label: d.onVideo ? "Download video…" : "Download audio", key: "d", accel: d.onDRMMedia ? "Protected" : "", enabled: !d.onDRMMedia && !!d.mediaURL, run: () => cm.saveMedia() },
        d.mediaURL && !/^blob:/.test(d.mediaURL) ? { label: d.onVideo ? "Copy video address" : "Copy audio address", key: "o", run: () => cm.copyMediaLocation() } : null,
        ...tail,
      ];
    }
    const linkGroup = () => {
      if (d.linkProtocol === "mailto") return [{ label: "Copy email address", key: "e", run: () => cm.copyEmail() }];
      if (d.linkProtocol === "tel") return [{ label: "Copy phone number", key: "e", run: () => cm.copyPhone() }];
      return [
        { label: "Open link in new tab", key: "t", run: () => openTab(d.linkURL) },
        inPeek || !peek ? null : { label: "Peek link", accel: "Shift+click", key: "p", run: () => peek.open(d.linkURL, { opener: b, params: cm._openLinkInParameters({}) }) },
        { label: "Open link in new window", key: "w", run: () => cm.openLink() },
        "-",
        d.selectionText ? edit("Copy", "cmd_copy", "Ctrl+C", "c", true) : null,
        { label: "Copy link address", key: "e", run: () => cm.copyLink() },
        d.onSaveableLink ? { label: "Download linked file", key: "d", run: () => VitreMenu.onDownload ? VitreMenu.onDownload(d.linkURL, cm) : cm.saveLink() } : null,
      ];
    };
    const imageGroup = (withPeek) => [
      { label: "Open image in new tab", key: "i", run: () => cm.viewMedia({ button: 1 }) },
      withPeek && !inPeek && peek ? { label: "Peek image", key: "p", run: () => peek.open(d.mediaURL, { opener: b }) } : null,
      withPeek ? "-" : null,
      { label: "Save image as…", key: "v", run: () => (VitreMenu.onSaveImage ? VitreMenu.onSaveImage(d, cm) : cm.saveMedia()) },
      { label: "Copy image", key: "y", run: () => goDoCommand("cmd_copyImage") },
      withPeek ? { label: "Copy image address", key: "o", run: () => cm.copyMediaLocation() } : null,
    ];
    // 4. image that is a link, 5. link, 6. image / canvas
    const jsLink = d.linkProtocol === "javascript";
    if (d.linkURL && !jsLink && (d.onImage || d.onCanvas)) return [...linkGroup(), "-", ...imageGroup(false), ...tail];
    if (d.linkURL && !jsLink) return [...linkGroup(), ...tail];
    if (d.onImage || d.onCanvas) return [...imageGroup(d.onImage), ...tail];
    // 7. selected text
    if (d.selectionText) {
      const q = quote(d.selectionText);
      return [
        edit("Copy", "cmd_copy", "Ctrl+C", "c", true),
        "-",
        d.selectionLinkURL
          ? { label: "Go to " + new URL(d.selectionLinkURL).host, key: "g", run: () => openTab(d.selectionLinkURL) }
          : { label: "Search for " + q, key: "s", run: () => cm.loadSearch ? document.getElementById("context-searchselect").doCommand() : null },
        { label: "Find " + q + " on page", accel: "Ctrl+F", key: "i", run: () => window.VitreFind && window.VitreFind.open(b, { query: d.selectionText.split(/\r?\n/)[0].slice(0, 120) }) },
        ...tail,
      ];
    }
    // 8. page
    const src = () => BrowserCommands.viewSource(b);
    return [
      { label: "Back", accel: "Alt+Left", key: "b", enabled: d.canGoBack, run: () => b.goBack() },
      { label: "Forward", accel: "Alt+Right", key: "f", enabled: d.canGoForward, run: () => b.goForward() },
      { label: "Reload", accel: "Ctrl+R", key: "r", run: () => b.reload() },
      "-",
      { label: "Find on page…", accel: "Ctrl+F", key: "i", run: () => window.VitreFind && window.VitreFind.open(b) },
      { label: "Print…", accel: "Ctrl+P", key: "p", run: () => PrintUtils.startPrintWindow(b.browsingContext) },
      { label: "Save page as…", accel: "Ctrl+S", key: "a", run: () => saveBrowser(b) },
      "-",
      { label: "View page source", accel: "Ctrl+U", key: "v", run: src },
      ...tail.slice(1),
    ];
  }

  let lastContext = null;

  function install() {
    ensure();
    const popup = document.getElementById("contentAreaContextMenu");
    popup.addEventListener("popupshowing", (e) => {
      if (e.target !== popup) return; // submenus bubble through here too
      const cm = gContextMenu;
      if (!cm || !cm.shouldDisplay || !cm.contentData) return; // Firefox already cancelled / chrome-only target
      e.preventDefault(); // the native popup never opens
      const d = describe(cm);
      lastContext = d;
      const items = pageItems(cm, d, popup);
      const byKeyboard = d.inputSource === MouseEvent.MOZ_SOURCE_KEYBOARD;
      const placed = show(items, d.x, d.y, { native: popup, byKeyboard });
      log("page menu", JSON.stringify({ at: [Math.round(d.x), Math.round(d.y)], placed, labels: items.filter((i) => i && i !== "-").map((i) => i.label || "[" + i.caption + "]") }));
    });
  }

  /** Menus for Vitre's own chrome: call from a "contextmenu" listener on a chrome element. */
  function showForChrome(event, items, opts = {}) {
    event.preventDefault();
    event.stopPropagation();
    return show(items, opts.x ?? event.clientX, opts.y ?? event.clientY, { byKeyboard: event.button !== 2 && !event.buttons, ...opts });
  }

  const api = {
    /** Context loss closes a menu. The spike turns this off: parallel spike windows steal OS focus. */
    closeOnBlur: true,
    install,
    show,
    showForChrome,
    extensionItemsFor,
    close,
    describe,
    get isOpen() { return !!open; },
    get lastContext() { return lastContext; },
    get current() { return open; },
    onSaveImage: null,
    onDownload: null,
  };
  return api;
})();
