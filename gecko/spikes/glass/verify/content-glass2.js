// CSP-safe variant of ../content-glass.js (frame script, content process).
// The spike's version sets `anon.root.innerHTML = html` with inline style="" attributes. A page CSP
// without 'unsafe-inline' in style-src (the Firefox PDF viewer, strict-CSP sites) silently drops those
// attributes, so the lens divs have no geometry and no backdrop-filter. Styles applied through the
// CSSOM (element.style.cssText) are not subject to CSP.
//
// Protocol: VitreGlass2:Set { html } where elements carry data-style="..." instead of style="...".
/* global content, addMessageListener, sendAsyncMessage, addEventListener */
(() => {
  let anon = null;
  let anonDoc = null;
  let last = "";
  function apply() {
    const doc = content.document;
    if (!anon || anonDoc !== doc) {
      anon = doc.insertAnonymousContent();
      anonDoc = doc;
    }
    // eslint-disable-next-line no-unsanitized/property
    anon.root.innerHTML = last;
    let n = 0;
    for (const el of anon.root.querySelectorAll("[data-style]")) {
      el.style.cssText = el.getAttribute("data-style");
      n++;
    }
    return n;
  }
  addMessageListener("VitreGlass2:Set", (m) => {
    last = m.data.html;
    let value;
    try {
      value = apply();
    } catch (e) {
      value = "ERR " + e;
    }
    sendAsyncMessage("VitreGlass2:Result", { value, url: content.location.href });
  });
  addEventListener(
    "DOMContentLoaded",
    (ev) => {
      if (ev.target === content.document && last) apply();
    },
    true
  );
})();
