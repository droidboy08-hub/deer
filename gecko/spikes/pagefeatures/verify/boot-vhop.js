// Verify claim 5 (hop): Shift+click another link on the dimmed page navigates the same sheet.
// The spike's own log line is "HOP: same sheet navigated true .../counter.html" with NO "?from=imglink"
// and no "[peek] hop" line: the clicked link sat under the sheet, so the click went into the peek.
//   a. link under the sheet (the spike's case)      b. link visible beside the sheet
//   c. Shift+click a link inside the sheet          d. beside the sheet without a Shift keydown
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitrePeek, VitreMenu, VitreFind */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
v.vload("common.js", "vitre-menu.js", "vitre-find.js", "vitre-peek.js", "vitre-actors.js");
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    VitreMenu.install();
    VitreFind.install();
    VitrePeek.install();
    await v.activate();
    const openFirst = async () => {
      const r = await pf.rectOf(b, "#first");
      pf.mouse(r.cx, r.cy, { shiftKey: true });
      const p = await pf.until(() => VitrePeek.current, 5000);
      await pf.browserLoaded(p.browser, "from=first");
      await spike.sleep(700);
      return p;
    };
    const shiftDown = () => pf.EU.synthesizeKey("KEY_Shift", { type: "keydown" }, window);
    const shiftUp = () => pf.EU.synthesizeKey("KEY_Shift", { type: "keyup" }, window);
    const inside = (p, r) => {
      const s = p.panel.getBoundingClientRect();
      return r.cx > s.left && r.cx < s.right && r.cy > s.top && r.cy < s.bottom;
    };

    // a. the spike's case: target link is under the sheet
    let p = await openFirst();
    let r = await pf.rectOf(b, "#mid");
    shiftDown();
    pf.mouse(r.cx, r.cy, { shiftKey: true });
    shiftUp();
    await spike.sleep(1500);
    spike.log("a link UNDER the sheet:", { linkCentre: [Math.round(r.cx), Math.round(r.cy)], coveredBySheet: inside(p, r), peekUrl: VitrePeek.current && VitrePeek.current.browser.currentURI.spec.replace(pf.base, ""), hopped: !!VitrePeek.current && VitrePeek.current.browser.currentURI.spec.includes("from=mid") });
    await spike.capture("vhop-a-under-sheet");

    // b. link visible beside the sheet, Shift held
    r = await pf.rectOf(b, "#edge");
    const tabBefore = VitrePeek.current.tab;
    shiftDown();
    await spike.sleep(50);
    spike.log("b scrim pointer-events while Shift is down:", JSON.stringify(VitrePeek.current.scrim.style.pointerEvents));
    pf.mouse(r.cx, r.cy, { shiftKey: true });
    shiftUp();
    const hop = await pf.until(() => VitrePeek.current && VitrePeek.current.browser.currentURI.spec.includes("from=edge"), 5000);
    await spike.sleep(500);
    spike.log("b link BESIDE the sheet, Shift held:", { linkCentre: [Math.round(r.cx), Math.round(r.cy)], coveredBySheet: inside(p, r), hopped: !!hop, sameTab: VitrePeek.current && VitrePeek.current.tab === tabBefore, peekUrl: VitrePeek.current && VitrePeek.current.browser.currentURI.spec.replace(pf.base, ""), canGoBack: VitrePeek.current && VitrePeek.current.browser.canGoBack, tabs: gBrowser.tabs.length, sourceUrl: b.currentURI.spec.replace(pf.base, "") });
    await spike.capture("vhop-b-beside-sheet");

    // c. Shift+click a link inside the sheet: hops in place
    if (VitrePeek.current) {
      const cur = VitrePeek.current;
      const lr = await pf.rectOf(cur.browser, "#next");
      shiftDown();
      pf.mouse(lr.cx, lr.cy, { shiftKey: true });
      shiftUp();
      const ok = await pf.until(() => VitrePeek.current && VitrePeek.current.browser.currentURI.spec.includes("second.html"), 5000);
      spike.log("c Shift+click a link INSIDE the sheet:", { navigatedInPlace: !!ok, sameTab: VitrePeek.current && VitrePeek.current.tab === cur.tab, tabs: gBrowser.tabs.length, windows: Array.from(Services.wm.getEnumerator("navigator:browser")).length });
    }

    // d. beside the sheet, modifier on the click only (no Shift keydown reached chrome, e.g. Shift was
    //    already down when the window got focus)
    if (VitrePeek.current) {
      r = await pf.rectOf(b, "#edge");
      const before = VitrePeek.current.browser.currentURI.spec;
      pf.mouse(r.cx, r.cy, { shiftKey: true });
      await spike.sleep(1200);
      spike.log("d beside the sheet, shiftKey on the click but no Shift keydown:", { peekStillOpen: !!VitrePeek.current, navigated: !!VitrePeek.current && VitrePeek.current.browser.currentURI.spec !== before });
    }
    // e. plain click beside the sheet closes (and the link is NOT followed)
    if (VitrePeek.current) {
      r = await pf.rectOf(b, "#edge");
      pf.mouse(r.cx, r.cy, {});
      await spike.sleep(900);
      spike.log("e plain click on the dim over a link:", { peekClosed: !VitrePeek.current, sourceUrl: b.currentURI.spec.replace(pf.base, "") });
    }
  });
