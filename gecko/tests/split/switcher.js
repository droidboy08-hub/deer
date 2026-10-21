// The switcher and split view (../design/SPLIT-VIEW-SPEC.md "With the rest of Deer": Switcher): a pair
// is one card showing both pages at the ratio with the gutter scaled; in the dock it is the capsule
// at dock size; a search matches either side and opening the result focuses the side that matched;
// Ctrl+W or Delete on a pair card closes both tabs (two closed-list entries). Grid and strip draw the
// same card.
/* global spike, SL */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b } = SL;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const sw = () => window.vitreSwitcher.state();
  const api = () => b.service("switcher");
  const settings = b.sys("VitreSettings");
  async function open() {
    api().open("latched");
    await SL.until(() => sw().phase === "open", 4000);
    await sleep(700);
  }
  async function shut() {
    if (sw().phase !== "idle") api().close();
    await SL.until(() => sw().phase === "idle", 4000);
    await sleep(400);
  }
  const card = (id, kind = "dcard") => document.querySelector(`.sw-${kind}[data-id="${id}"]`);
  /** Read a pixel of a card's picture at a fraction of its width and height. */
  function pixel(c, fx, fy) {
    const canvas = c.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const d = ctx.getImageData(Math.round(fx * (canvas.width - 1)), Math.round(fy * (canvas.height - 1)), 1, 1).data;
    return [d[0], d[1], d[2]];
  }
  const lum = (p) => (p[0] + p[1] + p[2]) / 3;
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  log("--- 1. the pair is one card, both pages at the ratio with the gutter scaled");
  let [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(900);
  b.splitRatio(undefined, 0.4);
  await sleep(600);
  await open();
  let st = sw();
  check("the switcher lists the pair once (the side used last stands for it) and Links", st.list.length === 2 && st.list.includes(fn.id) && !st.list.includes(tl.id) && st.list.includes(ln.id), st.list);
  const pc = card(fn.id);
  check("the pair's card is named for both sides and as the current tab", pc?.getAttribute("aria-label") === "Field Notes and Tideline, split view, current tab", pc?.getAttribute("aria-label"));
  await SL.until(() => !pc.querySelector(".sw-media").classList.contains("none"), 4000);
  await sleep(300);
  const share = b.splitView.layoutShare(b.splitView.active());
  const W = pc.querySelector("canvas").width;
  const g = Math.max(1, Math.round((8 * W) / window.innerWidth));
  const gutterX = (Math.round(share * (W - g)) + g / 2) / (W - 1);
  const leftPx = pixel(pc, share * 0.5, 0.6);
  const rightPx = pixel(pc, share + (1 - share) * 0.5, 0.6);
  const gutterPx = pixel(pc, gutterX, 0.6);
  check("its picture: Field Notes (light) on the left 40%, Tideline (dark) on the right", lum(leftPx) > 180 && lum(rightPx) < 70, { leftPx, rightPx, share });
  const want = dark ? 32 : 243;
  check("…with the gutter between them, scaled, in the Appearance mode's colour", Math.abs(gutterPx[0] - want) <= 12 && Math.abs(gutterPx[2] - want) <= 12, { gutterPx, want, at: gutterX });
  check("the card's label shows both favicons with the hairline between", !!pc.querySelector(".sw-dlabel .sw-pairfav") && pc.querySelectorAll(".sw-dlabel .sw-pairfav .fav").length === 2);
  const dot = document.querySelector(`.sw-dot[data-id="${fn.id}"]`);
  check("in the dock the pair is the capsule at dock size: 88 px (two dots and the gap), two favicons, a hairline", dot?.classList.contains("pair") && Math.round(dot.getBoundingClientRect().width) === 88 && dot.querySelectorAll(".pf .fav").length === 2 && !!dot.querySelector(".hair"), dot && { w: dot.getBoundingClientRect().width, cls: dot.className });
  await spike.capture("switcher-1-pair-card");

  log("--- 2. a search matches either side; opening the result shows the side that matched");
  const input = document.querySelector(".sw-input");
  input.value = "dark.html";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(400);
  st = sw();
  check("'dark.html' (Tideline's address) finds the pair's card", st.list.length === 1 && st.list[0] === fn.id, st.list);
  check("…its label is Tideline's, the side that matched, with the match marked", (card(fn.id)?.querySelector(".sw-dlabel .t")?.textContent ?? "") === "Tideline" && !!card(fn.id)?.querySelector(".sw-dlabel mark"), card(fn.id)?.querySelector(".sw-dlabel")?.textContent);
  spike.press("Enter");
  await SL.until(() => sw().phase === "idle", 4000);
  await sleep(400);
  check("Enter opened the pair on Tideline, the side that matched", b.active() === tl && b.splitView.showing()?.right === tl, { active: b.active()?.title });
  await open();
  input.value = "Field";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(300);
  check("'Field' finds the same card through the other side", sw().list.length === 1 && sw().list[0] === tl.id, sw().list);
  spike.press("Enter");
  await SL.until(() => sw().phase === "idle", 4000);
  await sleep(400);
  check("…and opens on Field Notes", b.active() === fn && !!b.splitView.showing());

  log("--- 3. Ctrl+W on a pair card closes both tabs (two entries on the closed list)");
  await open();
  st = sw();
  check("set-up: the switcher opened on Links (the previous entry)", st.selected === ln.id, st);
  spike.press("Left");
  await sleep(300);
  check("set-up: the pair's card selected", sw().selected === fn.id, sw());
  const closed0 = b.closedCount();
  spike.press("Ctrl+W");
  await SL.until(() => !b.tabs.includes(fn) && !b.tabs.includes(tl), 4000);
  await sleep(400);
  check("Ctrl+W closed both sides; Links stays; the switcher is still up without the card", !b.tabs.includes(fn) && !b.tabs.includes(tl) && b.tabs.includes(ln) && sw().phase === "open" && !sw().list.includes(fn.id), { tabs: b.tabs.map((t) => t.title), st: sw() });
  check("two entries on the closed-tab list", b.closedCount() - closed0 === 2, { before: closed0, after: b.closedCount() });
  await shut();

  log("--- 4. Delete on a pair card does the same");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(800);
  b.activate(ln);
  await sleep(500);
  await open();
  check("set-up: the pair's card is the previous entry (selected)", sw().selected === fn.id || sw().selected === tl.id, sw());
  const id4 = sw().selected;
  spike.press("Delete");
  await SL.until(() => !b.tabs.includes(fn) && !b.tabs.includes(tl), 4000);
  await sleep(300);
  check("Delete closed both sides of the pair card", !b.tabs.includes(fn) && !b.tabs.includes(tl) && !sw().list.includes(id4), b.tabs.map((t) => t.title));
  await shut();

  log("--- 5. grid and strip draw the same pair card");
  [fn, tl, ln] = await SL.scene(["dark.html", "links.html"]);
  b.split(tl);
  await SL.shown();
  await sleep(800);
  for (const style of ["grid", "strip"]) {
    settings.set({ switcherStyle: style });
    await sleep(300);
    await open();
    const kind = style === "grid" ? "gcard" : "scard";
    const c = card(fn.id, kind);
    check(`${style}: one card for the pair, named for both sides, both favicons in its label`, !!c && !card(tl.id, kind) && c.getAttribute("aria-label").startsWith("Field Notes and Tideline, split view") && !!c.querySelector(".sw-pairfav"), c?.getAttribute("aria-label"));
    if (style === "grid") check("grid: the pair card's x says Close both tabs", c.querySelector(".sw-x")?.dataset.tip === "Close both tabs", c.querySelector(".sw-x")?.dataset.tip);
    await spike.capture(`switcher-2-${style}`);
    await shut();
  }
  settings.set({ switcherStyle: "deck" });
  await sleep(300);
  log("done");
});
