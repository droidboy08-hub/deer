// Real sites (read-only loads) with blocking extensions installed: the cluster stays drawn in the
// pill, badges per tab, the popup opens over a heavy page, nothing throws. Skipped when offline.
//   python tests/extensions/runx.py --test tests/extensions-verify/realsite.js --name extensions-verify-realsite --app build-extensions-verify-all --out tests/extensions-verify/out/realsite
// Captures: real-1-wikipedia, real-2-popup-over-site.
/* global spike, gBrowser, Services, xt, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  for (const name of ["blocker", "dnr", "popup", "pageaction"]) await xt.install(name);
  await xt.waitFor(() => xt.button("blocker") && xt.button("popup"), 6000);
  const sites = ["https://example.com/", "https://en.wikipedia.org/wiki/Float_glass", "https://www.mozilla.org/en-US/"];
  let reached = 0;
  for (const url of sites) {
    gBrowser.selectedBrowser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    const ok = await xt.waitFor(() => gBrowser.selectedBrowser.currentURI.spec.startsWith(url.slice(0, 20)) && !b.active()?.loading, 25000, 250);
    await sleep(1500);
    log(url, "loaded", !!ok, "title", gBrowser.selectedTab.label, "theme", b.theme(), "cluster", xt.rect(xt.cluster()));
    if (!ok) continue;
    reached++;
    check(`${new URL(url).host}: the cluster is drawn in the active pill`, window.vitreExtensions.bar.drawn() && b.bar.item(b.activeId).contains(xt.cluster()));
    check(`${new URL(url).host}: the page action stays hidden (it matches only the test site)`, !!window.vitreExtensions.bar.pageActions.buttons.get(xt.id("pageaction"))?.hidden);
    if (url.includes("wikipedia")) await capture("real-1-wikipedia");
  }
  if (!reached) {
    log("offline: real sites skipped");
    return;
  }
  spike.click(xt.button("popup"));
  const wp = await xt.waitFor(() => xt.widgetPanel(), 6000);
  await sleep(900);
  check("a popup over a real site hangs at 64 under its button", !!wp && Math.abs(xt.rect(wp).y + 4 - 64) <= 2 && Math.abs(xt.rect(wp).r - 4 - xt.rect(xt.button("popup")).r) <= 2, xt.rect(wp));
  await capture("real-2-popup-over-site");
  await xt.closePopups();
  log("vitre errors", vx.errors());
  check("no errors from the extensions module", vx.extErrors().length === 0, vx.extErrors());
});
