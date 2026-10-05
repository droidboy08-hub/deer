// 03b: which page-side default actions make the keypress reply come back "consumed"?
// (contenteditable Ctrl+B/I/U, Backspace, Space scrolling, arrows...). Vitre router installed.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vitre-keys.js?" + Date.now(), window);
spike.main(async () => {
  await spike.resize(1100, 720);
  VitreKeys.neutralise();
  const stock = Services.env.get("KS_MODE") === "norouter";
  await KS.load(KS.pageURL("keys.html"));
  gBrowser.selectedBrowser.focus();
  await spike.sleep(300);
  const rec = [];
  // An independent observer: request a reply for every keypress and log how it comes back.
  window.addEventListener("keypress", (e) => {
    if (!e.target.isRemoteBrowser) return;
    if (!e.isReplyEventFromRemoteContent) { e.requestReplyFromRemoteContent(); return; }
    rec.push((e.ctrlKey ? "Ctrl+" : "") + (e.altKey ? "Alt+" : "") + (e.shiftKey ? "Shift+" : "") + e.key + " -> reply " + (e.defaultPrevented ? "CONSUMED" + (e.defaultPreventedByContent ? "(byContent)" : "") + (e.defaultPreventedByChrome ? "(byChrome)" : "") : "free"));
  }, true);
  const state = () => KS.inPage(function (w, d) {
    const s = w.getSelection();
    return { active: d.activeElement && d.activeElement.id, rich: d.getElementById("rich").innerHTML, field: d.getElementById("field").value, sel: String(s), scrollY: w.scrollY };
  });
  const focus = (id) => KS.inPage("function(w,d){ const el = d.getElementById('" + id + "'); el.focus(); if (el.select) el.select(); else { const r = d.createRange(); r.selectNodeContents(el); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r); } return d.activeElement.id; }");
  const press = async (spec) => { rec.length = 0; KS.press(spec); await spike.sleep(350); return rec.slice(); };

  spike.log("focused:", await focus("rich"), await state());
  for (const k of ["Ctrl+B", "Ctrl+I", "Ctrl+U", "Ctrl+Z", "Ctrl+A", "Ctrl+C", "Backspace", "Left", "Enter", "Ctrl+L", "Ctrl+R", "F5", "Escape", "Alt+Left", "Ctrl+H", "Ctrl+P", "Ctrl+S", "Ctrl+F", "Ctrl+G", "Ctrl+J", "Ctrl+1", "Ctrl+0", "Ctrl+Minus", "Ctrl+Shift+Delete", "Ctrl+Shift+A", "Ctrl+Q", "F1", "F3", "F11", "F12", "Alt+Enter", "Ctrl+Comma"]) {
    spike.log("contenteditable  " + k.padEnd(18) + (await press(k)).join(" | "));
  }
  spike.log("state:", await state());
  spike.log("focused:", await focus("field"));
  for (const k of ["Ctrl+B", "Ctrl+U", "Ctrl+Z", "Ctrl+A", "Backspace", "Left", "Enter", "Escape", "Alt+Left", "Ctrl+L", "Ctrl+H", "Shift+Delete", "Ctrl+Shift+Delete", "Alt+Enter"]) {
    spike.log("input            " + k.padEnd(18) + (await press(k)).join(" | "));
  }
  await KS.inPage(function (w, d) { d.activeElement.blur(); d.body.style.height = "4000px"; return 1; });
  for (const k of ["Space", "PageDown", "Down", "End", "Backspace", "Escape", "Alt+Left", "Ctrl+A", "Ctrl+C", "Tab", "Enter"]) {
    spike.log("body (no field)  " + k.padEnd(18) + (await press(k)).join(" | "));
  }
  spike.log("state:", await state());
  await spike.capture("03b");
});
