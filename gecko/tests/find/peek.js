// Find in a peek: the 440x32 capsule in the sheet's header (see tests/find/all.py).
// With the peek module built in, a real peek is opened. Without it, a stand-in 'peek' service makes
// the active tab's page the "peek" (so the page is visible) and names a header rectangle; a plain
// test element draws that header so the capture reads like the FindContexts board.
/* global spike, FL, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/flib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, capture } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  await FL.load(FL.http("article.html"));
  await sleep(1200);

  let peek = b.service("peek");
  const real = !!peek;
  const opened = [];
  let header = null;
  if (real) {
    log("the peek module is built in: a real peek");
    peek.open(FL.http("article.html"));
    await FL.until(() => peek.isOpen() && peek.browser() && !peek.browser().webProgress?.isLoadingDocument, "peek open", 10000);
    await sleep(1500);
  } else {
    log("no peek module in this build: a stand-in 'peek' service over the visible page");
    const browser = b.active().browser;
    let open = true;
    const rect = new DOMRect(200, 72, 1040, 44);
    peek = {
      open: (request, opts) => opened.push({ url: typeof request === "string" ? request : request.url, principal: !!request?.click?.triggeringPrincipal, opts }),
      isOpen: () => open,
      browser: () => (open ? browser : null),
      close: () => (open = false),
      promote() {},
      headerRect: () => (open ? rect : null),
      canReopen: () => false,
      reopen() {},
    };
    b.provide("peek", peek);
    // A stand-in for the sheet's frosted header (the peek module draws the real one).
    header = document.createElement("div");
    header.style.cssText = "position:absolute;left:200px;top:72px;width:1040px;height:44px;box-sizing:border-box;border-radius:22px 22px 0 0;border-bottom:1px solid rgba(16,18,24,0.08);background:rgba(250,251,253,0.92);pointer-events:none;font:600 13.5px 'Segoe UI';color:#16181d;display:flex;align-items:center;padding-left:38px";
    header.textContent = "127.0.0.1  /article.html";
    b.layer("find-test-header", 11).append(header);
  }

  // Ctrl+F with a peek open searches the peek, in the capsule.
  if (real) {
    peek.browser().focus();
    await sleep(200);
    spike.press("Ctrl+F");
  } else b.run("find");
  await FL.until(() => FL.st()?.open, "open in peek");
  await sleep(400);
  let s = FL.st();
  const cap = FL.rectOf(FL.capsule());
  const h = peek.headerRect();
  log("capsule", cap, "header", h && { x: h.x, y: h.y, w: h.width, h: h.height });
  check("Ctrl+F with a peek open: the capsule, focused", s?.view === "capsule" && s.focused, s);
  check("the capsule is 440x32, 38 px into the header, centred", cap && h && cap.w === 440 && cap.h === 32 && cap.x === Math.round(h.x + 38) && cap.y === Math.round(h.y + (h.height - 32) / 2), cap);
  check("the pill keeps its address face", FL.face().hidden && !b.root.classList.contains("find-face"));
  check("the header is told (:root[vitre-find-in-peek])", document.documentElement.hasAttribute("vitre-find-in-peek"));
  if (real) {
    const head = document.querySelector("#layer-peek .vp-head");
    check("the peek's header gives its domain and path to the capsule", head?.classList.contains("find"), head?.className);
  }
  await capture("peek-01-empty");
  FL.type("glass");
  s = await FL.counter("1 of 13");
  check("the capsule searches the peek's page: 1 of 13", s?.counter === "1 of 13", s);
  spike.press("Enter");
  s = await FL.counter("2 of 13");
  check("Enter steps in the peek: 2 of 13", s?.counter === "2 of 13", s);
  await sleep(500);
  await capture("peek-02-results");
  spike.press("Alt+C");
  await FL.until(() => FL.st()?.total === 11, "case", 3000);
  check("Alt+C in the capsule: match case", FL.st()?.matchCase && FL.capsule().querySelector(".vf-case").getAttribute("aria-pressed") === "true");
  await sleep(300);
  await capture("peek-03-case");
  spike.press("Alt+C");
  await FL.query("glasszz");
  s = await FL.counter("No matches");
  check("the capsule says No matches", s?.counter === "No matches", s);
  await capture("peek-04-none");

  // Ctrl+Q in the field: close find and peek the match's link.
  await FL.query("glass counter");
  s = await FL.counter("1 of 1");
  await sleep(300);
  spike.press("Ctrl+Q");
  await FL.until(() => !FL.st()?.open, "closed by Ctrl+Q");
  await sleep(800);
  if (real) {
    const hopped = await FL.until(() => /counter\.html$/.test(peek.browser()?.currentURI?.spec ?? ""), "peek hop", 6000);
    check("Ctrl+Q: find closes and the peek shows the match's link", !!hopped, peek.browser()?.currentURI?.spec);
    await sleep(800);
  } else {
    log("peek.open calls", opened);
    check("Ctrl+Q: find closes and the match's link is peeked with the page's principal", opened.length === 1 && /counter\.html$/.test(opened[0].url) && opened[0].principal && !!opened[0].opts?.origin, opened);
  }
  check("Ctrl+Q: the capsule is gone, the header's own text is back", FL.capsule().hidden && !document.documentElement.hasAttribute("vitre-find-in-peek"));

  // Esc closes the capsule; closing the peek with find open takes the capsule with it.
  b.run("find");
  await FL.until(() => FL.st()?.open, "reopen");
  spike.press("Escape");
  await FL.until(() => !FL.st()?.open, "esc");
  check("Esc in the capsule closes find", FL.capsule().hidden);
  b.run("find");
  await FL.until(() => FL.st()?.open, "reopen 2");
  peek.close();
  await sleep(700);
  check("the peek closes: the capsule goes with it", FL.capsule().hidden && FL.F().capsule.mode === "hidden");
  header?.remove();
});
