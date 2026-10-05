// Switcher verification over unusual pages and states: Home (an in-process page) as the start tab,
// pictures of WebGL and of a playing video stream, a window resized while the deck is up, Ctrl+W on a
// filtered search result, and long, right-to-left and emoji titles.
// python tools/run.py --test tests/switcher-verify/pages.js --name swverify-pages --app build-switcher-verify --timeout 300
/* global spike, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js?" + Date.now(), window);

spike.main(async () => {
  const { b, check, log, sleep, press, down, up, state, waitFor } = V;
  V.consoleStart();
  await spike.resize(1440, 900);
  await spike.activate();
  const gl = V.page("WebGL red", "#fff", `<canvas id=c width=1400 height=700 style="position:fixed;left:0;top:0;width:100vw;height:100vh"></canvas><script>const g=document.getElementById('c').getContext('webgl');g.clearColor(0.85,0.1,0.1,1);g.clear(g.COLOR_BUFFER_BIT);</script>`);
  const video = V.page("Stream green", "#fff", `<canvas id=s width=320 height=180 style="display:none"></canvas><video id=v autoplay muted style="position:fixed;left:0;top:0;width:100vw;height:100vh;object-fit:cover"></video><script>const s=document.getElementById('s'),x=s.getContext('2d');let n=0;setInterval(()=>{x.fillStyle=n++%2?'#12a032':'#14a836';x.fillRect(0,0,320,180)},50);const v=document.getElementById('v');v.srcObject=s.captureStream(20);v.play();</script>`);
  const long = V.page("A very long title that goes on and on about float glass, molten tin, the Pilkington process and everything that came after it in the twentieth century", "#eef");
  const rtl = V.page("זכוכית צפה — ויקיפדיה", "#efe");
  const emoji = V.page("Glass 🪟 and light ✨ notes", "#fee");
  const tabs = await V.openTabs([gl, video, long, rtl, emoji]);
  await sleep(1500);
  const colourOf = (tab) => {
    const c = document.querySelector(`#layer-switcher [data-id="${tab.id}"] .sw-media canvas`);
    if (!c || !c.width) return null;
    const d = c.getContext("2d").getImageData(Math.floor(c.width / 2), Math.floor(c.height * 0.6), 1, 1).data;
    return [d[0], d[1], d[2]];
  };

  // ---- 1. WebGL and a playing video stream are pictured ----
  await V.setStyle("grid");
  await V.latched();
  await sleep(1500);
  const red = colourOf(tabs[0]);
  const green = colourOf(tabs[1]);
  await spike.capture("pages-grid-media");
  press("Escape");
  await V.closed();
  check("a WebGL page's card shows its canvas (red)", !!red && red[0] > 180 && red[1] < 80 && red[2] < 80, red);
  log("a video stream in a background tab that was never shown (background video may be suspended):", green);
  // The realistic case: a video tab you watched, then left. Its card is pictured as you leave it.
  b.activate(tabs[1]);
  await sleep(1500);
  b.activate(tabs[0]);
  await sleep(800);
  await V.latched();
  await sleep(800);
  const watched = colourOf(tabs[1]);
  press("Escape");
  await V.closed();
  check("a page playing a video stream that you watched and left: its card shows the video frame (green)", !!watched && watched[1] > 120 && watched[0] < 80 && watched[2] < 100, watched);

  // ---- 2. Home as the start tab ----
  log("--- Home");
  const home = b.newTab();
  await sleep(1500);
  log("home", { kind: home.kind, url: home.url, active: b.activeId === home.id, omni: b.omni.open });
  if (b.omni.open) b.omni.close();
  b.focusPage();
  await sleep(300);
  await V.setStyle("deck");
  down("Control");
  press("Tab");
  await sleep(30);
  up("Control");
  await sleep(500);
  const afterTap = V.active();
  b.activate(home);
  await sleep(600);
  b.focusPage();
  await V.holdOpen(1);
  await sleep(700);
  const homeCard = document.querySelector(`#layer-switcher [data-id="${home.id}"] .sw-media`);
  const homeLabel = document.querySelector(`#layer-switcher [data-id="${home.id}"] .sw-dlabel`)?.textContent;
  await spike.capture("pages-home-start");
  press("Shift+Tab");
  await sleep(100);
  await V.release();
  check("Home as the current tab: a quick tap leaves it, the held deck pictures it with the label 'Home  Start page', and cancelling returns to it", afterTap !== "Home" && homeCard && !homeCard.classList.contains("none") && /HomeStart page/.test(homeLabel || "") && V.active() === "Home", { afterTap, painted: homeCard && !homeCard.classList.contains("none"), homeLabel, active: V.active() });

  // ---- 3. the window is resized while the deck is up ----
  await V.latched();
  const before = V.rect(document.querySelector("#layer-switcher .sw-dcard.sel"));
  await spike.resize(1100, 700);
  await sleep(900);
  const after = V.rect(document.querySelector("#layer-switcher .sw-dcard.sel"));
  const dock = V.rect(document.querySelector("#layer-switcher .sw-dock"));
  await spike.capture("pages-deck-resized");
  press("Escape");
  await V.closed();
  check("resized while the deck is up: the card keeps the window's shape at 60% height and the dock stays 70 px off the bottom, centred", Math.abs(after.h - innerHeight * 0.6) <= 1 && Math.abs(after.w / after.h - innerWidth / innerHeight) < 0.01 && Math.abs(innerHeight - dock.y - dock.h - 70) <= 1 && Math.abs(dock.x + dock.w / 2 - innerWidth / 2) <= 1, { before, after, dock, inner: [innerWidth, innerHeight] });
  await spike.resize(1440, 900);
  await sleep(500);

  // ---- 4. Ctrl+W on a filtered result ----
  log("--- Ctrl+W on a search result");
  await V.setStyle("grid");
  press("Shift+A", { ctrlKey: true });
  await waitFor(() => state().phase === "open", { what: "search" });
  await sleep(300);
  V.EU.sendString("glass", window);
  await sleep(300);
  const q0 = { ...state(), count: document.querySelector("#layer-switcher .sw-count").textContent };
  const doomed = V.sel();
  press("W", { ctrlKey: true });
  await sleep(500);
  const q1 = { ...state(), count: document.querySelector("#layer-switcher .sw-count").textContent, tabs: b.tabs.length };
  log("filtered close", { q0, doomed, q1 });
  check("while a search filters, Ctrl+W closes only the highlighted result; the query stays and the count follows", q0.list.length === 2 && q1.query === "glass" && q1.list.length === 1 && !b.tabs.some((t) => t.title === doomed) && q1.count === `1 of ${b.tabs.length}`, { q0, q1, doomed });
  await spike.capture("pages-grid-filtered-close");
  // Clearing the query brings every tab back, the selection stays on the highlighted one.
  const selBefore = state().selected;
  for (let i = 0; i < 5; i++) press("Backspace");
  await sleep(300);
  // Every change of the query selects its first match (TabSearch); an empty query keeps the selection it had.
  check("clearing the query lists every tab again with a live selection and no count", state().list.length === b.tabs.length && !!b.tab(state().selected) && document.querySelector("#layer-switcher .sw-count").textContent === "", { list: state().list.length, tabs: b.tabs.length, sel: state().selected, selBefore });
  press("Escape");
  await V.closed();

  // ---- 5. long, right-to-left and emoji titles ----
  for (const style of ["deck", "grid", "strip"]) {
    await V.setStyle(style);
    b.activate(b.tabs.find((t) => t.title.startsWith("A very long")));
    await sleep(500);
    await V.latched("search");
    await sleep(400);
    const label = document.querySelector("#layer-switcher .sw-dcard.sel .sw-dlabel, #layer-switcher .sw-gcard.sel .sw-glabel, #layer-switcher .sw-scard.sel .sw-slabel");
    const r = label?.getBoundingClientRect();
    const t = label?.querySelector(".t");
    const clipped = t ? t.scrollWidth > t.clientWidth : false;
    await spike.capture(`pages-titles-${style}`);
    check(`${style}: a very long title is cut with an ellipsis inside its card's width`, !!r && clipped && r.width <= (label.closest(".sw-dcard, .sw-gcard, .sw-scard").getBoundingClientRect().width + 1), { w: r?.width, clipped });
    press("Escape");
    await V.closed();
  }
  await V.setStyle("deck");
  const c = V.consoleDump("pages");
  check("no console errors from Vitre over these pages", c.vitre === 0, c);
});
