// A real update that asks for new permissions (verifier correction 8): Firefox parks it in
// ExtensionsUI.updates behind its hidden app-menu badge; Vitre shows its dot on the extensions
// button, lists it in Settings › Extensions, and its review opens Firefox's prompt (in about:addons,
// hanging from Vitre's bar). Accepting installs 2.0.
//   python tests/extensions/runx.py --test tests/extensions/update.js --name extensions-update --app build-extensions --timeout 240 --pref extensions.checkUpdateSecurity=false
// The update manifest and packages are on the local test site (make-extensions.py: upd 1.0 -> 2.0).
// TEST-ONLY: the packages are unsigned, so XPIDatabase.mustSign is replaced (see install.js).
// Captures: update-1-indicator, update-2-prompt, update-3-updated.
/* global spike, gBrowser, Services, ChromeUtils, PopupNotifications, xt */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  const sys = b.sys("VitreExtensions");
  await spike.resize(1280, 800);
  await spike.activate();
  const { XPIExports } = ChromeUtils.importESModule("resource://gre/modules/addons/XPIExports.sys.mjs");
  XPIExports.XPIDatabase.mustSign = () => false; // TEST-ONLY
  await xt.nav(xt.page());

  const first = await xt.AddonManager.getInstallForFile(xt.file("build", "www", "xpi", "upd-1.0.xpi"), "application/x-xpinstall");
  await first.install();
  await xt.waitFor(() => xt.button("upd"), 6000);
  const version = async () => (await xt.AddonManager.getAddonByID(xt.id("upd")))?.version;
  check("1.0 installed, pinned", (await version()) === "1.0" && xt.area("upd") === "vitre-ext-bar");

  // Vitre's "Check for updates" (Settings › Extensions) finds 2.0, which asks for more: parked.
  const result = await sys.checkForUpdates();
  log("check", result, "pending", sys.pending().map((r) => r.kind + " " + r.name));
  check("the check found it and it waits for a review", result.review === 1 && sys.pending().length === 1 && (await version()) === "1.0", result);
  await sleep(300);
  check("Vitre's dot on the extensions button", xt.extButton().classList.contains("vx-attention"));
  check("Firefox's own signal is only the hidden app-menu badge", window.PanelUI?.menuButton?.getAttribute("badge-status") === "addon-alert");
  await capture("update-1-indicator");

  // Review: about:addons opens and Firefox's prompt hangs from the bar.
  sys.review(sys.pending()[0], gBrowser);
  const n = await xt.waitFor(() => {
    xt.keepActive();
    const d = PopupNotifications.panel.firstElementChild;
    return PopupNotifications.panel.state === "open" && d?.getAttribute("popupid") === "addon-webext-permissions" ? d : null;
  }, 15000, 200);
  await sleep(700);
  log("prompt", n?.textContent.replace(/\s+/g, " ").trim().slice(0, 160), "tab", gBrowser.selectedBrowser.currentURI.spec, "anchor", PopupNotifications.panel.anchorNode?.className, "rect", xt.rect(PopupNotifications.panel));
  check("review opens Firefox's update prompt, hanging from the extensions button", !!n && PopupNotifications.panel.anchorNode?.classList?.contains("vx-door") && Math.abs(xt.rect(PopupNotifications.panel).y + 4 - 64) <= 2);
  await capture("update-2-prompt");
  if (n) {
    for (let i = 0; i < 12; i++) {
      await sleep(700);
      xt.keepActive();
      n.button.click();
      await sleep(300);
      if (!n.isConnected || PopupNotifications.panel.state !== "open") break;
    }
  }
  await xt.waitFor(async () => (await version()) === "2.0", 10000);
  await sleep(500);
  check("accepted: 2.0 installed, nothing left to review, dot gone", (await version()) === "2.0" && sys.pending().length === 0 && !xt.extButton().classList.contains("vx-attention"), { version: await version(), pending: sys.pending().length });
  check("still pinned after the update", xt.area("upd") === "vitre-ext-bar");
  await capture("update-3-updated");
});
