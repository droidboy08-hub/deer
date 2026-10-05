// Helpers shared by the input tests (keys, actions, omnibox, Home). Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
// Gives window.K. Keys are synthesized in-process through EventUtils (nsITextInputProcessor): they
// take the real widget -> chrome -> content -> reply path and need no OS focus. Runs must have
// focusmanager.testmode=true (tools/run.py sets it) so focus moves without the window being active.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser, IOUtils, PathUtils */
window.K = (() => {
  const { sleep, waitFor } = spike;
  const b = window.vitre;
  const EU = spike.EU;

  const NAMED = {
    Tab: "KEY_Tab", Enter: "KEY_Enter", Escape: "KEY_Escape", Esc: "KEY_Escape", Delete: "KEY_Delete",
    Backspace: "KEY_Backspace", Insert: "KEY_Insert", Home: "KEY_Home", End: "KEY_End",
    PageUp: "KEY_PageUp", PageDown: "KEY_PageDown", Left: "KEY_ArrowLeft", Right: "KEY_ArrowRight",
    Up: "KEY_ArrowUp", Down: "KEY_ArrowDown", Space: " ", Comma: ",", Plus: "+", Minus: "-", Equal: "=",
    Control: "KEY_Control", Shift: "KEY_Shift", Alt: "KEY_Alt",
    BrowserBack: "KEY_BrowserBack", BrowserForward: "KEY_BrowserForward", BrowserRefresh: "KEY_BrowserRefresh",
    BrowserStop: "KEY_BrowserStop", BrowserSearch: "KEY_BrowserSearch", BrowserHome: "KEY_BrowserHome",
  };
  for (let i = 1; i <= 12; i++) NAMED["F" + i] = "KEY_F" + i;

  /** "Ctrl+Shift+T" -> { key, opts } for EventUtils. Modifiers: Ctrl, Shift, Alt, AltGr, Meta (the Windows key). */
  function parse(spec) {
    const parts = spec.split("+");
    let key = parts.pop();
    const opts = {};
    for (const m of parts) {
      if (m === "Ctrl") opts.ctrlKey = true;
      else if (m === "Shift") opts.shiftKey = true;
      else if (m === "Alt") opts.altKey = true;
      else if (m === "AltGr") opts.altGraphKey = true;
      else if (m === "Meta") opts.metaKey = true;
      else throw new Error("bad modifier " + m);
    }
    if (key === "Num0") { key = "0"; Object.assign(opts, { code: "Numpad0", keyCode: 96, location: 3 }); }
    else if (NAMED[key]) key = NAMED[key];
    else if (/^[A-Za-z]$/.test(key)) key = opts.shiftKey ? key.toUpperCase() : key.toLowerCase();
    return { key, opts };
  }
  /** Full keydown (+keypress) + keyup of one chord in `win`. */
  function press(spec, extra = {}, win = window) {
    const { key, opts } = parse(spec);
    (win === window ? EU : win.spike.EU).synthesizeKey(key, Object.assign(opts, extra), win);
  }
  const down = (spec, extra = {}) => press(spec, { ...extra, type: "keydown" });
  const up = (spec, extra = {}) => press(spec, { ...extra, type: "keyup" });

  // ---- test pages (tests/input/pages, loaded as file: URLs in a content process) ----
  const bootFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  bootFile.initWithPath(Services.env.get("VITRE_BOOT"));
  function pageURL(leaf, query = "") {
    const f = bootFile.parent.clone();
    f.append("pages");
    f.append(leaf);
    return Services.io.newFileURI(f).spec + (query ? "?" + query : "");
  }
  /** A data: page. */
  const dataPage = (title, body = "", colour = "#f4f1ea") =>
    "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset=utf-8><title>${title}</title><body style='margin:0;background:${colour};font:16px Segoe UI'><p style='margin:120px 40px'>${body || title}</p>`);

  /** Load a URL in a tab (default: the active one) and wait for it. */
  async function load(url, tab = b.active()) {
    const browser = tab.browser;
    const done = new Promise((resolve) => {
      const listener = {
        onStateChange(br, wp, _req, flags) {
          if (br === browser && wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_STOP && flags & Ci.nsIWebProgressListener.STATE_IS_WINDOW) {
            gBrowser.removeTabsProgressListener(listener);
            resolve();
          }
        },
      };
      gBrowser.addTabsProgressListener(listener);
    });
    b.navigate(tab, url);
    await Promise.race([done, sleep(20000)]);
    await sleep(200);
  }
  /** Load a keys.html variant in the active tab and focus the page. */
  async function page(query = "") {
    await load(pageURL("keys.html", query));
    b.focusPage();
    await sleep(250);
    mark();
  }
  /** What the test page saw (it mirrors its event log into document.title). */
  async function seen(browser = gBrowser.selectedBrowser, wait = 200) {
    await sleep(wait);
    try { return JSON.parse(browser.contentTitle); } catch (e) { return ["<title not json: " + browser.contentTitle + ">"]; }
  }
  /** Run a function (given as source or function) in the page's content process; resolves with its JSON result. */
  function inPage(fn, browser = gBrowser.selectedBrowser) {
    return new Promise((resolve) => {
      const mm = browser.messageManager;
      const id = "K:r" + Math.random();
      const on = (m) => { mm.removeMessageListener(id, on); resolve(m.data); };
      mm.addMessageListener(id, on);
      const src = "(function(){ let r; try { r = (" + fn.toString() + ")(content, content.document); } catch (e) { r = 'ERR ' + e; } sendAsyncMessage(" + JSON.stringify(id) + ", r); })()";
      mm.loadFrameScript("data:," + encodeURIComponent(src), false);
    });
  }
  /** Evaluate page script (the page's own functions) and return the result. */
  const evalInPage = (code, browser) => inPage("function(w,d){ return w.wrappedJSObject.eval(" + JSON.stringify(code) + "); }", browser);

  // ---- what the router did ----
  let from = 0;
  /** Forget what the router logged so far. */
  function mark() { from = b.keys.log.length; }
  /** Router log lines since mark(): "ACTION newTab via Ctrl+T [browser-first]", "page kept Ctrl+K"... */
  const routed = () => b.keys.log.slice(from);
  /** Actions since mark(), short: "newTab[browser-first]", "goTab(3)[page-first/reply]". */
  const actions = () => routed().filter((l) => l.startsWith("ACTION ")).map((l) => {
    const m = /^ACTION (\S+) via (\S+) \[([^\]]+)\]( repeat)?$/.exec(l);
    return m ? m[1] + "[" + m[3] + (m[4] ? ",repeat" : "") + "]" : l;
  });
  /** Press a chord and return the actions it caused. */
  async function key(spec, extra, wait = 350) {
    mark();
    press(spec, extra);
    await sleep(wait);
    return actions();
  }

  /** Replace every action with a recorder (nothing really happens). Returns { ran, restore }. */
  function recordActions(win = window) {
    const ran = [];
    const ids = new Set(win.vitre.keys.bindings().map((x) => x.action));
    for (const extra of ["quit", "goHome", "find", "findNext", "findPrev"]) ids.add(extra);
    const undo = [...ids].map((id) => win.vitre.registerAction(id, (arg) => ran.push(id + (arg !== undefined ? "(" + arg + ")" : ""))));
    return { ran, restore: () => undo.forEach((fn) => fn()) };
  }

  // ---- did Firefox do anything by itself? ----
  const noise = [];
  window.addEventListener("command", (e) => noise.push("command:" + (e.target.id || e.target.getAttribute("command") || e.target.localName)), true);
  window.addEventListener("popupshown", (e) => { if (e.target.localName !== "tooltip") noise.push("popup:" + (e.target.id || e.target.localName)); }, true);
  window.addEventListener("DOMMenuBarActive", () => noise.push("menubar-active"), true);
  Services.obs.addObserver({ observe: (_s, topic) => noise.push(topic) }, "domwindowopened");
  gBrowser.addTabsProgressListener({
    onStateChange(_b, wp, _req, flags) {
      if (wp.isTopLevel && flags & Ci.nsIWebProgressListener.STATE_START && flags & Ci.nsIWebProgressListener.STATE_IS_NETWORK) noise.push("load-start");
    },
  });
  const describe = (el) => (el ? el.localName + (el.id ? "#" + el.id : "") : null);
  /** A picture of everything a Firefox shortcut could change. */
  function snap() {
    let findbar = false, sidebar = false, devtools = false;
    try { findbar = gBrowser.isFindBarInitialized() && !gBrowser.getCachedFindBar().hidden; } catch (e) {}
    try { sidebar = !!(window.SidebarController && window.SidebarController.isOpen); } catch (e) {}
    try { devtools = !!document.querySelector("[class*='devtools-toolbox']"); } catch (e) {}
    return {
      tabs: gBrowser.tabs.length,
      selected: gBrowser.tabs.indexOf(gBrowser.selectedTab),
      order: gBrowser.tabs.map((t) => t.linkedPanel).join(","),
      windows: [...Services.wm.getEnumerator(null)].length,
      focus: describe(document.activeElement),
      zoom: window.ZoomManager.zoom,
      fullscreen: window.fullScreen,
      url: gBrowser.currentURI.spec,
      findbar, sidebar, devtools,
      dialog: gBrowser.selectedBrowser.hasAttribute("tabDialogShowing") || document.documentElement.hasAttribute("window-modal-open"),
      caret: Services.prefs.getBoolPref("accessibility.browsewithcaret", false),
    };
  }
  function diff(a, c) {
    const out = [];
    for (const k of Object.keys(a)) if (a[k] !== c[k]) out.push(k + ": " + a[k] + " -> " + c[k]);
    return out;
  }
  /** Press a chord; return what Firefox itself did ([] = nothing): state changes and commands, popups, loads, windows. */
  async function firefoxDid(spec, extra, wait = 300) {
    const before = snap();
    noise.length = 0;
    press(spec, extra);
    await sleep(wait);
    return [...diff(before, snap()), ...noise.splice(0)];
  }

  return { b, EU, parse, press, down, up, pageURL, dataPage, load, page, seen, inPage, evalInPage, mark, routed, actions, key, recordActions, snap, diff, firefoxDid, noise, sleep, waitFor };
})();
