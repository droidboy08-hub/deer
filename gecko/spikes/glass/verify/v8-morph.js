// Verify claim 21 (pill morph kept in step). A pill oscillates between 480 px and 260 px wide
// (centre fixed) forever; captures are taken at arbitrary moments of the motion.
//   VITRE_SIDE = parent        lens is a child of the animated element (surface-root recipe): one CSS animation
//   VITRE_SIDE = content-msg   parent rAF loop sets the rim geometry and sends VitreGlass:Style per frame
//   VITRE_SIDE = content-css   the same CSS animation is started in both documents (parent rim, content lens)
// The lens is `invert(1)` (hard edge) and the parent draws a 1 px red outline of the pill, so any
// lag shows as a band of non-inverted page inside the outline or inverted page outside it.
// v8-measure.py reports the offset in px for each capture.
/* global spike, G, gBrowser, Services, document, window */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  const side = Services.env.get("VITRE_SIDE") || "parent";
  G.hideFirefoxUI();
  await G.go(G.sibling("page.html") + "?noanim=1&bg=white");
  const KF = `@keyframes vmorph { from { left: 400px; width: 480px; } to { left: 510px; width: 260px; } }`;
  const ANIM = "animation: vmorph 600ms cubic-bezier(.3,.7,.2,1) infinite alternate;";
  const base = "top:100px; height:44px; border-radius:22px;";
  let L;
  if (side === "parent") {
    const tabbox = document.getElementById("tabbrowser-tabbox");
    tabbox.style.filter = "saturate(1.0001)";
    L = G.el("div", "position:fixed; inset:0; z-index:2147483647; pointer-events:none;", tabbox);
    G.css(KF);
    const pill = G.el("div", `position:absolute; ${base} ${ANIM} outline:1px solid #f00; outline-offset:0;`, L);
    G.el("div", "position:absolute; inset:0; border-radius:inherit; backdrop-filter:invert(1);", pill);
  } else {
    L = G.layer();
    const C = await G.contentGlass();
    G.css(KF);
    if (side === "content-css") {
      await C.set(`<style>${KF}</style><div id="p" style="position:fixed; ${base} ${ANIM} backdrop-filter:invert(1);"></div>`);
      G.el("div", `position:absolute; ${base} ${ANIM} outline:1px solid #f00;`, L);
    } else {
      await C.set(`<div id="p" style="position:fixed; left:400px; width:480px; ${base} backdrop-filter:invert(1);"></div>`);
      const rim = G.el("div", `position:absolute; left:400px; width:480px; ${base} outline:1px solid #f00;`, L);
      const t0 = performance.now();
      const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
      const tick = () => {
        const ph = ((performance.now() - t0) / 600) % 2;
        const k = ease(ph < 1 ? ph : 2 - ph);
        const left = 400 + 110 * k;
        const width = 480 - 220 * k;
        rim.style.left = left + "px";
        rim.style.width = width + "px";
        C.style("p", `position:fixed; left:${left}px; width:${width}px; ${base} backdrop-filter:invert(1);`);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }
  spike.log("side", side);
  await spike.sleep(1500);
  for (let i = 0; i < 8; i++) {
    await spike.sleep(137);
    await spike.capture(`morph-${side}-${i}`);
  }
});
