// Spike-only: a plain panel drawn in the browser window that lists VitreDownloads' rows, so the
// captures show what the engine is doing. This is the same call a real Vitre panel would make:
// import the system module, subscribe(), render list().
/* global window, document, ChromeUtils */
window.vitreOverlay = (() => {
  const { VitreDownloads } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreDownloads.sys.mjs");
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;right:24px;top:96px;width:520px;padding:16px 18px;border-radius:14px;background:#1c1c1ef2;color:#fff;font:13px 'Segoe UI';z-index:2147483647;box-shadow:0 12px 40px #0008;pointer-events:none";
  document.documentElement.appendChild(box);
  const fmt = (n) => (n < 0 ? "?" : n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : (n / 1024).toFixed(0) + " kB");
  let note = "";
  const draw = () => {
    box.textContent = "";
    const head = document.createElement("div");
    head.style.cssText = "font-weight:600;margin-bottom:8px";
    head.textContent = "Vitre downloads (Gecko engine)" + (note ? " - " + note : "");
    box.appendChild(head);
    for (const v of VitreDownloads.list()) {
      const row = document.createElement("div");
      row.style.cssText = "margin:10px 0";
      const name = document.createElement("div");
      name.textContent = `${v.filename || v.url}`;
      const meta = document.createElement("div");
      meta.style.cssText = "opacity:.7;font-size:12px;margin-top:2px";
      meta.textContent = `${v.state}${v.phase ? " (" + v.phase + ")" : ""} | ${fmt(v.received)} of ${fmt(v.total)} | ${fmt(v.speed)}/s | ${v.connections} connections${v.error ? " | " + v.error : ""}`;
      const bar = document.createElement("div");
      bar.style.cssText = "display:flex;gap:2px;margin-top:6px;height:8px";
      const fills = v.segments.length ? v.segments : [v.total > 0 ? v.received / v.total : 0];
      for (const f of fills) {
        const cell = document.createElement("div");
        cell.style.cssText = `flex:1;border-radius:3px;background:linear-gradient(to right,#0a84ff ${f * 100}%,#ffffff30 ${f * 100}%)`;
        bar.appendChild(cell);
      }
      row.append(name, meta, bar);
      box.appendChild(row);
    }
  };
  const off = VitreDownloads.subscribe(() => draw());
  window.addEventListener("unload", off, { once: true });
  draw();
  return {
    draw,
    setNote(text) {
      note = text;
      draw();
    },
  };
})();
