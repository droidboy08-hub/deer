// 08: Shift+right-click (browser-first in keymap.json) on a page that replaces the context menu.
// Gecko has this built in (dom.event.contextmenu.shift_suppresses_event): check it.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
spike.main(async () => {
  await spike.resize(1000, 700);
  spike.log("dom.event.contextmenu.shift_suppresses_event =", Services.prefs.getBoolPref("dom.event.contextmenu.shift_suppresses_event", false));
  await KS.load(KS.pageURL("keys.html", "nocontext=1"));
  gBrowser.selectedBrowser.focus();
  await spike.sleep(300);
  const popups = [];
  window.addEventListener("popupshown", (e) => popups.push(e.target.id), true);
  const menu = document.getElementById("contentAreaContextMenu");
  const click = async (opts) => {
    popups.length = 0;
    KS.EU.synthesizeMouseAtCenter(gBrowser.selectedBrowser, Object.assign({ type: "contextmenu", button: 2 }, opts), window);
    await spike.sleep(900);
    const shown = popups.slice();
    if (menu.state === "open") menu.hidePopup();
    await spike.sleep(200);
    return shown;
  };
  const plain = await click({});
  const shift = await click({ shiftKey: true });
  spike.log("right-click on a page that preventDefaults contextmenu -> chrome popups: " + JSON.stringify(plain));
  spike.log("Shift+right-click on the same page -> chrome popups: " + JSON.stringify(shift));
  spike.log("page saw: " + JSON.stringify(await KS.pageSeen()));
});
