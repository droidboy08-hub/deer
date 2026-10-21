// Split view's glass beyond the bar items (../design/SPLIT-VIEW-SPEC.md "Split pill": Glass and
// Mixed tint; "With the rest of Deer": Find; boards SplitPill, SplitStart "The empty side", FindPill
// mixedLight / mixedDark): one contact shadow for the split pill, the darker page's; the mixed tint
// on the address field's suggestions and on the find face; none of it without a split.
/* global spike, SL */
Services.scriptloader.loadSubScript("resource://vitre-boot/slib.js", window);
spike.main(async () => {
  const { b } = SL;
  const { check, log, sleep } = spike;
  await spike.resize(1440, 900);
  await spike.activate();
  const DARK_SHADOW = "rgba(0, 0, 0, 0.25)";
  const panel = () => document.getElementById("vitre-omni-panel");
  const face = () => document.querySelector("#layer-find .vf-face");
  async function suggestions(query) {
    b.editAddress(query);
    await SL.until(() => b.omni.open && !panel().hidden, 5000);
    await sleep(250);
  }
  async function closeField() {
    b.omni.close();
    await sleep(300);
  }
  async function find() {
    b.focusPage();
    await sleep(150);
    spike.press("Ctrl+F");
    await SL.until(() => face() && !face().hidden && face().classList.contains("vf-find"), 4000);
    await sleep(300);
  }
  async function closeFind() {
    b.service("find")?.close();
    await sleep(500);
  }

  log("--- 1. without a split: the bar, the suggestions and find are as they always were");
  let [fn, tl] = await SL.scene(["dark.html"]);
  await SL.settled();
  const pillItem = b.bar.item(fn.id);
  check("one tab: no contact-shadow class on its pill", ![...pillItem.classList].some((c) => c.startsWith("sh-")), pillItem.className);
  const layers = (item) => [...item.children].slice(0, 3).map((c) => c.className).join();
  check("one tab: every bar item is the glass it always was (lens, tint, rim; no mixed-tint layer)", !document.querySelector("#vitre-bar .item > .tint-mix") && [...document.querySelectorAll("#vitre-bar .item")].every((x) => layers(x) === "lens,tint,rim"), [...document.querySelectorAll("#vitre-bar .item")].map(layers));
  await suggestions("Tide");
  const t0 = getComputedStyle(panel().querySelector(":scope > .tint"));
  check("one tab: the suggestions' own tint (rgba(28,28,34,0.8)), no mixed class", !panel().classList.contains("mixed") && t0.backgroundColor === "rgba(28, 28, 34, 0.8)", t0.backgroundColor);
  await closeField();
  await find();
  check("one tab: the find face is not mixed", !face().classList.contains("vf-mixed"));
  await closeFind();

  log("--- 2. a pair whose pages disagree: one contact shadow, the darker page's");
  b.split(tl);
  await SL.shown();
  await sleep(800);
  const item = SL.pairItem();
  const cs = getComputedStyle(item).boxShadow;
  check("Field Notes (light) focused beside Tideline (dark): the split pill's shadow is the dark page's (0 10px 28px rgba(0,0,0,0.25))", item.classList.contains("sh-dark") && cs.includes(DARK_SHADOW) && cs.includes("10px 28px"), { cls: item.className, cs });
  const circle = document.querySelector("#vitre-bar .item.plus");
  check("…the circles keep the bar theme's own shadow", !getComputedStyle(circle).boxShadow.includes(DARK_SHADOW), getComputedStyle(circle).boxShadow);
  b.activate(tl);
  await sleep(500);
  check("Tideline focused (dark bar): the darker page is the bar's own theme, no extra class", ![...SL.pairItem().classList].some((c) => c.startsWith("sh-")) && getComputedStyle(SL.pairItem()).boxShadow.includes(DARK_SHADOW), SL.pairItem().className);
  b.activate(fn);
  await sleep(500);
  await spike.capture("glass-1-shadow");

  log("--- 3. the address field's suggestions take the mixed tint");
  await suggestions("Tide");
  const t1 = getComputedStyle(panel().querySelector(":scope > .tint"));
  check("the suggestions panel takes the dark mixed tint (gradient over rgba(16,16,20,0.72)), as the field does", panel().classList.contains("mixed") && document.getElementById("vitre-omni-field").classList.contains("mixed") && t1.backgroundColor === "rgba(16, 16, 20, 0.72)" && t1.backgroundImage.includes("0.12"), { bg: t1.backgroundColor, img: t1.backgroundImage });
  await spike.capture("glass-2-suggestions");
  await closeField();

  log("--- 4. the find face takes the mixed tint over a pair whose pages disagree");
  await find();
  const f = face();
  const focusTint = getComputedStyle(f).getPropertyValue("--vf-focus");
  check("find on the light side: vf-mixed, its focused tint the light mixed gradient (0.70 -> 0.54)", f.classList.contains("vf-mixed") && focusTint.includes("0.7") && focusTint.includes("0.54"), { cls: f.className, focusTint });
  const hi = getComputedStyle(f.querySelector(".vf-hi"));
  check("…and that is what the field shows while it has focus", hi.backgroundImage.includes("0.7") && hi.opacity === "1", { img: hi.backgroundImage, op: hi.opacity });
  await spike.capture("glass-3-find");
  await closeFind();
  b.activate(tl);
  await sleep(500);
  await find();
  const fd = getComputedStyle(face()).getPropertyValue("--vf-focus");
  check("find on the dark side: the dark mixed tint (over rgba(16,16,20,0.72))", face().classList.contains("vf-mixed") && fd.includes("0.72"), fd);
  await closeFind();

  log("--- 5. two pages of one theme: no mixed tint anywhere, the bar theme's own shadow");
  [fn, tl] = await SL.scene(["light.html?two"]);
  b.split(tl);
  await SL.shown();
  await sleep(800);
  check("two light pages: no shadow class, no mixed item", ![...SL.pairItem().classList].some((c) => c.startsWith("sh-")) && SL.items().every((x) => !x.mixed), SL.pairItem().className);
  await suggestions("Field");
  check("…the suggestions are not mixed", !panel().classList.contains("mixed"));
  await closeField();
  await find();
  check("…nor is the find face", !face().classList.contains("vf-mixed"));
  await closeFind();

  log("--- 6. the split ends: the mixed tint's layers go once their fade is over");
  check("set-up: while the split shows every item has its mixed-tint layer", [...document.querySelectorAll("#vitre-bar .item:not(.leaving)")].every((x) => !!x.querySelector(":scope > .tint-mix")));
  b.separate();
  await sleep(900);
  check("after the split: no mixed-tint layer is left; the items are lens, tint, rim again", !document.querySelector("#vitre-bar .item > .tint-mix") && [...document.querySelectorAll("#vitre-bar .item:not(.leaving)")].every((x) => layers(x) === "lens,tint,rim"), [...document.querySelectorAll("#vitre-bar .item")].map(layers));
  log("done");
});
