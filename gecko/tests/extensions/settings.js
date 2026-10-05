// Settings › Extensions (registered with the 'settings' service), the empty state and the
// "everything pinned" case of the extensions button, and the parked-review indicator.
//   python tests/extensions/runx.py --test tests/extensions/settings.js --name extensions-settings --app build-extensions --timeout 240
// Captures: settings-0-empty-menu, settings-1-extensions, settings-2-remove-confirm,
// settings-3-review-indicator, settings-4-review-menu, settings-5-review-row.
/* global spike, gBrowser, Services, ChromeUtils, CustomizableUI, xt, WebExtensionPolicy */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  const sys = b.sys("VitreExtensions");
  await spike.resize(1280, 800);
  await spike.activate();
  await xt.nav(xt.page());

  // ---- 0. no extension: the button opens the empty-state menu ----
  const menus = b.service("menus");
  let rows = null;
  if (menus) {
    const show = menus.show;
    menus.show = function (items, at, opts) {
      rows = items;
      return show.call(this, items, at, opts);
    };
  }
  const labels = () => (rows || []).map((r) => ("separator" in r ? "---" : "caption" in r ? "[" + r.caption + "]" : r.label));
  check("no extension: count 0", b.service("extensions").count() === 0);
  spike.click(xt.extButton());
  await xt.waitFor(() => rows, 3000);
  await sleep(400);
  log("empty menu", labels());
  check("empty state: Vitre's menu (no Firefox onboarding panel)", labels().join("|") === "[No extensions installed]|&Get add-ons|&Load temporary add-on…|---|Extension &settings" && document.getElementById("unified-extensions-panel")?.state !== "open", labels());
  await capture("settings-0-empty-menu");
  menus?.close();
  await sleep(300);

  // ---- 1. extensions; one loaded the way "Load temporary add-on" does (remembered) ----
  for (const name of ["blocker", "popup"]) await xt.install(name);
  const loaded = await sys.loadTemporary(xt.extPath("pin1"));
  check("loadTemporary: loaded and remembered for the next start", loaded.id === xt.id("pin1") && sys.temporary().some((t) => t.id === xt.id("pin1") && t.path === xt.extPath("pin1")), sys.temporary());
  check("remembered in the pref", Services.prefs.getStringPref("vitre.extensions.temporary", "").includes("pin1@vitre.test"));
  await xt.waitFor(() => xt.button("pin1"), 5000);

  // ---- 2. everything pinned and in view: the button opens Settings › Extensions ----
  const settings = b.service("settings");
  check("'settings' service present in this build", !!settings);
  spike.click(xt.extButton());
  const page = () => document.querySelector(".vx-page");
  await xt.waitFor(() => page()?.querySelector(".vx-card"), 6000);
  await sleep(800);
  check("all pinned: the extensions button opens Settings › Extensions", !!page() && settings?.isOpen?.() !== false);
  // An extension without a toolbar button is listed in Firefox's panel: install one, reopen.
  await xt.install("pageaction");
  await xt.waitFor(() => page()?.querySelector(`.vx-card[data-extension-id="${xt.id("pageaction")}"]`), 6000);
  await sleep(500);
  const cards = () => [...(page()?.querySelectorAll(".vx-card") ?? [])];
  log("cards", cards().map((c) => c.dataset.extensionId + ": " + c.querySelector(".vs-title")?.textContent + " | " + c.querySelector(".vx-meta")?.textContent));
  check("one card per extension, sorted by name", cards().map((c) => c.dataset.extensionId).join(",") === [xt.id("blocker"), xt.id("pageaction"), xt.id("pin1"), xt.id("popup")].join(","), cards().map((c) => c.dataset.extensionId));
  const card = (name) => cards().find((c) => c.dataset.extensionId === xt.id(name));
  // The page scrolls inside the panel: a control below the fold is scrolled to before the click.
  const press = (el) => {
    el?.scrollIntoView({ block: "center" });
    spike.click(el);
  };
  check("card: icon, name, version and where it shows", !!card("blocker")?.querySelector(".vx-ext-ico img") && /Version 1\.0 · Pinned to the tab bar/.test(card("blocker")?.querySelector(".vx-meta")?.textContent), card("blocker")?.querySelector(".vx-meta")?.textContent);
  check("a page action extension says where it shows", /Shows in the tab bar on the pages it works on/.test(card("pageaction")?.querySelector(".vx-meta")?.textContent), card("pageaction")?.querySelector(".vx-meta")?.textContent);
  check("temporary add-on marked", /Temporary/.test(card("pin1")?.querySelector(".vx-meta")?.textContent));
  check("'Loaded from a folder or file' lists the remembered one", [...page().querySelectorAll(".vs-h2")].some((h) => h.textContent === "Loaded from a folder or file") && page().textContent.includes(xt.extPath("pin1")));
  check("private-window row per extension, off for temporary installs", card("blocker")?.querySelectorAll(".vs-switch")[1]?.getAttribute("aria-checked") === "false");
  check("no 'Report' anywhere", !/report/i.test(page().textContent));
  await capture("settings-1-extensions");

  // ---- 3. private-window access ----
  press(card("blocker").querySelectorAll(".vs-switch")[1]);
  await xt.waitFor(() => WebExtensionPolicy.getByID(xt.id("blocker"))?.privateBrowsingAllowed, 8000);
  check("Run in private windows: permission granted and the extension reloaded with it", !!WebExtensionPolicy.getByID(xt.id("blocker"))?.privateBrowsingAllowed);
  await sleep(500);

  // ---- 4. turn off, on ----
  await xt.waitFor(() => card("popup"), 3000);
  press(card("popup").querySelector(".vs-switch"));
  const off = await xt.waitFor(async () => (await xt.AddonManager.getAddonByID(xt.id("popup")))?.userDisabled, 5000);
  check("switch off disables it, its button leaves the pill", !!off && !xt.button("popup"));
  await sleep(400);
  press(card("popup").querySelector(".vs-switch"));
  await xt.waitFor(() => xt.button("popup"), 5000);
  check("switch on brings it back", !!xt.button("popup"));
  await sleep(400);

  // ---- 5. unpin from the page ----
  const pinLink = () => [...(card("pageaction")?.querySelectorAll(".vs-link") ?? [])].find((l) => /^(Pin|Unpin)$/.test(l.textContent));
  check("page action only extension has no Pin link (no toolbar button)", !pinLink());
  const blockerPin = () => [...(card("blocker")?.querySelectorAll(".vs-link") ?? [])].find((l) => /^(Pin|Unpin)$/.test(l.textContent));
  press(blockerPin());
  await xt.waitFor(() => xt.area("blocker") === CustomizableUI.AREA_ADDONS, 3000);
  check("Unpin moves it to the extensions panel", xt.area("blocker") === CustomizableUI.AREA_ADDONS);
  await sleep(300);
  press(blockerPin());
  await xt.waitFor(() => xt.area("blocker") === "vitre-ext-bar", 3000);
  check("Pin brings it back to the pill", xt.area("blocker") === "vitre-ext-bar");

  // ---- 6. remove, confirmed in place ----
  const removeLink = () => [...(card("popup")?.querySelectorAll(".vs-link") ?? [])].find((l) => l.textContent === "Remove");
  press(removeLink());
  await xt.waitFor(() => card("popup")?.querySelector(".vx-confirm"), 3000);
  check("Remove asks in place", !!card("popup")?.querySelector(".vx-confirm") && /Remove Test Popup\?/.test(card("popup").textContent));
  await capture("settings-2-remove-confirm");
  press([...card("popup").querySelectorAll(".vx-confirm .vs-btn")].find((x) => x.textContent === "Remove"));
  await xt.waitFor(async () => !(await xt.AddonManager.getAddonByID(xt.id("popup"))), 6000);
  check("removed", !(await xt.AddonManager.getAddonByID(xt.id("popup"))));
  await xt.waitFor(() => !card("popup"), 3000);

  // ---- 6b. "Remove extension…" from a pinned button's menu asks here too ----
  settings.close?.();
  await sleep(400);
  rows = null;
  const pb = xt.button("pin1");
  const pr = pb.getBoundingClientRect();
  pb.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, view: window, button: 2, clientX: pr.left + 14, clientY: pr.top + 14 }));
  await xt.waitFor(() => rows, 3000);
  menus.close();
  rows.find((r) => r.label === "&Remove extension…").run();
  await xt.waitFor(() => card("pin1")?.querySelector(".vx-confirm"), 4000);
  check("menu Remove opens Settings › Extensions with the confirmation waiting", !!card("pin1")?.querySelector(".vx-confirm") && document.activeElement?.textContent === "Remove", document.activeElement?.textContent);
  press([...card("pin1").querySelectorAll(".vx-confirm .vs-btn")].find((x) => x.textContent === "Cancel"));
  await xt.waitFor(() => !card("pin1")?.querySelector(".vx-confirm"), 3000);
  check("Cancel keeps it", !!(await xt.AddonManager.getAddonByID(xt.id("pin1"))));

  // ---- 6c. options: their own tab (open_in_tab), or Firefox's inline page in about:addons ----
  settings.open("extensions");
  await xt.waitFor(() => card("pin1"), 3000);
  const optionsOf = (name) => [...(card(name)?.querySelectorAll(".vs-link") ?? [])].find((l) => l.textContent === "Options");
  check("Options only where the extension has an options page", !optionsOf("blocker") && !optionsOf("pin1"));
  await xt.install("badge");
  await xt.waitFor(() => optionsOf("badge"), 4000);
  const tabsBefore = gBrowser.tabs.length;
  press(optionsOf("badge"));
  await xt.waitFor(() => gBrowser.selectedBrowser.currentURI.spec.startsWith("about:addons"), 6000);
  check("inline options open in about:addons at the extension's preferences", gBrowser.selectedBrowser.currentURI.spec.startsWith("about:addons"), gBrowser.selectedBrowser.currentURI.spec);
  check("Settings closed when the options opened", settings.isOpen?.() === false);
  if (gBrowser.selectedBrowser.currentURI.spec.startsWith("about:addons")) gBrowser.removeTab(gBrowser.selectedTab);
  await sleep(500);
  await xt.install("popup");
  settings.open("extensions");
  await xt.waitFor(() => optionsOf("popup"), 4000);
  await sleep(600); // the install's events re-render the page: click the settled card
  const isOptions = () => gBrowser.selectedBrowser.currentURI.spec.startsWith("moz-extension:") && gBrowser.selectedBrowser.currentURI.spec.endsWith("/options.html");
  for (let i = 0; i < 3 && !isOptions(); i++) {
    const link = optionsOf("popup");
    if (link) {
      link.scrollIntoView({ block: "center" }); // the last card is below the fold of the panel
      await sleep(200);
      press(link);
    }
    await xt.waitFor(isOptions, 3000);
  }
  check("tab options open the extension's page in a tab (extension process)", isOptions() && gBrowser.selectedBrowser.remoteType === "extension" && gBrowser.tabs.length === tabsBefore + 1, { url: gBrowser.selectedBrowser.currentURI.spec, remoteType: gBrowser.selectedBrowser.remoteType });
  if (isOptions()) gBrowser.removeTab(gBrowser.selectedTab);
  await sleep(500);
  settings.open("extensions");
  await xt.waitFor(() => card("pin1"), 3000);

  // ---- 7. check for updates (temporary installs never update) ----
  const checkButton = () => [...page().querySelectorAll(".vs-btn")].find((x) => /Check for updates|Checking/.test(x.textContent));
  press(checkButton());
  const status = await xt.waitFor(() => { const s = page()?.querySelector(".vx-status")?.textContent; return s && /up to date|Nothing to check|updated|review|could not/.test(s) ? s : null; }, 15000);
  check("check for updates reports (temporary add-ons never update)", status === "Nothing to check", status);

  // ---- 8. a parked review: Vitre's dot on the button, the review menu, the page row ----
  // The update path ExtensionsUI parks (webextension-update-permission-prompt) with a real add-on;
  // resolve/reject stand in for the install (tests/extensions/update.js runs the real download).
  settings.close?.();
  await sleep(400);
  const addon = await xt.AddonManager.getAddonByID(xt.id("blocker"));
  let answered = null;
  Services.obs.notifyObservers({ wrappedJSObject: { addon, permissions: { permissions: ["history"], origins: [] }, install: {}, resolve: () => (answered = "yes"), reject: () => (answered = "no") } }, "webextension-update-permission-prompt");
  await xt.waitFor(() => sys.pending().length === 1, 4000);
  await sleep(300);
  check("the review is pending", sys.pending()[0]?.kind === "update" && sys.pending()[0]?.id === xt.id("blocker"), sys.pending());
  check("Vitre's dot on the extensions button", xt.extButton().classList.contains("vx-attention") && /needs your review/.test(xt.extButton().getAttribute("data-tip")), xt.extButton().getAttribute("data-tip"));
  const dot = getComputedStyle(xt.extButton(), "::after");
  log("dot", dot.content, dot.width, dot.backgroundColor);
  await capture("settings-3-review-indicator");
  rows = null;
  spike.click(xt.extButton());
  await xt.waitFor(() => rows, 3000);
  await sleep(400);
  log("review menu", labels());
  check("left click while a review waits: the review menu", labels()[0] === "Review update for Test Blocker…" && labels().includes("Extension &settings"), labels());
  await capture("settings-4-review-menu");
  menus?.close();
  settings.open("extensions");
  await xt.waitFor(() => [...(page()?.querySelectorAll(".vs-h2") ?? [])].some((h) => h.textContent === "Waiting for your review"), 4000);
  await sleep(500);
  check("Settings lists it under 'Waiting for your review'", [...page().querySelectorAll(".vs-h2")].some((h) => h.textContent === "Waiting for your review"));
  await capture("settings-5-review-row");
  log("answered (not reviewed in this test)", answered);

  // ---- 9. an add-on another program installed (ExtensionsUI.sideloaded) is listed the same way ----
  // TEST-ONLY: the harness auto-enables sideloads (extensions.autoDisableScopes=0), so one is
  // simulated by putting an installed add-on into ExtensionsUI's set, as _checkForSideloaded does.
  const { ExtensionsUI } = ChromeUtils.importESModule("resource:///modules/ExtensionsUI.sys.mjs");
  const side = await xt.AddonManager.getAddonByID(xt.id("pin1"));
  ExtensionsUI.sideloaded.add(side);
  ExtensionsUI._updateNotifications();
  await xt.waitFor(() => sys.pending().some((r) => r.kind === "sideload"), 3000);
  check("a sideloaded add-on is pending as 'sideload'", sys.pending().some((r) => r.kind === "sideload" && r.id === xt.id("pin1")), sys.pending().map((r) => r.kind + " " + r.id));
  await xt.waitFor(() => page()?.textContent.includes("Another program added it"), 3000);
  check("Settings explains it", !!page()?.textContent.includes("Another program added it"));
  settings.close?.();
  await sleep(300);
  rows = null;
  spike.click(xt.extButton());
  await xt.waitFor(() => rows, 3000);
  check("the review menu lists both", labels().includes("Review update for Test Blocker…") && labels().includes("Review Test Pin One…"), labels());
  menus?.close();
  ExtensionsUI.sideloaded.delete(side);
  ExtensionsUI._updateNotifications();
});
