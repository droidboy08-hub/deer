// Fix-stage probe (not a product test): the two doorhanger cases of robust-panels.js with the
// state of PopupNotifications logged at each step.
//   python tools/run.py --test tests/review/fix-probe2.js --name fix-probe2 --url https://example.com --out tests/review/out-fix/probe2 --timeout 150
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser, PopupNotifications, gURLBar */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/robust-lib.js", window);
spike.main(async () => {
  const { log, sleep, waitFor } = spike;
  const R = window.R;
  const b = window.vitre;
  await spike.resize(1280, 800);
  await spike.activate();
  await spike.loaded();
  await sleep(500);
  const pn = PopupNotifications;
  const evalIn = (code, browser) => R.inPage("function(w, d){ return w.wrappedJSObject.eval(" + JSON.stringify(code) + "); }", browser);
  const askGeo = (browser) => evalIn("navigator.geolocation.getCurrentPosition(() => { document.title = 'geo-ok'; }, (e) => { document.title = 'geo-denied'; }); 'asked'", browser);
  const panelOpen = () => waitFor(() => pn.panel.state === "open", { timeout: 8000, what: "doorhanger" }).then(() => true, () => false);
  const state = (label) => {
    let orig = "?";
    try {
      orig = pn._shouldSuppress();
    } catch (e) {
      orig = "ERR " + e;
    }
    log("STATE " + label + " " + JSON.stringify({ panel: pn.panel.state, suppress: pn._suppress, shouldSuppress: orig, hooked: !!pn.vitreSuppress, omni: b.omni.open, urlbarFocused: gURLBar.focused, proxy: gURLBar.getAttribute("pageproxystate"), awaiting: !!gBrowser.selectedBrowser._awaitingSetURI, active: document.activeElement?.id || document.activeElement?.localName, barHidden: b.bar.hidden, pending: pn._currentNotifications?.length }));
  };
  for (const type of ["popupshowing", "popupshown", "popuphiding", "popuphidden"]) {
    pn.panel.addEventListener(type, () => log("EVENT " + type + " state=" + pn.panel.state + " at " + new Error().stack.split("\n").slice(1, 7).map((l) => l.trim().replace(/@.*\//, "@")).join(" <- ")));
  }
  state("start");

  // ---- 1. prompt pending, then Ctrl+L and typing ----
  await askGeo();
  log("geo prompt opened: " + (await panelOpen()));
  await sleep(300);
  state("prompt open");
  b.focusPage();
  await sleep(200);
  spike.press("Ctrl+L");
  await sleep(50);
  state("50 ms after Ctrl+L");
  await sleep(350);
  state("400 ms after Ctrl+L");
  spike.type("exa");
  await sleep(900);
  state("after typing");
  log("doorhanger rect " + JSON.stringify(R.popupRect(pn.panel)));
  b.omni.close();
  await sleep(600);
  state("field closed");
  spike.press("Escape");
  await sleep(500);
  state("after Esc");

  // ---- 2. auto-hide ----
  const settings = b.sys("VitreSettings");
  settings.set({ barAutoHide: true });
  await waitFor(() => b.bar.hidden, { timeout: 5000, what: "bar hidden" }).catch(() => {});
  const t2 = b.newTab("https://example.com/?two", { background: false });
  await waitFor(() => t2.url.includes("?two") && !t2.loading, { timeout: 20000, what: "second tab" });
  b.omni.open && b.omni.close();
  b.focusPage();
  await waitFor(() => b.bar.hidden, { timeout: 5000, what: "bar hidden again" }).catch(() => {});
  state("before askGeo (auto-hide)");
  await askGeo();
  const opened = await panelOpen();
  await sleep(400);
  state("after askGeo (auto-hide) opened=" + opened);
  log("doorhanger rect " + JSON.stringify(R.popupRect(pn.panel)));
  settings.set({ barAutoHide: false });
  await sleep(300);
});
