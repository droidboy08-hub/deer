// VERIFY (claim 13): the reveal zone with a REAL pointer. The spike moved the pointer with
// in-process synthesized events, which skip Windows' non-client hit-testing. In a normal window
// y 0-7 is HTTOP (resize) and y 8-17 is HTCAPTION (drag strip); maximized y 0-7 is HTCAPTION.
// Gecko sends no DOM mouse events for those, so does :hover on the 6px reveal zone ever fire?
//   python tools/run.py --boot spikes/shell/verify/boot-v-reveal.js --name shell-verify-t-reveal --timeout 120 --out spikes/shell/verify/out
// Only moves the real cursor (no button presses); the cursor is put back at the end.
/* global spike, vt, vv, Services, gBrowser, VitreUI */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    vt.install();
    const d = document;
    const root = d.documentElement;
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    gBrowser.selectedBrowser.fixupAndLoadURIString(vt.pageURL("hit.html"), { triggeringPrincipal: sys });
    await vt.tabLoaded(gBrowser.selectedTab);
    await spike.sleep(500);
    const bar = () => {
      const r = VitreUI.bar.items.get(gBrowser.selectedTab).getBoundingClientRect();
      return { pillTop: Math.round(r.top), opacity: getComputedStyle(d.getElementById("vitre-bar")).opacity, revealHover: d.getElementById("vitre-reveal").matches(":hover") };
    };
    // every DOM mouse event the chrome document sees, to show what a real pointer produces
    const seen = [];
    for (const t of ["mousemove", "mouseover", "mouseout", "mouseleave", "mouseenter"]) {
      window.addEventListener(t, (e) => {
        if (t === "mouseleave" || t === "mouseenter") {
          if (e.target !== root && e.target !== d) return;
        }
        seen.push(`${t}@${Math.round(e.clientX)},${Math.round(e.clientY)}${e.relatedTarget === null && (t === "mouseout") ? "(to outside)" : ""}`);
      }, true);
    }
    const drain = () => {
      const s = [...new Set(seen)].slice(-6).join(" ");
      seen.length = 0;
      return s;
    };
    const probe = async (label, x, y) => {
      await vv.moveTo(600, 400);
      await spike.sleep(500);
      drain();
      // approach from below, like a hand does
      await vv.glide(600, 400, x, y + 60, window, 6, 20);
      await vv.glide(x, y + 60, x, y, window, 8, 20);
      await spike.sleep(700);
      spike.log(label, { y, mine: vv.mine(), nchittest: vt.hit(x, y), ...bar(), domEvents: drain() });
    };

    vv.saveCursor();
    vv.topmost(true);
    try {
      spike.log("start", { active: Services.focus.activeWindow === window, cursor: vv.cursor() });
      // ---- auto-hide in a normal window
      VitreUI.root.classList.add("autohide");
      await spike.sleep(600);
      spike.log("autohide, normal window, pointer on the page", bar());
      await probe("normal: real pointer at y=2 (resize band)", 640, 2);
      await probe("normal: real pointer at y=5 (resize band)", 640, 5);
      await probe("normal: real pointer at y=12 (drag strip)", 640, 12);
      await probe("normal: real pointer at y=22 (page, where the bar was)", 640, 22);
      await spike.capture("vreveal-1-normal-pointer-at-top");

      // ---- auto-hide maximized
      window.maximize();
      await spike.sleep(1200);
      await probe("maximized: real pointer at y=0", 1280, 0);
      await probe("maximized: real pointer at y=3 (drag strip)", 1280, 3);
      await probe("maximized: real pointer at y=10 (page)", 1280, 10);
      window.restore();
      await spike.sleep(1000);
      VitreUI.root.classList.remove("autohide");

      // ---- F11 full screen
      window.fullScreen = true;
      await vt.until(() => root.hasAttribute("inFullscreen"), 5000);
      await spike.sleep(1500);
      spike.log("full screen", { inFullscreen: root.hasAttribute("inFullscreen"), ...bar() });
      await probe("fullscreen: real pointer at y=0", 1280, 0);
      await spike.capture("vreveal-2-fullscreen-pointer-at-top");
      await probe("fullscreen: real pointer at y=3", 1280, 3);
      window.fullScreen = false;
      await vt.until(() => !root.hasAttribute("inFullscreen"), 5000);
      await spike.sleep(1200);

      // ---- a reveal rule that does not depend on DOM events inside the non-client bands:
      // reveal when the pointer is within N px of the top in the client area, OR when it leaves the
      // document upwards (mouseout to nothing with the last position near the top).
      VitreUI.root.classList.add("autohide");
      let lastY = 999;
      let hideTimer = 0;
      const show = (why) => {
        clearTimeout(hideTimer);
        if (!VitreUI.root.classList.contains("revealed")) fixLog.push(why);
        VitreUI.root.classList.add("revealed");
      };
      const hideSoon = () => {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => VitreUI.root.classList.remove("revealed"), 400);
      };
      const fixLog = [];
      window.addEventListener("mousemove", (e) => {
        lastY = e.clientY;
        if (e.clientY < 28) show(`mousemove y=${Math.round(e.clientY)}`);
        else if (e.clientY > 76) hideSoon();
      }, true);
      window.addEventListener("mouseout", (e) => {
        if (e.relatedTarget === null && lastY < 40) show(`left through the top (last y=${Math.round(lastY)})`);
      }, true);
      await spike.sleep(600);
      const probe2 = async (label, x, y) => {
        await probe(label, x, y);
        spike.log("   reveal rule fired:", fixLog.splice(0).join(" | ") || "(no)");
      };
      await probe2("FIX normal: real pointer at y=2", 640, 2);
      await spike.capture("vreveal-3-fix-normal-pointer-at-top");
      await probe2("FIX normal: real pointer at y=12", 640, 12);
      await probe2("FIX normal: real pointer at y=22", 640, 22);
      await vv.moveTo(600, 400);
      await spike.sleep(900);
      spike.log("FIX: pointer back on the page", bar());
      window.maximize();
      await spike.sleep(1200);
      await probe2("FIX maximized: real pointer at y=0", 1280, 0);
      window.restore();
      await spike.sleep(800);
    } finally {
      vv.topmost(false);
      vv.restoreCursor();
    }
  });
}
