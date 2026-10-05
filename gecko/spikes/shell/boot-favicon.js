// Probe: SVG favicons arrive as moz-remote-image: URLs rendered for one colour scheme.
// Can the bar ask for the other scheme (light glass over a light page)?
//   python tools/run.py --boot spikes/shell/boot-favicon.js --name shell-m-favicon --timeout 90
/* global spike, vt, Services, gBrowser, VitreUI */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
if (vt.first()) {
  spike.main(async () => {
    await spike.resize(1280, 800);
    vt.install();
    const sys = Services.scriptSecurityManager.getSystemPrincipal();
    gBrowser.selectedBrowser.fixupAndLoadURIString("https://github.com/mozilla", { triggeringPrincipal: sys });
    const tab = gBrowser.selectedTab;
    await vt.tabLoaded(tab, 30000);
    await vt.until(() => tab.getAttribute("image"), 8000);
    await spike.sleep(1500);
    const attr = tab.getAttribute("image");
    const original = gBrowser.getIcon(tab);
    spike.log("tab image attribute", attr.slice(0, 60), "… params:", [...new URL(attr.replace("moz-remote-image://", "http://x/")).searchParams.keys()], "colorScheme", /colorScheme=(\w+)/.exec(attr)?.[1]);
    spike.log("gBrowser.getIcon (browser.mIconURL)", original.slice(0, 60), "… length", original.length);
    spike.log("svg text has prefers-color-scheme:", atob(original.split(",")[1] || "").includes("prefers-color-scheme"));
    const load = (src) =>
      new Promise((resolve) => {
        const img = document.createElementNS("http://www.w3.org/1999/xhtml", "img");
        img.onload = () => {
          const c = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          c.width = c.height = 16;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, 16, 16);
          let sum = 0;
          let n = 0;
          try {
            const data = ctx.getImageData(0, 0, 16, 16).data;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i + 3] > 40) {
                sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
                n++;
              }
            }
            resolve({ ok: true, size: [img.naturalWidth, img.naturalHeight], opaquePixels: n, meanLuma: n ? Math.round(sum / n) : null });
          } catch (e) {
            resolve({ ok: true, size: [img.naturalWidth, img.naturalHeight], readback: String(e).slice(0, 80) });
          }
        };
        img.onerror = () => resolve({ ok: false });
        img.src = src;
      });
    const { FaviconUtils } = ChromeUtils.importESModule("moz-src:///toolkit/modules/FaviconUtils.sys.mjs");
    spike.log("as given (chrome scheme)", await load(attr));
    spike.log("colorScheme swapped to light", await load(attr.replace(/colorScheme=(dark|light)/, "colorScheme=light")));
    spike.log("colorScheme swapped to dark", await load(attr.replace(/colorScheme=(dark|light)/, "colorScheme=dark")));
    spike.log("rebuilt with FaviconUtils, light", await load(FaviconUtils.getMozRemoteImageURL(original, { size: 16, colorScheme: "light" })));
    spike.log("rebuilt with FaviconUtils, dark", await load(FaviconUtils.getMozRemoteImageURL(original, { size: 16, colorScheme: "dark" })));
    spike.log("the data: URL straight into <img>", await load(original));
    spike.log("bar theme", VitreUI.root.className, "| bar icon", VitreUI.bar.items.get(tab).querySelector(".address .fav img")?.src.match(/colorScheme=\w+/)?.[0]);
    await spike.capture("favicon-github");
  });
}
