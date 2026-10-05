// BLOCKED - DO NOT RELY ON THIS SCRIPT. Services.prompt.asyncAlert(..., MODAL_TYPE_WINDOW, ...) blocks
// the main thread in this harness (no timer fires again; the run times out) both with the shell and
// in stock Firefox (--pref vitre.verify.noshell=true), so it says nothing about the shell. The
// recipe line "window-modal dialogs sit above this layer automatically" therefore stays UNVERIFIED.
// VERIFY (recipe 3: "window-modal dialogs sit above this layer automatically"): open a window-modal
// prompt and a tab-modal prompt and see what is on top of the Vitre bar, and whether the bar can
// still be clicked while the dialog is up.
//   python tools/run.py --boot spikes/shell/verify/boot-v-modal.js --name shell-verify-y-modal --timeout 90 --out spikes/shell/verify/out
/* global spike, vt, Services, gBrowser, VitreUI */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    const noShell = Services.prefs.getBoolPref("vitre.verify.noshell", false);
    if (!noShell) vt.install();
    const d = document;
    if (noShell) {
      // control: the same window-modal prompt in stock Firefox
      setTimeout(() => Services.prompt.asyncAlert(window.browsingContext, Services.prompt.MODAL_TYPE_WINDOW, "Window-modal", "control"), 0);
      for (let i = 0; i < 8; i++) {
        await spike.sleep(500);
        spike.log("stock Firefox, tick", i, { gDialogBoxOpen: !!window.gDialogBox?.isOpen });
      }
      return;
    }
    gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("hit.html"), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await vt.tabLoaded(gBrowser.selectedTab);
    await spike.sleep(400);
    const describe = (e) => (e ? `${e.localName}${e.id ? "#" + e.id : ""}${e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : ""}` : null);
    const pill = VitreUI.bar.items.get(gBrowser.selectedTab);
    const [px, py] = vt.center(pill);
    const [qx, qy] = vt.center(VitreUI.bar.plus);
    const probe = async (label) => {
      const n = gBrowser.tabs.length;
      const top = describe(d.elementFromPoint(px, py));
      await vt.click(qx, qy, { wait: 500 });
      spike.log(label, { elementAtPill: top, clickPlusOpensTab: gBrowser.tabs.length > n, rootZ: getComputedStyle(VitreUI.root).zIndex });
      if (gBrowser.tabs.length > n) gBrowser.removeTab(gBrowser.selectedTab, { animate: false });
      await spike.sleep(300);
    };
    await probe("no dialog");

    // window-modal (in-window "window prompt" sub dialog)
    let p = null;
    setTimeout(() => {
      try {
        p = Services.prompt.asyncAlert(window.browsingContext, Services.prompt.MODAL_TYPE_WINDOW, "Window-modal", "A window-modal prompt (MODAL_TYPE_WINDOW).");
      } catch (e) {
        spike.log("asyncAlert threw", String(e));
      }
    }, 0);
    const wins = () => [...Services.wm.getEnumerator(null)].map((w) => w.document.documentElement.getAttribute("windowtype") || w.location.href.replace(/^.*\//, ""));
    await vt.until(() => window.gDialogBox?.isOpen || wins().length > 1, 6000);
    await spike.sleep(900);
    spike.log("after asking for a window-modal prompt", { gDialogBoxOpen: !!window.gDialogBox?.isOpen, windows: wins(), prefSubDialog: Services.prefs.getBoolPref("prompts.windowPromptSubDialog", null) });
    const box = d.getElementById("window-modal-dialog");
    spike.log("window-modal open", { isOpen: window.gDialogBox?.isOpen, dialog: describe(box), rect: vt.rect(box), topLayer: box?.matches(":modal") });
    await probe("window-modal dialog up");
    await spike.capture("vmodal-1-window-modal");
    try {
      window.gDialogBox.dialog?.close();
    } catch (e) {}
    for (const w of Services.wm.getEnumerator(null)) if (w !== window && !w.gBrowser) w.close();
    await spike.sleep(1500);
    await spike.sleep(500);

    // tab-modal (content prompt)
    const p2 = Services.prompt.asyncAlert(gBrowser.selectedBrowser.browsingContext, Services.prompt.MODAL_TYPE_CONTENT, "Content-modal", "A content-modal prompt (MODAL_TYPE_CONTENT).");
    await vt.until(() => gBrowser.selectedBrowser.hasAttribute("tabDialogShowing") || d.querySelector(".dialogStack:not([hidden]) .dialogBox"), 6000);
    await spike.sleep(900);
    await probe("content-modal dialog up");
    await spike.capture("vmodal-2-content-modal");
  });
}
