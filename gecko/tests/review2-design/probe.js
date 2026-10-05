// Design review probes: measured numbers behind the findings (peek capsule over the favicon with
// history, Settings spacing of registered pages, panel scrollbars, the lenses' opaque step), plus
// Light-mode captures of the registered Settings pages.
/* global spike, Services, R, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b, dump, shot, sleep, log, cs, R4 } = R;
  await R.inner(1440, 900);
  await spike.activate();
  const src = "<!doctype html><meta charset=utf-8><title>Float glass · Refract</title><link rel=icon href='/icon/r.svg'><body style='margin:0;background:#fbfaf7;color:#1b1d21;font:17px/28px Georgia'><main style='max-width:760px;margin:0 auto;padding:40px'><h1>Float glass</h1>" +
    "<p>Float glass is made on a bath of tin. <a id='lk' href='/tideline'>Tideline</a> explains the float line.</p>".repeat(4) + "</main>";
  await IOUtils.writeUTF8(PathUtils.join(spike.outDir, "ref.html"), src);
  const light = await R.go(R.outUrl("ref.html"));

  // 1. peek with history + find
  const lr = await R.rectOf("#lk", light.browser);
  R.click(lr.cx, lr.cy, { shiftKey: true });
  await sleep(2500);
  const pb = b.service("peek").browser();
  const geom = (tag) => {
    const q = (s) => document.querySelector(s);
    dump(tag, {
      head: R4(q("#layer-peek .vp-head")),
      back: q("#layer-peek .vp-back") && cs(q("#layer-peek .vp-back")).display !== "none" ? R4(q("#layer-peek .vp-back")) : null,
      fav: R4(q("#layer-peek .vp-id .fav")),
      favVisible: q("#layer-peek .vp-id .fav") && cs(q("#layer-peek .vp-id .fav")).visibility,
      dom: R4(q("#layer-peek .vp-id .dom")),
      capsule: q(".vf-cap") && !q(".vf-cap").hidden ? R4(q(".vf-cap")) : null,
      capsuleBg: q(".vf-cap") && cs(q(".vf-cap")).backgroundColor,
    });
  };
  b.service("find").open({ query: "float" });
  await sleep(1000);
  geom("peek-nohistory-find");
  await shot("pr-peek-nohistory-find");
  b.service("find").close();
  await sleep(500);
  // navigate inside the sheet: the back chevron appears
  b.navigate ? null : null;
  pb.loadURI(Services.io.newURI(R.site("fieldnotes", "/article")), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  await sleep(2500);
  geom("peek-history");
  b.service("find").open({ query: "glass" });
  await sleep(1000);
  geom("peek-history-find");
  await shot("pr-peek-history-find");
  b.service("find").close();
  await sleep(400);
  b.service("peek").close();
  await sleep(1500);

  // 2. Settings spacing, built-in vs registered pages; scrollbars
  for (const mode of ["system", "light"]) {
    await R.setSettings({ theme: mode }, 1200);
    for (const page of ["appearance", "tabs", "downloads", "shortcuts", "video-downloads", "extensions"]) {
      b.service("settings").open(page);
      await sleep(900);
      const main = document.querySelector(".vs-main");
      const h1 = document.querySelector(".vs-main .vs-h1");
      const first = document.querySelector(".vs-main :is(.vs-h2, .vs-intro, .vs-card, .vx-page p, .vs-ext > *)");
      const h2 = document.querySelector(".vs-main .vs-h2");
      dump(`set-${mode}-${page}`, {
        h1: R4(h1),
        firstAfterH1: first && { cls: first.className, rect: R4(first) },
        firstH2: R4(h2),
        gapH1toH2: h1 && h2 ? +(h2.getBoundingClientRect().top - h1.getBoundingClientRect().bottom).toFixed(1) : null,
        scrollbar: main ? main.offsetWidth - main.clientWidth : null,
        scrollable: main ? main.scrollHeight > main.clientHeight : null,
      });
      if (mode === "light" && (page === "video-downloads" || page === "extensions" || page === "downloads")) await shot(`pr-light-settings-${page}`);
    }
    b.service("settings").close?.();
    await sleep(500);
  }
  await R.setSettings({ theme: "system" }, 900);

  // 3. the lenses' opaque step
  b.service("downloads").openPanel();
  await sleep(1000);
  const dlLens = document.querySelector(".vd-panel > .lens");
  const sLensFilter = (el) => {
    if (!el) return null;
    const v = el.style.backdropFilter || cs(el).backdropFilter;
    const id = (/#([\w-]+)/.exec(v) || [])[1];
    const f = id && document.getElementById(id);
    return { value: v, id, hasOpaqueStep: !!(f && f.querySelector("feComponentTransfer")) };
  };
  dump("downloads-panel-lens", sLensFilter(dlLens));
  spike.press("Escape");
  await sleep(600);
  b.service("settings").open("appearance");
  await sleep(900);
  dump("settings-panel-lens", sLensFilter(document.querySelector(".vs-lens")));
  b.service("settings").close?.();
  await sleep(500);
  log("errors", JSON.stringify(R.errors()));
  log("done");
});
