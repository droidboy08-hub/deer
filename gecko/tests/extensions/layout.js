// A profile whose saved toolbar layout lists Firefox's extensions button in the nav-bar (owner's
// report, 2026-10-10: installing from addons.mozilla.org did nothing; their profile, copied from the
// old Vitre profile, had that entry). With it, Firefox's start-up step BrowserGlue._onWindowsRestored
// threw in BrowserUsageTelemetry.init ("Area toolbar-menubar not yet restored") before
// ExtensionsUI.init(), so no add-on prompt ever showed. Deer removes the entry at start
// (VitreStartup.repairToolbarState, before CustomizableUI reads the layout).
//   all.py runs it with that layout as a user pref (--pref browser.uiCustomization.state=...).
/* global spike, Services, ChromeUtils, CustomizableUI, Cc, gBrowser */
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const state = JSON.parse(Services.prefs.getStringPref("browser.uiCustomization.state", "{}"));
  const listed = Object.entries(state.placements || {}).filter(([, ids]) => ids.includes("unified-extensions-button")).map(([area]) => area);
  log("layout areas", Object.keys(state.placements || {}).join(","), "button listed in", JSON.stringify(listed));
  check("the test started from the stale layout (other areas kept)", (state.placements?.["unified-extensions-area"] || []).includes("ublock0_raymondhill_net-browser-action"), state.placements);
  check("Deer took the extensions button out of the saved layout", listed.length === 0, listed);
  check("CustomizableUI does not place the button in a toolbar", CustomizableUI.getPlacementOfWidget("unified-extensions-button") === null, CustomizableUI.getPlacementOfWidget("unified-extensions-button"));

  // Firefox's start-up step after the windows are restored ran to its end.
  const glue = Cc["@mozilla.org/browser/browserglue;1"].getService().wrappedJSObject;
  await waitFor(() => glue._windowsWereRestored, { timeout: 15000, what: "windows restored" });
  await sleep(1500);
  let observers = 0;
  for (const o of Services.obs.enumerateObservers("webextension-permission-prompt")) if (o) observers++;
  check("Firefox's add-on prompts are listening (ExtensionsUI.init ran)", observers >= 1, observers);
  const { BrowserUsageTelemetry } = ChromeUtils.importESModule("resource:///modules/BrowserUsageTelemetry.sys.mjs");
  check("the step before it did not throw (BrowserUsageTelemetry finished its init)", "widgetMap" in BrowserUsageTelemetry, Object.keys(BrowserUsageTelemetry).length);
  const button = document.getElementById("unified-extensions-button");
  check("the extensions button is in Deer's bar", !!button?.closest(".vx-cluster"), button?.parentElement?.className);
  log("tabs", gBrowser.tabs.length);
});
