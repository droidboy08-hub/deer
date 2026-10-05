// Without the 'menus' and 'settings' services (a build of the extensions module alone): the pinned
// buttons fall back to Firefox's toolbar menu with its Firefox-only entries hidden, and the
// extensions button's "nothing to list" cases open about:addons.
//   node tools/build.mjs --out=build-extensions-solo --modules=extensions
//   python tests/extensions/runx.py --test tests/extensions/fallback.js --name extensions-fallback --app build-extensions-solo --timeout 200
// Capture: fallback-1-native-menu.
/* global spike, gBrowser, Services, xt */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  check("no menus / settings service in this build", !b.service("menus") && !b.service("settings"));
  await xt.nav(xt.page());

  // No extension: about:addons (instead of Firefox's onboarding panel).
  spike.click(xt.extButton());
  await xt.waitFor(() => gBrowser.selectedBrowser.currentURI.spec.startsWith("about:addons"), 6000);
  check("no extension, no menus: the extensions button opens about:addons", gBrowser.selectedBrowser.currentURI.spec.startsWith("about:addons"), gBrowser.selectedBrowser.currentURI.spec);
  gBrowser.removeTab(gBrowser.selectedTab);
  await sleep(500);

  await xt.install("menus");
  await xt.waitFor(() => xt.button("menus"), 5000);
  await xt.nav(xt.page() + "?menus");
  const menu = document.getElementById("toolbar-context-menu");
  const btn = xt.button("menus");
  const r = btn.getBoundingClientRect();
  btn.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window, button: 2, clientX: r.left + 14, clientY: r.top + 14, screenX: window.mozInnerScreenX + r.left + 14, screenY: window.mozInnerScreenY + r.top + 14 }));
  await xt.waitFor(() => menu.state === "open", 4000);
  await sleep(600);
  const items = [...menu.children].filter((c) => !c.hidden && c.getBoundingClientRect().height > 0).map((c) => (c.localName === "menuseparator" ? "---" : c.label || c.getAttribute("label") || c.id));
  log("native menu", items);
  // Vitre's wording for Firefox's items: src/locales/en-US/browser/toolbarContextMenu.ftl (verifier).
  check("fallback: Firefox's toolbar menu with the extension's items, Manage, Remove, Pin", items.includes("Open the & log") && items.some((l) => /Manage Extension/i.test(l)) && items.some((l) => /Remove Extension/i.test(l)) && items.some((l) => /^Pin to tab bar$/.test(l)), items);
  check("fallback: no Report, no toolbar customisation, no dangling separator", !items.some((l) => /Report|Customize|Menu Bar|Bookmarks Toolbar/i.test(l)) && items[items.length - 1] !== "---" && items[0] !== "---", items);
  await capture("fallback-1-native-menu");
  menu.hidePopup();
  await xt.closePopups();

  // Everything pinned and in view: about:addons too.
  spike.click(xt.extButton());
  await xt.waitFor(() => gBrowser.selectedBrowser.currentURI.spec.startsWith("about:addons"), 6000);
  check("all pinned, no settings: about:addons", gBrowser.selectedBrowser.currentURI.spec.startsWith("about:addons"));
});
