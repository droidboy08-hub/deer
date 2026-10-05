// Menus after an in-place restart with session restore: the restored, still deferred background
// tabs get correct circle menus (caption, rows, actions), the restored active page gets its page
// menus, and nothing from the first run leaks into the second.
//   python tests/menus-verify/all.py restore
/* global spike, Services, M, V */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, log, sleep, capture, waitFor } = spike;
  await spike.resize(1440, 900);
  await M.activate();
  const article = M.page("article.html");
  const counter = M.page("counter.html");
  const plain = V.page("plain.html");

  if (spike.run === 1) {
    M.fakeServices();
    await M.load(article);
    const t2 = b.newTab(counter, { background: true });
    const t3 = b.newTab(plain, { background: true });
    const ok = await waitFor(() => !t2.loading && !t3.loading && t3.title.startsWith("Plain") && t2.title.startsWith("Counter"), { timeout: 20000, what: "tabs" }).then(
      () => true,
      () => false
    );
    check("run 1: three tabs loaded", ok, b.tabs.map((t) => [t.url, t.title, t.loading, t.deferred]));
    // A menu open at the moment of the restart.
    await M.openOn("#link1");
    check("run 1: a menu open before the restart", M.isOpen());
    await sleep(500);
    log("restarting");
    await spike.restart();
    return;
  }

  const fake = M.fakeServices();
  await waitFor(() => b.tabs.length === 3, { timeout: 20000, what: "restored tabs" });
  await waitFor(() => b.active() && !b.active().loading && b.active().url === article, { timeout: 20000, what: "restored active tab" });
  await sleep(1200);
  const t1 = b.tabs.find((t) => t.url === article);
  const t2 = b.tabs.find((t) => t.url === counter);
  const t3 = b.tabs.find((t) => t.url === plain);
  log("restored", JSON.stringify(b.tabs.map((t) => ({ url: t.url, title: t.title, deferred: t.deferred }))));
  check("restore: tabs back, background ones deferred", !!t1 && !!t2 && !!t3 && b.activeId === t1.id && t2.deferred && t3.deferred, b.tabs.map((t) => [t.url, t.deferred]));
  check("restore: no menu carried over", !M.isOpen() && V.menuNodes().allPanels === 0);

  await V.section("deferred circle", async () => {
    const item = b.bar.item(t3.id);
    const r = item.getBoundingClientRect();
    M.rightClick(r.left + r.width / 2, r.top + r.height / 2);
    check("restore: circle menu on a deferred tab", await M.waitOpen());
    const st = M.describe("RESTORED CIRCLE");
    check("restore: the caption names the deferred tab", st.captions[0] === "Plain - Field Notes · 127.0.0.1", st.captions);
    check("restore: the full circle rows", JSON.stringify(st.rows.map((x) => x.label)) === JSON.stringify(["Reload tab", "Duplicate tab", "Copy address", "Move tab to new window", "Close other tabs", "Close tab"]), st.rows.map((x) => x.label));
    await capture("restore-circle");
    await M.pick("Copy address");
    check("restore: Copy address of a deferred tab", (await M.clipboardIs(plain)) === plain, M.readClipboard());
    M.rightClick(r.left + r.width / 2, r.top + r.height / 2);
    await M.waitOpen();
    const known = new Set(b.tabs);
    await M.pick("Duplicate tab");
    const dup = await waitFor(() => b.tabs.find((t) => !known.has(t)), { timeout: 8000, what: "duplicate" }).catch(() => null);
    await sleep(800);
    log("after Duplicate tab", JSON.stringify(b.tabs.map((t) => [t.url, t.title, t.deferred, t.id === b.activeId])));
    check("restore: Duplicate tab of a deferred tab: a copy right after it, the active tab unchanged", !!dup && b.tabs.indexOf(dup) === b.tabs.indexOf(t3) + 1 && (dup.url === plain || dup.title.startsWith("Plain")) && b.activeId === t1.id, dup && [dup.url, dup.title, b.tabs.indexOf(dup), b.tabs.indexOf(t3)]);
    if (dup) b.closeTab(dup);
    await sleep(300);
    // Reload a deferred tab: it stays a background tab and ends with its page.
    const item2 = b.bar.item(t2.id);
    const r2 = item2.getBoundingClientRect();
    M.rightClick(r2.left + r2.width / 2, r2.top + r2.height / 2);
    await M.waitOpen();
    await M.pick("Reload tab");
    await sleep(1500);
    check("restore: Reload tab on a deferred tab keeps it in the background", b.activeId === t1.id && b.tabs.includes(t2) && t2.url === counter, { active: b.activeId, url: t2.url, deferred: t2.deferred });
  });

  await V.section("restored page", async () => {
    const o = await M.openOn("#link1");
    check("restore: page menu on the restored active tab", o.ok && M.last().kind === "link", M.last().kind);
    await M.pick("Download linked file");
    const d = fake.take().find((c) => c.name === "downloads.download");
    const dp = d?.args[1]?.triggeringPrincipal;
    check("restore: Download linked file reaches the downloader with the page's principal", !!d && d.args[0] === counter && !!dp && !dp.isSystemPrincipal && dp.isContentPrincipal && dp.origin === Services.io.newURI(counter).prePath, d && { url: d.args[0], origin: dp?.origin, system: dp?.isSystemPrincipal });
    // The + circle: Reopen closed tab after closing one.
    b.closeTab(t3);
    await sleep(500);
    const plus = document.querySelector("#vitre-bar .item.plus");
    const pr = plus.getBoundingClientRect();
    M.rightClick(pr.left + pr.width / 2, pr.top + pr.height / 2);
    await M.waitOpen();
    const rows = M.labels();
    check("restore: + menu offers Reopen closed tab", rows.includes("Reopen closed tab") && !M.state().rows.find((x) => x.label === "Reopen closed tab").disabled, rows);
    const n = b.tabs.length;
    await M.pick("Reopen closed tab");
    check("restore: Reopen closed tab brings it back", await waitFor(() => b.tabs.length === n + 1, { timeout: 8000 }).then(() => true, () => false));
  });

  check("native popup never shown", M.last().nativeShown === 0);
  const errs = V.errors();
  check("console: no errors from Vitre's code", errs.length === 0, errs.slice(0, 5));
});
