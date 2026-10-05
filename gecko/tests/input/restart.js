// The previous session comes back after a restart, including a selected Home tab, and history is
// still there (Places).
//   python tools/run.py --test tests/input/restart.js --name input-restart --timeout 200
// Run 1 opens tabs with Home selected and restarts in place; run 2 (same profile, new process)
// checks what came back. Captures: restart-1-before.png, restart-2-restored.png.
/* global spike, Services, ChromeUtils, gBrowser, IOUtils, PathUtils, K */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
  const out = Services.env.get("VITRE_OUT");
  const picture = PathUtils.join(out, "restart-bright.png");
  const homeDoc = () => b.active()?.browser.contentDocument;
  await spike.resize(1280, 800);
  await spike.activate();

  if (spike.run === 1) {
    const canvas = new OffscreenCanvas(1600, 1000);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f1ece2";
    ctx.fillRect(0, 0, 1600, 1000);
    ctx.fillStyle = "#b9c7b0";
    for (let i = 0; i < 6; i++) ctx.fillRect(120 + i * 240, 420, 150, 420);
    await IOUtils.write(picture, new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer()));
    b.sys("VitreSettings").set({ homeBackground: { kind: "image", path: picture } });

    await K.load("https://example.com/");
    b.newTab(K.dataPage("Third tab", "The third tab.", "#14161c"), { background: true, index: 1 });
    b.focusPage();
    await sleep(200);
    K.press("Ctrl+T"); // Home, next to the first tab, selected
    await waitFor(() => b.active().url === "about:vitre-home" && homeDoc()?.documentElement.dataset.state === "ready", { timeout: 15000, what: "Home tab" });
    K.press("Escape");
    await waitFor(() => b.tabs.length === 3 && b.tabs.every((t) => !t.loading), { what: "tabs loaded" });
    await sleep(800);
    check("before the restart: example.com, Home (selected), a third tab; Home has light glass", b.tabs.map((t) => t.kind).join() === "web,home,web" && b.tabs.indexOf(b.active()) === 1 && b.theme() === "light", b.tabs.map((t) => t.url.slice(0, 30)));
    check("the visit is in Places", (await PlacesUtils.history.fetch("https://example.com/")) !== null);
    await spike.capture("restart-1-before");
    log("restarting");
    await spike.restart();
    return;
  }

  // ---- run 2 ----
  log("run 2: tabs at script start " + JSON.stringify(b.tabs.map((t) => ({ url: t.url.slice(0, 30), deferred: t.deferred }))));
  check("the glass Home had is known before its page has loaded (remembered from the last session)", b.homeTheme === "light" && Services.prefs.getStringPref("vitre.home.theme", "") === "light", b.homeTheme);
  await waitFor(() => b.tabs.length === 3, { timeout: 20000, what: "restored tabs" });
  await waitFor(() => b.active()?.url === "about:vitre-home" && homeDoc()?.documentElement.dataset.state === "ready", { timeout: 20000, what: "restored Home tab" });
  await sleep(800);
  const [t1, t2, t3] = b.tabs;
  const doc = homeDoc();
  check("three tabs restored in order with Home selected", t1.url.startsWith("https://example.com") && t2.url === "about:vitre-home" && t3.url.startsWith("data:text/html") && b.activeId === t2.id, b.tabs.map((t) => t.url.slice(0, 30)));
  check("the restored, selected Home tab shows Home itself (not an error page): its document, its picture, light glass", doc.documentURI === "about:vitre-home" && doc.title === "Home" && !!doc.querySelector("#bg > img.shown") && doc.documentElement.dataset.kind === "image" && b.theme() === "light" && t2.kind === "home", { uri: doc.documentURI, title: doc.title, data: { ...doc.documentElement.dataset } });
  check("the bar shows it as Home", document.querySelector("#vitre-bar .item.active .host").textContent === "Search or enter address" && document.querySelector("#vitre-bar .item.active").classList.contains("home"));
  check("the tabs that are not selected wait unloaded, with their address and title", t1.deferred && t3.deferred && t1.title.length > 0 && t3.title === "Third tab", [t1.title, t3.title]);
  check("history survived the restart (Places)", (await PlacesUtils.history.fetch("https://example.com/")) !== null);
  await spike.capture("restart-2-restored");
  b.activate(t1);
  await waitFor(() => !t1.deferred && !t1.loading && t1.title === "Example Domain", { timeout: 20000, what: "restored tab loading on first show" });
  check("a restored tab loads when it is first shown", t1.ready && t1.url.startsWith("https://example.com"));
  b.sys("VitreSettings").reset("homeBackground.kind");
  b.sys("VitreSettings").reset("homeBackground.path");
});
