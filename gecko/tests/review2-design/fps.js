// Design review: find (light, dark, busy pages, no matches, hidden bar), peek (light and dark pages,
// mid-open, with history), switcher (deck, grid, strip; System and Light modes; search) in one window.
/* global spike, Services, R, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b, dump, shot, sleep, log, cs, R4 } = R;
  await R.inner(1440, 900);
  await spike.activate();
  const darkTarget = "<!doctype html><meta charset=utf-8><title>ETag mismatch · vitre-shell</title><link rel=icon href='/icon/v.svg'><body style='margin:0;background:#0f1115;color:#e6e8ee;font:15px/22px Segoe UI'><main style='max-width:860px;margin:0 auto;padding:40px'><h1>#39 ETag mismatch on resume</h1>" +
    "<p>ETag values differ after a range request. The ETag of the second response is weak.</p>".repeat(8) + "<a id='more' style='color:#7df3d0' href='/shell'>Related: #38</a></main>";
  await IOUtils.writeUTF8(PathUtils.join(spike.outDir, "issue.html"), darkTarget);
  const darkSrc = "<!doctype html><meta charset=utf-8><title>Issues · vitre-shell</title><link rel=icon href='/icon/v.svg'><body style='margin:0;background:#0f1115;color:#e6e8ee;font:15px/22px Segoe UI'>" +
    Array.from({ length: 20 }, (_, i) => `<div style="padding:14px 48px;border-bottom:1px solid #2a2d36"><a id="i${i}" style="color:#e6e8ee" href="issue.html">#${41 - i} ETag mismatch on resume after a range request</a></div>`).join("");
  await IOUtils.writeUTF8(PathUtils.join(spike.outDir, "issues.html"), darkSrc);
  const lightSrc = "<!doctype html><meta charset=utf-8><title>Float glass · Refract</title><link rel=icon href='/icon/r.svg'><body style='margin:0;background:#fbfaf7;color:#1b1d21;font:17px/28px Georgia'><main style='max-width:760px;margin:0 auto;padding:40px'><h1>Float glass</h1>" +
    "<p>Float glass is made by pouring molten glass onto a bath of tin. <a id='lk' href='/article'>How a pane is floated</a> explains the float line in detail.</p>".repeat(6) + "</main>";
  await IOUtils.writeUTF8(PathUtils.join(spike.outDir, "ref.html"), lightSrc);

  const light = await R.go(R.outUrl("ref.html"));
  const dark = await R.open(R.outUrl("issues.html"));
  const busy = await R.open(R.site("club", "/busy"));
  const art = await R.open(R.site("fieldnotes", "/article"));
  const home = b.newTab();
  await sleep(1500);
  b.activate(light);
  await sleep(900);

  const find = () => b.service("find");
  const findDump = (tag) => {
    const face = document.querySelector("#layer-find .vf-face, #layer-find .vf-pill, #layer-find > *");
    dump(tag, { theme: b.theme(), rootClass: b.root.className, face: R4(face), faceCls: face && face.className, counter: document.querySelector("#layer-find .vf-count, #layer-find [class*=count]")?.textContent });
  };
  const doFind = async (tag, tab, q) => {
    b.activate(tab);
    await sleep(900);
    await R.settled();
    find().open({ query: q });
    await sleep(1100);
    findDump(tag);
    await shot(tag);
  };
  await doFind("f-light-results", light, "float");
  spike.type("zzqx");
  await sleep(900);
  findDump("f-light-none");
  await shot("f-light-none");
  find().close();
  await sleep(500);
  await doFind("f-dark-results", dark, "ETag");
  find().close();
  await sleep(400);
  await doFind("f-busy-results", busy, "Slow");
  find().close();
  await sleep(400);
  // parked: focus to the page
  await doFind("f-article-results", art, "glass");
  b.focusPage();
  await sleep(700);
  await shot("f-article-parked");
  find().close();
  await sleep(500);
  // hidden bar
  await R.setSettings({ barAutoHide: true }, 1500);
  R.mouse(700, 600, { type: "mousemove" });
  await sleep(1500);
  await doFind("f-hidden", art, "glass");
  find().close();
  await sleep(1200);
  await R.setSettings({ barAutoHide: false }, 1200);

  // ---- peek ----
  const peek = () => b.service("peek");
  const peekDump = (tag) => {
    const sheet = document.querySelector("#layer-peek .vp-sheet");
    const head = document.querySelector("#layer-peek .vp-head");
    dump(tag, { sheet: R4(sheet), head: R4(head), headBg: head && cs(head).backgroundColor, id: document.querySelector("#layer-peek .vp-id")?.textContent });
  };
  b.activate(light);
  await sleep(800);
  const lr = await R.rectOf("#lk", light.browser);
  Services.prefs.setIntPref("vitre.debug.peekMotionScale", 4);
  R.click(lr.cx, lr.cy, { shiftKey: true });
  await sleep(4 * 150);
  await shot("pk-light-opening");
  await sleep(4 * 500);
  Services.prefs.setIntPref("vitre.debug.peekMotionScale", 1);
  await sleep(1500);
  peekDump("pk-light-open");
  await shot("pk-light-open");
  // header hover tooltip on Open as tab
  const openBtn = document.querySelector("#layer-peek .vp-actions button");
  if (openBtn) {
    const r = openBtn.getBoundingClientRect();
    R.mouse(r.left + 16, r.top + 16, { type: "mousemove" });
    await sleep(1200);
    await shot("pk-light-tip");
  }
  // find in the peek
  find().open({ query: "float" });
  await sleep(1000);
  await shot("pk-light-find");
  find().close();
  await sleep(400);
  peek().close();
  await sleep(1500);
  b.activate(dark);
  await sleep(900);
  const dr = await R.rectOf("#i2", dark.browser);
  R.click(dr.cx - 100, dr.cy, { shiftKey: true });
  await sleep(2500);
  peekDump("pk-dark-open");
  await shot("pk-dark-open");
  // navigate inside the peek (back button appears)
  const pb = peek().browser();
  if (pb) {
    const mr = await R.rectOf("#more", pb);
    if (mr) {
      R.click(mr.cx, mr.cy);
      await sleep(2000);
      peekDump("pk-dark-hop");
      await shot("pk-dark-back");
    }
  }
  find().open({ query: "ETag" });
  await sleep(1000);
  await shot("pk-dark-find");
  find().close();
  await sleep(300);
  peek().close();
  await sleep(1500);

  // ---- switcher ----
  const sw = () => b.service("switcher");
  for (const mode of ["system", "light"]) {
    await R.setSettings({ theme: mode }, 1200);
    for (const style of ["deck", "grid", "strip"]) {
      await R.setSettings({ switcherStyle: style }, 600);
      b.activate(dark);
      await sleep(900);
      sw().open("latched");
      await sleep(1600);
      dump(`sw-${mode}-${style}`, { rootClass: b.root.className });
      await shot(`sw-${mode}-${style}`);
      spike.press("Escape");
      await sleep(900);
      if (mode === "light" && style !== "strip") continue;
    }
  }
  await R.setSettings({ theme: "system", switcherStyle: "deck" }, 800);
  b.activate(light);
  await sleep(800);
  sw().open("search");
  await sleep(1200);
  spike.type("vit");
  await sleep(1000);
  await shot("sw-search-deck");
  spike.press("Escape");
  await sleep(800);
  await R.setSettings({ switcherStyle: "grid" }, 600);
  sw().open("search");
  await sleep(1200);
  spike.type("vit");
  await sleep(1000);
  await shot("sw-search-grid");
  spike.press("Escape");
  await sleep(800);
  await R.setSettings({ switcherStyle: "deck" }, 600);
  log("home", home && home.url);
  log("errors", JSON.stringify(R.errors()));
  log("done");
});
