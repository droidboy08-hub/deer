// Design review: the glass menus in every context (page, link, image, selection, editable, pill,
// background circle, +, downloads ring, Home wallpaper) over light, dark and busy pages, in the
// System (Windows) mode and in Light mode. Captures + DUMP lines with each menu's rows and rectangle.
/* global spike, Services, R, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b, dump, shot, sleep, log } = R;
  await R.inner(1440, 900);
  await spike.activate();
  const page = (bg, fg, link, extra = "") =>
    `<!doctype html><meta charset=utf-8><title>Menus ${bg}</title><body style="margin:0;background:${bg};color:${fg};font:17px/1.6 'Segoe UI'">` +
    `<main style="max-width:760px;margin:0 auto;padding:40px 32px">${extra}<h1 style="font-size:40px;margin:0 0 12px">Float glass</h1>` +
    `<p id="p1">Most flat glass made today is float glass. Molten glass is poured onto a bath of molten tin, where surface tension pulls it into a sheet. <a id="lnk" style="color:${link}" href="/article">The counter page</a> explains the rest.</p>` +
    `<p><input id="field" value="float glass" style="font:16px 'Segoe UI';width:300px;padding:6px"></p>` +
    `<img id="img" width="240" height="134" style="border-radius:12px;display:block;background:linear-gradient(#7cc,#258)" src="/icon/t.svg">` +
    `<p>The process was developed by Pilkington in the 1950s.</p><div style="height:1400px"></div></main>`;
  const busyBg = "<div style='position:fixed;inset:0;z-index:-1;display:grid;grid-template-columns:repeat(8,1fr)'>" +
    Array.from({ length: 48 }, (_, i) => `<div style="background:hsl(${(i * 37) % 360} 70% ${30 + (i * 13) % 45}%)"></div>`).join("") + "</div>";
  await IOUtils.writeUTF8(PathUtils.join(spike.outDir, "light.html"), page("#fbfaf7", "#1b1b1f", "#005fb8"));
  await IOUtils.writeUTF8(PathUtils.join(spike.outDir, "dark.html"), page("#0f1115", "#e6e8ee", "#7df3d0"));
  await IOUtils.writeUTF8(PathUtils.join(spike.outDir, "busy.html"), page("#222", "#fff", "#fff", busyBg));

  const light = await R.go(R.outUrl("light.html"));
  const dark = await R.open(R.outUrl("dark.html"));
  const busy = await R.open(R.outUrl("busy.html"));
  b.activate(light);
  await sleep(800);
  await R.settled();

  const at = async (tag, x, y) => {
    R.rightClick(x, y);
    const ok = await R.waitMenu();
    if (!ok) {
      log("NOMENU", tag);
      return;
    }
    R.menuDump(tag);
    await shot(tag);
    spike.press("Escape");
    await sleep(350);
    await R.closeMenu();
  };
  const onEl = async (tag, sel, tab, dx) => {
    const r = await R.rectOf(sel, tab.browser);
    if (!r) return log("NOEL", sel);
    await at(tag, dx != null ? r.x + dx : r.cx, r.cy);
  };

  for (const mode of ["system", "light"]) {
    await R.setSettings({ theme: mode }, 1200);
    dump("mode " + mode, { matchDark: window.matchMedia("(prefers-color-scheme: dark)").matches, rootClass: b.root.className });
    for (const [name, tab] of [["light", light], ["dark", dark], ["busy", busy]]) {
      b.activate(tab);
      await sleep(900);
      await R.settled();
      await at(`m-${mode}-${name}-page`, 1000, 640);
      await onEl(`m-${mode}-${name}-link`, "#lnk", tab, 20);
    }
    b.activate(light);
    await sleep(800);
    await onEl(`m-${mode}-light-image`, "#img", light);
    await onEl(`m-${mode}-light-field`, "#field", light);
    await R.inContent(light.browser, (content) => {
      const p = content.document.getElementById("p1");
      const t = p.firstChild;
      const r = content.document.createRange();
      r.setStart(t, 0);
      r.setEnd(t, 28);
      const s = content.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return true;
    });
    await sleep(200);
    await onEl(`m-${mode}-light-selection`, "#p1", light, 60);
    // chrome surfaces
    const pill = b.bar.item(b.activeId);
    const pr = pill.getBoundingClientRect();
    await at(`m-${mode}-pill`, pr.left + 200, pr.top + 22);
    const circle = [...document.querySelectorAll("#vitre-bar .item")].find((el) => !el.classList.contains("active") && !el.classList.contains("plus") && el.getClientRects().length);
    if (circle) {
      const cr = circle.getBoundingClientRect();
      await at(`m-${mode}-circle`, cr.left + 22, cr.top + 22);
    }
    const plus = document.querySelector("#vitre-bar .item.plus");
    if (plus) {
      const r = plus.getBoundingClientRect();
      await at(`m-${mode}-plus`, r.left + 22, r.top + 22);
    }
  }
  await R.setSettings({ theme: "system" }, 1200);

  // the downloads ring (needs a running download)
  b.activate(light);
  await sleep(600);
  b.service("downloads")?.download(R.local("/dl/big.bin?mb=400&kbps=300"), { browser: light.browser, filename: "big-archive.bin" });
  try {
    await R.waitFor(() => document.querySelector(".vd-ring") && document.querySelector(".vd-ring").getClientRects().length, { timeout: 15000, what: "ring" });
  } catch {}
  await sleep(1500);
  const ring = document.querySelector(".vd-ring");
  dump("ring", { rect: R.R4(ring), cls: ring && ring.className });
  await shot("m-ring-over-light");
  if (ring) {
    const r = ring.getBoundingClientRect();
    await at("m-system-ring", r.left + 22, r.top + 22);
  }
  // Home wallpaper
  const home = b.newTab();
  await sleep(2500);
  await R.settled();
  await shot("m-home");
  await at("m-system-home", 700, 600);
  await R.setSettings({ theme: "light" }, 1200);
  await at("m-light-home", 700, 600);
  await R.setSettings({ theme: "system" }, 800);
  log("home tab", home && home.url);
  log("errors", JSON.stringify(R.errors()));
  log("done");
});
