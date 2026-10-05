// Probe: does a synthesized right-click reach ContextMenuChild -> ContextMenuParent -> popupshowing,
// and what does the context look like? Also checks the helpers.
/* global Services, gBrowser, spike, pf, gContextMenu, nsContextMenu */
Services.scriptloader.loadSubScript("resource://vitre-boot/common.js", window);
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 860);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    spike.log("url", b.currentURI.spec, "remote", b.isRemoteBrowser, "dpr", window.devicePixelRatio);
    spike.log("typeof nsContextMenu", typeof window.nsContextMenu, "gContextMenu", String(gContextMenu));

    const popup = document.getElementById("contentAreaContextMenu");
    let seen = null;
    popup.addEventListener("popupshowing", (e) => {
      if (e.target !== popup) return;
      const cm = gContextMenu;
      const c = cm?.contentData?.context || {};
      seen = {
        eventClass: Object.prototype.toString.call(e),
        hasGContextMenu: !!cm,
        shouldDisplay: cm?.shouldDisplay,
        onLink: cm?.onLink,
        linkURL: cm?.linkURL,
        linkText: cm?.linkTextStr,
        screenXDevPx: c.screenXDevPx,
        screenYDevPx: c.screenYDevPx,
        clientX: c.clientX,
        clientY: c.clientY,
        inner: [window.mozInnerScreenX, window.mozInnerScreenY],
        keys: Object.keys(c).join(","),
      };
      e.preventDefault();
    });

    const r = await pf.rectOf(b, "#link1");
    spike.log("link rect", r);
    pf.rightClick(r.cx, r.cy);
    await pf.until(() => seen, 4000);
    spike.log("popupshowing", seen);
    spike.log("popup state after cancel", popup.state);

    const tok = await pf.inContent(b, (content) => content.document.title);
    spike.log("inContent title", tok);
    await spike.capture("probe");
  });
