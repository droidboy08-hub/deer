// Edge cases: a long name with "&" (tooltip, menu, Settings card), a four-digit badge on a light
// badge colour, a popup whose page is busy for seconds (the cluster stays usable), and "Load
// temporary add-on" with bad input (missing path, a folder without manifest.json, a manifest.json
// picked instead of its folder) and a remembered folder that vanished before a restart.
//   python tests/extensions/runx.py --test tests/extensions-verify/edge.js --name extensions-verify-edge --app build-extensions-verify-all --out tests/extensions-verify/out/edge
// Captures: edge-1-long-badge, edge-2-long-menu, edge-3-settings-long, edge-4-vanished.
/* global spike, gBrowser, Services, Cc, Ci, IOUtils, PathUtils, CustomizableUI, xt, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  const sys = b.sys("VitreExtensions");
  await spike.resize(1280, 800);
  await spike.activate();
  const tmp = PathUtils.join(PathUtils.tempDir, "vx-edge-" + spike.run);
  const copy = PathUtils.join(tmp, "pin2copy");

  if (spike.run === 1) {
    await xt.nav(xt.page());
    await vx.install("longname");
    await vx.install("slowpopup");
    await xt.waitFor(() => document.getElementById(vx.widgetId("longname")) && document.getElementById(vx.widgetId("slowpopup")), 6000);
    await sleep(800);
    const long = document.getElementById(vx.widgetId("longname")).querySelector(".unified-extensions-item-action-button");
    const badge = long.querySelector(".toolbarbutton-badge");
    const br = badge.getBoundingClientRect();
    log("long badge", badge.textContent, { w: br.width, h: br.height }, "style", badge.getAttribute("style"), "scrollWidth", badge.scrollWidth, "tip", long.getAttribute("data-tip"));
    check("long name: Vitre's tooltip carries the full name", long.getAttribute("data-tip") === "Very Long Extension Name & Friends That Keeps Going Well Past Any Reasonable Width");
    check("four-digit badge: it stays a 14 px capsule no wider than its button", Math.round(br.height) === 14 && br.width <= 28.5, { w: br.width, h: br.height });
    const ring = getComputedStyle(badge).boxShadow;
    check("light badge colour (#e5e5e5 on light glass): the ring still separates it from the glass", /1\.5px/.test(ring), ring);
    await capture("edge-1-long-badge");

    const rows = vx.menuRows();
    vx.rightClick(long);
    await xt.waitFor(() => window.vitreMenus?.state?.()?.open, 3000);
    await sleep(400);
    const st = window.vitreMenus.state();
    log("menu", st.rows.map((r) => r.label), st.rect);
    check("menu of a long-named extension: fits on screen", st.rect && st.rect.left >= 0 && st.rect.left + st.rect.width <= window.innerWidth, st.rect);
    await capture("edge-2-long-menu");
    b.service("menus")?.close();
    rows.undo();
    await sleep(300);

    // A popup page busy for 4 s: the cluster and the bar keep answering meanwhile.
    const slow = document.getElementById(vx.widgetId("slowpopup")).querySelector(".unified-extensions-item-action-button");
    const t0 = Date.now();
    spike.click(slow);
    await sleep(300);
    const responsive = Date.now() - t0 < 1500;
    spike.click(xt.extButton());
    await sleep(300);
    log("busy popup: chrome answered in", Date.now() - t0, "ms; widget panel", document.getElementById("customizationui-widget-panel")?.state, "ext panel", document.getElementById("unified-extensions-panel")?.state);
    check("busy popup page: the window stays responsive (the page runs in the extension process)", responsive);
    await sleep(4500);
    await xt.closePopups();
    await sleep(500);
    check("after the busy popup: nothing left open, pill consistent", vx.openPopups().length === 0 && window.vitreExtensions.bar.lent.size === 0, vx.openPopups());

    // Settings card with the long name.
    b.service("settings")?.open("extensions");
    const page = () => document.querySelector(".vx-page");
    await xt.waitFor(() => page()?.querySelector(`.vx-card[data-extension-id="longname@vitre.verify"]`), 5000);
    await sleep(600);
    const card = page().querySelector(`.vx-card[data-extension-id="longname@vitre.verify"]`);
    const cr = card.getBoundingClientRect();
    const sw = card.querySelector(".vs-switch").getBoundingClientRect();
    log("long card", { w: cr.width, h: cr.height }, "switch", { x: sw.x, r: sw.right }, "title", card.querySelector(".vs-title").getBoundingClientRect().height);
    check("Settings: a long name wraps or ellipsises inside its card, the switch stays inside", sw.right <= cr.right && sw.x > cr.x, { card: cr.right, switch: sw.right });
    card.scrollIntoView({ block: "center" });
    await sleep(300);
    await capture("edge-3-settings-long");
    b.service("settings")?.close?.();
    await sleep(300);

    // "Load temporary add-on" with bad input.
    let err = "";
    try {
      await sys.loadTemporary(PathUtils.join(tmp, "does-not-exist"));
    } catch (e) {
      err = String(e?.message ?? e);
    }
    log("missing path ->", err);
    check("load: a missing path is refused with a message in words, nothing remembered", err === "The folder or file is no longer there." && !sys.temporary().some((t) => t.path.includes("does-not-exist")), err);
    await IOUtils.makeDirectory(PathUtils.join(tmp, "empty"), { createAncestors: true });
    err = "";
    try {
      await sys.loadTemporary(PathUtils.join(tmp, "empty"));
    } catch (e) {
      err = String(e?.message ?? e);
    }
    log("folder without manifest ->", err);
    check("load: a folder without manifest.json is refused, nothing remembered", !!err && !sys.temporary().some((t) => t.path.endsWith("empty")), err);
    // A manifest.json picked instead of its folder: the folder is remembered.
    await IOUtils.copy(xt.extPath("pin2"), copy, { recursive: true });
    const r = await sys.loadTemporary(PathUtils.join(copy, "manifest.json"));
    check("load: manifest.json stands for its folder", r.id === xt.id("pin2") && sys.temporary().some((t) => t.path === copy), sys.temporary());
    // The remembered folder vanishes before the next start.
    Services.prefs.savePrefFile(null);
    await capture("edge-0-before-restart");
    await spike.restart();
    return;
  }

  // ---- run 2: the remembered folder is gone ----
  const prevTmp = PathUtils.join(PathUtils.tempDir, "vx-edge-1");
  const prevCopy = PathUtils.join(prevTmp, "pin2copy");
  if (spike.run === 2) {
    await sys.restored;
    log("run 2 temporary", sys.temporary());
    check("run 2: the copied add-on came back", sys.temporary().some((t) => t.path === prevCopy && !t.error) && !!(await xt.AddonManager.getAddonByID(xt.id("pin2"))));
    await IOUtils.remove(prevTmp, { recursive: true });
    Services.prefs.savePrefFile(null);
    await spike.restart();
    return;
  }

  await sys.restored;
  const gone = sys.temporary().find((t) => t.path === prevCopy);
  log("run 3 temporary", sys.temporary());
  check("run 3: the vanished folder is listed with its error, the add-on is not installed", !!gone?.error && !(await xt.AddonManager.getAddonByID(xt.id("pin2"))), gone);
  await xt.nav(xt.page());
  b.service("settings")?.open("extensions");
  const page = () => document.querySelector(".vx-page");
  await xt.waitFor(() => page()?.textContent.includes("Loaded from a folder or file"), 5000);
  await sleep(500);
  check("Settings shows it under 'Loaded from a folder or file' with the reason", page().textContent.includes(prevCopy) && page().textContent.includes(gone?.error || "@@"), page().querySelector(".vx-warn")?.textContent);
  const warn = page().querySelector(".vx-warn");
  const wr = warn?.getBoundingClientRect();
  check("...the reason is whole and in the warning colour (not cut off by the path's ellipsis)", !!warn && warn.textContent === gone?.error && warn.scrollWidth <= Math.ceil(wr.width) + 1 && getComputedStyle(warn).color !== getComputedStyle(page().querySelector(".vx-path")).color, warn && { text: warn.textContent, color: getComputedStyle(warn).color });
  const stop = [...page().querySelectorAll(".vs-link")].find((l) => l.textContent === "Stop loading at start");
  stop?.scrollIntoView({ block: "center" });
  await sleep(300);
  await capture("edge-4-vanished");
  spike.click(stop);
  await xt.waitFor(() => !sys.temporary().some((t) => t.path === prevCopy), 3000);
  check("'Stop loading at start' forgets it", !sys.temporary().some((t) => t.path === prevCopy) && !Services.prefs.getStringPref("vitre.extensions.temporary", "").includes("pin2copy"));
  b.service("settings")?.close?.();
  log("vitre errors", vx.errors());
  check("no errors from the extensions module (load failures are reported, not thrown at the user)", vx.extErrors().filter((e) => !/could not load the temporary add-on/.test(e.text)).length === 0, vx.extErrors());
});
