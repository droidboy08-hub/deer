// Spike S1, follow-up: where does small (<= 64 px) real glass flip between light and dark? 36 px
// pieces, color-scheme light and dark, over a ramp of greys (sRGB 0..255 in 11 steps) and over six
// saturated colours. Then the page is mirrored under the open pieces (the ramp reversed, the colours
// shifted) to see whether the decision depends on what was there before (hysteresis).
//   /usr/bin/python3 -u tools/run.py --test spikes/mac-glass/s1b-flip.js --name mac-glass-s1b --url about:blank \
//       --timeout 300 --out tests/menus/out --pref ui.systemUsesDarkTheme=1
// Captures: glass-look-flip-ramp-<sys> (fresh), glass-look-flip-ramp-mirrored-<sys> (page changed
// under the open pieces), glass-look-flip-ramp-reopened-<sys> (the same mirrored page, pieces opened
// fresh). Numbers: spikes/mac-glass/analyze.py on the log.
/* global spike, G, Services */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);
spike.main(async () => {
  const { check, sleep, log } = spike;
  const b = window.vitre;
  if (Services.appinfo.OS !== "Darwin") {
    check("macOS only", true);
    return;
  }
  window.windowUtils.disableNonTestMouseEvents(true);
  const forced = Services.prefs.getIntPref("ui.systemUsesDarkTheme", -1);
  const sys = forced === 1 ? "sysdark" : forced === 0 ? "syslight" : "sys";
  await spike.resize(1400, 880);
  await spike.activate();

  const GREYS = Array.from({ length: 11 }, (_, i) => Math.round((i * 255) / 10));
  const COLOURS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#af52de", "#ff9500"];
  const hex = (g) => "#" + g.toString(16).padStart(2, "0").repeat(3);
  const body = (greys, colours) =>
    `<div style="position:absolute;left:0;top:0;width:100%;height:440px;display:flex">${greys.map((g) => `<div style="flex:1;background:${hex(g)};font:600 13px system-ui;color:${g > 128 ? "#000" : "#fff"};padding-top:330px;text-align:center">grey ${g}</div>`).join("")}</div>` +
    `<div style="position:absolute;left:0;top:440px;width:100%;height:440px;display:flex">${colours.map((c) => `<div style="flex:1;background:${c};font:600 13px system-ui;color:#000;padding-top:200px;text-align:center">${c}</div>`).join("")}</div>`;
  await G.load(G.page("Flip", "#808080", "#000", `<div id=ramp>${body(GREYS, COLOURS)}</div>`, "#000"));
  await G.caption("");

  const colW = window.innerWidth / GREYS.length;
  const cW = window.innerWidth / COLOURS.length;
  async function openAll() {
    for (let i = 0; i < GREYS.length; i++) {
      const x = Math.round(i * colW + (colW - 110) / 2);
      await G.panel({ x, y: 100, w: 110, h: 36, scheme: "light", cls: "h36", html: `<span>L · ${GREYS[i]}</span>`, name: `grey${GREYS[i]}-light`, wait: false });
      await G.panel({ x, y: 160, w: 110, h: 36, scheme: "dark", cls: "h36", html: `<span>D · ${GREYS[i]}</span>`, name: `grey${GREYS[i]}-dark`, wait: false });
    }
    for (let i = 0; i < COLOURS.length; i++) {
      const x = Math.round(i * cW + (cW - 180) / 2);
      await G.panel({ x, y: 500, w: 180, h: 36, scheme: "light", cls: "h36", html: `<span>L · ${COLOURS[i]}</span>`, name: `col${i}-light`, wait: false });
      await G.panel({ x, y: 560, w: 180, h: 36, scheme: "dark", cls: "h36", html: `<span>D · ${COLOURS[i]}</span>`, name: `col${i}-dark`, wait: false });
    }
    await sleep(900);
  }
  const shoot = async (name) => {
    G.layout(name + "-" + sys);
    await spike.captureScreen(name + "-" + sys);
  };
  await openAll();
  await shoot("glass-look-flip-ramp");
  // Mirror the page under the open pieces.
  const greysR = [...GREYS].reverse();
  const coloursR = COLOURS.slice(3).concat(COLOURS.slice(0, 3));
  log("MIRROR greys " + JSON.stringify(greysR) + " colours " + JSON.stringify(coloursR));
  await G.inContent(b.active().browser, (content, html) => { content.document.getElementById("ramp").innerHTML = html; return true; }, body(greysR, coloursR));
  await sleep(1500);
  await shoot("glass-look-flip-ramp-mirrored");
  G.closeAll();
  await sleep(400);
  await openAll();
  await shoot("glass-look-flip-ramp-reopened");
  G.closeAll();
  check("flip captures", true);
});
