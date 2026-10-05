// Shared helpers for the "keys" spike boot scripts.
// Load with: Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
/* global window, document, gBrowser, Services, Cc, Ci, ChromeUtils, spike */
window.KS = (() => {
  // --- key synthesis -------------------------------------------------------------------------
  // Firefox ships the mochitest EventUtils inside the remote agent (omni.ja). It drives
  // nsITextInputProcessor, so the events take the real widget -> PresShell -> EventStateManager
  // path (including forwarding to the remote page and the reply back), with no OS focus needed.
  const EU = { window, parent: window, _EU_Ci: Ci, _EU_Cc: Cc };
  Services.scriptloader.loadSubScript("chrome://remote/content/external/EventUtils.js", EU);

  const NAMED = {
    Tab: "KEY_Tab", Enter: "KEY_Enter", Escape: "KEY_Escape", Esc: "KEY_Escape", Delete: "KEY_Delete",
    Backspace: "KEY_Backspace", Insert: "KEY_Insert", Home: "KEY_Home", End: "KEY_End",
    PageUp: "KEY_PageUp", PageDown: "KEY_PageDown", Left: "KEY_ArrowLeft", Right: "KEY_ArrowRight",
    Up: "KEY_ArrowUp", Down: "KEY_ArrowDown", Space: " ", Comma: ",", Plus: "+", Minus: "-", Equal: "=",
    Control: "KEY_Control", Shift: "KEY_Shift", Alt: "KEY_Alt", AltGraph: "KEY_AltGraph",
    ContextMenu: "KEY_ContextMenu", BrowserBack: "KEY_BrowserBack", BrowserForward: "KEY_BrowserForward",
    BrowserRefresh: "KEY_BrowserRefresh", BrowserStop: "KEY_BrowserStop", BrowserSearch: "KEY_BrowserSearch",
    BrowserHome: "KEY_BrowserHome",
  };
  for (let i = 1; i <= 12; i++) NAMED["F" + i] = "KEY_F" + i;

  /** "Ctrl+Shift+T" -> { key: "T", opts: { ctrlKey: true, shiftKey: true } } */
  function parse(spec) {
    const parts = spec.split("+");
    let key = parts.pop();
    if (key === "" && parts.length) { key = "+"; parts.pop(); } // "Ctrl++"
    const opts = {};
    for (const m of parts) {
      if (m === "Ctrl") opts.ctrlKey = true;
      else if (m === "Shift") opts.shiftKey = true;
      else if (m === "Alt") opts.altKey = true;
      else if (m === "AltGr") opts.altGraphKey = true;
      else if (m === "Meta") opts.metaKey = true;
      else throw new Error("bad modifier " + m);
    }
    if (NAMED[key]) key = NAMED[key];
    else if (/^[A-Za-z]$/.test(key)) key = opts.shiftKey ? key.toUpperCase() : key.toLowerCase();
    return { key, opts };
  }

  /** Full keydown(+keypress)+keyup of one chord, modifiers activated only for its duration. */
  function press(spec, extra = {}) {
    const { key, opts } = parse(spec);
    EU.synthesizeKey(key, Object.assign(opts, extra), window);
  }
  /** Only the keydown (modifier keys stay down in the TIP until up()). */
  function down(spec, extra = {}) {
    const { key, opts } = parse(spec);
    EU.synthesizeKey(key, Object.assign(opts, extra, { type: "keydown" }), window);
  }
  function up(spec, extra = {}) {
    const { key, opts } = parse(spec);
    EU.synthesizeKey(key, Object.assign(opts, extra, { type: "keyup" }), window);
  }

  // --- test pages ----------------------------------------------------------------------------
  const bootFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  bootFile.initWithPath(Services.env.get("VITRE_BOOT"));
  function pageURL(leaf, query = "") {
    const f = bootFile.parent.clone();
    f.append("pages");
    f.append(leaf);
    return Services.io.newFileURI(f).spec + (query ? "?" + query : "");
  }
  const sysPrincipal = Services.scriptSecurityManager.getSystemPrincipal();
  async function load(url, browser = gBrowser.selectedBrowser) {
    const done = new Promise((resolve) => {
      const listener = {
        onStateChange(b, wp, req, flags) {
          if (b === browser && wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_STOP && flags & Ci.nsIWebProgressListener.STATE_IS_WINDOW) {
            gBrowser.removeTabsProgressListener(listener);
            resolve();
          }
        },
      };
      gBrowser.addTabsProgressListener(listener);
    });
    browser.fixupAndLoadURIString(url, { triggeringPrincipal: sysPrincipal });
    await Promise.race([done, spike.sleep(15000)]);
    await spike.sleep(150);
  }
  /** What the test page saw (it mirrors its event log into document.title). */
  async function pageSeen(browser = gBrowser.selectedBrowser) {
    await spike.sleep(200);
    try { return JSON.parse(browser.contentTitle); } catch (e) { return ["<title not json: " + browser.contentTitle + ">"]; }
  }
  /** Run a function source in the page (content process) and get its JSON result back. */
  function inPage(fn, browser = gBrowser.selectedBrowser) {
    return new Promise((resolve) => {
      const mm = browser.messageManager;
      const id = "KS:r" + Math.random();
      const on = (m) => { mm.removeMessageListener(id, on); resolve(m.data); };
      mm.addMessageListener(id, on);
      const src = "(function(){ let r; try { r = (" + fn.toString() + ")(content, content.document); } catch (e) { r = 'ERR ' + e; } sendAsyncMessage(" + JSON.stringify(id) + ", r); })()";
      mm.loadFrameScript("data:," + encodeURIComponent(src), false);
    });
  }

  function focusInfo() {
    const fm = Services.focus;
    const el = fm.focusedElement;
    return {
      activeWindow: fm.activeWindow === window,
      focusedWindowIsChrome: fm.focusedWindow === window,
      focused: el ? el.localName + (el.id ? "#" + el.id : "") : null,
      docActive: document.activeElement ? document.activeElement.localName + (document.activeElement.id ? "#" + document.activeElement.id : "") : null,
    };
  }

  function describe(e) {
    const t = e.target;
    const f = [];
    if (e.defaultPrevented) f.push("prevented");
    if (e.defaultPreventedByChrome) f.push("byChrome");
    if (e.defaultPreventedByContent) f.push("byContent");
    if (e.isWaitingReplyFromRemoteContent) f.push("waitingReply");
    if (e.isReplyEventFromRemoteContent) f.push("REPLY");
    if (e.isReservedByChrome) f.push("reserved");
    if (e.repeat) f.push("repeat");
    if (e.isComposing) f.push("composing");
    if (e.keyCode === 229) f.push("kc229");
    if (e.getModifierState("AltGraph")) f.push("AltGraph");
    const mods = (e.ctrlKey ? "Ctrl+" : "") + (e.altKey ? "Alt+" : "") + (e.shiftKey ? "Shift+" : "") + (e.metaKey ? "Meta+" : "");
    return e.type + " " + mods + e.key + " code=" + e.code + " kc=" + e.keyCode + " target=" + (t && t.localName) + (t && t.isRemoteBrowser ? "(remote)" : "") + (f.length ? " [" + f.join(",") + "]" : "");
  }

  return { EU, parse, press, down, up, pageURL, load, pageSeen, inPage, focusInfo, describe, sysPrincipal };
})();
