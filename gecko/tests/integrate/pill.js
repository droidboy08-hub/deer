// The active pill's right end shared by the extensions cluster (b.bar.accessories()) and the
// download mark (b.bar.downloadMark()): with 0, 1, 3 and 8 extensions, on a page without media (mark
// slot kept, invisible), on a page with a video (mark shown) and with a download running (the ring),
// the address stays readable (never cut for a short host) and its favicon + host stay centred at the
// pill's middle as bar.css defines it, or as near to it as the box allows. Nothing overlaps: address,
// cluster, mark (410..438) and Reload (442..470) keep their order and slots. Find's face still covers
// the whole pill with the cluster in it.
// Captures: pill-<n>-plain, pill-<n>-mark, pill-3-download, pill-3-find, pill-8-long.
/* global spike, Services, I, Cc, Ci, ChromeUtils, WebExtensionPolicy, CustomizableUI, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b } = I;
  const { check, log, sleep, waitFor, capture } = spike;
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  await spike.resize(1440, 900);
  await spike.activate();
  I.mouse(700, 500, { type: "mousemove" });

  const extFile = (name) => {
    const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    f.initWithPath(PathUtils.join(I.extDir, name));
    return f;
  };
  const install = async (name) => {
    const addon = await AddonManager.installTemporaryAddon(extFile(name));
    await waitFor(() => WebExtensionPolicy.getByID(addon.id)?.extension, { timeout: 8000, what: "extension " + name });
    return addon;
  };
  const toolbar = () => document.getElementById("vitre-ext-bar");
  const pinned = () => [...(toolbar()?.children ?? [])];
  const visible = () => pinned().filter((n) => n.getClientRects().length && !n.classList.contains("vx-overflow"));

  /** Geometry of the active pill's face, relative to the pill. */
  const measure = () => {
    const item = b.bar.item(b.activeId);
    const pr = item.getBoundingClientRect();
    const rel = (el) => {
      if (!el || !el.getClientRects().length) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round((r.left - pr.left) * 10) / 10, r: Math.round((r.right - pr.left) * 10) / 10, w: Math.round(r.width * 10) / 10 };
    };
    const address = item.querySelector(".address");
    const fav = address.querySelector(".fav");
    const host = address.querySelector(".host");
    const acc = item.querySelector(".accessories");
    const mark = item.querySelector(".dl-mark");
    const reload = item.querySelector(".reload");
    const a = rel(address);
    const f = rel(fav);
    const h = rel(host);
    const content = { x: f.x, r: h.r, w: h.r - f.x };
    // Where the group should be: centred at the pill's middle, clamped into the address box.
    const want = Math.max(a.x, Math.min(pr.width / 2 - content.w / 2, a.r - content.w));
    return {
      pill: Math.round(pr.width),
      address: a,
      content,
      centre: Math.round(((f.x + h.r) / 2) * 10) / 10,
      want: Math.round(want * 10) / 10,
      cut: host.scrollWidth > host.clientWidth + 0.5,
      text: host.textContent,
      acc: rel(acc),
      mark: rel(mark),
      markShown: !mark.classList.contains("empty"),
      reload: rel(reload),
      buttons: visible().length + (document.getElementById("unified-extensions-button")?.getClientRects().length ? 1 : 0),
    };
  };
  const near = (x, y, d = 1.5) => Math.abs(x - y) <= d;
  const judge = (tag, m, expectMark) => {
    log(tag, m);
    const centred = near(m.content.x, m.want, 1.5);
    const order = m.address.r <= m.acc.x + 0.5 && (!m.acc.w || m.acc.r <= m.mark.x + 0.5) && near(m.mark.x, 410, 1) && near(m.reload.x, 442, 1);
    check(`${tag}: the host is whole (${m.text}), the group sits at the pill's middle or as near as the box allows (centre ${m.centre}, pill middle ${m.pill / 2})`, !m.cut && centred, { content: m.content, want: m.want, centre: m.centre, address: m.address });
    check(`${tag}: address, ${m.buttons} cluster button(s), the mark's slot (410..438, ${m.markShown ? "shown" : "kept empty"}) and Reload (442) keep their order without overlap`, order && m.markShown === expectMark, { address: m.address, acc: m.acc, mark: m.mark, reload: m.reload, markShown: m.markShown });
  };

  const video = await I.makeVideo("clip.webm", 2);
  log("video", video, (await IOUtils.stat(PathUtils.join(spike.outDir, "clip.webm"))).size, "bytes");
  const plainUrl = I.page("article.html");
  // Each video page asks for its own address: a clip Gecko's media cache hands over without a
  // request is reported only when it is long (the downloads page module skips clips under 5 s).
  let seqVideo = 0;
  const videoUrl = () => I.page("video.html?src=" + encodeURIComponent(video + "?v=" + ++seqVideo));
  await I.load(plainUrl, 700);
  const step = async (n) => {
    await I.load(plainUrl + "?n=" + n, 700);
    await waitFor(() => b.bar.downloadMark()?.classList.contains("empty"), { timeout: 3000, what: "mark hidden" }).catch(() => null);
    await sleep(300);
    judge(`${n} extension(s), no media`, measure(), false);
    await capture(`pill-${n}-plain`);
    await I.load(videoUrl() + "&n=" + n, 900);
    const shown = await waitFor(() => !b.bar.downloadMark()?.classList.contains("empty"), { timeout: 8000, what: "download mark shown" }).catch(() => false);
    if (!shown) {
      let debug = null;
      try {
        debug = b.sys("VitreDownloads").media.debug?.();
      } catch (e) {
        debug = String(e);
      }
      log("mark not shown", { state: b.service("downloads").mediaState(), browserId: b.active().browser.browserId, debug });
    }
    await sleep(400);
    judge(`${n} extension(s), video page (download mark)`, measure(), true);
    await capture(`pill-${n}-mark`);
  };

  await step(0);
  await install("popup");
  await waitFor(() => visible().length === 1, { timeout: 6000, what: "1 pinned" }).catch(() => null);
  await step(1);
  await install("blocker");
  await install("badge");
  await waitFor(() => visible().length === 3, { timeout: 6000, what: "3 pinned" }).catch(() => null);
  await step(3);

  // ---- a download running: the ring at the bottom right, the pill unchanged ----
  const bigName = "big.bin";
  await IOUtils.write(PathUtils.join(spike.outDir, bigName), new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 131) & 255));
  b.sys("VitreSettings").set({ speedLimitKBps: 96 });
  await sleep(200);
  b.service("downloads").download(I.outUrl(bigName), { browser: b.active().browser });
  const running = await waitFor(() => b.sys("VitreDownloads").runningCount() > 0, { timeout: 8000, what: "download running" }).catch(() => false);
  await waitFor(() => window.vitreDownloads?.ring?.isShown, { timeout: 4000, what: "ring shown" }).catch(() => null);
  await sleep(900);
  const ring = document.querySelector("#vitre-root .vd-ring");
  log("ring", I.rect(ring), "running", running, "count", b.sys("VitreDownloads").runningCount());
  judge("3 extensions, video page, a download running", measure(), true);
  check("a download running: the downloads ring shows at the bottom right, outside the pill", !!running && !!window.vitreDownloads?.ring?.isShown && !!ring && ring.getBoundingClientRect().top > 700, I.rect(ring));
  await capture("pill-3-download");

  // ---- find's face covers the whole pill, cluster included ----
  b.service("find").open();
  await waitFor(() => b.service("find").isOpen(), { timeout: 3000, what: "find open" });
  await sleep(500);
  const face = document.querySelector("#layer-find .vf-face") || document.querySelector("#layer-find > *");
  const pillFace = b.bar.item(b.activeId).querySelector(".pill-face");
  const fr = face?.getBoundingClientRect();
  const pr = b.bar.item(b.activeId).getBoundingClientRect();
  log("find face", I.rect(face), "pill", I.rect(b.bar.item(b.activeId)), "pill face opacity", getComputedStyle(pillFace).opacity, "visibility", getComputedStyle(pillFace).visibility);
  check("find open: its 480x44 face lies over the pill and the pill's own face (cluster and mark included) is hidden", !!fr && near(fr.left, pr.left, 1) && near(fr.width, 480, 1) && (getComputedStyle(pillFace).opacity === "0" || getComputedStyle(pillFace).visibility === "hidden"), { face: I.rect(face), pill: I.rect(b.bar.item(b.activeId)) });
  await capture("pill-3-find");
  b.service("find").close();
  await sleep(500);

  // ---- eight extensions: five fit, the address keeps its room ----
  for (const name of ["dnr", "menus", "command", "pin1", "pin2"]) await install(name);
  await waitFor(() => pinned().length === 8, { timeout: 8000, what: "8 pinned" }).catch(() => null);
  await step(8);
  const m8 = measure();
  check("8 extensions: five shown, the address keeps at least 140 px", visible().length === 5 && m8.address.w >= 140, { visible: visible().length, address: m8.address });
  // A long host fills its box and is cut only at its end.
  b.sys("VitreSettings").set({ speedLimitKBps: 0 });
  await I.load(I.xpage("article.html?" + "x".repeat(10)), 700);
  const ml = measure();
  log("8 extensions, other host", ml);
  check("8 extensions, another host: still whole and as near the middle as the box allows", !ml.cut && near(ml.content.x, ml.want, 1.5), ml);
  await capture("pill-8-long");
});
