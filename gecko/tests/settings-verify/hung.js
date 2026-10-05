// Settings verifier: slow and hung pages. A page that never finishes loading and a page whose
// content process is stuck in a loop: Settings opens over them (from the address field, since a
// hung page never answers page-first keys), works, clears data, and closes back to the page.
//   python tools/run.py --app build-settings-verify --test tests/settings-verify/hung.js --name settings-verify-hung --timeout 240
// Captures: hung-settings.png (Settings over the hung page).
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const V = window.V;
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  V.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const panel = V.panel();
  const svc = b.service("settings");

  // ---------------------------------------------------------------- a load that never ends
  // A TCP port nothing answers on keeps the tab loading (connection attempt) for a long time.
  b.navigate(b.active(), "http://10.255.255.1/never");
  await sleep(1500);
  log("slow tab loading:", b.active().loading);
  b.editAddress();
  await sleep(300);
  V.press("Ctrl+Comma");
  await sleep(600);
  check("a page still loading: Ctrl+, from the address field opens Settings", V.isOpen() && !b.omni.open && V.focusInSheet());
  V.press("Escape");
  await sleep(400);
  check("…and Esc closes it again (the load goes on)", !panel.isOpen);
  b.run("stop");
  await sleep(300);

  // ---------------------------------------------------------------- a hung page
  await V.load(V.page("Hung page", "<p style='margin:120px 40px'>This page stops answering.</p><script>setTimeout(() => { const t = Date.now(); while (Date.now() - t < 60000) {} }, 400)</script>"));
  await sleep(1200);
  b.focusPage();
  await sleep(150);
  V.press("Ctrl+Comma");
  await sleep(1200);
  check("a hung page does not answer page-first keys: Ctrl+, from it does nothing (yet)", !panel.isOpen, b.keys.log.slice(-2));
  V.press("F6");
  await sleep(500);
  check("F6 always leaves the page: the address field opens", b.omni.open);
  V.press("Ctrl+Comma");
  await sleep(700);
  check("Ctrl+, from the address field opens Settings over the hung page", V.isOpen() && !b.omni.open && V.focusInSheet());
  await spike.capture("hung-settings");
  svc.open("privacy");
  await sleep(400);
  const go = V.content().querySelector('[data-action="clear-data"]');
  const status = V.content().querySelector(".vs-status");
  const t0 = Date.now();
  go.click();
  const done = await waitFor(() => status.dataset.done, { timeout: 20000, what: "clearing while a page hangs" }).then(() => true, () => false);
  check("Clear browsing data finishes while a page hangs", done && status.dataset.done !== "error", { ms: Date.now() - t0, text: status.textContent });
  svc.open("appearance");
  await sleep(300);
  V.rowFor("Start pages below the tab bar").querySelector(".vs-switch").click();
  await sleep(300);
  check("a setting the hung page's process reads (pageInset) is still written", b.sys("VitreSettings").get().pageInset === false);
  V.rowFor("Start pages below the tab bar").querySelector(".vs-switch").click();
  await sleep(200);
  V.press("Escape");
  await sleep(500);
  check("Esc closes Settings over the hung page; focus goes back to it", !panel.isOpen && V.active() === gBrowser.selectedBrowser, V.describe(V.active()));
  // Leave the hung tab for a fresh one and close it.
  const hung = b.active();
  b.newTab();
  await sleep(500);
  if (b.omni.open) b.omni.close();
  b.closeTab(hung);
  await sleep(500);
  V.consoleCheck("hung");
});
