// VERIFY claim 6: does the extension's keyboard command (Ctrl+Shift+Y -> _execute_browser_action)
// open the popup when the key goes through Gecko's real key pipeline (nsITextInputProcessor: trusted
// widget-level key events, the same path a physical key takes after the OS), with the toolbox hidden?
// Tested with focus in chrome and with focus in the (remote) page.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  xt.installExtensionBar(ui);
  await xt.nav(xt.page());
  const mv2 = await xt.installTemp("mv2");
  await xt.waitFor(() => xt.reported(mv2.id)?.tabs);
  await xt.nav(xt.page() + "?keys");
  await xt.sleep(800);
  const node = xt.actionFor(mv2.id).widget.forWindow(window).node;
  const button = node.querySelector(".unified-extensions-item-action-button");

  const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
  spike.log("TIP beginInputTransactionForTests:", tip.beginInputTransactionForTests(window));
  const ctrl = new KeyboardEvent("", { key: "Control", code: "ControlLeft", keyCode: KeyboardEvent.DOM_VK_CONTROL });
  const shift = new KeyboardEvent("", { key: "Shift", code: "ShiftLeft", keyCode: KeyboardEvent.DOM_VK_SHIFT });
  const y = new KeyboardEvent("", { key: "Y", code: "KeyY", keyCode: KeyboardEvent.DOM_VK_Y });
  const chord = () => {
    tip.keydown(ctrl, tip.KEY_NON_PRINTABLE_KEY);
    tip.keydown(shift, tip.KEY_NON_PRINTABLE_KEY);
    const consumed = tip.keydown(y);
    tip.keyup(y);
    tip.keyup(shift, tip.KEY_NON_PRINTABLE_KEY);
    tip.keyup(ctrl, tip.KEY_NON_PRINTABLE_KEY);
    return consumed;
  };

  for (const where of ["chrome", "page"]) {
    if (where === "chrome") { document.documentElement.focus(); window.focus(); }
    else gBrowser.selectedBrowser.focus();
    await xt.sleep(400);
    let opened = false, consumed, active;
    for (let attempt = 0; attempt < 6 && !opened; attempt++) {
      active = Services.focus.activeWindow === window;
      consumed = chord();
      opened = !!(await xt.waitFor(() => button.open, 2500));
      if (!opened) { window.focus(); await xt.sleep(700); }
    }
    spike.log("focus in " + where + ": Ctrl+Shift+Y through TIP -> keydown flags=" + consumed + " (KEYDOWN_IS_CONSUMED=" + tip.KEYDOWN_IS_CONSUMED + ") window active=" + active +
      " focused=" + (document.activeElement?.localName + "#" + document.activeElement?.id) + " popup open=" + opened);
    if (opened) {
      await xt.sleep(1000);
      await spike.capture("keys-popup-from-real-key-focus-" + where);
    }
    await xt.closePopups();
  }
});
