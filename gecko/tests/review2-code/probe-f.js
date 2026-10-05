// Reviewer's probe F (review2-code; not a product test): which cookies Vitre's take-over re-request
// carries compared with Firefox's own request, for a download a cross-site page starts.
//   R2_PROBE=probe-f.js python tests/review2-code/run.py
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const base = Services.env.get("R2_BASE");
  const xsite = Services.env.get("R2_XSITE");
  const engine = b.sys("VitreDownloads");
  await spike.resize(1280, 800);
  await spike.activate();
  await engine.ready;
  const serverLog = async () => (await fetch(base + "log")).json();
  const frame = (browser, fn, args = []) =>
    new Promise((resolve) => {
      const mm = browser.messageManager;
      const name = "r2f-" + Date.now();
      mm.addMessageListener(name, function on(m) {
        mm.removeMessageListener(name, on);
        resolve(m.data);
      });
      const body = `(() => { let out; try { out = (${fn.toString()})(...${JSON.stringify(args)}); } catch (e) { out = { error: String(e) }; } sendAsyncMessage(${JSON.stringify(name)}, out); })()`;
      mm.loadFrameScript("data:application/javascript," + encodeURIComponent(body), false);
    });
  const tab = b.active();
  const go = async (url) => {
    b.navigate(tab, url);
    await waitFor(() => tab.url === url && !tab.loading, { timeout: 15000, what: url });
    await sleep(400);
  };
  // First-party visit: the cross-site host sets a SameSite=Strict and a SameSite=Lax cookie.
  await go(xsite + "setcookie");
  await go(base + "page.html");

  const run = async (tag, how) => {
    const before = engine.takeovers.length;
    const mark = (await serverLog()).length;
    await frame(tab.browser, (h, url) => {
      const doc = content.document;
      if (h === "iframe") {
        const f = doc.createElement("iframe");
        f.src = url;
        doc.body.append(f);
      } else {
        content.location.href = url;
      }
      return true;
    }, [how, xsite + "file?name=" + tag + ".bin&tag=" + tag]);
    let taken = null;
    try {
      taken = await waitFor(() => engine.takeovers.length > before && engine.takeovers[engine.takeovers.length - 1], { timeout: 15000, what: "take-over " + tag });
      await waitFor(() => engine.list(false).find((x) => x.url.includes("tag=" + tag) && ["completed", "failed"].includes(x.state)), { timeout: 20000, what: tag });
    } catch (e) {
      log("R2 F " + tag + ": " + e);
    }
    const reqs = (await serverLog()).slice(mark).filter((x) => x.path.includes("tag=" + tag));
    log("R2 F " + how + " download started by the 127.0.0.1 page (no user gesture), " + (taken ? taken.action : "no take-over") + "; requests to localhost: " + JSON.stringify(reqs.map((x) => [x.range || "(Firefox's own request)", x.cookie || "(no cookies)"])));
  };
  await run("fnav", "script navigation");
  await go(base + "page.html");
  await run("fframe", "iframe");
  await sleep(300);
});
