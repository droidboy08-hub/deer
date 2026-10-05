// Install flow from a web page: every add-on doorhanger hangs from Vitre's bar.
//   python tests/extensions/runx.py --test tests/extensions/install.js --name extensions-install --app build-extensions --timeout 200
// Order on 157 (verifier correction 6): addon-progress (download) -> addon-install-blocked
// ("Continue to installation") -> addon-webext-permissions ("Add") -> "<name> was added" (app-menu
// doorhanger). Then the release build's refusal of an unsigned package (addon-install-failed).
// Read-only at the end: the real addons.mozilla.org listing of uBlock Origin under the shell
// (navigator.mozAddonManager present, Add to Firefox offered); nothing is clicked or downloaded there.
//
// TEST-ONLY: the release runtime installs only Mozilla-signed add-ons; the local test package is
// unsigned, so this script replaces XPIDatabase.mustSign for the first part (as the verifier's
// v-install-flow.js). Vitre itself never does this (no signing waiver).
/* global spike, gBrowser, Services, ChromeUtils, PopupNotifications, PanelUI, xt, Cu */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  const { XPIExports } = ChromeUtils.importESModule("resource://gre/modules/addons/XPIExports.sys.mjs");
  const mustSign = XPIExports.XPIDatabase.mustSign;
  XPIExports.XPIDatabase.mustSign = () => false; // TEST-ONLY, see the header

  await xt.nav(xt.page("/install.html"));
  await sleep(500);
  const doorhanger = () => {
    const n = PopupNotifications.panel.firstElementChild;
    return PopupNotifications.panel.state === "open" && n ? n : null;
  };
  const describe = (n) => ({
    id: n.getAttribute("popupid"),
    label: n.getAttribute("label"),
    primary: n.button?.label,
    anchor: PopupNotifications.panel.anchorNode?.className || PopupNotifications.panel.anchorNode?.id,
    inCluster: !!PopupNotifications.panel.anchorNode?.closest?.(".vx-cluster"),
    rect: xt.rect(PopupNotifications.panel),
  });
  const wait = (fn, ms = 15000) => xt.waitFor(() => { xt.keepActive(); return fn(); }, ms, 200);
  // Doorhanger buttons ignore clicks for 500 ms after they show (security.notification_enable_delay).
  const press = async (button) => {
    const note = button.closest("popupnotification");
    for (let i = 0; i < 12; i++) {
      await sleep(700);
      xt.keepActive();
      button.click();
      await sleep(300);
      if (!note.isConnected || note.hidden || PopupNotifications.panel.firstElementChild !== note || PopupNotifications.panel.state !== "open") return true;
    }
    return false;
  };
  const extButton = xt.rect(xt.extButton());
  log("extensions button", extButton);

  // ---- 1. the link: download, "Continue to installation" ----
  gBrowser.selectedBrowser.fixupAndLoadURIString(xt.page("/xpi/blocker.xpi"), {
    triggeringPrincipal: Services.scriptSecurityManager.createContentPrincipalFromOrigin(xt.SITE),
    hasValidUserGestureActivation: true,
  });
  let n = await wait(() => { const d = doorhanger(); return d && d.getAttribute("popupid") !== "addon-progress" ? d : null; });
  log("doorhanger 1", n ? describe(n) : "none");
  check("install blocked prompt hangs from the extensions button in the pill", !!n && n.getAttribute("popupid") === "addon-install-blocked" && describe(n).inCluster, n && describe(n));
  const doorTop = (r) => r.y + 4; // the panel's shadow margin
  check("it opens 8 px under the pill (visible top 64), right edge on the extensions button's", !!n && Math.abs(doorTop(describe(n).rect) - 64) <= 2 && Math.abs(describe(n).rect.r - 4 - xt.rect(xt.extButton()).r) <= 2, n && describe(n).rect);
  await capture("install-1-continue");

  // ---- 2. permissions ----
  if (n) await press(n.button);
  n = await wait(() => { const d = doorhanger(); return d && d.getAttribute("popupid") === "addon-webext-permissions" ? d : null; });
  await sleep(600);
  log("doorhanger 2", n ? describe(n) : "none", "text", n?.textContent.replace(/\s+/g, " ").trim().slice(0, 200));
  check("permission prompt hangs from the extensions button", !!n && describe(n).inCluster && Math.abs(doorTop(describe(n).rect) - 64) <= 2, n && describe(n));
  await capture("install-2-permissions");

  // ---- 3. "was added" ----
  if (n) await press(n.button);
  const added = await wait(() => PanelUI.notificationPanel.state === "open" && [...PanelUI.notificationPanel.children].find((c) => !c.hidden));
  await sleep(700);
  const ap = PanelUI.notificationPanel;
  log("added notice", added?.id, "anchor", ap.anchorNode?.className, "rect", xt.rect(ap), "ext button", xt.rect(xt.extButton()));
  check("'was added' notice hangs from the extensions button, 8 px under the pill", !!added && ap.anchorNode?.classList?.contains("vx-hang") && Math.abs(xt.rect(ap).y + 4 - 64) <= 2 && Math.abs(xt.rect(ap).r - 4 - xt.rect(xt.extButton()).r) <= 2, xt.rect(ap));
  const installed = await xt.AddonManager.getAddonByID(xt.id("blocker"));
  check("installed for real (not temporary)", !!installed && !installed.temporarilyInstalled);
  check("its button landed pinned in the pill", xt.area("blocker") === "vitre-ext-bar" && !!xt.button("blocker"));
  await capture("install-3-added");
  added?.button?.click();
  await xt.closePopups();
  await capture("install-4-installed");

  // ---- 4. the release build refuses an unsigned package: the failure hangs from the bar too ----
  XPIExports.XPIDatabase.mustSign = mustSign;
  await xt.nav(xt.page("/install.html?again"));
  gBrowser.selectedBrowser.fixupAndLoadURIString(xt.page("/xpi/popup.xpi"), {
    triggeringPrincipal: Services.scriptSecurityManager.createContentPrincipalFromOrigin(xt.SITE),
    hasValidUserGestureActivation: true,
  });
  n = await wait(() => { const d = doorhanger(); return d && /addon-install-failed|addon-install-blocked/.test(d.getAttribute("popupid")) ? d : null; });
  if (n?.getAttribute("popupid") === "addon-install-blocked") {
    await press(n.button);
    n = await wait(() => { const d = doorhanger(); return d && d.getAttribute("popupid") === "addon-install-failed" ? d : null; });
  }
  await sleep(500);
  log("unsigned", n ? describe(n) : "none", n?.textContent.replace(/\s+/g, " ").trim().slice(0, 160));
  check("unsigned package refused, the failure doorhanger hangs from the bar", !!n && n.getAttribute("popupid") === "addon-install-failed" && describe(n).inCluster, n && describe(n));
  await capture("install-5-unsigned-refused");
  PopupNotifications.panel.hidePopup();
  await xt.closePopups();

  // ---- 5. Home: no cluster drawn, the doorhanger falls back to the pill ----
  // (covered by the core's doorhanger hook: a hidden requested anchor becomes the pill)

  // ---- 6. read-only: the real AMO listing (skipped offline) ----
  if (Services.env.get("VITRE_AMO") !== "0") {
    const url = "https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/";
    gBrowser.selectedBrowser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    const loaded = await xt.waitFor(() => gBrowser.selectedBrowser.currentURI.spec.startsWith("https://addons.mozilla.org/") && !gBrowser.selectedBrowser.webProgress?.isLoadingDocument, 25000, 250);
    await sleep(3000);
    if (loaded) {
      log("AMO", gBrowser.selectedBrowser.currentURI.spec, "remoteType", gBrowser.selectedBrowser.remoteType, "title", gBrowser.selectedTab.label);
      check("AMO listing loads in the privileged Mozilla process (mozAddonManager's home)", gBrowser.selectedBrowser.remoteType === "privilegedmozilla", gBrowser.selectedBrowser.remoteType);
      await capture("install-6-amo-listing");
    } else {
      log("AMO not reachable: read-only check skipped");
    }
  }
});
