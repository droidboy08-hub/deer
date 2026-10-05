// Design review probe 2: the link status bubble on hover (Firefox's #statuspanel) next to the
// PeekDiscover board's bubble, on light and dark pages, System and Light modes; the page <select>
// popup.
/* global spike, Services, R, IOUtils, PathUtils */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  const { b, dump, shot, sleep, log, cs, R4 } = R;
  await R.inner(1440, 900);
  await spike.activate();
  const page = (bg, fg) => `<!doctype html><meta charset=utf-8><title>Links</title><body style="margin:0;background:${bg};color:${fg};font:17px 'Segoe UI'"><main style="padding:60px"><p><a id="lk" style="color:inherit" href="https://code.vitre.dev/vitre/vitre-shell/issues/39">#39 ETag mismatch on resume after a range request</a></p><p><select id="sel"><option>Most recently used</option><option>Order in the tab bar</option><option>Third</option></select></p></main>`;
  await IOUtils.writeUTF8(PathUtils.join(spike.outDir, "light.html"), page("#fbfaf7", "#1b1b1f"));
  await IOUtils.writeUTF8(PathUtils.join(spike.outDir, "dark.html"), page("#0f1115", "#e6e8ee"));
  const light = await R.go(R.outUrl("light.html"));
  const dark = await R.open(R.outUrl("dark.html"));
  const sp = () => document.getElementById("statuspanel");
  const spDump = (tag) => {
    const p = sp();
    const label = document.getElementById("statuspanel-label");
    dump(tag, {
      panel: R4(p),
      hidden: p && (p.hidden || p.getAttribute("inactive")),
      label: label && { text: label.value || label.textContent, rect: R4(label), bg: cs(label).backgroundColor, color: cs(label).color, border: cs(label).borderTopWidth + " " + cs(label).borderTopColor, radius: cs(label).borderTopLeftRadius, font: cs(label).fontFamily + " " + cs(label).fontSize, shadow: cs(label).boxShadow },
    });
  };
  for (const mode of ["system", "light"]) {
    await R.setSettings({ theme: mode }, 1200);
    for (const [name, tab] of [["light", light], ["dark", dark]]) {
      b.activate(tab);
      await sleep(900);
      await R.settled();
      const r = await R.rectOf("#lk", tab.browser);
      R.mouse(r.x + 40, r.cy - 30, { type: "mousemove" });
      await sleep(200);
      R.mouse(r.x + 40, r.cy, { type: "mousemove" });
      await sleep(1200);
      spDump(`status-${mode}-${name}`);
      await shot(`s-${mode}-${name}-status`);
      R.mouse(r.x + 40, r.cy + 200, { type: "mousemove" });
      await sleep(600);
    }
  }
  await R.setSettings({ theme: "system" }, 900);
  log("errors", JSON.stringify(R.errors()));
  log("done");
});
