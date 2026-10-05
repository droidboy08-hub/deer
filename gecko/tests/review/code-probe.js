// Code-review probes (reviewer's own; not a product test). Each block logs evidence for one question.
//   python tests/review/code_run.py extra code-probe.js
/* global spike, gBrowser, Services, ChromeUtils, Ci, IOUtils, PathUtils */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const page = (html) => "data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><meta charset=utf-8><title>probe</title>" + html);
  const settings = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreSettings.sys.mjs").VitreSettings;
  const out = spike.outDir;
  await spike.resize(1280, 800);
  await spike.activate();

  const section = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      log("PROBE " + name + " threw " + e + " " + (e && e.stack ? e.stack.split("\n")[0] : ""));
    }
  };

  // ---- P1: which principal do b.newTab / b.navigate load with? ----
  await section("P1", async () => {
    const t = b.newTab("about:config", { background: true });
    await waitFor(() => t.url === "about:config" && !t.loading, { timeout: 8000, what: "about:config via b.newTab" });
    log("P1 b.newTab('about:config') loaded:", t.url, "system principal document:", t.browser.contentPrincipal.isSystemPrincipal);
    b.closeTab(t);
    const web = Services.scriptSecurityManager.createContentPrincipalFromOrigin("https://example.com");
    const node = gBrowser.addTab("about:config", { inBackground: true, triggeringPrincipal: web, skipAnimation: true });
    await sleep(1500);
    log("P1 same URL with a web page's triggering principal (what Firefox's 'Open link in new tab' passes):", node.linkedBrowser.currentURI.spec);
    gBrowser.removeTab(node, { animate: false });
    const t2 = b.newTab("chrome://browser/content/browser.xhtml", { background: true });
    await sleep(1500);
    log("P1 b.newTab('chrome://browser/content/browser.xhtml'):", t2 ? t2.url : "no tab");
    if (t2) b.closeTab(t2);
  });

  // ---- P2: a peek's hidden tab, made the only way the core offers (fx.addTab + fx.hideTab) ----
  await section("P2", async () => {
    const events = [];
    const off = [
      b.on("tab-created", (t) => events.push("tab-created#" + t.id + " tabs=" + b.tabs.length + " mru=" + JSON.stringify(b.mru))),
      b.on("tab-closed", (t) => events.push("tab-closed#" + t.id + " tabs=" + b.tabs.length)),
      b.on("tab-activated", (t) => events.push("tab-activated#" + t.id)),
    ];
    const before = b.tabs.length;
    const node = gBrowser.addTrustedTab("about:blank", { inBackground: true, skipAnimation: true });
    gBrowser.hideTab(node, "vitre-peek");
    await sleep(200);
    log("P2 hidden tab created+hidden; b.tabs", before, "->", b.tabs.length, "events seen by modules:", events);
    events.length = 0;
    gBrowser.removeTab(node, { animate: false });
    await sleep(200);
    log("P2 hidden tab removed; events:", events);
    off.forEach((f) => f());
  });

  // ---- P3: a rebind value that is not a string (about:config, a buggy settings panel) ----
  await section("P3", async () => {
    const count = () => b.keys.bindings().length;
    const before = count();
    const has = (a) => b.keys.bindings().some((x) => x.action === a);
    Services.prefs.setStringPref("vitre.rebind", '{"peekLink":5}');
    await sleep(300);
    log("P3 bindings before", before, "after rebind {peekLink:5}:", count(), "downloads bound:", has("downloads"), "settings bound:", has("settings"), "find bound:", has("find"), "newTab bound:", has("newTab"));
    Services.prefs.clearUserPref("vitre.rebind");
    await sleep(300);
    log("P3 after clearing the pref:", count());
  });

  // ---- P4: how often is the page snapshotted for the glass theme while a page animates? ----
  await section("P4", async () => {
    const calls = [];
    const original = b.sample;
    b.sample = async function () {
      const t0 = performance.now();
      try {
        return await original.call(this);
      } finally {
        calls.push(performance.now() - t0);
      }
    };
    const measure = async (name, html, seconds) => {
      b.navigate(b.activeId, page(html));
      await sleep(1500);
      calls.length = 0;
      await sleep(seconds * 1000);
      const n = calls.length;
      const mean = n ? calls.reduce((a, c) => a + c, 0) / n : 0;
      log("P4 " + name + ": " + n + " theme samples in " + seconds + " s (" + (n / seconds).toFixed(1) + "/s), mean " + mean.toFixed(1) + " ms, max " + (n ? Math.max(...calls).toFixed(1) : 0) + " ms");
    };
    await measure("static page", "<body style='margin:0;background:#fff'><h1 style='margin-top:300px'>still</h1>", 5);
    await measure(
      "page with a small spinner 600 px below the bar",
      "<style>@keyframes s{to{transform:rotate(360deg)}} .s{position:absolute;top:600px;left:40px;width:24px;height:24px;border:3px solid #999;border-top-color:#000;border-radius:50%;animation:s 1s linear infinite}</style><body style='margin:0;background:#fff'><div class=s></div>",
      5
    );
    b.sample = original;
  });

  // ---- P5: lens filters kept per distinct size ----
  await section("P5", async () => {
    const filters = () => document.querySelectorAll("#vitre-glass-defs filter").length;
    const nodes = () => document.querySelectorAll("#vitre-glass-defs *").length;
    b.navigate(b.activeId, page("<body style='background:#fff'>resize"));
    await sleep(800);
    const f0 = filters();
    const n0 = nodes();
    b.editAddress();
    await sleep(400);
    for (let w = 700; w <= 900; w += 5) {
      window.resizeTo(w, 700);
      await sleep(60);
    }
    b.omni.close();
    log("P5 filters before", f0, "(" + n0 + " svg nodes); after 41 window widths with the address field open:", filters(), "(" + nodes() + " svg nodes)");
    await spike.resize(1280, 800);
  });

  // ---- P6: Home's picture when the Home tab that started the decode is closed mid-way ----
  await section("P6", async () => {
    const make = async (name, hue) => {
      const canvas = new OffscreenCanvas(6000, 4000);
      const ctx = canvas.getContext("2d");
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = "hsl(" + ((hue + i * 7) % 360) + " 60% " + (30 + (i % 5) * 10) + "%)";
        ctx.fillRect(i * 100, 0, 100, 4000);
      }
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
      const path = PathUtils.join(out, name);
      await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
      return path;
    };
    const delays = [0, 10, 40, 120];
    for (let i = 0; i < delays.length; i++) {
      const path = await make("probe-pic-" + i + ".jpg", i * 80);
      settings.set({ homeBackground: { kind: "image", path } });
      await sleep(300);
      const first = b.newTab(undefined, { background: false });
      let state = "";
      const t0 = performance.now();
      for (let k = 0; k < 2000; k++) {
        const d = first.browser.contentDocument?.documentElement?.dataset;
        if (d && d.kind === "image" && d.state) {
          state = d.state;
          break;
        }
        await sleep(1);
      }
      await sleep(delays[i]);
      const stateAtClose = first.browser.contentDocument?.documentElement?.dataset.state;
      b.closeTab(first);
      const closedAfter = Math.round(performance.now() - t0);
      await sleep(200);
      const second = b.newTab(undefined, { background: false });
      let result = "timeout";
      const t1 = performance.now();
      for (let k = 0; k < 100; k++) {
        const d = second.browser.contentDocument?.documentElement?.dataset;
        if (d && d.kind === "image" && (d.state === "ready" || d.state === "error")) {
          result = d.state + " after " + Math.round(performance.now() - t1) + " ms";
          break;
        }
        await sleep(100);
      }
      log("P6 delay " + delays[i] + " ms: first Home tab closed " + closedAfter + " ms after it opened (state then: " + stateAtClose + ", first seen: " + state + "); the next Home tab: " + result + "; its state now: " + second.browser.contentDocument?.documentElement?.dataset.state);
      if (b.omni.open) b.omni.close();
      b.closeTab(second);
      await sleep(200);
    }
    settings.reset("homeBackground.kind");
    settings.reset("homeBackground.path");
  });

  // ---- P7: a malformed message from a content process ----
  await section("P7", async () => {
    b.navigate(b.activeId, page("<body>actor"));
    await sleep(1000);
    const actor = gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.getActor("VitrePage");
    const heard = [];
    const off = b.on("page-message", (_t, name, data) => heard.push([typeof name, name, data]));
    for (const data of [null, undefined, 7, { name: { evil: 1 }, data: 1 }, { data: 1 }]) {
      try {
        actor.receiveMessage({ name: "Vitre:FromPage", data });
        log("P7 receiveMessage(" + JSON.stringify(data) + ") returned; page-message listeners got:", heard.splice(0));
      } catch (e) {
        log("P7 receiveMessage(" + JSON.stringify(data) + ") THREW " + e);
      }
    }
    off();
  });

  log("PROBES DONE");
});
