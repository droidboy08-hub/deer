// Instance A of the single-instance test (test-remote.py drives it). Logs every tab/window that
// appears while other launches hand their URLs over through Gecko's remoting.
/* global spike, gBrowser, Services, BrowserWindowTracker */
spike.main(async () => {
  await spike.loaded();
  const seen = new Set();
  const snapshot = () => {
    const out = [];
    let w = 0;
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      w++;
      for (const tab of win.gBrowser.tabs) out.push("w" + w + (win.PrivateBrowsingUtils?.isWindowPrivate(win) ? "(private)" : "") + ":" + tab.linkedBrowser.currentURI.spec);
    }
    return out;
  };
  spike.log("READY pid=" + Services.appinfo.processID + " app=" + Services.appinfo.name + " tabs=" + JSON.stringify(snapshot()));
  const seconds = Number(Services.env.get("VITRE_REMOTE_SECONDS") || 40);
  for (let i = 0; i < seconds * 4; i++) {
    await spike.sleep(250);
    for (const t of snapshot()) {
      if (!seen.has(t) && !t.endsWith(":about:blank")) {
        seen.add(t);
        spike.log("TAB " + t);
      }
    }
    if (await IOUtils.exists(PathUtils.join(spike.outDir, "stop"))) break;
  }
  spike.log("FINAL windows=" + [...Services.wm.getEnumerator("navigator:browser")].length + " tabs=" + JSON.stringify(snapshot()));
  await spike.capture("remote-final");
});
