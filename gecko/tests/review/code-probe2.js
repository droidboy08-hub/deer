// Code-review probes, part 2 (reviewer's own; not a product test).
//   python tests/review/code_run.py extra code-probe2.js
/* global spike, gBrowser, Services, ChromeUtils */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  const page = (html) => "data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><meta charset=utf-8><title>probe</title>" + html);
  await spike.resize(1280, 800);
  await spike.activate();

  // ---- Q1: b.page(tab).query() when the page goes away before it answers ----
  for (const how of ["close the tab", "navigate away"]) {
    try {
      const t = b.newTab(page("<body>query " + how), { background: true });
      await waitFor(() => !t.loading && t.url.startsWith("data:"), { timeout: 8000, what: "probe page" });
      await sleep(300);
      const ok = await b.page(t).query("core:ping", 1);
      // A query nobody answers quickly: the actor answers after the event loop turn, the page is gone first.
      const p = b.page(t).query("core:ping", 2);
      if (how === "close the tab") b.closeTab(t);
      else t.browser.fixupAndLoadURIString("https://example.com/", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      let outcome;
      try {
        const v = await Promise.race([p, sleep(4000).then(() => "PENDING after 4 s")]);
        outcome = "resolved: " + JSON.stringify(v)?.slice(0, 80);
      } catch (e) {
        outcome = "REJECTED: " + e;
      }
      log("Q1 query answered normally first:", !!ok, "| then '" + how + "' with a query in flight ->", outcome);
      if (how !== "close the tab") b.closeTab(t);
    } catch (e) {
      log("Q1 threw " + e);
    }
  }

  // ---- Q2: page-message for a frame cannot be answered through b.page() ----
  try {
    const t = b.newTab(page("<body><iframe src='data:text/html,<body>inner'></iframe>"), { background: false });
    await waitFor(() => !t.loading && t.url.startsWith("data:"), { timeout: 8000, what: "frame page" });
    await sleep(500);
    const top = await b.page(t).query("core:ping", 0);
    const kids = t.browser.browsingContext.children.length;
    log("Q2 b.page(tab).query reaches:", top && top.isTop ? "the top document only" : top, "| frames in the tab:", kids, "| PageLink has no way to address one (send/query/sendAll only)");
    b.closeTab(t);
  } catch (e) {
    log("Q2 threw " + e);
  }

  log("PROBES2 DONE");
});
