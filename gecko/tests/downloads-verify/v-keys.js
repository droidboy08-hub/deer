// Keyboard only: every downloads surface driven with keys (design/keymap.json "Downloads",
// "Menus and focus", "Popovers", "Panels"), and the Esc and close ladders between them.
//   - the ring is a stop of the tab bar (Tab from the address field, then Right), Enter opens the
//     quick view, Shift+F10 the ring menu, Esc steps back one surface at a time, then to the page;
//   - the quick view: rows by Up/Down/Home/End, Space is the row's button, Esc back to the ring;
//   - the panel is the topmost surface: opening it closes the quick view and the picker, one Esc closes it;
//   - the panel: focus on the selected row, Up/Down, Space pause/resume, Delete removes the row (never
//     the file), Shift+F10 the row menu (Esc closes only the menu), Ctrl+F the search, Tab stays inside;
//   - the picker (Ctrl+Shift+D): the checked quality focused, Up/Down, Tab cycles, Enter downloads,
//     Ctrl+Shift+D again closes it;
//   - the quit prompt: Keep downloading focused, Tab cycles, Esc keeps.
/* global spike, Services, gBrowser, DL, V, IOUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);

spike.main(async () => {
  const { check, sleep, log } = spike;
  await DL.init();
  await spike.resize(1440, 900);
  await spike.activate();
  const b = DL.b;
  const engine = DL.engine;
  const ui = DL.ui();
  const menus = () => b.service("menus");
  const menuOpen = () => !!menus()?.isOpen?.() || !!b.root.querySelector(".vd-menu");
  const active = () => document.activeElement;

  await DL.open(DL.base + "/page.html");
  const done = engine.start(DL.base + "/blob/medium", { filename: "field-notes-issue-14.pdf", named: true });
  await DL.until(done, ["completed"], { timeout: 30000 });
  const run = engine.start(DL.base + "/blob/big?rate=256", { filename: "photos-archive-2026.zip", named: true });
  await DL.until(run, ["downloading"], { test: (v) => v.received > 1 << 20, timeout: 30000 });
  await V.until(() => ui.ring.isShown, "the ring");
  const ringBtn = ui.ring.el.querySelector("button");

  // ---- the ring from the tab bar ----
  b.editAddress();
  await sleep(400);
  await V.key("Tab");
  await sleep(200);
  for (let i = 0; i < 12 && !V.within(ui.ring.el); i++) {
    await V.key("Right");
    await sleep(80);
  }
  check("the ring is a keyboard stop of the tab bar (Tab from the address field, then Right)", V.within(ui.ring.el), V.focus());
  if (!V.within(ui.ring.el)) ringBtn.focus();
  await V.key("Left");
  await sleep(100);
  check("Left from the ring goes back along the bar", !V.within(ui.ring.el) && !!active()?.closest?.("#vitre-bar"), V.focus());
  ringBtn.focus();

  await V.key("Enter");
  await V.until(() => ui.ring.pop.isOpen, "the quick view (Enter)");
  await sleep(350);
  check("Enter on the ring opens the quick view with its first row focused", active()?.classList.contains("vd-pop-row"), V.focus());
  await V.capture("v-keys-01-quickview");
  await V.key("End");
  check("End reaches Open Downloads", active()?.classList.contains("vd-pop-open"), V.focus());
  await V.key("Home");
  check("Home goes back to the first row", active()?.classList.contains("vd-pop-row"), V.focus());
  b.root.querySelector(`.vd-pop-row[data-id="${run}"]`)?.focus();
  await V.key("Space");
  await DL.until(run, ["paused"], { timeout: 8000, what: "Space to pause from the quick view" });
  check("Space on a quick view row is its button (pause)", engine.get(run).state === "paused");
  await sleep(300);
  b.root.querySelector(`.vd-pop-row[data-id="${run}"]`)?.focus();
  await V.key("Space");
  await DL.until(run, ["downloading", "queued"], { timeout: 8000, what: "Space to resume from the quick view" });
  check("Space again resumes it", ["downloading", "queued"].includes(engine.get(run).state));
  await V.key("Escape");
  await sleep(300);
  check("Esc closes the quick view and focus goes back to the ring", !ui.ring.pop.isOpen && V.within(ui.ring.el), V.focus());

  await V.key("Shift+F10");
  await sleep(350);
  check("Shift+F10 on the ring opens the ring menu", menuOpen());
  await V.capture("v-keys-02-ring-menu");
  await V.key("Escape");
  await sleep(300);
  check("Esc closes only the ring menu; focus stays on the ring", !menuOpen() && V.within(ui.ring.el), V.focus());
  await V.key("Escape");
  await sleep(300);
  check("Esc on the ring goes back to the page", V.focus() === "page", V.focus());

  // ---- the panel is the topmost surface ----
  ringBtn.focus();
  await V.key("Enter");
  await V.until(() => ui.ring.pop.isOpen, "the quick view");
  await V.key("Ctrl+J");
  await V.until(() => ui.panel.open, "the panel over the quick view");
  await sleep(450);
  check("opening the panel closes the quick view", !ui.ring.pop.isOpen);
  await V.key("Escape");
  await sleep(450);
  check("one Esc then closes the panel", !ui.panel.open);
  check("nothing of the quick view is left on screen", !b.root.querySelector(".vd-pop"), !!b.root.querySelector(".vd-pop"));

  // ---- another Vitre surface takes focus (the switcher's search): the quick view gives way ----
  const switcher = b.service("switcher");
  if (switcher) {
    ringBtn.focus();
    await V.key("Enter");
    await V.until(() => ui.ring.pop.isOpen, "the quick view");
    await sleep(300);
    await V.key("Ctrl+Shift+A");
    await V.until(() => switcher.isOpen(), "the switcher's search", 5000);
    await sleep(500);
    check("the switcher's search opening over the quick view closes it", !ui.ring.pop.isOpen);
    await V.key("Escape");
    await sleep(600);
    check("one Esc then closes the switcher", !switcher.isOpen());
  }

  // ---- the panel ----
  await V.key("Ctrl+J");
  await V.until(() => ui.panel.open, "the panel");
  await sleep(450);
  const panel = b.root.querySelector(".vd-panel");
  check("the panel puts focus on the selected row", active()?.classList.contains("vd-row") && active().getAttribute("aria-selected") === "true", V.focus());
  const firstId = active()?.dataset.id;
  await V.key("Down");
  await sleep(120);
  check("Down selects and focuses the next row", active()?.classList.contains("vd-row") && active().dataset.id !== firstId && active().getAttribute("aria-selected") === "true", V.focus());
  await V.key("Up");
  await sleep(120);
  check("Up goes back", active()?.dataset.id === firstId);
  for (let i = 0; i < 4 && active()?.dataset.id !== run; i++) {
    await V.key("Down");
    await sleep(80);
  }
  check("the running download's row can be reached by arrows", active()?.dataset.id === run);
  await V.key("Space");
  await DL.until(run, ["paused"], { timeout: 8000, what: "Space to pause in the panel" });
  check("Space pauses the selected download", true);
  await sleep(250);
  await V.key("Space");
  await DL.until(run, ["downloading", "queued"], { timeout: 8000, what: "Space to resume in the panel" });
  check("Space resumes it", true);
  await sleep(250);
  check("focus stays on the row while it changes state", active()?.dataset.id === run, V.focus());

  await V.key("Shift+F10");
  await sleep(350);
  check("Shift+F10 opens the row's menu", menuOpen());
  await V.capture("v-keys-03-row-menu");
  await V.key("Escape");
  await sleep(300);
  check("Esc closes only the menu; the panel stays", !menuOpen() && ui.panel.open);
  check("focus goes back to the row", active()?.dataset.id === run, V.focus());

  await V.key("Ctrl+F");
  await sleep(200);
  const search = panel.querySelector(".vd-search input");
  check("Ctrl+F focuses Search downloads", active() === search, V.focus());
  spike.type("notes");
  await sleep(350);
  check("typing narrows the list", panel.querySelectorAll(".vd-row").length === 1, panel.querySelectorAll(".vd-row").length);
  await V.key("Down");
  await sleep(150);
  check("Down from the search field goes into the list", active()?.classList.contains("vd-row"), V.focus());
  search.focus();
  search.select();
  await V.key("Backspace");
  await sleep(300);

  b.root.querySelector(`.vd-row[data-id="${done}"]`)?.focus();
  const donePath = engine.get(done).path;
  await V.key("Delete");
  await sleep(350);
  check("Delete removes the row", !engine.get(done));
  check("... and never the file", await IOUtils.exists(donePath), donePath);
  check("the selection moves to a neighbour, focus stays in the list", active()?.classList.contains("vd-row"), V.focus());

  let escaped = false;
  for (let i = 0; i < 24 && !escaped; i++) {
    await V.key("Tab");
    escaped = !panel.contains(active());
  }
  check("Tab never leaves the panel", !escaped, V.focus());
  for (let i = 0; i < 24 && !escaped; i++) {
    await V.key("Shift+Tab");
    escaped = !panel.contains(active());
  }
  check("Shift+Tab never leaves the panel", !escaped, V.focus());
  await V.key("Escape");
  await sleep(450);
  check("Esc closes the panel and the page gets focus back", !ui.panel.open && V.focus() === "page", V.focus());

  // ---- the picker ----
  engine.pause(run);
  await DL.open(DL.base + "/video.html", { settle: 1500 });
  await V.key("Ctrl+Shift+D");
  await V.until(() => ui.video.picker.isOpen, "Ctrl+Shift+D to open the picker");
  await sleep(350);
  const picker = ui.video.picker.element;
  check("the picker opens with the checked quality focused", active()?.getAttribute("aria-checked") === "true", V.focus());
  const q1 = active()?.dataset.id;
  await V.key("Down");
  await sleep(120);
  check("Down checks the next quality", active()?.getAttribute("aria-checked") === "true" && active().dataset.id !== q1, V.focus());
  await V.key("Up");
  await sleep(120);
  check("Up goes back", active()?.dataset.id === q1);
  await V.key("Tab");
  check("Tab goes to Change", active()?.classList.contains("vd-change"), V.focus());
  await V.key("Tab");
  check("Tab goes to Download", active()?.classList.contains("vd-go"), V.focus());
  await V.key("Tab");
  check("Tab comes back to the quality", active()?.getAttribute("aria-checked") === "true", V.focus());
  await V.capture("v-keys-04-picker");
  await V.key("Escape");
  await sleep(300);
  check("Esc closes the picker", !ui.video.picker.isOpen && !picker.isConnected);
  await V.key("Ctrl+Shift+D");
  await V.until(() => ui.video.picker.isOpen, "the picker again");
  await sleep(200);
  await V.key("Ctrl+Shift+D");
  await sleep(300);
  check("Ctrl+Shift+D again closes it", !ui.video.picker.isOpen);
  await V.key("Ctrl+Shift+D");
  await V.until(() => ui.video.picker.isOpen, "the picker a third time");
  await sleep(250);
  const before = engine.list().length;
  await V.key("Enter");
  await V.until(() => engine.list().length > before, "Enter to start the download");
  const vid = engine.list().find((v) => v.stream && v.state !== "completed")?.id ?? engine.list()[0].id;
  check("Enter on the quality downloads it", !!vid && !ui.video.picker.isOpen);
  await V.until(() => ["downloading", "paused", "saved"].includes(ui.video.state.mode), "the pill to follow the download", 10000);
  check("the pill stays on the video with the download", ui.video.state.shown, ui.video.state.mode);
  await DL.until(vid, ["completed"], { timeout: 60000 });

  // ---- the quit prompt ----
  engine.resume(run);
  await DL.until(run, ["downloading"], { timeout: 15000 });
  b.run("quit");
  await V.until(() => ui.prompt.isOpen, "the quit prompt");
  await sleep(250);
  const keep = b.root.querySelector(".vd-q-keep");
  const go = b.root.querySelector(".vd-q-go");
  check("the quit prompt focuses Keep downloading", active() === keep, V.focus());
  await V.key("Tab");
  check("Tab goes to Quit", active() === go, V.focus());
  await V.key("Tab");
  check("Tab cycles back to Keep downloading", active() === keep, V.focus());
  await V.key("Shift+Tab");
  check("Shift+Tab goes to Quit", active() === go, V.focus());
  await V.key("Escape");
  await sleep(300);
  check("Esc keeps Vitre and the download", !ui.prompt.isOpen && !window.closed && engine.get(run).state === "downloading");
  b.run("quit");
  await V.until(() => ui.prompt.isOpen, "the quit prompt again");
  await sleep(200);
  await V.key("Enter");
  await sleep(300);
  check("Enter on Keep downloading keeps going", !ui.prompt.isOpen && engine.get(run).state === "downloading");

  engine.cancel(run);
  await sleep(300);
  const errs = V.errors();
  check("no Vitre errors in the console", errs.length === 0, errs);
  log("done");
});
