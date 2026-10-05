// Peek: the Esc behaviours (keymap.json "Peek", DESIGN-NOTES "Close"). Esc is page-first: a page that
// does not use it lets it close the sheet. On a page that keeps Esc, a second Esc within 400 ms
// closes anyway (taken before the page sees it), unless the user typed in the peek: then it only
// nudges the sheet. Key repeat and an Esc used by a layer below the peek (a menu, find) never count.
// Ctrl+W closes the sheet, never the tab.   python tests/peek/all.py esc
/* global spike, P, gBrowser, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { check, log, sleep } = spike;
  const { b, peek } = P;
  await P.size(1440, 900);
  await spike.activate();
  await spike.loaded();
  await sleep(600);
  const src = b.active();
  const esc = async (br) => (await P.state(br)).esc;

  // ---- 1. a page that does not use Esc: one Esc closes ---------------------------------------------
  await P.shiftClick("#i39");
  let br = await P.waitOpen("n=39");
  log("focus in the peek", await P.focusPeek());
  P.press("Escape");
  await P.waitClosed();
  check("Esc closes the peek when the page does not use it (the page saw it first)", !peek().isOpen() && (await esc(br)) === 1);
  check("the tab under it is still there, focus back on the link", b.tabs.length === 1 && (await P.state(src.browser)).active === "i39");

  // ---- 2. a page that keeps Esc: Esc goes to the page, Esc Esc closes ---------------------------------
  await P.shiftClick("#i33");
  br = await P.waitOpen("trapesc");
  await P.focusPeek();
  P.press("Escape");
  await sleep(700);
  check("on a page that keeps Esc, one Esc stays with the page", peek().isOpen() && (await esc(br)) === 1, await esc(br));
  P.press("Escape");
  await sleep(700);
  check("two Escs more than 400 ms apart both stay with the page", peek().isOpen() && (await esc(br)) === 2);
  P.press("Escape");
  await sleep(120);
  P.press("Escape");
  await P.waitClosed();
  check("Esc Esc within 400 ms closes the peek anyway; the second Esc never reaches the page", !peek().isOpen() && (await esc(br)) === 3, await esc(br));

  // ---- 3. key repeat never counts --------------------------------------------------------------------
  await P.shiftClick("#i33");
  br = await P.waitOpen("trapesc");
  await P.focusPeek();
  P.press("Escape");
  await sleep(100);
  P.press("Escape", { repeat: true });
  await sleep(600);
  check("a held Esc (key repeat) does not make Esc Esc", peek().isOpen());

  // ---- 4. after typing, Esc Esc only nudges ----------------------------------------------------------
  const ta = await P.rectOf(br, "#comment");
  P.mouse(ta.cx, ta.cy);
  await sleep(150);
  spike.type("unsaved words");
  await sleep(300);
  P.press("Escape");
  await sleep(120);
  P.press("Escape");
  await sleep(60);
  const nudge = gBrowser.tabpanels.querySelector(".vitre-peek-frame").style.translate;
  await sleep(600);
  check("after typing in the peek, Esc Esc only nudges the sheet; the text stays", peek().isOpen() && /px/.test(nudge) && (await P.state(br)).typed === "unsaved words", nudge);

  // ---- 5. Ctrl+W closes the peek, never the tab ------------------------------------------------------
  P.press("Ctrl+W");
  await P.waitClosed();
  check("Ctrl+W closes the peek (even after typing) and leaves the tab", !peek().isOpen() && b.tabs.length === 1 && b.active() === src);

  // ---- 6. an Esc a lower layer used does not count toward Esc Esc ------------------------------------
  // A stand-in for parked find (priority 90): it takes the next Esc that runs the ladder.
  let armed = false;
  const remove = b.addEscLayer(90, () => {
    if (!armed) return false;
    armed = false;
    return true;
  });
  await P.shiftClick("#i39");
  br = await P.waitOpen("n=39");
  await P.focusPeek();
  const e0 = await esc(br);
  armed = true;
  P.press("Escape");
  await sleep(120);
  check("the lower layer took the first Esc; the peek stays", peek().isOpen() && !armed);
  P.press("Escape");
  await P.waitClosed();
  check("the next Esc went to the page first (it was not counted as Esc Esc), then closed the peek", !peek().isOpen() && (await esc(br)) === e0 + 2, { before: e0, after: await esc(br) });
  remove();

  // ---- 7. Esc while the address field is open closes the field first --------------------------------
  await P.shiftClick("#i39");
  br = await P.waitOpen("n=39");
  b.editAddress();
  await sleep(400);
  check("the address field opens over a peek", b.omni.open && b.omni.focused && peek().isOpen());
  P.press("Escape");
  await sleep(400);
  check("Esc in the (untouched) address field closes the field, not the peek", !b.omni.open && peek().isOpen());
  check("focus went back to the sheet's page, not the dimmed tab", document.activeElement === br, document.activeElement === src.browser ? "the tab" : document.activeElement?.localName);
  P.press("Escape");
  await P.waitClosed();
  check("the next Esc closes the peek", !peek().isOpen());
});
