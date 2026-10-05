// Peek verification: page actions on a focused peek (keymap "Peek": Ctrl+R, Ctrl+P, Ctrl+U, zoom
// keys, F12 act on the peek, not the tab under it). Print preview opens inside the sheet and its Esc
// is its own; view source opens a tab next to the page; zoom changes the peek; F12 makes the peek a
// tab first and opens the tools for it; Alt+Right goes forward inside the peek.
//   python tests/peek-verify/all.py actions
/* global spike, P, V, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek } = V;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(400);
  const src = b.active();

  await V.section("print preview in the sheet", async () => {
    await P.shiftClick("#i39");
    const br = await P.waitOpen("n=39");
    await P.focusPeek();
    P.press("Ctrl+P");
    const node = gBrowser.getTabForBrowser(br);
    await waitFor(() => window.PrintUtils.getPreviewBrowser?.(br) || br.hasAttribute("tabDialogShowing") || node.hasAttribute("tabDialogShowing"), { timeout: 10000, what: "print preview for the peek" });
    await sleep(1500);
    const box = br.closest(".browserStack")?.querySelector("tabmodalprompt, .dialogOverlay[topmost], .dialogBox") ?? null;
    log("print dialog", box && P.R(box.getBoundingClientRect()));
    check("Ctrl+P in a peek prints the peek: its print preview opens in the sheet, the tab under it stays selected", peek().isOpen() && gBrowser.selectedTab === src.node && !!window.PrintUtils.getPreviewBrowser?.(br));
    await spike.capture("actions-1-print");
    P.press("Escape");
    await waitFor(() => !window.PrintUtils.getPreviewBrowser?.(br), { timeout: 6000, what: "print preview to close" });
    await sleep(500);
    check("Esc closes the print preview, not the peek", peek().isOpen());
    check("after print preview the sheet's page is still active and rendering", br.docShellIsActive && gBrowser._printPreviewBrowsers.has(br));
    await P.focusPeek();
    P.press("Escape");
    await P.waitClosed();
    check("the next Esc closes the peek", !peek().isOpen());
  });

  await V.section("alert in the sheet, by keyboard", async () => {
    await P.shiftClick("#i41");
    const br = await P.waitOpen("n=41");
    await P.focusPeek();
    const al = await P.rectOf(br, "#alert");
    P.mouse(al.cx, al.cy);
    await waitFor(() => br.hasAttribute("tabDialogShowing"), { timeout: 5000, what: "the alert" });
    await sleep(800);
    P.press("Escape");
    await sleep(800);
    check("Esc on an alert in the sheet answers the alert; the peek stays", !br.hasAttribute("tabDialogShowing") && peek().isOpen());
    check("focus is back in the sheet's page", document.activeElement === br, document.activeElement?.localName);
    P.mouse(al.cx, al.cy);
    await waitFor(() => br.hasAttribute("tabDialogShowing"), { timeout: 5000, what: "the alert again" });
    await sleep(800);
    P.press("Enter");
    await sleep(800);
    check("Enter answers it too; the peek stays", !br.hasAttribute("tabDialogShowing") && peek().isOpen());
    P.press("Escape");
    await P.waitClosed();
    check("then Esc closes the peek", !peek().isOpen());
  });

  await V.section("view source of the peek", async () => {
    await P.shiftClick("#i38");
    const br = await P.waitOpen("n=38");
    await P.focusPeek();
    P.press("Ctrl+U");
    await waitFor(() => b.tabs.length === 2, { timeout: 8000, what: "the view-source tab" });
    await sleep(800);
    const vs = b.tabs.find((t) => t !== src);
    check("Ctrl+U in a peek shows the peek's source in a new tab", /^view-source:.*n=38/.test(vs?.browser.currentURI.spec ?? ""), vs?.browser.currentURI.spec);
    check("the peek warm-closed as its tab went to the background", !peek().isOpen() && V.hidden() === 1 && !br.docShellIsActive);
  });

  await V.section("zoom in the peek", async () => {
    await P.shiftClick("#i36");
    const br = await P.waitOpen("n=36");
    await P.focusPeek();
    const z0 = br.fullZoom;
    P.press("Ctrl+=");
    await waitFor(() => br.fullZoom > z0, { timeout: 4000, what: "the peek to zoom" });
    await sleep(500);
    const s = P.sheet();
    check("Ctrl+= zooms the page in the sheet; the sheet keeps its size", br.fullZoom > z0 && s.chrome.w === 1040 && s.browser.w === 1040, { zoom: br.fullZoom, chrome: s.chrome });
    P.press("Ctrl+0");
    await waitFor(() => br.fullZoom === 1, { timeout: 4000, what: "zoom reset" });
  });

  await V.section("forward inside the peek", async () => {
    await P.shiftClick("#i39");
    const br = await P.waitOpen("n=39");
    await P.focusPeek();
    const nx = await P.rectOf(br, "#next");
    P.mouse(nx.cx, nx.cy);
    await waitFor(() => br.currentURI.spec.includes("n=38") && !br.webProgress.isLoadingDocument, { what: "next" });
    await sleep(300);
    P.press("Alt+Left");
    await waitFor(() => br.currentURI.spec.includes("n=39") && !br.webProgress.isLoadingDocument, { what: "back" });
    await sleep(300);
    P.press("Alt+Right");
    await waitFor(() => br.currentURI.spec.includes("n=38") && !br.webProgress.isLoadingDocument, { what: "forward" });
    check("Alt+Left / Alt+Right move inside the peek's history; the tab under it stays", peek().isOpen() && src.url.endsWith("issues.html"));
  });

  await V.section("F12 on a peek", async () => {
    await P.shiftClick("#i41");
    const br = await P.waitOpen("n=41");
    await P.focusPeek();
    P.press("F12");
    await waitFor(() => !peek().isOpen() && b.active()?.browser === br, { timeout: 8000, what: "the peek to become a tab" });
    const node = gBrowser.getTabForBrowser(br);
    // The toolbox docks in the tab's own panel as an about:devtools-toolbox frame.
    const toolbox = () => gBrowser.getPanel(br)?.querySelector('iframe[src^="about:devtools-toolbox"], browser[src^="about:devtools-toolbox"]') ?? null;
    await waitFor(toolbox, { timeout: 20000, what: "the toolbox" }).catch(() => null);
    check("F12 on a focused peek opens it as a tab and the developer tools for it", !!toolbox() && !node.hidden);
    await spike.capture("actions-2-devtools");
    b.focusPage();
    P.press("F12");
    await sleep(1500);
  });

  check("no errors from Vitre's code in the console", V.errors.length === 0, V.errors.slice(0, 8));
});
