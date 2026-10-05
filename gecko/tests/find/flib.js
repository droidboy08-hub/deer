// Helpers for the find tests (tests/find/*.js). Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/flib.js", window);
// Gives window.FL. Pages come from the local server tests/find/all.py starts (FIND_PORT); keys are
// synthesized in-process (spike.press / spike.type), never OS input.
/* global spike, Services, Cc, Ci, gBrowser */
window.FL = (() => {
  const b = window.vitre;
  const { sleep } = spike;
  const port = Services.env.get("FIND_PORT");
  const pagesDir = Services.env.get("FIND_PAGES");

  const http = (leaf, host = "127.0.0.1") => `http://${host}:${port}/${leaf}`;
  function file(leaf) {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(pagesDir);
    f.append(leaf);
    return Services.io.newFileURI(f).spec;
  }

  /** Load a URL in a tab (default: the active one) and wait for it to stop loading. */
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
    await Promise.race([done, sleep(30000)]);
    await sleep(300);
  }

  /** Run a function in the page's top document (content process); resolves with its JSON result. */
  function inPage(fn, browser = gBrowser.selectedBrowser) {
    return new Promise((resolve) => {
      const mm = browser.messageManager;
      const id = "FL:r" + Math.random();
      const on = (m) => {
        mm.removeMessageListener(id, on);
        resolve(m.data);
      };
      mm.addMessageListener(id, on);
      const src = "(function(){ let r; try { r = (" + fn.toString() + ")(content, content.document); } catch (e) { r = 'ERR ' + e; } sendAsyncMessage(" + JSON.stringify(id) + ", r); })()";
      mm.loadFrameScript("data:," + encodeURIComponent(src), false);
    });
  }

  const F = () => window.vitreFind;
  /** The find state of the topmost page (or of `browser`), as plain data. */
  const st = (browser) => F()?.inspect(browser) ?? null;

  async function until(fn, what = "condition", timeout = 6000) {
    const end = Date.now() + timeout;
    for (;;) {
      let v;
      try {
        v = await fn();
      } catch (e) {
        v = false;
      }
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(40);
    }
  }

  /** Wait until the counter reads `text` (or the timeout); returns the state. */
  async function counter(text, timeout = 4000) {
    await until(() => st()?.counter === text, "counter " + text, timeout);
    await sleep(60);
    return st();
  }

  /** Wait for the counter to stop changing. */
  async function settle(ms = 500, timeout = 5000) {
    let last = "";
    let since = Date.now();
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const s = st();
      const now = JSON.stringify([s?.counter, s?.ord, s?.total, s?.result]);
      if (now !== last) {
        last = now;
        since = Date.now();
      } else if (Date.now() - since >= ms) break;
      await sleep(40);
    }
    return st();
  }

  const face = () => document.querySelector("#layer-find .vf-face");
  const capsule = () => document.querySelector("#layer-find .vf-cap");
  const input = () => (st()?.view === "capsule" ? capsule() : face())?.querySelector(".vf-input");
  const rectOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };

  /** Type into whatever has focus (the find field). */
  function type(text) {
    spike.type(text);
  }
  /** Replace the field's text as typing would (select all, then type). */
  async function query(text) {
    const i = input();
    i.focus();
    i.select();
    if (!text) spike.press("Backspace");
    else type(text);
    await sleep(80);
  }

  /** The page's selection and focused element (top document). */
  const pageState = (browser) =>
    inPage("function (w, d) { const a = d.activeElement; return { sel: String(w.getSelection()), active: a ? (a.id || a.localName) : '', scrollY: w.scrollY, focus: d.hasFocus(), url: d.location.href }; }", browser);

  const nativeFindbar = () => ({ initialized: gBrowser.isFindBarInitialized(), elements: document.querySelectorAll("findbar").length, realFindBar: !!gBrowser.selectedTab._findBar });

  return { http, file, load, inPage, F, st, until, counter, settle, face, capsule, input, rectOf, type, query, pageState, nativeFindbar };
})();
