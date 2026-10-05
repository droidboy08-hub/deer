// Extension items through the menus API: a local temporary extension (tests/menus/ext-menus, never
// downloaded) adds a link item, a group of page items (a submenu named after the extension, with a
// checkbox and a nested submenu) and a tab item. Listed in Vitre's menus, clicked, cleaned up; an
// item renamed from menus.onShown (menus.refresh) shows up in the open menu.
/* global spike, Services, Cc, Ci, ChromeUtils, PathUtils, M */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, sleep, capture, log } = spike;
  await spike.resize(1440, 900);
  await M.activate();
  M.fakeServices();
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const dir = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  dir.initWithPath(PathUtils.join(PathUtils.parent(Services.env.get("VITRE_BOOT")), "ext-menus"));
  const addon = await AddonManager.installTemporaryAddon(dir);
  check("test extension installed (temporary, local)", !!addon, addon?.id);
  await sleep(1200);
  const article = M.page("article.html");
  await M.load(article);
  const tab0 = b.active();
  const popup = document.getElementById("contentAreaContextMenu");
  const leftovers = () => popup.querySelectorAll('[id*="-menuitem-"]').length;
  const markerTab = (marker) => spike.waitFor(() => b.tabs.find((t) => t.url.includes(marker)), { timeout: 6000, what: marker }).catch(() => null);

  // ---- a link: the extension's single item, with its icon, before Inspect ----
  await M.openOn("#link1");
  let st = M.describe("EXT LINK");
  const extRow = st.rows.find((r) => r.label === "Probe: open link with marker");
  check("link menu lists the extension item", !!extRow, st.rows.map((r) => r.label));
  check("the extension item carries the extension's icon", /^moz-extension:/.test(extRow?.icon || ""), extRow?.icon);
  check("its access key comes from '&' in the title", extRow?.access === "m", extRow?.access);
  check("extension items sit before Inspect", st.rows[st.rows.length - 1].label === "Inspect" && st.rows[st.rows.length - 2].label === "Probe: open link with marker", st.rows.map((r) => r.label));
  check("the extension icon is drawn", !!document.querySelector("#layer-menus .vt-menu img.vt-mi-icon"));
  await capture("ext-link");
  await M.pick("Probe: open link with marker");
  let t = await markerTab("#ext-clicked-probe-link");
  check("clicking it runs the extension (menus.onClicked with the link)", !!t && t.url.startsWith(M.page("counter.html")), t?.url);
  if (t) b.closeTab(t);
  await sleep(300);
  check("extension nodes cleaned out of Firefox's popup", leftovers() === 0, leftovers());

  // ---- the page: the extension's group (Firefox's submenu named after it), updated from onShown.
  // The design has no submenus: the group is a caption with its items listed in place, and its
  // nested menu another caption (menus/types.ts flatten). ----
  await M.openOn("#gap", { dx: 400, dy: 40 });
  await sleep(500); // menus.onShown -> update -> refresh
  st = M.describe("EXT PAGE");
  const flat = st.rows.map((r) => r.label);
  log("EXT GROUP", JSON.stringify({ rows: flat, captions: st.captions }));
  check("page menu: no submenu; the extension's group is a caption named after it", (st.captions || []).includes("Vitre menus probe") && !st.rows.some((r) => r.submenu) && M.state().submenus === 0, { flat, captions: st.captions });
  check("its page items, the checkbox and the nested items are listed in place", flat.some((l) => l.startsWith("Probe: page item")) && flat.includes("Probe: checkbox") && flat.includes("Probe: child one") && flat.includes("Probe: child two") && (st.captions || []).includes("Probe: more"), flat);
  check("menus.refresh() from onShown reached the open menu", flat.some((l) => /^Probe: page item \(shown \d+\)$/.test(l)), flat);
  await capture("ext-page-group");
  // keyboard: Down from the top reaches the nested items like any row
  const target = flat.indexOf("Probe: child two");
  for (let k = 0; k <= target; k++) M.key("KEY_ArrowDown");
  check("keys reach a nested item listed in place", M.state().rows[M.state().active]?.label === "Probe: child two", { active: M.state().active, target });
  M.key("KEY_Enter");
  t = await markerTab("#ext-clicked-probe-child-2");
  check("Enter on a nested extension item runs it", !!t, b.tabs.map((x) => x.url));
  check("menus.onShown / onHidden ran for that menu", !!t && /-shown[1-9]\d*-hidden\d+$/.test(t.url), t?.url);
  if (t) b.closeTab(t);
  await sleep(400);
  check("extension nodes cleaned out after the group", leftovers() === 0, leftovers());

  // the checkbox: unchecked, clicked (checked), shown checked next time
  await M.openOn("#gap", { dx: 400, dy: 40 });
  await sleep(400);
  st = M.state();
  const ci = st.rows.findIndex((r) => r.label === "Probe: checkbox");
  const checkEl = M.menus().view.rowElement(ci);
  check("checkbox item unchecked", checkEl.getAttribute("aria-checked") === "false", checkEl.getAttribute("aria-checked"));
  const cr = checkEl.getBoundingClientRect();
  M.mouse(cr.left + 40, cr.top + 17, { type: "mousemove" });
  await sleep(60);
  M.mouse(cr.left + 40, cr.top + 17, { type: "mousedown" });
  M.mouse(cr.left + 40, cr.top + 17, { type: "mouseup" });
  t = await markerTab("#ext-clicked-probe-check-true");
  check("clicking the checkbox: onClicked with checked true", !!t, b.tabs.map((x) => x.url));
  if (t) b.closeTab(t);
  await sleep(400);
  await M.openOn("#gap", { dx: 400, dy: 40 });
  await sleep(400);
  st = M.state();
  check("the checkbox shows checked next time", M.menus().view.rowElement(st.rows.findIndex((r2) => r2.label === "Probe: checkbox"))?.getAttribute("aria-checked") === "true");
  await capture("ext-page-checked");
  M.key("KEY_Escape");
  await M.waitClosed();
  await sleep(300);

  // ---- Shift+right-click: Vitre's menu; Firefox 157 builds extension items here too (its own popup
  // event carries no Shift), and the design has no Shift tier, so they stay ----
  await M.openOn("#gap", { dx: 400, dy: 40, mods: { shiftKey: true } });
  check("Shift+right-click: Vitre's menu", M.isOpen(), M.labels());
  log("Shift+right-click rows", JSON.stringify(M.labels()));
  M.key("KEY_Escape");
  await M.waitClosed();

  // ---- a tab circle: the extension's tab item ----
  const other = b.newTab(M.page("counter.html"), { background: true });
  await sleep(800);
  const item = b.bar.item(other.id);
  const ir = item.getBoundingClientRect();
  M.rightClick(ir.left + 22, ir.top + 22);
  await M.waitOpen();
  st = M.describe("EXT TAB");
  check("tab circle menu lists the extension's tab item", st.rows.some((x) => x.label === "Probe: tab item"), st.rows.map((x) => x.label));
  await capture("ext-tab");
  await M.pick("Probe: tab item");
  t = await markerTab("#ext-clicked-probe-tab");
  check("the tab item runs with that tab", !!t && t.url.startsWith(M.page("counter.html")), t?.url);
  const scratch = document.getElementById("vitre-menus-ext-scratch");
  check("tab items cleaned out of the scratch popup", !scratch || scratch.querySelectorAll('[id*="-menuitem-"]').length === 0);
  if (t) b.closeTab(t);
  b.closeTab(other);
  check("native context menu never shown", M.last().nativeShown === 0, M.last().nativeShown);
  await addon.uninstall();
});
