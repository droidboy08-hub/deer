// Split view's keyboard rings and a Home side (../design/SPLIT-VIEW-SPEC.md "Keys": F6, "Divider":
// Keyboard, "With the rest of Deer": Home): F6 with find open (the pill stop is the find field) and
// with a peek open (its stops take its source page's place), the divider as the one Tab stop between
// the tab bar and the focused page (a Shift+Tab the page keeps for itself leaves no detour to it), and
// a Home side's video background showing its poster frame until Home fills the window again.
/* global spike, SL, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b, http } = SL;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const face = () => document.querySelector("#layer-find .vf-face");
  const findInput = () => document.querySelector("#layer-find .vf-face .vf-input");
  const focusIn = (t) => document.activeElement === t.browser;
  const where = () => {
    const a = document.activeElement;
    return a?.localName === "browser" ? "page:" + (b.tabFor(a)?.title ?? "?") : (a?.className || a?.localName || "none");
  };
  async function f6(shift = false) {
    spike.press(shift ? "Shift+F6" : "F6");
    await sleep(450);
  }

  log("--- 1. F6 with find open: left page -> right page -> the find field -> left page");
  let [fn, tl] = await SL.scene(["dark.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(700);
  b.activate(tl);
  await sleep(400);
  b.focusPage();
  await sleep(200);
  spike.press("Ctrl+F");
  await SL.until(() => face() && !face().hidden && document.activeElement === findInput(), 4000);
  await sleep(300);
  check("set-up: find open on the right side (Tideline), its field focused", document.activeElement === findInput() && b.active() === tl, where());
  await f6();
  check("F6 from the find field: the left page (Field Notes) is focused", b.active() === fn && focusIn(fn), where());
  await f6();
  check("F6: the right page (Tideline), its find parked", b.active() === tl && focusIn(tl) && !face().hidden, where());
  await f6();
  check("F6: the pill stop is the find field while find is open there (the address field stays closed)", document.activeElement === findInput() && !b.omni.open, where());
  await f6(true);
  check("Shift+F6 from the find field: the right page", b.active() === tl && focusIn(tl), where());
  await f6(true);
  check("Shift+F6: the left page", b.active() === fn && focusIn(fn), where());
  await f6(true);
  check("Shift+F6 from the left page: the pill stop; find is not open on this side, so the address field", b.omni.focused && b.active() === fn, where());
  b.omni.close();
  await sleep(300);
  b.service("find")?.close();
  await sleep(300);

  log("--- 2. F6 with a peek open: its stops take its page's place in the ring");
  const peek = b.service("peek");
  if (peek) {
    b.activate(fn);
    await sleep(300);
    peek.open(http("links.html?peek"), {});
    await SL.until(() => peek.isOpen() && peek.browser()?.currentURI?.spec === http("links.html?peek") && !peek.browser().webProgress?.isLoadingDocument, 8000);
    await sleep(800);
    peek.browser().focus();
    await sleep(200);
    check("set-up: a peek from the left page (Field Notes), its page focused", peek.isOpen() && document.activeElement === peek.browser() && b.active() === fn, where());
    await f6();
    const inHeader = peek.isOpen() && document.activeElement !== peek.browser() && !!document.activeElement?.closest?.("#layer-peek, [id*='peek']");
    check("F6 from the peek's page: its header", inHeader, where());
    await f6();
    check("F6 from the peek's header: the right page (the other side's stop); the peek closes with its tab", b.active() === tl && focusIn(tl) && !peek.isOpen(), { where: where(), open: peek.isOpen() });
    b.activate(fn);
    await sleep(400);
    peek.open(http("links.html?peek2"), {});
    await SL.until(() => peek.isOpen() && !peek.browser().webProgress?.isLoadingDocument && peek.browser()?.currentURI?.spec === http("links.html?peek2"), 8000);
    await sleep(800);
    b.editAddress();
    await SL.until(() => b.omni.focused, 3000);
    await sleep(200);
    await f6();
    check("F6 from the address field: the peek's page (the left page's stop)", peek.isOpen() && document.activeElement === peek.browser() && !b.omni.open, where());
    b.editAddress();
    await SL.until(() => b.omni.focused, 3000);
    await sleep(200);
    await f6(true);
    check("Shift+F6 from the address field: the right page (Tideline)", b.active() === tl && focusIn(tl), { where: where(), open: peek.isOpen() });
    await sleep(300);
  } else log("no peek module in this build");

  log("--- 3. the divider is one Tab stop between the tab bar and the focused page");
  [fn, tl] = await SL.scene(["dark.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(800);
  const d = SL.divider();
  const plus = document.querySelector("#vitre-bar .item.plus > .face");
  plus.focus({ focusVisible: true });
  await sleep(150);
  check("set-up: keyboard focus on the bar's last stop (+)", document.activeElement === plus, where());
  spike.press("Tab");
  await sleep(250);
  check("Tab from the bar's last stop: the divider, with its accent grip and ring (keyboard focus)", document.activeElement === d && d.classList.contains("focused"), where());
  spike.press("Tab");
  await sleep(300);
  check("Tab from the divider: the focused page", focusIn(fn) && b.active() === fn, where());
  plus.focus({ focusVisible: true });
  spike.press("Tab");
  await sleep(250);
  spike.press("Shift+Tab");
  await sleep(250);
  check("Shift+Tab from the divider: back to the bar's last stop", document.activeElement === plus, where());
  b.focusPage();
  await sleep(200);
  await SL.inPage((content, doc) => {
    const a = doc.querySelector("a");
    a.focus();
    return doc.activeElement === a;
  }, fn.browser);
  await sleep(200);
  spike.press("Shift+Tab");
  await SL.until(() => document.activeElement === d, 2000);
  check("Shift+Tab out of the focused page's first element: the divider (focus stays on Field Notes' side)", document.activeElement === d && b.active() === fn, where());
  spike.press("Tab");
  await sleep(300);
  check("…and Tab goes back into the page", focusIn(fn), where());
  // A Shift+Tab the page keeps (between two of its links) leaves nothing behind: the next key or
  // click goes where it always goes, not to the divider.
  const shiftTabInside = async () => {
    b.activate(fn);
    b.focusPage();
    await sleep(250);
    await SL.inPage((content, doc) => {
      doc.getElementById("l2").focus();
      return doc.activeElement.id;
    }, fn.browser);
    await sleep(200);
    spike.press("Shift+Tab");
    await sleep(200);
  };
  await shiftTabInside();
  check("set-up: Shift+Tab moved between two links inside the page (focus still in Field Notes)", focusIn(fn) && (await SL.inPage((content, doc) => doc.activeElement?.id, fn.browser)) === "l1", where());
  spike.press("Ctrl+L");
  await sleep(500);
  check("…then Ctrl+L: the address field has focus (not the divider)", b.omni.focused, where());
  b.omni.close();
  await sleep(400);
  await shiftTabInside();
  spike.press("Ctrl+F");
  await sleep(600);
  check("…then Ctrl+F: the find field has focus", document.activeElement === findInput(), where());
  b.service("find")?.close();
  await sleep(400);
  await shiftTabInside();
  const rightPane = SL.panes().right;
  SL.mouse(rightPane.x + rightPane.w / 2, 600, { type: "mousemove" });
  SL.mouse(rightPane.x + rightPane.w / 2, 600, { type: "mousedown" });
  SL.mouse(rightPane.x + rightPane.w / 2, 600, { type: "mouseup" });
  await sleep(600);
  check("…then a click in the right pane: Tideline is focused, keyboard focus in its page", b.active() === tl && focusIn(tl), { active: b.active()?.title, where: where() });
  b.activate(fn);
  await sleep(300);

  log("--- 4. a Home side shows its video's poster frame until Home fills the window again");
  const res = Cc["@mozilla.org/network/protocol;1?name=resource"].getService(Ci.nsIResProtocolHandler);
  const here = Services.io.newURI(res.resolveURI(Services.io.newURI("resource://vitre-boot/slib.js")));
  const video = Services.io.newURI("../settings/live-wallpaper.mp4", null, here).QueryInterface(Ci.nsIFileURL).file;
  const settings = b.sys("VitreSettings");
  const old = settings.get().homeBackground;
  if (video.exists()) {
    settings.set({ homeBackground: { kind: "video", path: video.path } });
    [fn, tl] = await SL.scene(["dark.html"]);
    b.split("home");
    await SL.until(() => b.active()?.kind === "home" && b.splitView.active(), 4000);
    const home = b.active();
    const doc = () => home.browser.contentDocument?.documentElement;
    await SL.until(() => doc()?.dataset.kind === "video" && doc()?.dataset.state === "ready", 10000);
    await sleep(800);
    const v = () => home.browser.contentDocument.querySelector("video");
    check("a Home side with a video background: paused on its first frame (the poster)", doc()?.dataset.split === "true" && doc()?.dataset.playing === "false" && v()?.paused && v()?.currentTime === 0, { ...doc()?.dataset, t: v()?.currentTime });
    b.omni.close();
    await sleep(200);
    b.separate();
    await SL.until(() => doc()?.dataset.playing === "true", 4000);
    check("Home fills the window again: the video plays", doc()?.dataset.split === "false" && doc()?.dataset.playing === "true" && !v()?.paused, { ...doc()?.dataset });
    settings.set({ homeBackground: old });
    await sleep(300);
  } else check("the video fixture tests/settings/live-wallpaper.mp4 exists", false, video.path);
  log("done");
});
