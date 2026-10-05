// The find face's motion, frame by frame (FindMotion / FindSpec boards): the chrome window's refresh
// driver is put under test control (windowUtils.advanceTimeAndRefresh) and stepped through the open
// morph (0, 60, 120, 240 ms) and the close (100, 200 ms); one capture per frame.
/* global spike, FL, gBrowser, Services, Ci, PathUtils, IOUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/flib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep } = spike;
  await spike.resize(1280, 860);
  await spike.activate();
  await FL.load(FL.http("article.html"));
  await sleep(1500);
  b.focusPage();
  await sleep(300);
  const wu = window.windowUtils;
  const at = [];
  // spike.capture waits for two animation frames, which never come while the refresh driver is
  // paused: ask the runner directly (the same "@@capture" line spike.capture writes).
  const hwnd = window.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle;
  async function capture(name) {
    const done = PathUtils.join(spike.outDir, name + ".png.done");
    spike.log("@@capture " + name + " " + hwnd);
    for (let i = 0; i < 200 && !(await IOUtils.exists(done)); i++) await sleep(50);
  }
  const face = () => FL.face();
  const probe = () => {
    const f = face();
    const q = (s) => f.querySelector(s);
    const op = (s) => Number(getComputedStyle(q(s)).opacity).toFixed(2);
    return { fav: Math.round(q(".vf-fav").getBoundingClientRect().x - f.getBoundingClientRect().x), navs: op(".vf-navs"), reload: op(".vf-reload"), close: op(".vf-close"), grp: op(".vf-grp"), domain: op(".vf-domain"), input: op(".vf-input") };
  };
  try {
    wu.advanceTimeAndRefresh(0);
    b.run("find");
    wu.advanceTimeAndRefresh(0);
    at.push(["0", probe()]);
    await capture("motion-open-000");
    for (const [step, name] of [[60, "060"], [60, "120"], [120, "240"], [200, "440"]]) {
      wu.advanceTimeAndRefresh(step);
      at.push([name, probe()]);
      await capture("motion-open-" + name);
    }
    FL.type("glass");
    wu.advanceTimeAndRefresh(300);
    await sleep(300);
    wu.advanceTimeAndRefresh(500);
    spike.press("Escape");
    wu.advanceTimeAndRefresh(0);
    at.push(["close 0", probe()]);
    wu.advanceTimeAndRefresh(100);
    at.push(["close 100", probe()]);
    await capture("motion-close-100");
    wu.advanceTimeAndRefresh(90);
    at.push(["close 190", probe()]);
    await capture("motion-close-190");
    wu.advanceTimeAndRefresh(200);
  } finally {
    wu.restoreNormalRefresh();
  }
  for (const [t, p] of at) log("t", t, p);
  const open0 = at[0][1];
  const open60 = at.find((x) => x[0] === "060")[1];
  const open240 = at.find((x) => x[0] === "240")[1];
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // Reduced motion: 150 ms cross-fades, nothing slides or turns.
    check("reduced motion: nothing slides (the favicon is at x 16 at once), the parts cross-fade", open0.fav === 16 && Number(open60.close) > 0.3 && Number(open60.close) < 0.95 && Number(open60.navs) < 0.7, { open0, open60 });
  } else {
    check("t 0: the address face (Back/Forward, reload, favicon at its address spot)", Number(open0.navs) > 0.9 && Number(open0.reload) > 0.9 && open0.fav > 16, open0);
    check("t 60: Back/Forward and reload going, the favicon on its way, the group starting", Number(open60.navs) < 0.5 && open60.fav > 16 && open60.fav < open0.fav, open60);
  }
  check("t 240: the find face (favicon at x 16, ×, the group in, address parts gone)", open240.fav === 16 && Number(open240.close) > 0.9 && Number(open240.grp) > 0.9 && Number(open240.navs) < 0.05 && Number(open240.reload) < 0.05, open240);
  await sleep(500);
  check("closed after the morph", face().hidden);
});
