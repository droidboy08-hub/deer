// The menus with the other modules as they are in the tree (full build, no stand-ins): Peek link
// opens a real peek, the page inside it gets the peek page menu, the peek's header menu and the find
// field menu are drawn by this module through the 'menus' service, Find selection opens find,
// Settings and Show downloads open their panels. Run against build-menus-full (all.py).
/* global spike, Services, M */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, sleep, capture, log } = spike;
  await spike.resize(1440, 900);
  await M.activate();
  log("modules", JSON.stringify(b.modules), "errors", JSON.stringify(b.moduleErrors));
  const peek = b.service("peek");
  const find = b.service("find");
  const settings = b.service("settings");
  const downloads = b.service("downloads");
  check("the other modules are installed", !!peek && !!find && !!settings && !!downloads, { peek: !!peek, find: !!find, settings: !!settings, downloads: !!downloads });
  await M.load(M.page("article.html"));
  const tab0 = b.active();
  const close = async () => {
    if (M.isOpen()) M.key("KEY_Escape");
    await M.waitClosed();
    await sleep(250);
  };

  // ---- Peek link opens a real peek ----
  await M.openOn("#link1");
  M.describe("INT LINK");
  check("link menu with Peek link (the Peek module)", M.labels()[1] === "Peek link" && M.state().rows[1].key === "Shift+click", M.labels());
  await M.pick("Peek link");
  const opened = await spike.waitFor(() => peek?.isOpen() && peek.browser()?.currentURI?.spec.includes("counter.html"), { timeout: 8000, what: "peek open" }).catch(() => false);
  check("Peek link: a peek opened on the link", !!opened);
  await sleep(900);
  await capture("integration-peek");
  if (opened) {
    // the page inside the sheet
    const pb = peek.browser();
    const r = pb.getBoundingClientRect();
    M.rightClick(r.left + r.width / 2, r.top + r.height / 2);
    await M.waitOpen();
    const st = M.describe("INT PEEK PAGE");
    check("the page in the sheet: the peek page menu", M.last().context.inPeek === true && st.rows[0]?.label === "Open as tab" && st.rows[1]?.label === "Copy address", st.rows.map((x) => x.label));
    await capture("integration-peek-page-menu");
    await close();
    // the peek's header menu, drawn by the menus module for the Peek module
    const head = document.querySelector(".vp-head");
    if (head) {
      const hr = head.getBoundingClientRect();
      M.rightClick(hr.left + hr.width / 2, hr.top + hr.height / 2);
      await M.waitOpen();
      const hs = M.describe("INT PEEK HEADER");
      check("peek header menu through the service", hs.rows.some((x) => x.label === "Close peek") && hs.rows.every((x) => x.key.length !== 1), hs.rows);
      await capture("integration-peek-header");
      await close();
    }
    peek.close();
    await spike.waitFor(() => !peek.isOpen(), { timeout: 4000, what: "peek closed" }).catch(() => null);
    await sleep(600);
  }

  // ---- Find selection opens find, and the find field's own menu ----
  await M.inContent(tab0.browser, (content) => {
    content.scrollTo(0, 0);
    const t = content.document.getElementById("p1").firstChild;
    const i = t.data.indexOf("surface tension");
    const range = content.document.createRange();
    range.setStart(t, i);
    range.setEnd(t, i + 15);
    content.getSelection().removeAllRanges();
    content.getSelection().addRange(range);
  });
  await sleep(200);
  const selRect = await M.inContent(tab0.browser, (content) => {
    const r = content.getSelection().getRangeAt(0).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const box = tab0.browser.getBoundingClientRect();
  M.rightClick(box.left + selRect.x, box.top + selRect.y);
  await M.waitOpen();
  await M.pick("Find “surface tension” on page");
  const fo = await spike.waitFor(() => find.isOpen(), { timeout: 4000, what: "find open" }).catch(() => false);
  check("Find selection: find opened", !!fo);
  await sleep(800);
  const input = document.querySelector(".vf-input");
  check("find seeded with the selection", input?.value === "surface tension", input?.value);
  await capture("integration-find");
  if (input) {
    const ir = input.getBoundingClientRect();
    M.rightClick(ir.left + 40, ir.top + ir.height / 2);
    await M.waitOpen();
    const fs = M.describe("INT FIND FIELD");
    check("find field menu: editing rows + Match case", fs.rows[0]?.label === "Undo" && fs.rows[fs.rows.length - 1]?.label === "Match case" && fs.rows[fs.rows.length - 1].checked !== undefined, fs.rows.map((x) => x.label));
    await capture("integration-find-menu");
    await close();
  }
  find.close();
  await sleep(500);

  // ---- Settings and Show downloads from the + circle ----
  const plus = document.querySelector("#vitre-bar .item.plus");
  let pr = plus.getBoundingClientRect();
  M.rightClick(pr.left + 22, pr.top + 22);
  await M.waitOpen();
  M.describe("INT PLUS");
  await M.pick("Settings");
  await sleep(900);
  check("Settings opens the settings panel", b.root.classList.contains("panel-open") || !!settings.isOpen?.(), b.root.className);
  await capture("integration-settings");
  b.escape();
  await sleep(600);
  pr = plus.getBoundingClientRect();
  M.rightClick(pr.left + 22, pr.top + 22);
  await M.waitOpen();
  await M.pick("Show downloads");
  await sleep(900);
  check("Show downloads opens the downloads panel", b.root.classList.contains("panel-open"), b.root.className);
  await capture("integration-downloads");
  b.escape();
  await sleep(500);
  check("native context menu never shown", M.last().nativeShown === 0, M.last().nativeShown);
});
