// macOS One row, "Show the tab bar: When I point at the top" (barAutoHide) in a normal window, as the
// Windows bar's auto-hide (the owner, 2026-11-15: "where is the option to hide the capsule tabs ... like
// in windows, it appears when you move the cursor at the top"). Only the row's hiding; full screen is
// mac-fullscreen-look.js.
//   python3 tools/run.py --test tests/menus/mac-row-autohide.js --name mac-row-autohide --url about:blank --timeout 200
// Captures: autohide-1-hidden (the page alone, no row, no traffic lights), autohide-2-revealed (the
// pointer at the top).
/* global spike, M */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = M;
  const { check, sleep, capture, log, waitFor } = spike;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only: nothing to check here", true);
    return;
  }
  const store = b.sys("VitreSettings");
  const root = b.root;
  await spike.resize(1280, 800);
  await M.activate();
  await M.load(M.page("article.html"));
  for (const t of ["Tideline", "Refract"]) b.newTab("data:text/html,<title>" + t + "</title><body style='background:%23f4f2ec'>", { background: true });
  await waitFor(() => b.tabs.length === 3 && b.tabs.every((t) => !t.loading), { what: "three tabs" });
  const away = () => M.mouse(640, 600, { type: "mousemove" });
  away();
  await sleep(600);
  const look = () => {
    const lights = document.getElementById("vitre-win-lights");
    const winctl = document.getElementById("vitre-winctl");
    const end = document.getElementById("vitre-row-end");
    const drag = document.getElementById("vitre-drag");
    const item = b.bar.item(b.tabs.find((t) => t.id !== b.active().id).id);
    const ir = item.getBoundingClientRect();
    const hit = document.elementFromPoint(ir.left + ir.width / 2, ir.top + ir.height / 2);
    return {
      hiding: root.classList.contains("bar-hiding"),
      revealed: root.classList.contains("bar-revealed"),
      hidden: b.bar.hidden,
      lights: lights ? getComputedStyle(lights).visibility : null,
      winctl: winctl ? Number(getComputedStyle(winctl).opacity) : null,
      end: end ? Number(getComputedStyle(end).opacity) : null,
      bar: Number(getComputedStyle(document.getElementById("vitre-bar")).opacity),
      capsuleHit: !!hit && !!hit.closest("#vitre-bar"),
      drag: drag ? Math.round(drag.getBoundingClientRect().height) : 0,
      pageTop: Math.round(gBrowser.selectedBrowser.getBoundingClientRect().top),
    };
  };

  // 1. The setting off ("Always", what the harness starts with): the row is there.
  check("Always: the row is shown and not hiding", !look().hiding && !b.bar.hidden, look());

  // 2. "When I point at the top": the row, the traffic lights and the row's end slide away.
  store.set({ barAutoHide: true });
  await waitFor(() => b.bar.hidden, { timeout: 4000, what: "the row hides" }).catch(() => {});
  await sleep(700);
  let s = look();
  log("hidden: " + JSON.stringify(s));
  check("When I point at the top: the row hides in a normal window", s.hiding && s.hidden && !s.revealed && s.bar < 0.05, s);
  check("hidden: the traffic lights go too (native buttons, by visibility) and their capsule and the row's end fade", s.lights === "hidden" && s.winctl < 0.05 && s.end < 0.05, s);
  check("hidden: a click where a capsule was reaches the page", !s.capsuleHit, s);
  check("hidden: the page fills the window from the top and the 18 px drag strip stays", s.pageTop === 0 && s.drag === 18, s);
  await capture("autohide-1-hidden");

  // 3. The pointer at the top brings it back; going down hides it again.
  M.mouse(640, 4, { type: "mousemove" });
  await waitFor(() => !b.bar.hidden, { timeout: 3000, what: "the row comes back" }).catch(() => {});
  await sleep(700);
  s = look();
  log("revealed: " + JSON.stringify(s));
  check("the pointer at the top: the row comes back, traffic lights and all", !s.hidden && s.revealed && s.bar > 0.95 && s.lights === "visible" && s.winctl > 0.95 && s.end > 0.95, s);
  await capture("autohide-2-revealed");
  M.mouse(640, 30, { type: "mousemove" });
  await sleep(700);
  check("the pointer on the row keeps it", !b.bar.hidden, look());
  away();
  await waitFor(() => b.bar.hidden, { timeout: 4000, what: "the row hides again" }).catch(() => {});
  check("the pointer back down on the page: the row leaves again", b.bar.hidden, look());

  // 4. Typing an address brings the row and keeps it while the field is open.
  b.editAddress("deer");
  await sleep(800);
  check("the address field open: the row is shown", !b.bar.hidden, look());
  await sleep(900);
  check("...and stays while the field is open", !b.bar.hidden && b.omni?.open, look());
  M.key("KEY_Escape");
  M.key("KEY_Escape");
  away();
  await waitFor(() => b.bar.hidden, { timeout: 4000, what: "the row hides after the field" }).catch(() => {});
  check("the field closed: the row leaves again", b.bar.hidden, look());

  // 5. Settings shows the choice on a Mac, and Home's menu has "Show tab bar".
  b.service("settings").open("appearance");
  await waitFor(() => document.querySelector("#vitre-settings .vs-content")?.dataset.page === "appearance", { timeout: 3000, what: "Settings › Appearance" }).catch(() => {});
  await sleep(500);
  const text = document.querySelector("#vitre-settings .vs-main")?.textContent ?? "";
  check("Settings › Appearance › Tab bar: Show the tab bar (Always / When I point at the top) on a Mac", /Show the tab bar/.test(text) && /When I point at the top|Always/.test(text), text.slice(0, 300));
  M.key("KEY_Escape");
  await sleep(600);
  const home = b.newTab();
  await waitFor(() => home.kind === "home" && !home.loading, { what: "Home" });
  if (b.omni?.open) b.omni.close();
  await sleep(800);
  M.rightClick(700, 600);
  const opened = await M.waitOpen();
  const rows = opened ? M.labels() : [];
  check("Home's menu has Show tab bar on a Mac, unchecked while the row hides", opened && rows.includes("Show tab bar"), rows);
  if (opened) {
    await M.pick("Show tab bar");
    await sleep(500);
    check("Show tab bar: the setting goes back to Always and the row stays", store.get().barAutoHide === false && !b.bar.hiding && !b.bar.hidden, { auto: store.get().barAutoHide, state: look() });
  }
  b.closeTab(home);
  store.set({ barAutoHide: false });
  await sleep(500);
  check("Always again: the row is shown", !b.bar.hiding && !b.bar.hidden, look());
});
