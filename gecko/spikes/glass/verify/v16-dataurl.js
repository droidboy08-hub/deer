// Verify the claim "an external url("data:...svg#f") filter reference does not render in
// backdrop-filter". ../boot4-content.js put url("...") inside a style="..." attribute, which ends the
// attribute at the first inner double quote, so that tile never had a backdrop-filter at all.
// Here the value is applied with single quotes (content, innerHTML) and through the CSSOM (parent).
/* global spike, G, gBrowser, Services, document, window, getComputedStyle */
Services.scriptloader.loadSubScript("resource://vitre-boot/glasslib.js", window);

spike.main(async () => {
  await spike.resize(1280, 800);
  G.hideFirefoxUI();
  await G.go(G.sibling("page.html") + "?noanim=1");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><filter id="f" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="4"/><feColorMatrix type="hueRotate" values="180"/></filter></svg>';
  const dataURL = "data:image/svg+xml," + encodeURIComponent(svg);
  const blobURL = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const tabbox = document.getElementById("tabbrowser-tabbox");
  tabbox.style.filter = "saturate(1.0001)";
  const L = G.el("div", "position:fixed; inset:0; z-index:2147483647; pointer-events:none; font:600 12px 'Segoe UI',sans-serif;", tabbox);
  const C = await G.contentGlass();
  // Content side: single quotes inside the style attribute.
  spike.log("content set ->", await C.set(
    `<div style="position:fixed; left:60px; top:60px; width:300px; height:60px; border-radius:30px; backdrop-filter:url('${dataURL}#f');"></div>` +
    `<svg width="0" height="0"><filter id="inl" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="4"/><feColorMatrix type="hueRotate" values="180"/></filter></svg>` +
    `<div style="position:fixed; left:60px; top:160px; width:300px; height:60px; border-radius:30px; backdrop-filter:url(#inl);"></div>`));
  // Parent side: CSSOM.
  const mk = (x, y, value, label) => {
    const t = G.el("div", `position:absolute; left:${x}px; top:${y}px; width:300px; height:60px; border-radius:30px; outline:1px solid #f0f;`, L);
    if (value) t.style.backdropFilter = value;
    G.el("div", "position:absolute; left:0; top:64px; background:#000; color:#fff; padding:1px 6px; white-space:nowrap;", t, label + (value ? "  computed: " + getComputedStyle(t).backdropFilter.slice(0, 40) : ""));
  };
  mk(60, 60, "", "CONTENT url('data:...svg#f')");
  mk(60, 160, "", "CONTENT url(#inl) inline filter (control)");
  mk(480, 60, `url("${dataURL}#f")`, "PARENT url(data:...#f)");
  mk(480, 160, `url("${blobURL}#f")`, "PARENT url(blob:...#f)");
  mk(880, 60, "blur(4px) hue-rotate(180deg)", "PARENT css functions (control)");
  await spike.sleep(1200);
  await spike.capture("dataurl");
});
