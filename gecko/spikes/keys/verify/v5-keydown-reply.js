// v5 (verifier): requestReplyFromRemoteContent() on KEYDOWN (what tabbox/tabbrowser do under
// keyboard lock). Needed for browser-first keys that must go to the page first under keyboard
// lock: Ctrl+Tab and F6 never produce a usable KEYPRESS reply (Gecko's own default action in the
// page consumes the keypress), so the keypress-reply rule of the spike router cannot serve them.
/* global window, document, gBrowser, Services, Cc, Ci, ChromeUtils, spike, KS, VitreKeys */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
Services.scriptloader.loadSubScript("resource://vitre-boot/vitre-keys.js?" + Date.now(), window);
if ([...Services.wm.getEnumerator("navigator:browser")].length === 1) spike.main(async () => {
  await spike.resize(1100, 720);
  VitreKeys.neutralise(); // keys parked + prefs; the router itself is NOT installed here
  const rec = [];
  let actOnKeydownReply = false;
  const name = (e) => (e.ctrlKey ? "Ctrl+" : "") + (e.shiftKey ? "Shift+" : "") + e.key;
  window.addEventListener("keydown", (e) => {
    if (!e.target.isRemoteBrowser) return;
    if (!e.isReplyEventFromRemoteContent) { e.requestReplyFromRemoteContent(); rec.push("keydown " + name(e) + " first pass (waiting=" + e.isWaitingReplyFromRemoteContent + ")"); return; }
    rec.push("keydown " + name(e) + " REPLY defaultPrevented=" + e.defaultPrevented + " byContent=" + e.defaultPreventedByContent);
    if (actOnKeydownReply && !e.defaultPrevented) { e.preventDefault(); rec.push("  -> Vitre acts on the keydown reply"); }
  }, true);
  let killKeypress = false;
  window.addEventListener("keypress", (e) => {
    if (!e.target.isRemoteBrowser) return;
    if (killKeypress && !e.isReplyEventFromRemoteContent) { e.preventDefault(); e.stopPropagation(); rec.push("keypress " + name(e) + " first pass: preventDefault in chrome"); return; }
    if (!e.isReplyEventFromRemoteContent) { e.requestReplyFromRemoteContent(); return; }
    rec.push("keypress " + name(e) + " REPLY defaultPrevented=" + e.defaultPrevented);
  }, true);
  const run = async (label, query, spec) => {
    await KS.load(KS.pageURL("edge.html", query));
    window.focus(); gBrowser.selectedBrowser.focus();
    await KS.inPage(function (w, d) { d.getElementById("field").focus(); return 1; });
    await spike.sleep(300);
    rec.length = 0;
    const focusBefore = document.activeElement && document.activeElement.localName;
    KS.press(spec);
    await spike.sleep(500);
    const pageActive = await KS.inPage(function (w, d) { return d.activeElement ? d.activeElement.id || d.activeElement.tagName : null; });
    spike.log(label.padEnd(58) + JSON.stringify(rec.slice()) + " | page saw " + JSON.stringify(await KS.pageSeen()) + " | page activeElement " + pageActive + " | chrome activeElement " + focusBefore + "->" + (document.activeElement && document.activeElement.localName));
  };
  spike.log("--- observer only (does not act)");
  await run("Ctrl+Tab, page prevents nothing", "", "Ctrl+Tab");
  await run("Ctrl+Tab, page preventDefaults it on keydown", "prevent=ctrl-tab", "Ctrl+Tab");
  await run("F6, page prevents nothing", "", "F6");
  await run("F6, page preventDefaults it on keydown", "prevent=f6", "F6");
  await run("Ctrl+W, page prevents nothing", "", "Ctrl+W");
  await run("Ctrl+W, page preventDefaults it on keydown", "prevent=ctrl-w", "Ctrl+W");
  await run("Escape, page prevents nothing", "", "Escape");
  spike.log("--- chrome acts on the keydown reply and preventDefaults it");
  actOnKeydownReply = true;
  await run("Ctrl+Tab, page prevents nothing", "", "Ctrl+Tab");
  await run("F6, page prevents nothing", "", "F6");
  await run("Ctrl+A in a page field (default action select-all)", "", "Ctrl+A");
  const selAfterCtrlA = await KS.inPage(function (w, d) { const f = d.getElementById("field"); return f.selectionEnd - f.selectionStart; });
  spike.log("--- same, and chrome also preventDefaults the KEYPRESS first pass (kills Gecko's own Ctrl+Tab / F6 focus move)");
  killKeypress = true;
  await run("Ctrl+Tab, page prevents nothing", "", "Ctrl+Tab");
  await run("Ctrl+Tab, page preventDefaults it on keydown", "prevent=ctrl-tab", "Ctrl+Tab");
  await run("F6, page prevents nothing", "", "F6");
  killKeypress = false;
  spike.log("   selection in the page field after Ctrl+A: " + selAfterCtrlA + " chars (11 = the page's select-all ALSO ran: a keydown-reply decision cannot stop page default actions)");
});
