// Peek: element full screen asked for by the page in the sheet. Firefox only lets the selected tab
// go full screen (FullScreen.enterDomFullscreen), so the peek is opened as a tab first (verifier
// correction 12), at once, then the element fills the screen; the page does not reload and stays
// a tab after full screen ends.   python tests/peek/all.py fullscreen
/* global spike, P, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek } = P;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(600);
  const src = b.active();

  await P.shiftClick("#i36");
  const br = await P.waitOpen("n=36");
  const before = await P.state(br);
  const loads = P.countLoads(br);
  await P.focusPeek();
  const fs = await P.rectOf(br, "#fs");
  P.mouse(fs.cx, fs.cy);
  await waitFor(async () => (await P.state(br)).isFs, { timeout: 8000, what: "element full screen" });
  await sleep(900);
  const st = await P.state(br);
  log("full screen", { page: st, chrome: { fsElement: document.fullscreenElement?.localName, inDOMFullscreen: document.documentElement.hasAttribute("inDOMFullscreen"), windowFullScreen: window.fullScreen } });
  check("the page in the sheet went full screen", st.isFs && st.fs === "in" && document.fullscreenElement === br && document.documentElement.hasAttribute("inDOMFullscreen"));
  check("it became a tab first (right of its source), the sheet is gone", b.active()?.browser === br && b.tabs.length === 2 && b.tabs.indexOf(b.active()) === b.tabs.indexOf(src) + 1 && !peek().isOpen() && !P.sheet().shown);
  await spike.capture("fullscreen-1-in");
  document.exitFullscreen();
  await waitFor(() => !document.fullscreenElement && !document.documentElement.hasAttribute("inDOMFullscreen"), { timeout: 6000, what: "leaving full screen" });
  await sleep(900);
  loads.stop();
  const after = await P.state(br);
  check("after full screen it is an ordinary tab with the same page (no reload)", b.active()?.browser === br && !gBrowser.getTabForBrowser(br).hidden && after.token === before.token && loads.loads === 0 && !after.isFs, { loads: loads.loads });
  const inset = await b.page(br).query("inset:state");
  check("and it sits under the bar with its strip", inset?.browserOff === false && inset.applied === true, inset && { off: inset.browserOff, applied: inset.applied });
  await spike.capture("fullscreen-2-out");
});
