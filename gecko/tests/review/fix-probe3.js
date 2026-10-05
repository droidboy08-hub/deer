// Fix-stage probe (not a product test): why a geolocation prompt on a second tab with the bar
// auto-hidden does not open after an earlier prompt was answered with Esc (robust-panels.js 2).
//   python tools/run.py --test tests/review/fix-probe3.js --name fix-probe3 --url https://example.com --out tests/review/out-fix/probe3 --timeout 200
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
  const { SitePermissions } = ChromeUtils.importESModule("resource:///modules/SitePermissions.sys.mjs");
  const evalIn = (code, browser) => R.inPage("function(w, d){ return w.wrappedJSObject.eval(" + JSON.stringify(code) + "); }", browser);
  const askGeo = (browser) => evalIn("navigator.geolocation.getCurrentPosition(() => { document.title = 'geo-ok'; }, (e) => { document.title = 'geo-denied:' + e.code; }); 'asked'", browser);
  const panelOpen = () => waitFor(() => pn.panel.state === "open", { timeout: 6000, what: "doorhanger" }).then(() => true, () => false);
  const perms = (browser) => {
    try {
      return SitePermissions.getAllForBrowser(browser).map((p) => `${p.id}=${p.state}/${p.scope}`);
    } catch (e) {
      return "ERR " + e;
    }
  };
  const state = (label, browser = gBrowser.selectedBrowser) =>
    log("STATE " + label + " " + JSON.stringify({ panel: pn.panel.state, suppress: pn._suppress, pending: pn._currentNotifications?.length, title: browser.contentTitle, perms: perms(browser), proxy: gURLBar.getAttribute("pageproxystate"), barHidden: b.bar.hidden, url: browser.currentURI.spec }));
  const settings = b.sys("VitreSettings");

  // A. auto-hide first, with no earlier prompt.
  log("--- A. auto-hide, fresh");
  settings.set({ barAutoHide: true });
  await waitFor(() => b.bar.hidden, { timeout: 5000, what: "bar hidden" }).catch(() => {});
  const tA = b.newTab("https://example.com/?a", { background: false });
  await waitFor(() => tA.url.includes("?a") && !tA.loading, { timeout: 20000, what: "tab A" });
  b.focusPage();
  await waitFor(() => b.bar.hidden, { timeout: 5000, what: "bar hidden again" }).catch(() => {});
  state("A before");
  log("A askGeo -> " + JSON.stringify(await askGeo()));
  log("A opened: " + (await panelOpen()));
  await sleep(300);
  state("A after");
  if (pn.panel.state === "open") {
    spike.press("Escape");
    await sleep(600);
    state("A after Esc");
  }
  settings.set({ barAutoHide: false });
  await sleep(300);
  b.closeTab(tA);
  await sleep(300);

  // B. a prompt on the first tab answered with Esc, then auto-hide and a second tab.
  log("--- B. prompt, Esc, then auto-hide + second tab");
  state("B start");
  log("B askGeo -> " + JSON.stringify(await askGeo()));
  log("B first opened: " + (await panelOpen()));
  await sleep(300);
  spike.press("Escape");
  await sleep(600);
  state("B after Esc");
  settings.set({ barAutoHide: true });
  await waitFor(() => b.bar.hidden, { timeout: 5000, what: "bar hidden" }).catch(() => {});
  const tB = b.newTab("https://example.com/?two", { background: false });
  await waitFor(() => tB.url.includes("?two") && !tB.loading, { timeout: 20000, what: "tab B" });
  b.focusPage();
  await waitFor(() => b.bar.hidden, { timeout: 5000, what: "bar hidden again" }).catch(() => {});
  state("B before second");
  log("B askGeo 2 -> " + JSON.stringify(await askGeo()));
  const openedB = await panelOpen();
  await sleep(300);
  state("B after second, opened=" + openedB);
  // the same on a page of another site
  const tC = b.newTab("https://example.org/", { background: false });
  await waitFor(() => tC.url.includes("example.org") && !tC.loading, { timeout: 20000, what: "tab C" });
  b.focusPage();
  await sleep(300);
  log("C askGeo -> " + JSON.stringify(await askGeo()));
  const openedC = await panelOpen();
  await sleep(300);
  state("C after, opened=" + openedC);
  settings.set({ barAutoHide: false });
});
