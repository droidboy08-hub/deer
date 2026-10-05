// VERIFY: do title="" tooltips show on the bar's HTML buttons in browser.xhtml? (bar.js sets
// title="New tab  Ctrl+T" etc.) Uses the real cursor, move only, no button presses.
//   python spikes/shell/run_popups.py --boot spikes/shell/verify/boot-v-tooltip.js --name shell-verify-w-tooltip --timeout 90 --out spikes/shell/verify/out
/* global spike, vt, vv, Services, gBrowser, VitreUI */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    vt.install();
    const d = document;
    const XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
    gBrowser.selectedBrowser.fixupAndLoadURIString("https://example.com/", { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
    await vt.tabLoaded(gBrowser.selectedTab);
    const openTips = () => [...d.querySelectorAll("tooltip")].filter((t) => t.state === "open" || t.state === "showing").map((t) => `${t.id}:${t.getAttribute("label") || t.textContent.trim().slice(0, 40)}`);
    const hover = async (el, label) => {
      await vv.moveTo(600, 400);
      await spike.sleep(400);
      const [x, y] = vt.center(el);
      await vv.glide(600, 400, x, y, window, 6, 20);
      await vv.moveTo(x + 1, y);
      const tip = await vt.until(() => (openTips().length ? openTips() : null), 2500);
      spike.log(label, { mine: vv.mine(), hover: el.matches(":hover"), tooltip: tip || "(none after 2.5 s)" });
      return !!tip;
    };
    vv.saveCursor();
    vv.topmost(true);
    try {
      await vv.activate();
      const plus = VitreUI.bar.plus.querySelector("button");
      spike.log("document root", { ns: d.documentElement.namespaceURI === XUL ? "XUL" : "HTML", local: d.documentElement.localName, bodyParent: VitreUI.root.parentNode.localName });
      // 1. as shipped
      await hover(plus, "as shipped: HTML button title='" + plus.title + "'");
      // 2. tooltip attribute on the HTML root of the layer
      VitreUI.root.setAttribute("tooltip", "aHTMLTooltip");
      await hover(plus, "tooltip='aHTMLTooltip' on the HTML #vitre-root");
      VitreUI.root.removeAttribute("tooltip");
      // 3. the layer wrapped in a XUL element that carries tooltip="aHTMLTooltip"
      const wrap = d.createElementNS(XUL, "box");
      wrap.id = "vitre-xul-host";
      wrap.setAttribute("tooltip", "aHTMLTooltip");
      wrap.style.cssText = "position:fixed; inset:0; z-index:10; pointer-events:none; display:block;";
      d.body.append(wrap);
      wrap.append(VitreUI.root);
      await spike.sleep(300);
      const ok = await hover(plus, "layer inside <xul:box tooltip='aHTMLTooltip'>");
      if (ok) await spike.capture("vtooltip-1-xul-host");
      // the layer still works from inside the XUL host?
      const n = gBrowser.tabs.length;
      await vt.click(...vt.center(VitreUI.bar.plus), { wait: 500 });
      spike.log("layer inside the XUL host: click + ->", `tabs ${n} -> ${gBrowser.tabs.length}`, "| pill rect", vt.rect(VitreUI.anchor("site")), "| nchittest max", vt.hit(...vt.center(d.getElementById("vitre-win-max"))));
      // 4. control: a XUL button with tooltiptext
      const xb = d.createElementNS(XUL, "toolbarbutton");
      xb.setAttribute("tooltiptext", "control tooltip on a XUL button");
      xb.setAttribute("label", "XUL");
      xb.style.cssText = "position:fixed; left:200px; top:300px; width:80px; height:30px; background:#888; pointer-events:auto;";
      wrap.append(xb);
      await spike.sleep(300);
      await hover(xb, "control: XUL toolbarbutton tooltiptext");
    } finally {
      vv.topmost(false);
      vv.restoreCursor();
    }
  });
}
