// S10 probe (logic only, --no-capture is fine): the row's DOM as the capsule demo will mirror it, and
// the mechanics the demo relies on. Test-only; nothing in src/ changes.
//   cd gecko && /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s10-probe.js --name mac-glass-s10-probe \
//       --url about:blank --timeout 200 --out tests/menus/out --no-capture
/* global spike, G, Services, gBrowser */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
spike.main(async () => {
  const { check, sleep, log, waitFor } = spike;
  const b = window.vitre;
  const EU = spike.EU;
  await spike.resize(1280, 800);
  await spike.activate();
  const titled = (t, bg, fg = "#1d1d1f") => "data:text/html;charset=utf-8," + encodeURIComponent(
    `<!doctype html><meta charset=utf-8><title>${t}</title><body style="margin:0;background:${bg};color:${fg};font:17px Georgia"><h1 style="margin:80px 40px">${t}</h1>`);
  await G.load(titled("Annealing", "#ffffff"));
  for (const [t, bg, fg] of [["Night Shift", "#15161a", "#e8e8ea"], ["Tideline", "#e9f4f3"], ["Refract", "#f4f2ec"]]) b.newTab(titled(t, bg, fg), { background: true });
  await waitFor(() => b.tabs.length === 4 && b.tabs.every((t) => !t.loading), { what: "tabs" });
  await sleep(1200);

  const root = b.root;
  log("root classes: " + root.className);
  const bar = document.getElementById("vitre-bar");
  const end = document.getElementById("vitre-row-end");
  const winctl = document.getElementById("vitre-winctl");
  const short = (el) => el.outerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>").replace(/\s+/g, " ").slice(0, 3000);
  for (const it of bar.querySelectorAll(":scope > *")) log("BAR CHILD " + it.className + " " + JSON.stringify(it.getBoundingClientRect()) + "\n" + short(it));
  log("ROW-END " + JSON.stringify(end.getBoundingClientRect()) + "\n" + short(end));
  for (const it of end.children) log("ROW-END CHILD " + it.className + " " + JSON.stringify(it.getBoundingClientRect()) + " bg=" + getComputedStyle(it).backgroundColor + " bf=" + getComputedStyle(it).backdropFilter);
  log("WINCTL " + JSON.stringify(winctl.getBoundingClientRect()) + "\n" + short(winctl));

  // Computed styles of the faces.
  const act = b.bar.item(b.active().id);
  const cs = (el, props) => Object.fromEntries(props.map((p) => [p, getComputedStyle(el)[p]]));
  log("ACTIVE ITEM " + JSON.stringify(cs(act, ["left", "top", "width", "height", "borderRadius", "boxShadow", "opacity", "transform"])));
  for (const sel of [".pill-face", ".address", ".host", ".fav", ".fav img", ".reload", ".circle-face", ".title"]) {
    const e = act.querySelector(sel);
    if (e) log("ACTIVE " + sel + " " + JSON.stringify(e.getBoundingClientRect()) + " " + JSON.stringify(cs(e, ["color", "fontSize", "fontWeight", "fontFamily", "letterSpacing", "opacity", "visibility", "display"])));
  }
  const bg = b.bar.item(b.tabs[1].id);
  for (const sel of [".circle-face", ".title", ".fav", ".fav img", ".close-badge"]) {
    const e = bg.querySelector(sel);
    if (e) log("BG " + sel + " " + JSON.stringify(e.getBoundingClientRect()) + " " + JSON.stringify(cs(e, ["color", "fontSize", "fontWeight", "fontFamily", "letterSpacing", "opacity", "visibility", "display"])));
  }

  // -moz-element parse support in chrome.
  const probe = document.createElement("div");
  probe.style.backgroundImage = "-moz-element(#vitre-bar)";
  root.append(probe);
  log("-moz-element inline: " + JSON.stringify(probe.style.backgroundImage) + " computed: " + getComputedStyle(probe).backgroundImage);
  probe.remove();

  // A glass panel over the + capsule, mouse-transparent: does a synthesized move at that point reach Deer's row?
  const plus = bar.querySelector(".item.plus");
  const pr = plus.getBoundingClientRect();
  const p = await G.panel({ x: pr.left, y: pr.top, w: pr.width, h: pr.height, scheme: "light", html: "", name: "probe-plus" });
  let hitRow = 0;
  let hitPanel = 0;
  plus.addEventListener("mousemove", () => hitRow++);
  p.addEventListener("mousemove", () => hitPanel++);
  EU.synthesizeMouseAtPoint(pr.left + 10, pr.top + 10, { type: "mousemove" }, window);
  EU.synthesizeMouseAtPoint(pr.left + 12, pr.top + 12, { type: "mousemove" }, window);
  await sleep(200);
  log("plain panel: moves to row " + hitRow + ", to panel " + hitPanel);
  p.style.pointerEvents = "none";
  await sleep(300);
  hitRow = 0;
  hitPanel = 0;
  EU.synthesizeMouseAtPoint(pr.left + 14, pr.top + 14, { type: "mousemove" }, window);
  EU.synthesizeMouseAtPoint(pr.left + 16, pr.top + 16, { type: "mousemove" }, window);
  await sleep(200);
  log("pointer-events:none panel: moves to row " + hitRow + ", to panel " + hitPanel);

  // keys.ts tracks it as a Firefox panel; closePanels() would close it.
  log("keys.popups has it: " + !!b.keys?.popups?.has?.(p));
  b.keys?.popups?.delete?.(p);
  b.closePanels();
  await sleep(200);
  log("after delete + closePanels: state " + p.state);
  // popuphiding is cancelable?
  let vetoed = 0;
  const veto = (e) => {
    if (e.target === p) {
      e.preventDefault();
      vetoed++;
    }
  };
  p.addEventListener("popuphiding", veto);
  p.hidePopup(false);
  await sleep(200);
  log("popuphiding prevented " + vetoed + ": state " + p.state);
  p.removeEventListener("popuphiding", veto);

  // moveTo / sizeTo cost, per frame, for 60 frames.
  const times = [];
  let x = pr.left;
  await new Promise((done) => {
    let n = 0;
    const step = () => {
      const t0 = performance.now();
      x += 2;
      p.moveTo(Math.round(window.mozInnerScreenX + x), Math.round(window.mozInnerScreenY + pr.top));
      const t1 = performance.now();
      p.sizeTo(Math.round(pr.width + (n % 20)), Math.round(pr.height));
      const t2 = performance.now();
      const r = p.getOuterScreenRect();
      times.push([Math.round((t1 - t0) * 100) / 100, Math.round((t2 - t1) * 100) / 100, Math.round(r.x - window.mozInnerScreenX), Math.round(r.width)]);
      if (++n < 60) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
  log("moveTo/sizeTo ms and Gecko's rect per frame: " + JSON.stringify(times));
  G.closeAll();

  // Hover growth timing: the second tab.
  const t2 = b.bar.item(b.tabs[2].id);
  const r2 = t2.getBoundingClientRect();
  EU.synthesizeMouseAtPoint(r2.left + 20, r2.top + 18, { type: "mousemove" }, window);
  EU.synthesizeMouseAtPoint(r2.left + 22, r2.top + 18, { type: "mousemove" }, window);
  await sleep(1000);
  log("hover: item " + JSON.stringify(t2.getBoundingClientRect()) + " classes " + t2.className + " (before " + JSON.stringify(r2) + ")");
  EU.synthesizeMouseAtPoint(640, 600, { type: "mousemove" }, window);
  await sleep(800);

  // Editing: the field.
  b.editAddress("deer");
  await sleep(900);
  const field = document.getElementById("vitre-omni-field");
  const input = document.getElementById("vitre-omni");
  log("FIELD " + JSON.stringify(field?.getBoundingClientRect()) + "\n" + (field ? short(field) : "none"));
  if (input) log("INPUT " + JSON.stringify(input.getBoundingClientRect()) + " " + JSON.stringify(cs(input, ["color", "fontSize", "fontFamily", "letterSpacing", "paddingLeft", "caretColor"])) + " value=" + input.value + " sel=" + input.selectionStart);
  log("active item while editing: " + JSON.stringify(b.bar.item(b.active().id).getBoundingClientRect()));
  EU.synthesizeKey("KEY_Escape", {}, window);
  EU.synthesizeKey("KEY_Escape", {}, window);
  await sleep(600);
  check("probe ran", true);
});
