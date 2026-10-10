// Peek on a real site (Wikipedia, needs the network): Shift+click a link of an article, the sheet
// shows the linked article (its own process, its own favicon and path in the header), Ctrl+Q peeks
// the hovered link, then Open as tab keeps the page (no reload).   python tests/peek/all.py real
/* global spike, P, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek, sheet } = P;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  const src = b.active();
  await P.load("https://en.wikipedia.org/wiki/Float_glass");
  await sleep(1500);
  check("Wikipedia loaded", src.url.includes("wikipedia.org/wiki/Float_glass") && !src.loading, src.url);

  // The first article link of the body text that is on screen.
  const pick = await P.inContent(src.browser, (w) => {
    const links = Array.from(w.document.querySelectorAll("#mw-content-text p a[href*='/wiki/']")).filter((a) => !a.href.includes(":") || a.href.startsWith("https:"));
    for (const a of links) {
      const r = a.getBoundingClientRect();
      if (r.top > 120 && r.bottom < w.innerHeight - 40 && r.width > 20 && !/\/wiki\/[^/]*:/.test(new URL(a.href).pathname)) {
        a.id = a.id || "peek-test-link";
        return { id: a.id, href: a.href };
      }
    }
    return null;
  });
  log("link", pick, await P.inContent(src.browser, (w) => {
    const all = Array.from(w.document.querySelectorAll("#mw-content-text p a[href*='/wiki/']"));
    return { title: w.document.title, links: w.document.links.length, content: !!w.document.getElementById("mw-content-text"), ps: w.document.querySelectorAll("#mw-content-text p").length, sample: Array.from(w.document.querySelectorAll("#mw-content-text p a")).slice(0, 3).map((a) => a.getAttribute("href")), n: all.length, first: all.slice(0, 3).map((a) => { const r = a.getBoundingClientRect(); return [a.getAttribute("href"), Math.round(r.top), Math.round(r.bottom), Math.round(r.width)]; }), h: w.innerHeight };
  }));
  check("found an article link on screen", !!pick);
  await P.shiftClick("#" + pick.id);
  await waitFor(() => peek().isOpen() && peek().browser(), { what: "a peek" });
  const br = peek().browser();
  await waitFor(() => br.currentURI.spec === pick.href && !br.webProgress.isLoadingDocument, { timeout: 20000, what: "the peeked article" });
  await sleep(1500);
  const s = sheet();
  log("sheet", s, { remoteType: br.remoteType, srcRemoteType: src.browser.remoteType });
  check("the linked article shows in the sheet", s.shown && s.host === "en.wikipedia.org" && s.path === new URL(pick.href).pathname && Number(s.cover) === 0, { host: s.host, path: s.path });
  check("the header has the site's favicon", !!document.querySelector("#layer-peek .vp-id:last-child .fav img"));
  await spike.capture("real-1-peek");

  // Scroll the sheet's page with the wheel over it, then Open as tab: no reload.
  const r = br.getBoundingClientRect();
  spike.EU.synthesizeWheelAtPoint(r.left + r.width / 2, r.top + 300, { deltaY: 600, deltaMode: 0 }, window);
  await sleep(800);
  // The live page is laid out differently at the window's width than at the sheet's (Wikipedia pins
  // its contents and Appearance columns beside the text at 1440 px, not at 1040 px; a fundraising
  // banner above the article rewraps too) and differs from run to run (banners, late images), so
  // scrollY grows by the strip plus whatever scroll anchoring makes of the reflow, and which text
  // stays still depends on the element Gecko anchors (2026-10-08..10: +68, +94; the top text moved
  // 0, -25 or -34 px). Here: no reload and the scroll position kept (on by at least the strip); that
  // the content stays in place on a page that reflows is checked on a local page (promote.js 6).
  // The text at the top of the view is logged for diagnosis.
  const topOf = () =>
    P.inContent(br, (w) => {
      const d = w.document;
      const box = (n) => {
        const r = d.createRange();
        r.selectNodeContents(n);
        return r.getBoundingClientRect();
      };
      if (!w.__peekTop) {
        const walker = d.createTreeWalker(d.getElementById("mw-content-text"), 4 /* NodeFilter.SHOW_TEXT */);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.data.trim() || n.parentElement.closest("table, figure, .infobox, style, script")) continue;
          const r = box(n);
          if (r.height > 0 && r.bottom > 2) {
            w.__peekTop = n;
            break;
          }
        }
      }
      const n = w.__peekTop;
      return { y: w.scrollY, text: n?.data.trim().slice(0, 30), at: n ? box(n).top : null };
    });
  const t0 = await topOf();
  const y0 = t0.y;
  const loads = P.countLoads(br);
  await P.focusPeek();
  P.press("Alt+Enter");
  await waitFor(() => gBrowser.selectedBrowser === br && !peek().isOpen() && !sheet().shown, { timeout: 6000, what: "promotion" });
  await sleep(1200);
  loads.stop();
  const t1 = await topOf();
  const y1 = t1.y;
  log("scroll", { before: t0, after: t1, loads: loads.loads });
  check("Open as tab on a real site: no reload, the scroll position kept (on by at least the strip)", loads.loads === 0 && y0 > 0 && y1 - y0 >= 66, { y0, y1, top: [t0.text, t0.at, t1.at], loads: loads.loads });
  await spike.capture("real-2-promoted");

  // Ctrl+Q on the hovered link of the promoted article.
  const pick2 = await P.inContent(br, (w) => {
    for (const a of w.document.querySelectorAll("#mw-content-text p a[href*='/wiki/']")) {
      const r = a.getBoundingClientRect();
      if (r.top > 120 && r.bottom < w.innerHeight - 40 && r.width > 20 && !/\/wiki\/[^/]*:/.test(new URL(a.href).pathname)) {
        a.id = a.id || "peek-test-link2";
        return { id: a.id, href: a.href };
      }
    }
    return null;
  });
  const lr = await P.rectOf(br, "#" + pick2.id);
  P.move(lr.cx, lr.cy);
  await sleep(200);
  b.focusPage();
  P.press("Ctrl+Q");
  await waitFor(() => peek().isOpen() && peek().browser()?.currentURI.spec === pick2.href, { timeout: 15000, what: "Ctrl+Q peek" });
  check("Ctrl+Q peeks the hovered link on a real site", peek().isOpen());
  await sleep(1200);
  await spike.capture("real-3-ctrl-q");
  P.press("Escape");
  await P.waitClosed();
});
