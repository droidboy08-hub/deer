// Frame script (content process). Draws Vitre's lens layer INSIDE the content document, as native
// anonymous content (document.insertAnonymousContent), so backdrop-filter is in the same WebRender
// pipeline as the page and really samples it. The page cannot see or touch this content.
//
// Parent -> content messages:
//   VitreGlass:Set   { html }                  replace the whole lens layer markup (style + svg + divs)
//   VitreGlass:Style { id, css }               set style.cssText of one element (by id)
//   VitreGlass:FrameStats { frames, tag }      spike only: rAF interval statistics in the content process
//   VitreGlass:Scroll { y }                    spike only
// Content -> parent:
//   VitreGlass:Ready { url }                   a new document has a lens layer
//   VitreGlass:Result { tag, value }
/* global content, addMessageListener, sendAsyncMessage, addEventListener, docShell */
(() => {
  let anon = null;
  let anonDoc = null;
  let lastHTML = "";

  function ensure() {
    const doc = content.document;
    if (anon && anonDoc === doc) return anon;
    anon = null;
    anonDoc = null;
    try {
      anon = doc.insertAnonymousContent();
      anonDoc = doc;
    } catch (e) {
      sendAsyncMessage("VitreGlass:Result", { tag: "error", value: "insertAnonymousContent: " + e });
    }
    return anon;
  }

  function apply() {
    const a = ensure();
    if (!a) return false;
    // eslint-disable-next-line no-unsanitized/property
    a.root.innerHTML = lastHTML;
    return true;
  }

  addMessageListener("VitreGlass:Set", (m) => {
    lastHTML = m.data.html;
    const ok = apply();
    sendAsyncMessage("VitreGlass:Result", { tag: "set", value: ok });
  });

  addMessageListener("VitreGlass:Style", (m) => {
    const a = ensure();
    const e = a && a.root.getElementById(m.data.id);
    if (e) e.style.cssText = m.data.css;
  });

  // Spike measurement: N requestAnimationFrame intervals in the content process.
  addMessageListener("VitreGlass:FrameStats", (m) => {
    const n = m.data.frames || 120;
    const t = [];
    const win = content;
    const step = (now) => {
      t.push(now);
      if (t.length <= n) win.requestAnimationFrame(step);
      else {
        const d = [];
        for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
        d.sort((x, y) => x - y);
        const mean = d.reduce((x, y) => x + y, 0) / d.length;
        sendAsyncMessage("VitreGlass:Result", {
          tag: m.data.tag || "frames",
          value: { frames: d.length, mean: +mean.toFixed(2), median: +d[d.length >> 1].toFixed(2), p95: +d[Math.floor(d.length * 0.95)].toFixed(2), max: +d[d.length - 1].toFixed(2), over20ms: d.filter((x) => x > 20).length },
        });
      }
    };
    win.requestAnimationFrame(step);
  });

  addMessageListener("VitreGlass:Scroll", (m) => {
    content.scrollTo(0, m.data.y);
    sendAsyncMessage("VitreGlass:Result", { tag: "scroll", value: content.scrollY });
  });

  // Re-create the layer for every new document (anonymous content dies with its document).
  addEventListener(
    "DOMContentLoaded",
    (ev) => {
      if (ev.target !== content.document) return;
      if (lastHTML) apply();
      sendAsyncMessage("VitreGlass:Ready", { url: content.location.href });
    },
    true
  );
  sendAsyncMessage("VitreGlass:Result", { tag: "loaded", value: content.location.href });
})();
