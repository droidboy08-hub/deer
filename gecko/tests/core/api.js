// The Browser API hooks and the fixes of the review round: error page card, prompt accent, PDF
// viewer under the bar, paint-driven theme sampling, lens cache, rebind validation, actor envelope,
// hidden tabs (Peek), openLink principals, popup windows, closed tabs, navigation events,
// onDestroy, luma / snapshot, mute, per-frame page links, window.open interception, the pending
// address of a new tab, Ctrl+T + Ctrl+W, window titles, reduced motion, the Appearance theme.
//   python tools/run.py --test tests/core/api.js --name core-api --timeout 240
// Captures: api-1-error-page, api-2-alert, api-3-pdf.
/* global spike, gBrowser, Services, Cc, Ci, Cu, ChromeUtils, IOUtils, PathUtils */
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  const settings = b.sys("VitreSettings");
  const out = Services.env.get("VITRE_OUT");
  const page = (title, body, bg = "#fff") => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset=utf-8><title>${title}</title><body style='margin:0;background:${bg};font:16px Segoe UI'>${body}`);
  const inPage = (browser, fn) =>
    new Promise((resolve) => {
      const mm = browser.messageManager;
      const id = "A:" + Math.random();
      mm.addMessageListener(id, function on(m) {
        mm.removeMessageListener(id, on);
        resolve(m.data);
      });
      const src = "(function(){ let r; try { r = (" + fn.toString() + ")(content, content.document); } catch (e) { r = 'ERR ' + e; } Promise.resolve(r).then((v) => sendAsyncMessage(" + JSON.stringify(id) + ", v), (e) => sendAsyncMessage(" + JSON.stringify(id) + ", 'ERR ' + e)); })()";
      mm.loadFrameScript("data:," + encodeURIComponent(src), false);
    });
  const loaded = async (t, what, timeout = 20000) => {
    await waitFor(() => !t.loading && t.url !== "about:blank", { timeout, what });
    await sleep(300);
  };
  await spike.resize(1280, 800);
  await spike.activate();
  const first = b.active();

  // ---- 1. boot ----
  check("no boot errors (the window.open hook patches the BrowserDOMWindow class, not the XPConnect wrapper)", Shell.errors.length === 0 && b.moduleErrors.length === 0, Shell.errors);
  check("product defaults: standard scrollbars, plain error pages", !matchMedia("(-moz-overlay-scrollbars)").matches && Services.prefs.getBoolPref("widget.windows.overlay-scrollbars.enabled") === false && Services.prefs.getBoolPref("security.certerrors.felt-privacy-v1") === false);

  // ---- 2. the error page: the Electron card ----
  b.navigate(first, "http://nothing-here.invalid/");
  await waitFor(() => first.error && !first.loading, { timeout: 25000, what: "error page" });
  await sleep(1200);
  const err = await inPage(first.browser, (w, d) => {
    const cs = (el) => (el ? w.getComputedStyle(el) : null);
    const t = d.querySelector(".title-text");
    const btn = d.querySelector("#neterrorTryAgainButton");
    return { url: d.documentURI.slice(0, 40), bodyBg: cs(d.body).backgroundColor, title: t && t.textContent, titleFont: t && cs(t).font, btnText: btn && btn.textContent, btnBg: btn && cs(btn).backgroundColor, btnH: btn && btn.getBoundingClientRect().height, btnRadius: btn && cs(btn).borderRadius, long: cs(d.getElementById("errorLongDesc")).display, short: (d.getElementById("errorShortDesc") || {}).textContent, width: d.querySelector(".container").getBoundingClientRect().width, accent: cs(d.documentElement).getPropertyValue("--color-accent-primary").trim(), learnMore: !!d.querySelector("#learnMoreLink") };
  });
  log("error page:", err);
  check("error page: 'Can’t reach this page' 600 24/32, one detail line, a 32 px #005fb8 'Try again' button on #f6f7f9, 480 px card", err.title === "Can’t reach this page" && /600 24px/.test(err.titleFont) && err.btnText === "Try again" && err.btnBg === "rgb(0, 95, 184)" && err.btnH === 32 && err.btnRadius === "6px" && err.bodyBg === "rgb(246, 247, 249)" && err.long === "none" && err.width === 480 && /connect/.test(err.short), err);
  check("the window title carries the page's title with an en dash", document.title === "Can’t reach this page – Deer" && first.title === "Can’t reach this page", document.title);
  await spike.capture("api-1-error-page");

  // ---- 3. the alert() prompt: Firefox's design-system accent is Vitre's blue ----
  b.navigate(first, page("Alert", "<p style='margin:140px 40px'>alert</p><script>setTimeout(()=>alert('Saved your changes.'),500)</scr" + "ipt>"));
  const dlg = await waitFor(() => [...document.querySelectorAll(".dialogFrame")].find((f) => f.contentDocument && f.contentDocument.documentURI.includes("commonDialog") && f.contentDocument.readyState === "complete"), { timeout: 10000, what: "alert dialog" });
  await sleep(600);
  const dd = dlg.contentDocument;
  const dv = dd.defaultView;
  const accent = dv.getComputedStyle(dd.documentElement).getPropertyValue("--color-accent-primary").trim();
  const accept = dd.querySelector("dialog")?.shadowRoot?.querySelector('button[dlgtype="accept"]') ?? dd.querySelector('button[dlgtype="accept"]');
  const acceptBg = accept ? dv.getComputedStyle(accept).backgroundColor : "(no button)";
  log("alert dialog:", { accent, acceptBg, scheme: dv.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light" });
  check("the prompt's accent tokens are Vitre's (#005fb8 light / #4cc2ff dark); its OK button is painted with them", /#005fb8|#4cc2ff/i.test(accent) && (acceptBg === "rgb(0, 95, 184)" || acceptBg === "rgb(76, 194, 255)"), { accent, acceptBg });
  await spike.capture("api-2-alert");
  spike.press("Escape");
  await sleep(400);
  check("Esc closed the prompt", !document.querySelector(".dialogFrame")?.contentDocument?.documentURI.includes("commonDialog"));

  // ---- 4. the PDF viewer sits under the bar ----
  const pdf = "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n4 0 obj << /Length 44 >> stream\nBT /F1 24 Tf 72 700 Td (Vitre PDF) Tj ET\nendstream endobj\n5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n";
  const pdfPath = PathUtils.join(out, "api-test.pdf");
  await IOUtils.write(pdfPath, new TextEncoder().encode(pdf));
  const pdfFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  pdfFile.initWithPath(pdfPath);
  const pdfTab = b.newTab(Services.io.newFileURI(pdfFile).spec);
  let pdfState = null;
  await waitFor(async () => {
    pdfState = await b.page(pdfTab).query("pdf:state").catch((e) => ({ error: String(e) }));
    return pdfState && pdfState.viewer && pdfState.sheet;
  }, { timeout: 20000, what: "pdf.js viewer with Vitre's sheet" }).catch((e) => log("NOTE " + e + " last state " + JSON.stringify(pdfState) + " tab " + JSON.stringify({ url: pdfTab.url, title: pdfTab.title, loading: pdfTab.loading, remote: pdfTab.browser.remoteType })));
  await sleep(800);
  const pdfGeom = await inPage(pdfTab.browser, (w, d) => {
    const r = (s) => { const el = d.querySelector(s); return el ? Math.round(el.getBoundingClientRect().top) : null; };
    return { toolbar: r("#toolbarContainer"), viewer: r("#viewerContainer"), url: d.documentURI.slice(0, 40), toolbarH: Math.round(d.querySelector("#toolbarContainer").getBoundingClientRect().height) };
  });
  log("pdf viewer:", pdfGeom, pdfState);
  check("pdf.js: the toolbar starts at 68 px, under the bar, and the pages under the toolbar", pdfGeom.toolbar === 68 && pdfGeom.viewer === 68 + pdfGeom.toolbarH && pdfState.principal === "resource://pdf.js/web/viewer.html" && pdfGeom.url.startsWith("file:"), { pdfGeom, pdfState });
  await spike.capture("api-3-pdf");
  b.closeTab(pdfTab);
  await sleep(300);

  // ---- 5. paint-driven sampling: damped when repaints change nothing under the bar ----
  // On a page with a running compositor animation every snapshot the sampler takes repaints the
  // page (a static page reports no paint for it), which fed the next sample four times a second.
  const samples = [];
  const realSample = b.sample;
  b.sample = async function () {
    samples.push(performance.now());
    return realSample.call(this);
  };
  const spinner = (top) => page("Spin", `<style>@keyframes s{to{transform:rotate(360deg)}} .s{position:absolute;top:${top}px;left:40px;width:24px;height:24px;border:3px solid #999;border-top-color:#000;border-radius:50%;animation:s 1s linear infinite}</style><div class=s></div>`);
  const paintStats = () => b.page(first).query("core:paint-stats");
  b.navigate(first, spinner(600));
  await loaded(first, "spinner low");
  await sleep(2500);
  samples.length = 0;
  const lowBefore = await paintStats();
  await sleep(4000);
  const low = samples.length;
  log("spinner (compositor animation) for 4 s:", { samples: low, before: lowBefore, after: await paintStats() });
  // A page that really changes under the bar (a script flipping colours every 100 ms) keeps the
  // theme sampled at the page's 250 ms cap. The body's background is the canvas, which is what the
  // band under the bar shows at scroll 0 (the page's top inset strip, src/actors/page/inset.ts).
  b.navigate(first, page("Repaint", "<body style='margin:0;background:#000'><div style='height:120px'></div><script>let n=0;setInterval(()=>{document.body.style.background=(n++%2)?'#000':'#fff'},100)</scr" + "ipt>"));
  await loaded(first, "repainting page");
  await sleep(1200);
  samples.length = 0;
  await sleep(2500);
  const high = samples.length;
  log("script repainting under the bar for 2.5 s:", { samples: high, stats: await paintStats() });
  check("an animated page settles to at most one snapshot per 2 s (was four a second for ever); a page whose colours really change under the bar is sampled up to four times a second", low <= 3 && high >= 4 && high <= 12, { low, high });
  // A one-off repaint right after a sample is sampled at once (nothing is swallowed).
  b.navigate(first, page("Flip", "<body style='margin:0;background:#fff'><script>onmessage=()=>{document.body.style.background='#000'}</script>"));
  await loaded(first, "flip page");
  await waitFor(() => b.theme() === "light", { what: "light over the white page" });
  await sleep(100);
  const t0 = performance.now();
  await inPage(first.browser, (w) => w.postMessage("dark", "*"));
  const flipped = await waitFor(() => b.theme() === "dark", { timeout: 3000, what: "dark after the page repainted itself" }).then(() => true, () => false);
  const flipMs = Math.round(performance.now() - t0);
  b.sample = realSample;
  check("a page that repaints itself dark right after a sample turns the glass dark within a second", flipped && flipMs < 1000, { flipped, flipMs });

  // ---- 6. lens filters: a bounded cache that keeps what is in use ----
  b.navigate(first, page("Resize", "resize"));
  await loaded(first, "resize page");
  const pillLens = () => getComputedStyle(document.querySelector("#vitre-bar .item.active > .lens")).backdropFilter;
  const before = b.bar.state.lenses;
  b.editAddress();
  await sleep(400);
  for (let w = 700; w <= 900; w += 5) {
    window.resizeTo(w, 700);
    await sleep(40);
  }
  b.omni.close();
  await spike.resize(1280, 800);
  await waitFor(() => b.bar.state.settled, { what: "settle" });
  await sleep(200);
  const after = b.bar.state.lenses;
  const pillFilter = pillLens().match(/#vitre-lens-\d+/)?.[0];
  check("41 widths of the address field leave at most 16 cached lens filters, and the pill's own filter is still there", after.cached <= 16 && after.filters <= 16 + after.rows && !!pillFilter && !!document.querySelector(pillFilter), { before, after, pillFilter });

  // ---- 7. a rebind value that is not a string ----
  const count = () => b.keys.bindings().length;
  const n0 = count();
  Services.prefs.setStringPref("vitre.rebind", '{"peekLink":5,"newTab":"Ctrl+K"}');
  await sleep(300);
  const bound = (a) => b.keys.bindings().filter((x) => x.action === a).map((x) => x.spec);
  check("a rebind that is not a string (or not rebindable) is dropped: every binding keeps its default", count() === n0 && bound("downloads").length === 1 && bound("settings").length === 1 && bound("peekLink")[0] === "Ctrl+Q" && bound("newTab")[0] === "Ctrl+T" && Object.keys(b.settings.rebind).length === 0, { n0, now: count(), peek: bound("peekLink"), rebind: b.settings.rebind });
  Services.prefs.setStringPref("vitre.rebind", '{"peekLink":"Ctrl+K"}');
  await sleep(300);
  check("a valid rebind applies", bound("peekLink")[0] === "Ctrl+K" && count() === n0, bound("peekLink"));
  Services.prefs.clearUserPref("vitre.rebind");
  await sleep(300);

  // ---- 8. a malformed message from a content process ----
  b.navigate(first, page("Actor", "actor"));
  await loaded(first, "actor page");
  const actor = first.browser.browsingContext.currentWindowGlobal.getActor("VitrePage");
  const heard = [];
  const offHeard = b.on("page-message", (_t, name, data) => heard.push([name, data]));
  let threw = 0;
  for (const data of [null, undefined, 7, { name: { evil: 1 }, data: 1 }, { data: 1 }, { name: "x".repeat(200), data: 1 }, { name: "test:ok", data: { fine: true } }]) {
    try {
      actor.receiveMessage({ name: "Vitre:FromPage", data });
    } catch (e) {
      threw++;
    }
  }
  offHeard();
  check("the parent actor drops envelopes without a short string name, without throwing, and passes a good one", threw === 0 && heard.length === 1 && heard[0][0] === "test:ok" && heard[0][1].fine === true, { threw, heard });

  // ---- 9. hidden tabs for Peek: no events until adopted ----
  const events = [];
  const offEv = [b.on("tab-created", (t) => events.push("created#" + t.id)), b.on("tab-closed", (t) => events.push("closed#" + t.id)), b.on("tab-activated", (t) => events.push("activated#" + t.id))];
  const tabsBefore = b.tabs.length;
  const hidden = b.openHidden(page("Peek", "peek"));
  await sleep(400);
  const quiet = events.length === 0 && b.tabs.length === tabsBefore && hidden.node.hidden && !b.tabFor(hidden.browser);
  check("b.openHidden: a real hidden tab, not in b.tabs, no tab events, tabFor() undefined", quiet, { events: [...events], tabs: b.tabs.length, hidden: hidden.node.hidden });
  const navs = [];
  const offNav = b.on("tab-navigated", (t, br, info) => navs.push({ tab: t ? t.id : null, hidden: br === hidden.browser, url: info.url.slice(0, 20) }));
  await sleep(400);
  const adopted = b.adopt(hidden.node);
  await sleep(300);
  check("b.adopt puts it after the active tab, activates it and emits one tab-created (and tab-activated)", adopted && b.tabs[1] === adopted && b.activeId === adopted.id && events.filter((e) => e.startsWith("created")).length === 1 && events.includes("activated#" + adopted.id) && !hidden.node.hidden, events);
  offNav();
  offEv.forEach((f) => f());
  b.closeTab(adopted);
  await sleep(300);

  // ---- 10. openLink loads with the page's principal; newTab with Vitre's ----
  const web = Services.scriptSecurityManager.createContentPrincipalFromOrigin("https://example.com");
  const refused = b.openLink("about:config", "tab", { triggeringPrincipal: web, background: true });
  await sleep(1500);
  const refusedUrl = refused ? refused.browser.currentURI.spec : "(no tab)";
  if (refused) b.closeTab(refused);
  const sys = b.newTab("about:config", { background: true });
  await waitFor(() => sys.url === "about:config" && !sys.loading, { timeout: 8000, what: "about:config via newTab" });
  b.closeTab(sys);
  await sleep(200);
  // A page cannot open what it could not load: nothing opens at all (not even a blank tab named
  // after the refused address); a blank tab would also keep the address out of reach.
  check("openLink with a web principal cannot open about:config (nothing opens, or a blank tab); newTab (system) can", (refusedUrl === "(no tab)" || refusedUrl === "about:blank") && sys.url === "about:config", { refusedUrl, sys: sys.url });
  const linked = b.openLink("https://example.org/?via-openlink", "tab", { triggeringPrincipal: web, background: true });
  check("openLink with a web principal opens a web address in the background, after the active tab", !!linked && linked !== b.active() && b.tabs.indexOf(linked) === b.tabs.indexOf(b.active()) + 1 && /example\.org/.test(linked.url), linked && linked.url);
  b.closeTab(linked);
  await sleep(200);

  // ---- 11. closed tabs ----
  const victim = b.newTab(page("Victim", "bye"), { background: true });
  await loaded(victim, "victim");
  b.closeTab(victim);
  await sleep(400);
  const closedBefore = b.closedCount();
  b.forgetClosed();
  await sleep(200);
  check("b.closedCount() counts Ctrl+Shift+T candidates and b.forgetClosed() clears them", closedBefore >= 1 && b.closedCount() === 0, { closedBefore, after: b.closedCount() });

  // ---- 12. navigation and loading events ----
  const seen = [];
  const offs = [b.on("tab-loading", (t, _br, loading) => seen.push((loading ? "start" : "stop") + (t === first ? "@first" : ""))), b.on("tab-navigated", (t, _br, info) => seen.push("nav:" + (t === first ? "first" : "?") + (info.sameDocument ? ":same" : "") + (info.errorPage ? ":error" : "")))];
  b.navigate(first, page("Nav", "<a id=a href='#x'>x</a>"));
  await loaded(first, "nav page");
  await inPage(first.browser, (w) => w.location.hash = "#x");
  await sleep(500);
  offs.forEach((f) => f());
  check("'tab-loading' start/stop and 'tab-navigated' (with sameDocument for a hash change) arrive for the tab", seen.includes("start@first") && seen.includes("stop@first") && seen.includes("nav:first") && seen.includes("nav:first:same"), seen);

  // ---- 13. onDestroy and the 'closing' event ----
  const w2 = await spike.openWindow();
  await sleep(500);
  let destroyed = [];
  w2.vitre.onDestroy(() => destroyed.push("destroy"));
  w2.vitre.on("closing", () => destroyed.push("closing"));
  w2.close();
  await sleep(800);
  check("b.onDestroy runs when its window closes, after the 'closing' event", destroyed.join() === "closing,destroy", destroyed);

  // ---- 14. luma and snapshot of any rectangle ----
  b.navigate(first, page("Luma", "<div style='position:absolute;left:0;top:300px;width:100%;height:300px;background:#000'></div>"));
  await loaded(first, "luma page");
  const bright = await b.luma(first.browser, { x: 0, y: 100, width: 400, height: 100 });
  const dark = await b.luma(first.browser, { x: 0, y: 320, width: 400, height: 100 });
  const bmp = await b.snapshot(first.browser, { x: 0, y: 0, width: 400, height: 200 }, 0.5);
  check("b.luma reads any rectangle (white 1.0, black 0.0) and b.snapshot returns a bitmap of the asked size at the asked scale", bright > 0.95 && dark < 0.05 && bmp && bmp.width === 200 && bmp.height === 100, { bright, dark, bmp: bmp && [bmp.width, bmp.height] });
  bmp?.close();

  // ---- 15. mute ----
  b.toggleMute(first);
  await sleep(200);
  const muted = first.muted;
  b.toggleMute(first);
  await sleep(200);
  check("b.toggleMute flips the tab's muted state", muted === true && first.muted === false, { muted, now: first.muted });

  // ---- 16. per-frame page links ----
  b.navigate(first, page("Frames", "<iframe src='" + page("Inner", "inner") + "' width=300 height=100></iframe>"));
  await loaded(first, "frames page");
  await sleep(500);
  const answers = await b.page(first).queryAll("core:ping", { k: 1 });
  const inner = answers.find((a) => !a.isTop);
  const viaContext = inner ? await b.page(inner.browsingContext).query("core:ping") : null;
  check("b.page(tab).queryAll answers from every frame; b.page(browsingContext) reaches one frame", answers.length >= 2 && answers.some((a) => a.isTop) && !!inner && viaContext && viaContext.isTop === false, { n: answers.length, inner: !!inner, viaContext });

  // ---- 17. window.open from a page goes to the interceptors ----
  const requests = [];
  const offOpen = b.interceptOpen((r) => { requests.push({ source: r.source, url: r.url, opener: r.opener === first }); return true; });
  const tabsNow = b.tabs.length;
  await inPage(first.browser, (w) => { w.open("https://example.org/?popup", "_blank"); return true; });
  await sleep(1000);
  offOpen();
  check("window.open from a page reaches interceptOpen as source 'window-open' with its opener, and a taken request opens nothing", requests.length === 1 && requests[0].source === "window-open" && /example\.org/.test(requests[0].url) && requests[0].opener && b.tabs.length === tabsNow, { requests, tabs: [tabsNow, b.tabs.length] });

  // ---- 18. a new tab shows its address while the server has not answered ----
  const slow = b.newTab("https://10.255.255.1/never");
  const atOnce = { url: slow.url, loading: slow.loading, kind: slow.kind };
  check("right after newTab(url) the Tab already carries its address and counts as loading", atOnce.url === "https://10.255.255.1/never" && atOnce.loading && atOnce.kind === "web", atOnce);
  await sleep(700);
  const pill = document.querySelector("#vitre-bar .item.active");
  const pending = { url: slow.url, kind: slow.kind, loading: slow.loading, host: pill.querySelector(".host").textContent, placeholder: pill.querySelector(".address").classList.contains("placeholder"), stop: pill.querySelector(".reload").getAttribute("aria-label"), navShown: pill.querySelector(".reload").getClientRects().length > 0 };
  check("a tab whose first load is still connecting shows its host, the Stop button and the load line, not Home", pending.url === "https://10.255.255.1/never" && pending.kind === "web" && pending.loading && pending.host === "10.255.255.1" && !pending.placeholder && pending.stop === "Stop" && pending.navShown, pending);
  b.run("stop");
  await sleep(500);
  const stoppedState = { url: slow.url, loading: slow.loading, reload: pill.querySelector(".reload").getAttribute("aria-label") };
  check("Stop on a load that never answered: the tab keeps its address but is no longer loading (Reload shows)", stoppedState.url === "https://10.255.255.1/never" && !stoppedState.loading && stoppedState.reload === "Reload", stoppedState);
  b.closeTab(slow);
  await sleep(300);

  // ---- 19. Ctrl+T immediately followed by Ctrl+W ----
  b.activate(first);
  await sleep(200);
  b.run("newTab");
  b.run("closeTab");
  await sleep(400);
  check("Ctrl+T then Ctrl+W at once leaves the address field closed over the tab the user came back to", !b.omni.open && b.active() === first, { omni: b.omni.open, active: b.active()?.url.slice(0, 30) });

  // ---- 20. window titles ----
  const homeTab = b.newTab();
  await waitFor(() => homeTab.url === "about:vitre-home" && !homeTab.loading, { timeout: 10000, what: "Home" });
  if (b.omni.open) b.omni.close();
  await sleep(300);
  const homeTitle = document.title;
  b.activate(first);
  await sleep(300);
  check("the window title is 'Deer' on Home and '<title> – Deer' (en dash) on a page", homeTitle === "Deer" && document.title === "Frames – Deer", { homeTitle, page: document.title });
  b.closeTab(homeTab);

  // ---- 21. reduced motion: no scaling ----
  Services.prefs.setIntPref("ui.prefersReducedMotion", 1);
  await waitFor(() => matchMedia("(prefers-reduced-motion: reduce)").matches, { what: "reduced motion" });
  const gone = b.newTab(page("Gone", "gone"), { background: true });
  await loaded(gone, "gone");
  const goneItem = b.bar.item(gone.id);
  b.closeTab(gone);
  await sleep(30);
  const leaving = { cls: goneItem.className, transform: getComputedStyle(goneItem).transform, badge: getComputedStyle(goneItem.querySelector(".close-badge")).transform };
  Services.prefs.clearUserPref("ui.prefersReducedMotion");
  check("reduced motion: a closing tab fades without scaling, and the close badge has no scale either", leaving.cls.includes("leaving") && leaving.transform === "none" && leaving.badge === "none", leaving);

  // ---- 22. Appearance: the built-in theme follows settings.theme ----
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const active = async (id) => (await AddonManager.getAddonByID(id))?.isActive === true;
  settings.set({ theme: "dark" });
  await waitFor(() => active("firefox-compact-dark@mozilla.org"), { timeout: 8000, what: "dark theme" });
  const darkOn = await active("firefox-compact-dark@mozilla.org");
  settings.set({ theme: "light" });
  await waitFor(() => active("firefox-compact-light@mozilla.org"), { timeout: 8000, what: "light theme" });
  const lightOn = await active("firefox-compact-light@mozilla.org");
  settings.reset("theme");
  await waitFor(() => active("default-theme@mozilla.org"), { timeout: 8000, what: "default theme" });
  check("Appearance Light / Dark / Match Windows switch Firefox's built-in theme (prompts, panels and pages follow it)", darkOn && lightOn && (await active("default-theme@mozilla.org")), { darkOn, lightOn });

  check("no boot errors at the end", Shell.errors.length === 0, Shell.errors);
});
