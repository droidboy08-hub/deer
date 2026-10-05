// Reviewer's probe (review2-code; not a product test): evidence for the code/security review.
//   python tests/review2-code/run.py
// Blocks log "R2 <id> ..." lines; nothing here is a product assertion.
/* global spike, Services, Cc, Ci, ChromeUtils, gBrowser, IOUtils, PathUtils */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const base = Services.env.get("R2_BASE");
  const xsite = Services.env.get("R2_XSITE");
  const engine = b.sys("VitreDownloads");
  await spike.resize(1280, 800);
  await spike.activate();
  await engine.ready;

  const section = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      log("R2 " + name + " THREW " + e + " " + (e && e.stack ? e.stack.split("\n").slice(0, 2).join(" / ") : ""));
    }
  };
  const frame = (browser, fn, args = []) =>
    new Promise((resolve) => {
      const mm = browser.messageManager;
      const name = "r2-" + Date.now() + "-" + Math.round(Math.random() * 1e9);
      const timer = setTimeout(() => resolve({ error: "timeout" }), 10000);
      mm.addMessageListener(name, function on(m) {
        mm.removeMessageListener(name, on);
        clearTimeout(timer);
        resolve(m.data);
      });
      const body = `(() => { let out; try { out = (${fn.toString()})(...${JSON.stringify(args)}); } catch (e) { out = { error: String(e) }; } sendAsyncMessage(${JSON.stringify(name)}, out); })()`;
      mm.loadFrameScript("data:application/javascript," + encodeURIComponent(body), false);
    });
  const serverLog = async () => (await fetch(base + "log")).json();

  // Requests the engine makes for /file: their principals and Referer as Necko sees them.
  const seen = [];
  const observer = {
    observe(subject) {
      try {
        const ch = subject.QueryInterface(Ci.nsIHttpChannel);
        const url = ch.URI.spec;
        if (!url.includes("/file?")) return;
        const li = ch.loadInfo;
        let referer = "";
        try {
          referer = ch.getRequestHeader("Referer");
        } catch {
          referer = "(none)";
        }
        seen.push({
          url: url.replace(/^https?:\/\/[^/]+/, ""),
          triggeringSystem: !!li.triggeringPrincipal?.isSystemPrincipal,
          loading: li.loadingPrincipal ? (li.loadingPrincipal.isSystemPrincipal ? "system" : li.loadingPrincipal.origin) : "(none)",
          policyType: li.externalContentPolicyType,
          referer,
        });
      } catch {
        /* not http */
      }
    },
  };
  Services.obs.addObserver(observer, "http-on-modify-request");

  const tab = b.active();
  b.navigate(tab, base + "page.html");
  await waitFor(() => tab.url === base + "page.html" && !tab.loading, { timeout: 15000, what: "page" });
  await sleep(500);
  const dl = b.service("downloads");
  const finished = async (tag, ms = 20000) => {
    const v = await waitFor(() => engine.list(false).find((x) => x.url.includes("tag=" + tag) && ["completed", "failed", "cancelled"].includes(x.state)), { timeout: ms, what: "download " + tag });
    return v;
  };

  // ---- E. A Firefox download from a rel=noreferrer link, taken over: the Referer of Firefox's request vs Vitre's ----
  await section("E", async () => {
    const before = engine.takeovers.length;
    const mark = (await serverLog()).length;
    await frame(tab.browser, (href) => {
      const a = content.document.createElement("a");
      a.href = href;
      a.rel = "noreferrer";
      a.textContent = "noreferrer attachment";
      content.document.body.prepend(a);
      const r = a.getBoundingClientRect();
      for (const type of ["mousedown", "mouseup"]) content.synthesizeMouseEvent(type, r.left + 5, r.top + r.height / 2, { button: 0, clickCount: 1 }, {});
      return true;
    }, [xsite + "file?name=e.bin&tag=e"]);
    const taken = await waitFor(() => engine.takeovers.length > before && engine.takeovers[engine.takeovers.length - 1], { timeout: 20000, what: "take-over" });
    await finished("e");
    const reqs = (await serverLog()).slice(mark).filter((x) => x.path.includes("tag=e"));
    log("R2 E take-over (" + taken.action + ") of a rel=noreferrer link; requests the server saw: " + JSON.stringify(reqs.map((x) => [x.range || "(no range)", x.referer || "(no Referer)"])));
  });

  Services.obs.removeObserver(observer, "http-on-modify-request");
  await sleep(300);
});
