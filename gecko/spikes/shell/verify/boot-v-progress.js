// VERIFY (claim 18): is there a real load FRACTION to drive the pill's load line? The spike's log
// only ever shows --progress 0.1. Record every onProgressChange the tabs progress listener gets,
// and the values the bar put into --progress, for a few real pages.
//   python tools/run.py --boot spikes/shell/verify/boot-v-progress.js --name shell-verify-x-progress --timeout 120 --out spikes/shell/verify/out
/* global spike, vt, Services, gBrowser, VitreUI */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    vt.install();
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    const tab = gBrowser.selectedTab;
    const item = () => VitreUI.bar.items.get(tab);
    for (const url of ["https://en.wikipedia.org/wiki/Glass", "https://www.mozilla.org/en-US/", "https://github.com/mozilla"]) {
      const calls = [];
      const barValues = new Set();
      const listener = {
        onProgressChange(browser, webProgress, request, curSelf, maxSelf, curTotal, maxTotal) {
          if (browser !== tab.linkedBrowser) return;
          calls.push(`${curTotal}/${maxTotal}${webProgress ? (webProgress.isTopLevel ? "" : "(sub)") : "(no webProgress)"}`);
        },
      };
      gBrowser.addTabsProgressListener(listener);
      const watch = setInterval(() => barValues.add(`${item().classList.contains("loading") ? "L" : "-"}${item().style.getPropertyValue("--progress")}`), 4);
      tab.linkedBrowser.fixupAndLoadURIString(url, { triggeringPrincipal: sys });
      await vt.until(() => tab.linkedBrowser.currentURI.spec.startsWith(url.slice(0, 20)) && !tab.hasAttribute("busy"), 30000);
      await spike.sleep(800);
      clearInterval(watch);
      gBrowser.removeTabsProgressListener(listener);
      const fr = calls.map((c) => c.split("/").map((v) => parseInt(v, 10))).filter(([c, m]) => m > 0).map(([c, m]) => Math.round((c / m) * 100));
      spike.log(url, { onProgressChangeCalls: calls.length, withKnownTotal: fr.length, fractionsPercent: [...new Set(fr)].slice(0, 20), sample: calls.slice(0, 6), barProgressValuesSeen: [...barValues] });
    }
  });
}
