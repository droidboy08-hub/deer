// VERIFY (claim 5): is the page <select> dropdown stable with the shell installed? Opens it
// several times (fresh, after a doorhanger, after a tab switch) and checks it STAYS open.
//   python spikes/shell/run_popups.py --boot spikes/shell/verify/boot-v-select.js --name shell-verify-r-select --timeout 120 --out spikes/shell/verify/out
/* global spike, vt, vv, Services, gBrowser, PopupNotifications */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    const noShell = Services.prefs.getBoolPref("vitre.verify.noshell", false);
    if (!noShell) vt.install();
    const d = document;
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("hit.html"), { triggeringPrincipal: sys });
    await vt.tabLoaded(gBrowser.selectedTab);
    await spike.sleep(400);
    // without the shell the page starts below Firefox's toolbars
    const top = Math.round(gBrowser.selectedBrowser.getBoundingClientRect().top);
    const open = async (label, shot) => {
      await vv.activate();
      await vt.click(82, top + 128, { wait: 300 });
      const menulist = d.getElementById("ContentSelectDropdown");
      const popup = menulist?.menupopup || menulist?.querySelector("menupopup");
      const ok = popup && (await vt.popupOpen(popup, 4000));
      const states = [];
      for (let i = 0; i < 6; i++) {
        states.push(popup?.state);
        await spike.sleep(150);
      }
      spike.log(label, { shell: !noShell, active: Services.focus.activeWindow === window, opened: !!ok, statesOver900ms: states.join(","), rect: popup ? vt.popupInfo(popup).rect : null });
      if (shot) await spike.capture(shot);
      if (popup) await vt.popupClosed(popup);
      await spike.sleep(300);
    };
    await open("select #1 (fresh)", noShell ? null : "vselect-1");
    await open("select #2 (again)");
    // after a doorhanger was shown and removed
    const n = PopupNotifications.show(gBrowser.selectedBrowser, "vitre-verify", "A doorhanger before the select", "password-notification-icon", { label: "OK", accessKey: "O", callback() {} }, [], {});
    await vt.popupOpen(PopupNotifications.panel, 4000);
    await spike.sleep(300);
    await vt.popupClosed(PopupNotifications.panel);
    await open("select #3 (doorhanger dismissed but still pending)");
    PopupNotifications.remove(n);
    await spike.sleep(300);
    await open("select #4 (doorhanger removed)");
    const t2 = await vt.openTab("https://example.com/", { select: true });
    gBrowser.selectedTab = gBrowser.tabs[0];
    await spike.sleep(500);
    await open("select #5 (after a tab switch)");
    gBrowser.removeTab(t2, { animate: false });
  });
}
