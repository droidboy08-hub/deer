// A real site (en.wikipedia.org, Float glass): link, image, selection, page and a keyboard menu.
/* global spike, Services, M */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, sleep, capture, log } = spike;
  await spike.resize(1440, 900);
  await M.activate();
  M.fakeServices();
  const url = "https://en.wikipedia.org/wiki/Float_glass";
  const t = b.active();
  b.navigate(t, url);
  const loaded = await spike.waitFor(() => !t.loading && t.browser.currentURI.spec.startsWith("https://en.wikipedia.org/"), { timeout: 40000, what: "wikipedia" }).catch(() => false);
  check("Wikipedia loaded", !!loaded, t.url);
  if (!loaded) return;
  await sleep(1500);
  const page = (fn, arg) => M.inContent(t.browser, fn, arg);
  const close = async () => {
    if (M.isOpen()) M.key("KEY_Escape");
    await M.waitClosed();
    await sleep(200);
  };
  // tag the elements the test uses
  const tagged = await page((content) => {
    const d = content.document;
    const links = [...d.querySelectorAll("#mw-content-text p a[href]")].filter((a) => /\/wiki\/[^:]+$/.test(a.getAttribute("href")) && a.getClientRects().length === 1);
    const link = links[0];
    if (link) link.id = "vt-link";
    const img = d.querySelector("#mw-content-text img");
    if (img) img.id = "vt-img";
    const p = link?.closest("p");
    if (p) p.id = "vt-p";
    return { links: links.length, link: link?.href, img: img?.src, title: d.title, paras: d.querySelectorAll("p").length };
  });
  log("tagged", JSON.stringify(tagged));

  // ---- link ----
  let at = await M.openOn("#vt-link");
  check("real site: link menu", at.ok && M.last().kind === "link", M.last().kind);
  let st = M.describe("REAL LINK");
  check("real site: Peek link offered for a web link", st.rows[1]?.label === "Peek link", st.rows.map((r) => r.label));
  check("real site: the link is washed", st.wash >= 1, st.wash);
  await capture("real-link");
  await M.pick("Copy link address");
  const copied = await M.clipboardIs(M.last().context.linkURL);
  check("real site: Copy link address", copied.startsWith("https://en.wikipedia.org/wiki/"), copied);

  // ---- image ----
  at = await M.openOn("#vt-img");
  st = M.describe("REAL IMAGE");
  check("real site: image menu", at.ok && (M.last().kind === "imagelink" || M.last().kind === "image"), M.last().kind);
  await capture("real-image");
  await M.pick("Copy image", { prefix: false }).catch(async () => close());
  await sleep(300);

  // ---- selection ----
  const sel = await page((content) => {
    const p = content.document.getElementById("vt-p");
    const walker = content.document.createTreeWalker(p, content.NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const i = node.data.search(/\b(glass|molten|tin|process)\b/);
      if (i < 0 || node.parentElement.closest("a")) continue;
      const m = node.data.slice(i).match(/^\w+/)[0];
      const range = content.document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + m.length);
      const s = content.getSelection();
      s.removeAllRanges();
      s.addRange(range);
      p.scrollIntoView({ block: "center" });
      const r = range.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height, text: m };
    }
    return null;
  });
  check("real site: a word selected", !!sel, sel);
  if (sel) {
    await sleep(300);
    const box = t.browser.getBoundingClientRect();
    M.rightClick(box.left + sel.x + sel.w / 2, box.top + sel.y + sel.h / 2);
    await M.waitOpen();
    st = M.describe("REAL SELECTION");
    check("real site: selection menu", M.last().kind === "selection" && st.rows[1]?.label === `Search for “${sel.text}”`, st.rows.map((r) => r.label));
    await capture("real-selection");
    await close();
    await page((content) => content.getSelection().removeAllRanges());
  }

  // ---- page ----
  at = await M.openOn("#firstHeading", { dx: 20, dy: 20 });
  st = M.describe("REAL PAGE");
  check("real site: page menu", at.ok && M.last().kind === "page", M.last().kind);
  await capture("real-page");
  await close();

  // ---- keyboard on a focused link ----
  await page((content) => {
    const a = content.document.getElementById("vt-link");
    a.scrollIntoView({ block: "center" });
    a.focus();
  });
  t.browser.focus();
  await M.activate();
  await sleep(300);
  const lr = await M.rectOf("#vt-link", { scroll: false });
  M.keyboardMenu();
  await M.waitOpen();
  st = M.describe("REAL KEYBOARD");
  check("real site: keyboard menu below the focused link, first row focused", M.last().context.keyboard && st.active === 0 && Math.abs(st.rect.top - (lr.bottom + 4)) <= 2 && Math.abs(st.rect.left - lr.x) <= 2, { rect: st.rect, link: lr });
  await capture("real-keyboard");
  await close();
  check("native context menu never shown", M.last().nativeShown === 0, M.last().nativeShown);
});
