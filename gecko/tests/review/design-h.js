// Design-fidelity review, probe H: the same Firefox-owned surfaces with
//   --pref security.certerrors.felt-privacy-v1=false --pref browser.nova.enabled=false
// to see whether two product defaults remove the mascot illustration and the violet accent.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const settled = async (win = window) => { await waitFor(() => win.vitre.bar.state.settled, { timeout: 9000, what: "settle" }); await sleep(150); };
  const inner = async (w, h, win = window) => {
    win.resizeTo(w + (win.outerWidth - win.innerWidth), h + (win.outerHeight - win.innerHeight));
    win.moveTo(30, 30);
    await sleep(600);
  };
  const go = async (url, t = b.active(), wait = 30000) => {
    b.navigate(t, url);
    await waitFor(() => !t.loading && t.url !== "about:blank", { timeout: wait, what: "load " + url }).catch((e) => log("NOTE " + e));
    await sleep(1200);
    await settled();
  };
  await inner(1440, 900);
  await spike.activate();
  log("prefs " + JSON.stringify({ nova: Services.prefs.getBoolPref("browser.nova.enabled", false), felt: Services.prefs.getBoolPref("security.certerrors.felt-privacy-v1", false) }));
  await go("http://nothing-here.invalid/", b.active(), 20000);
  await spike.capture("h1-error-page");
  const page = "data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><meta charset=utf-8><title>Alert</title><body style='margin:0;background:#f3eee4;font:16px Segoe UI'><p style='margin:140px 40px'>A page that calls alert().</p><script>setTimeout(()=>alert('Saved your changes.'),600)</scr" + "ipt>");
  b.navigate(b.active(), page);
  await sleep(2500);
  await spike.capture("h2-alert");
  spike.press("Escape");
  await sleep(500);
  const priv = await spike.openWindow({ private: true });
  await sleep(1500);
  await inner(1440, 900, priv);
  await priv.spike.capture("h3-private");
  priv.close();
  await sleep(500);
});
