// Used by tests/core/idm.py. Does a download manager that hooks browsers by process name get in?
// Reports the hooked DLLs, fetches two "download-looking" addresses from the local test server and
// lets Firefox download one through a tab, then captures the window (IDM draws a bar on hooked
// browsers).
/* global spike, Services, ChromeUtils, gBrowser */
spike.main(async () => {
  const base = Services.env.get("VITRE_IDM_SERVER");
  const tag = Services.env.get("VITRE_IDM_TAG");
  await spike.resize(1200, 760);
  await spike.modules("idm");

  for (const path of ["/vitre-idm-test.bin", "/vitre-idm-test.zip"]) {
    try {
      const r = await fetch(base + path, { cache: "no-store" });
      const bytes = (await r.arrayBuffer()).byteLength;
      spike.log("FETCH " + path + " status=" + r.status + " bytes=" + bytes);
    } catch (e) {
      spike.log("FETCH " + path + " failed: " + e);
    }
  }

  // A real page download: a media page, then a click-like navigation to an attachment.
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const list = await Downloads.getList(Downloads.ALL);
  const seen = [];
  await list.addView({ onDownloadAdded: (d) => seen.push(d), onDownloadChanged() {} });
  const tab = gBrowser.selectedTab;
  gBrowser.selectedBrowser.fixupAndLoadURIString(base + "/media.html", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  await spike.sleep(2500);
  gBrowser.selectedBrowser.fixupAndLoadURIString(base + "/vitre-idm-test.mp4?as=download", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  let done = null;
  for (let i = 0; i < 100 && !done; i++) {
    done = seen.find((d) => d.succeeded || d.error);
    await spike.sleep(100);
  }
  spike.log("DOWNLOAD " + (done ? "succeeded=" + done.succeeded + " bytes=" + done.currentBytes + " error=" + (done.error ? done.error.message : "none") : "never reached Firefox's download list") + " (" + seen.length + " in list)");
  gBrowser.selectedTab = tab;
  await spike.sleep(1500);
  await spike.capture("idm-" + tag);
});
