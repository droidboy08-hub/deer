// Helpers for the Peek verification scripts. Load with
//   Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
// Loads the feature's own helpers (tests/peek/lib.js, window.P) through a resource mapping of the
// sibling folder, then adds window.V: sections that never abort the whole run, a state reset, the
// inset switch list, console error capture and a few probes.
/* global spike, Services, Ci, gBrowser */
(() => {
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  const mine = res.resolveURI(Services.io.newURI("resource://vitre-boot/"));
  res.setSubstitution("vitre-peektests", Services.io.newURI(new URL("../peek/", mine).href));
  Services.scriptloader.loadSubScript("resource://vitre-peektests/lib.js", window);
})();

window.V = (() => {
  const { sleep, waitFor, log, check } = spike;
  const b = window.vitre;
  const peek = () => b.service("peek");

  /** Errors and warnings logged to the console from now on (Vitre's code, or mentioning peek). */
  const errors = [];
  const listener = {
    observe(m) {
      try {
        const e = m.QueryInterface(Ci.nsIScriptError);
        const text = `${e.errorMessage} @ ${e.sourceName}:${e.lineNumber}`;
        const ours = /chrome:\/\/vitre\/|VitrePage|vitre|Deer/i.test(e.sourceName + " " + e.errorMessage);
        const isError = !(e.flags & Ci.nsIScriptError.warningFlag) && !(e.flags & Ci.nsIScriptError.infoFlag);
        if (ours && isError) errors.push(text);
      } catch {
        const text = String(m.message ?? m);
        if (/vitre|deer|peek/i.test(text) && /error|fail/i.test(text)) errors.push(text);
      }
    },
  };
  Services.console.registerListener(listener);
  window.addEventListener("unload", () => Services.console.unregisterListener(listener));

  /** The inset per-browser off switch list (src/shared/geometry.ts INSET_OFF_KEY). */
  const insetOff = () => {
    const v = Services.ppmm.sharedData.get("vitre:inset-off");
    return Array.isArray(v) ? [...v] : [];
  };

  /** Bring the window back to one tab on the issues page, no peek, no panel. */
  async function reset() {
    const p = peek();
    try {
      b.service("find")?.close();
    } catch {}
    try {
      b.service("menus")?.close();
    } catch {}
    try {
      if (b.service("settings")?.isOpen()) b.service("settings").close();
    } catch {}
    if (b.omni.open) b.omni.close(false);
    if (p?.isOpen()) p.close();
    try {
      await waitFor(() => !p?.isOpen() && !document.querySelector("#layer-peek > .vp-sheet.on"), { timeout: 4000, what: "reset: no sheet" });
    } catch (e) {
      log("reset: sheet still up", String(e));
    }
    while (b.tabs.length > 1) {
      b.closeTab(b.tabs[b.tabs.length - 1]);
      await sleep(150);
    }
    // Tabs the test itself closed are not what the closed-tab checks look for.
    await sleep(300);
    b.forgetClosed();
    const t = b.active();
    if (!t.url.endsWith("issues.html")) await P.load(P.page("issues.html"), t);
    await sleep(200);
    await spike.activate();
  }

  /** Run one part of a script: an exception is a FAIL for that part only, and the window is reset. */
  async function section(name, fn) {
    log("---- " + name);
    try {
      await fn();
    } catch (e) {
      check(name + ": ran to the end", false, String(e) + " " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : ""));
    }
    await reset();
  }

  /** Hidden tabs in this window (open and warm peeks). */
  const hidden = () => Array.from(gBrowser.tabs).filter((t) => t.hidden).length;

  /** The browser's state as Peek sees it. */
  const phase = () => {
    const p = peek();
    return { open: p.isOpen(), shown: !!document.querySelector("#layer-peek > .vp-sheet.on"), dim: !!gBrowser.tabpanels.querySelector(".vitre-peek-dim.on"), hidden: hidden(), bar: b.tabs.length };
  };

  /** Count requestAnimationFrame callbacks and timers set by chrome code over `ms`. */
  async function chromeActivity(ms) {
    let raf = 0;
    let timers = 0;
    let intervals = 0;
    const oRaf = window.requestAnimationFrame;
    const oTimeout = window.setTimeout;
    const oInterval = window.setInterval;
    window.requestAnimationFrame = function (fn) {
      raf++;
      return oRaf.call(window, fn);
    };
    window.setTimeout = function (...a) {
      timers++;
      return oTimeout.apply(window, a);
    };
    window.setInterval = function (...a) {
      intervals++;
      return oInterval.apply(window, a);
    };
    let paints = 0;
    const onPaint = () => paints++;
    window.addEventListener("MozAfterPaint", onPaint);
    await new Promise((r) => oTimeout.call(window, r, ms));
    window.removeEventListener("MozAfterPaint", onPaint);
    window.requestAnimationFrame = oRaf;
    window.setTimeout = oTimeout;
    window.setInterval = oInterval;
    return { raf, timers, intervals, paints };
  }

  /** CPU time of this (parent) process, ms. */
  const cpuMs = async () => {
    const info = await ChromeUtils.requestProcInfo();
    return Number(info.cpuTime) / 1e6;
  };

  return { b, peek, errors, insetOff, reset, section, hidden, phase, chromeActivity, cpuMs };
})();
