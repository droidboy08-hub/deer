// Verify the surface-root recipe does not break input to the page: wheel scrolling (through APZ)
// and clicks must still reach the remote page under the parent glass layer.
/* global spike, G, gBrowser, Services, document, window */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  G.hideFirefoxUI();
  const root = Services.env.get("VITRE_ROOT") !== "0";
  const browser = gBrowser.selectedBrowser;
  const tabbox = document.getElementById("tabbrowser-tabbox");
  if (root) tabbox.style.filter = "saturate(1.0001)";
  const L = G.el("div", "position:fixed; inset:0; z-index:2147483647; pointer-events:none; font:600 12px 'Segoe UI',sans-serif;", tabbox);
  const pill = G.el("div", "position:absolute; left:400px; top:12px; width:480px; height:44px; border-radius:22px; backdrop-filter:blur(3px) invert(1); pointer-events:auto;", L);
  let pillClicks = 0;
  pill.addEventListener("click", () => pillClicks++);
  const scrollY = () =>
    new Promise((res) => {
      const mm = browser.messageManager;
      const on = (m) => {
        mm.removeMessageListener("VitreVerify:Y", on);
        res(m.data);
      };
      mm.addMessageListener("VitreVerify:Y", on);
      mm.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(`sendAsyncMessage("VitreVerify:Y", { y: content.scrollY, hash: content.location.hash, clicks: content.document.body.dataset.clicks || "0" });`), false);
    });
  const page = "data:text/html," + encodeURIComponent(`<body style="margin:0" onclick="document.body.dataset.clicks = 1 + Number(document.body.dataset.clicks || 0)"><a href="#clicked" style="display:block;height:6000px;background:repeating-linear-gradient(#e6194b 0 60px,#ffe119 60px 120px,#4363d8 120px 180px);font:40px sans-serif">link covering the page</a></body>`);
  await G.go(page);
  spike.log("surface root:", root, "remoteType", browser.remoteType, "before:", await scrollY());
  const wu = window.windowUtils;
  // Wheel over the page (below the bar): 5 notches.
  for (let i = 0; i < 5; i++) {
    wu.sendWheelEvent(640, 400, 0, 3, 0, 1 /* DOM_DELTA_LINE */, 0, 0, 3, 0);
    await spike.sleep(120);
  }
  await spike.sleep(900);
  spike.log("after 5 wheel notches:", await scrollY());
  await spike.capture("input-scrolled");
  // Click on the page (not on the pill).
  for (const type of ["mousedown", "mouseup"]) window.synthesizeMouseEvent(type, 640, 400, { button: 0, clickCount: 1 }, {});
  await spike.sleep(500);
  spike.log("after click on page:", await scrollY(), "pill clicks", pillClicks);
  // Click on the pill: must be taken by the chrome layer, not the page.
  for (const type of ["mousedown", "mouseup"]) window.synthesizeMouseEvent(type, 640, 34, { button: 0, clickCount: 1 }, {});
  await spike.sleep(500);
  spike.log("after click on pill:", await scrollY(), "pill clicks", pillClicks);
});
