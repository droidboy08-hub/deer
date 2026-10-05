// Robustness review: every error that reaches the browser console during an ordinary session,
// with and without Vitre (compare: --stock --env REVIEW_STOCK=1).
//   python tools/run.py --app build-review-robustness --test tests/review/robust-console.js --name review-robust-console --url https://example.com --timeout 200
//   python tools/run.py --stock --test tests/review/robust-console.js --name review-robust-console-stock --url https://example.com --timeout 200 --out tests/review/out-console-stock
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const stock = !window.vitre;
  const errors = [];
  const take = (m) => {
    try {
      if (!(m instanceof Ci.nsIScriptError) || m.flags & Ci.nsIScriptError.warningFlag) return;
      let stack = "";
      try {
        let f = m.stack;
        for (let i = 0; f && i < 10; i++, f = f.parent) stack += ` <- ${f.functionDisplayName || "?"}@${String(f.source).replace(/^.*\//, "")}:${f.line}`;
      } catch (e) {}
      errors.push({ message: m.errorMessage, source: m.sourceName, line: m.lineNumber, stack, time: m.timeStamp });
    } catch (e) {}
  };
  for (const m of Services.console.getMessageArray()) take(m);
  Services.console.registerListener({ observe: take, QueryInterface: ChromeUtils.generateQI(["nsIConsoleListener"]) });
  Services.obs.addObserver((subject) => {
    try {
      const ev = subject.wrappedJSObject;
      if (ev.level !== "error") return;
      errors.push({ message: "console.error: " + Array.from(ev.arguments || [], (a) => (a && a.message ? a.message : String(a))).join(" "), source: ev.filename, line: ev.lineNumber, stack: "" });
    } catch (e) {}
  }, "console-api-log-event");

  await spike.resize(1280, 800);
  await spike.activate();
  await spike.loaded();
  await sleep(1500);
  const load = (url, win = window) => new Promise((resolve) => {
    const br = win.gBrowser.selectedBrowser;
    br.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    setTimeout(resolve, 2500);
  });
  // An ordinary session: tabs, Home, the address field, a panel, a second window, a private one.
  if (!stock) {
    const b = window.vitre;
    spike.press("Ctrl+T");
    await sleep(800);
    spike.type("example.org");
    spike.press("Enter");
    await sleep(2500);
    spike.press("Ctrl+L");
    await sleep(300);
    spike.press("Escape");
    spike.press("Ctrl+H");
    await sleep(500);
    spike.press("Escape");
    spike.press("Ctrl+Tab");
    await sleep(300);
    b.run("zoomIn");
    await sleep(300);
    b.run("zoomReset");
    spike.press("Ctrl+W");
    await sleep(500);
  } else {
    gBrowser.addTrustedTab("https://example.org/");
    await sleep(2500);
    gBrowser.removeTab(gBrowser.selectedTab);
    await sleep(500);
  }
  try {
    window.PanelUI.show();
    await sleep(800);
    window.PanelUI.hide();
  } catch (e) {
    log("app menu: " + e);
  }
  await sleep(300);
  const w2 = await spike.openWindow();
  await sleep(1000);
  await load("https://example.com/?w2", w2);
  w2.close();
  const pw = await spike.openWindow({ private: true });
  await sleep(1000);
  await load("https://example.com/?pw", pw);
  pw.close();
  await sleep(1500);
  await load("https://nonexistent-host.invalid/");
  await sleep(2000);
  // Everything that was logged, once each.
  const seen = new Map();
  for (const e of errors) {
    const key = `${e.message}|${e.source}|${e.line}`;
    const have = seen.get(key);
    if (have) have.n++;
    else seen.set(key, { ...e, n: 1 });
  }
  for (const e of seen.values()) log(`CONSOLE${stock ? "[stock]" : ""} x${e.n} ${String(e.message).slice(0, 400)} @ ${e.source}:${e.line}${e.stack}`);
  log(`CONSOLE-SUMMARY${stock ? "[stock]" : ""} distinct=${seen.size} total=${errors.length}`);
  const ours = [...seen.values()].filter((e) => /chrome:\/\/vitre\//.test(e.source + e.message + e.stack));
  check(`${stock ? "[stock] " : ""}no console errors from Vitre's own code`, ours.length === 0, ours.map((e) => e.message));
});
