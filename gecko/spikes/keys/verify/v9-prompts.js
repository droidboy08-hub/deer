// v9 (verifier): page-first Esc and other keys against layers a page can put up that are NOT
// plain key handlers: alert() (tab-modal prompt drawn by chrome), a popover, a search field, and
// focus on nothing in the chrome document.
/* global window, document, gBrowser, Services, Cc, Ci, ChromeUtils, spike, KS, VitreKeys */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);
const fixed = Services.env.get("KS_KEYS") === "fixed";
Services.scriptloader.loadSubScript("resource://vitre-boot/" + (fixed ? "vitre-keys-fixed.js" : "vitre-keys.js") + "?" + Date.now(), window);
if ([...Services.wm.getEnumerator("navigator:browser")].length === 1) spike.main(async () => {
  await spike.resize(1100, 720);
  const actions = [];
  VitreKeys.neutralise();
  VitreKeys.install({ onAction: (a, arg, info) => actions.push(a + "[" + info.how + "]") });
  const page = (code) => KS.inPage("function(w,d){ return w.wrappedJSObject.eval(" + JSON.stringify(code) + "); }");
  const key = async (spec, wait = 500) => { actions.length = 0; KS.press(spec); await spike.sleep(wait); return actions.slice(); };
  const load = async (q) => { await KS.load(KS.pageURL("edge.html", q)); window.focus(); gBrowser.selectedBrowser.focus(); await spike.sleep(300); };
  const dialogs = () => { try { return gBrowser.getTabDialogBox(gBrowser.selectedBrowser).getContentDialogManager()._dialogs.length; } catch (e) { return "? " + e; } };
  const ae = () => { const a = document.activeElement; return a ? a.localName + (a.id ? "#" + a.id : "") + (a.className && typeof a.className === "string" ? "." + a.className.split(" ")[0] : "") : null; };

  spike.log("--- 1. alert() open (tab-modal prompt)");
  await load("");
  await page("setTimeout(() => { alert('hello from the page'); seen.push('alert-returned'); publish(); }, 0); 1");
  await spike.sleep(1200);
  spike.log("  prompt open: dialogs=" + dialogs() + " chrome activeElement=" + ae());
  await spike.capture("v9-alert");
  let a = await key("Ctrl+L");
  const a2 = await key("Ctrl+R");
  const a3 = await key("F5");
  spike.log("  Ctrl+L -> " + JSON.stringify(a) + ", Ctrl+R -> " + JSON.stringify(a2) + ", F5 -> " + JSON.stringify(a3) + " (dialogs still open: " + dialogs() + ")");
  a = await key("Escape", 900);
  spike.log("  Esc -> Vitre " + JSON.stringify(a) + " | dialogs now " + dialogs() + " | page saw " + JSON.stringify(await KS.pageSeen()) + (a.length && dialogs() === 0 ? "   <-- the prompt closed AND Vitre ran its Esc step" : ""));
  await page("setTimeout(() => { alert('second'); }, 0); 1");
  await spike.sleep(1200);
  a = await key("Ctrl+W", 700);
  spike.log("  alert open, Ctrl+W (browser-first) -> " + JSON.stringify(a) + " dialogs " + dialogs());
  a = await key("Enter", 900);
  spike.log("  Enter -> Vitre " + JSON.stringify(a) + " dialogs " + dialogs());

  spike.log("--- 2. popover (light dismiss on Esc) and <input type=search>");
  await load("");
  await page("const p = document.createElement('div'); p.id = 'pop'; p.popover = 'auto'; p.textContent = 'popover'; document.body.appendChild(p); p.addEventListener('toggle', (e) => { seen.push('popover:' + e.newState); publish(); }); p.showPopover(); p.matches(':popover-open')");
  await spike.sleep(300);
  a = await key("Escape", 700);
  spike.log("  Esc with a page popover open -> Vitre " + JSON.stringify(a) + " | page saw " + JSON.stringify(await KS.pageSeen()) + (a.length ? "   <-- popover closed AND Vitre ran its Esc step" : ""));
  await page("document.getElementById('search').focus(); document.getElementById('search').select(); 1");
  a = await key("Escape", 700);
  spike.log("  Esc in <input type=search> with text -> Vitre " + JSON.stringify(a) + " | value now " + JSON.stringify(await page("document.getElementById('search').value")));

  spike.log("--- 3. focus on nothing in the chrome document");
  await load("");
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  Services.focus.clearFocus(window);
  await spike.sleep(300);
  spike.log("  chrome activeElement=" + ae() + " focusedElement=" + (Services.focus.focusedElement && Services.focus.focusedElement.localName));
  a = await key("Ctrl+L");
  const b2 = await key("Ctrl+T");
  const b3 = await key("Escape");
  const b4 = await key("F6");
  spike.log("  Ctrl+L -> " + JSON.stringify(a) + ", Ctrl+T -> " + JSON.stringify(b2) + ", Esc -> " + JSON.stringify(b3) + ", F6 -> " + JSON.stringify(b4) + " | page saw " + JSON.stringify(await KS.pageSeen()));
});
