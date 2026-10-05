// Robustness review: restart with 40 tabs (a selected Home tab, pinned tabs, a second window),
// then a content-process crash in the restored session.
//   python tools/run.py --app build-review-robustness --test tests/review/robust-session.js --name review-robust-session --timeout 400
// Run 1 builds the session and restarts in place; run 2 checks what came back and kills a content
// process (its own child, through taskkill).
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/robust-lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const R = window.R;
  const b = window.vitre;
  const $ = (s, d = document) => d.querySelector(s);
  R.consoleStart();
  await spike.resize(1280, 800);
  await spike.activate();
  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  const tabPage = (i) => R.page("Session tab " + i, `<p style='margin:120px 40px'>Session tab ${i}</p>`, `hsl(${(i * 53) % 360} 35% 92%)`);

  if (spike.run === 1) {
    await R.load("https://example.com/");
    for (let i = 2; i <= 38; i++) b.newTab(tabPage(i), { background: true, index: i - 1 });
    b.newTab("https://example.org/", { background: true, index: 38 });
    await waitFor(() => b.tabs.length === 39 && b.tabs.every((t) => !t.loading), { timeout: 90000, what: "39 tabs loaded" });
    gBrowser.pinTab(b.tabs[1].node);
    gBrowser.pinTab(b.tabs[2].node);
    await sleep(300);
    b.focusPage();
    spike.press("Ctrl+T"); // Home next to the active tab (example.com, now at index 2), selected
    await waitFor(() => b.tabs.length === 40 && b.active().url === "about:vitre-home", { timeout: 15000, what: "Home tab" });
    spike.press("Escape");
    const home = b.active();
    b.activate(b.tabs[2]); // example.com
    await sleep(300);
    b.run("zoomIn");
    await sleep(500);
    b.activate(home);
    await sleep(300);
    const w2 = await spike.openWindow();
    await w2.spike.resize(900, 600);
    await R.load("https://example.com/?w2", w2.vitre.active(), w2);
    w2.vitre.newTab(tabPage(101), { background: true });
    w2.vitre.newTab(tabPage(102), { background: true });
    await waitFor(() => w2.vitre.tabs.length === 3 && w2.vitre.tabs.every((t) => !t.loading), { timeout: 30000, what: "second window tabs" });
    const pw = await spike.openWindow({ private: true });
    await R.load(tabPage(201), pw.vitre.active(), pw);
    await sleep(1000);
    log("before restart:", { tabs: b.tabs.length, active: b.tabs.indexOf(b.active()), pinned: b.tabs.filter((t) => t.pinned).length, w2: w2.vitre.tabs.length, private: pw.vitre.tabs.length });
    check("run 1: 40 tabs, Home selected at index 3, two pinned, a second window with 3 tabs, a private window", b.tabs.length === 40 && b.active().url === "about:vitre-home" && b.tabs.indexOf(b.active()) === 3 && b.tabs[0].pinned && b.tabs[1].pinned && w2.vitre.tabs.length === 3, [b.tabs.length, b.tabs.indexOf(b.active())]);
    await spike.capture("session-1-before");
    log("restarting");
    await spike.restart();
    return;
  }

  // ---- run 2 ----
  log("run 2: tabs at script start", b.tabs.length, "windows", Shell.windows.size);
  await waitFor(() => b.tabs.length === 40, { timeout: 30000, what: "40 restored tabs" }).catch(() => {});
  await sleep(1500);
  const wins = [...Shell.windows];
  const main = wins.find((w) => w.vitre.tabs.length === 40) || window;
  const mb = main.vitre;
  const other = wins.find((w) => w !== main && !w.vitre.isPrivate);
  log("restored:", { windows: wins.length, main: mb.tabs.length, other: other?.vitre.tabs.length, private: wins.filter((w) => w.vitre.isPrivate).length });
  check("run 2: both normal windows are back, the private window is not", wins.length === 2 && !!other && other.vitre.tabs.length === 3 && !wins.some((w) => w.vitre.isPrivate), { windows: wins.length, other: other?.vitre.tabs.length });
  check("run 2: 40 tabs in order, Home selected at index 3, pinned tabs first", mb.tabs.length === 40 && mb.active()?.url === "about:vitre-home" && mb.tabs.indexOf(mb.active()) === 3 && mb.tabs[0].pinned && mb.tabs[1].pinned && mb.tabs[2].url === "https://example.com/" && mb.tabs[39].url === "https://example.org/", { active: mb.tabs.indexOf(mb.active()), url: mb.active()?.url, pinned: mb.tabs.slice(0, 3).map((t) => t.pinned), t39: mb.tabs[39]?.url });
  const deferred = mb.tabs.filter((t) => t.deferred);
  const untitled = deferred.filter((t) => !t.title);
  check("run 2: unselected tabs are deferred and carry their titles", deferred.length >= 36 && untitled.length === 0, { deferred: deferred.length, untitled: untitled.map((t) => t.url.slice(0, 30)) });
  check("run 2: model, gBrowser and bar agree", R.consistent(main).length === 0, R.consistent(main));
  await waitFor(() => mb.bar.state.settled, { timeout: 6000 }).catch(() => {});
  await main.spike.capture("session-2-restored");
  // A deferred tab far from the active one: Ctrl+9 brings it in and loads it.
  main.spike.press("Ctrl+9");
  await waitFor(() => !mb.active().deferred && !mb.active().loading && mb.active().url === "https://example.org/", { timeout: 30000, what: "last tab loading" }).catch(() => {});
  check("run 2: the last (deferred) tab loads on first show and is drawn", mb.active().url === "https://example.org/" && !mb.active().deferred && !!$("#vitre-bar .item.tab.active", main.document), [mb.active().url, mb.active().deferred]);
  const ex = mb.tabs[2];
  mb.activate(ex);
  await waitFor(() => !ex.deferred && !ex.loading, { timeout: 30000, what: "example.com loading" }).catch(() => {});
  await sleep(800);
  check("run 2: the zoom set before the restart is back on example.com (site-specific zoom)", ex.zoom > 1.05, ex.zoom);

  // ---- a content process crash ----
  log("--- crash");
  const victim = ex;
  const pid = victim.browser.frameLoader?.remoteTab?.osPid;
  const sameProcess = mb.tabs.filter((t) => t !== victim && !t.deferred && t.browser.frameLoader?.remoteTab?.osPid === pid);
  log("killing content process", pid, "which also hosts", sameProcess.map((t) => t.title));
  const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  const exe = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  exe.initWithPath("C:\\Windows\\System32\\taskkill.exe");
  proc.init(exe);
  proc.run(true, ["/F", "/PID", String(pid)], 3);
  await waitFor(() => victim.crashed || victim.node.hasAttribute("crashed"), { timeout: 10000, what: "crashed tab" }).catch(() => {});
  await sleep(1500);
  const host = $("#vitre-bar .item.active .host", main.document)?.textContent;
  log("after the crash:", { crashed: victim.crashed, url: victim.url, title: victim.title, host, theme: victim.theme, rootTheme: mb.root.className });
  check("crash: the model marks the tab crashed", victim.crashed === true);
  check("crash: the pill does not show the about:tabcrashed address", !/about:tabcrashed/.test(host || ""), host);
  await main.spike.capture("session-3-crashed");
  // Ctrl+R on the crashed tab restores it.
  mb.focusPage();
  await sleep(200);
  main.spike.press("Ctrl+R");
  const revived = await waitFor(() => !victim.crashed && !victim.loading && victim.url === "https://example.com/" && victim.title === "Example Domain", { timeout: 15000, what: "revived tab" }).then(() => true, () => false);
  log("after Ctrl+R on the crashed tab:", { revived, crashed: victim.crashed, url: victim.url, title: victim.title });
  check("crash: Ctrl+R brings the page back", revived, { crashed: victim.crashed, url: victim.url });
  if (!revived) {
    // what Firefox's own button does
    try {
      const { TabCrashHandler } = ChromeUtils.importESModule("resource:///modules/ContentCrashHandlers.sys.mjs");
      TabCrashHandler.restoreTab?.(victim.browser) ?? main.SessionStore.reviveCrashedTab(victim.node);
    } catch (e) {
      log("restore via SessionStore: " + e);
      try { main.SessionStore.reviveCrashedTab(victim.node); } catch (e2) { log("reviveCrashedTab: " + e2); }
    }
    await waitFor(() => !victim.crashed && !victim.loading && victim.title === "Example Domain", { timeout: 15000 }).catch(() => {});
    log("after reviveCrashedTab:", { crashed: victim.crashed, url: victim.url, title: victim.title });
  }
  // Another tab of the crashed process.
  if (sameProcess.length) {
    const t = sameProcess[0];
    mb.activate(t);
    await waitFor(() => !t.crashed && !t.loading && !t.deferred, { timeout: 15000, what: "sibling tab" }).catch(() => {});
    await sleep(500);
    log("sibling of the crashed process after activation:", { crashed: t.crashed, deferred: t.deferred, url: t.url.slice(0, 30), title: t.title });
    check("crash: a background tab of the crashed process comes back when selected", !t.crashed && !t.deferred && t.title.length > 0, { crashed: t.crashed, deferred: t.deferred, title: t.title });
  }
  check("crash: consistency", R.consistent(main).length === 0, R.consistent(main));
  check("no boot errors", Shell.errors.length === 0, Shell.errors);
  R.consoleDump("session");
});
