// Session restore through Firefox's SessionStore: tabs come back after a restart, the ones that are
// not selected stay unloaded ("deferred") until first shown, and the tab model mirrors all of it.
//   python tools/run.py --test tests/core/session.js --name core-session --url https://example.com --timeout 150
// Captures: session-1-before.png, session-2-restored.png.
/* global spike, gBrowser, Services */
spike.main(async () => {
  const b = window.vitre;
  const { check, log, sleep, waitFor } = spike;
  const page = (title, colour) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset=utf-8><title>${title}</title><body style='margin:0;background:${colour}'><h1 style='margin:120px 60px;font:600 32px Segoe UI'>${title}</h1>`);
  await spike.resize(1200, 760);

  if (spike.run === 1) {
    await spike.loaded();
    const a = b.newTab(page("Second tab", "#f4f1ea"), { background: true });
    const c = b.newTab(page("Third tab", "#14161c"), { background: true, index: 2 });
    b.activate(a);
    await waitFor(() => !a.loading && a.title === "Second tab" && c.title === "Third tab", { what: "tabs loading" });
    await sleep(600);
    check("three tabs before the restart", b.tabs.length === 3 && b.tabs.indexOf(a) === 1 && b.tabs.indexOf(c) === 2 && b.activeId === a.id, b.tabs.map((t) => t.title));
    await spike.capture("session-1-before");
    log("restarting");
    await spike.restart();
    return;
  }

  await waitFor(() => b.tabs.length === 3, { timeout: 20000, what: "restored tabs" });
  await waitFor(() => b.active()?.title === "Second tab" && !b.active().loading, { timeout: 20000, what: "restored selected tab" });
  await sleep(800);
  const [t1, t2, t3] = b.tabs;
  log("restored:", b.tabs.map((t) => ({ title: t.title, url: t.url.slice(0, 40), deferred: t.deferred, active: t.id === b.activeId })));
  check("tabs restored in order with the same one selected", t1.url.startsWith("https://example.com") && t2.title === "Second tab" && t3.title === "Third tab" && b.activeId === t2.id);
  check("unselected restored tabs are deferred and still have their URL and title", t1.deferred && t3.deferred && !t2.deferred && t3.url.startsWith("data:text/html") && t1.title.length > 0, [t1.title, t3.title]);
  check("the selected one is first in MRU", b.mru[0] === t2.id && b.mru.length === 3, b.mru);
  check("a deferred tab's browser is still on about:blank", (await b.page(t3).query("core:ping"))?.url === "about:blank");
  await waitFor(() => t2.theme === "light" && b.root.classList.contains("theme-light"), { what: "theme of the restored page" });
  await spike.capture("session-2-restored");
  b.activate(t3);
  const shownPong = await waitFor(async () => {
    const pong = await b.page(t3).query("core:ping");
    return pong?.url.startsWith("data:text/html") ? pong : null;
  }, { timeout: 15000, what: "deferred tab loading on first show" });
  await waitFor(() => !t3.loading, { what: "restored tab finishing its load" });
  check("a deferred tab loads when first shown", t3.ready && !t3.deferred && t3.title === "Third tab" && shownPong.isTop, [t3.ready, t3.title]);
  b.closeTab(t3);
  b.run("reopenClosed");
  await waitFor(() => b.tabs.length === 3 && b.active()?.title === "Third tab", { timeout: 15000, what: "reopen closed tab" });
  check("reopenClosed brings the closed tab back at its place", b.tabs.indexOf(b.active()) === 2);
});
