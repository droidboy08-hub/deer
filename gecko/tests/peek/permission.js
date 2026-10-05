// Peek: prompts from the page in the sheet. A permission request (geolocation) shows at once,
// hanging from the sheet's header (PeekSpec "Permission request"), instead of waiting for the
// peek's hidden tab to be selected (verifier correction 13); Esc answers the prompt, not the peek.
// alert() shows inside the sheet and never selects the peek's tab.
//   python tests/peek/all.py permission
// The doorhanger is a separate OS window: it is not in the captures; its place is logged.
/* global spike, P, gBrowser, Services, PopupNotifications */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const { b, peek, sheet } = P;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(600);
  const src = b.active();

  // ---- 1. geolocation from the peek --------------------------------------------------------------
  await P.shiftClick("#i39");
  const br = await P.waitOpen("n=39");
  await P.focusPeek();
  const geo = await P.rectOf(br, "#geo");
  P.mouse(geo.cx, geo.cy);
  const panel = PopupNotifications.panel;
  await waitFor(() => panel.state === "open", { timeout: 8000, what: "the permission doorhanger" });
  await sleep(400);
  const n = PopupNotifications.getNotification("geolocation", br);
  const anchor = panel.anchorNode;
  const head = sheet().head;
  const pr = panel.getOuterScreenRect();
  const at = { x: Math.round(pr.left - window.mozInnerScreenX), y: Math.round(pr.top - window.mozInnerScreenY), w: Math.round(pr.width), h: Math.round(pr.height) };
  log("doorhanger", { state: panel.state, anchor: anchor && (anchor.className || anchor.id), at, head });
  check("the geolocation prompt for the peek's page shows at once", !!n && panel.state === "open" && (await P.state(br)).geo === "asked");
  check("it hangs from the sheet's header (its site), not the tab bar", !!anchor && !!anchor.closest?.(".vp-head") && at.y >= head.y + head.h - 12 && at.y <= head.y + head.h + 24 && at.x >= head.x - 24 && at.x < head.x + 400, { at, head });
  check("the peek stays a peek: its tab is not selected", peek().isOpen() && gBrowser.selectedTab === src.node);
  await spike.capture("permission-1-prompt");
  P.press("Escape");
  await waitFor(() => panel.state === "closed", { timeout: 4000, what: "the doorhanger to close" });
  await sleep(500);
  check("Esc answers the prompt (the page gets a refusal), and the peek stays open", peek().isOpen() && (await P.state(br)).geo === "error 1", (await P.state(br)).geo);

  // ---- 2. the tab's own prompts stay with the tab ------------------------------------------------------
  P.press("Escape");
  await P.waitClosed();
  check("the next Esc closes the peek", !peek().isOpen());
  await sleep(300);
  check("no doorhanger is left after the peek closed", panel.state === "closed");

  // ---- 3. alert() inside the sheet -------------------------------------------------------------------
  await P.shiftClick("#i41");
  const br41 = await P.waitOpen("n=41");
  await P.focusPeek();
  const al = await P.rectOf(br41, "#alert");
  P.mouse(al.cx, al.cy);
  await waitFor(() => br41.hasAttribute("tabDialogShowing"), { timeout: 5000, what: "the alert" });
  await sleep(600);
  const dialog = gBrowser.getTabDialogBox(br41)?.getContentDialogManager?.()?._dialogs?.[0]?._frame ?? null;
  const dr = dialog && P.R(dialog.getBoundingClientRect());
  const s = sheet();
  log("alert", { dialog: dr, sheet: s.chrome });
  check("alert() from the peek shows in the sheet and does not select its tab", peek().isOpen() && gBrowser.selectedTab === src.node && (!dr || (dr.x >= s.chrome.x && dr.x + dr.w <= s.chrome.x + s.chrome.w)), { dialog: dr });
  await spike.capture("permission-2-alert");
  gBrowser.getTabDialogBox(br41).abortAllDialogs();
  await sleep(400);
  check("after the alert the peek is still open over its tab", peek().isOpen() && !br41.hasAttribute("tabDialogShowing"));
  P.press("Ctrl+W");
  await P.waitClosed();
});
