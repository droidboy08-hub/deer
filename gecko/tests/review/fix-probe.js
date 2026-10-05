// Fix-stage probe (not a product test): what the runtime offers for the open findings.
//   python tools/run.py --test tests/review/fix-probe.js --name fix-probe --out tests/review/out-fix/probe --timeout 120 --pref security.certerrors.felt-privacy-v1=false
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
spike.main(async () => {
  const b = window.vitre;
  const { log, sleep, waitFor } = spike;
  await spike.resize(1280, 800);
  await spike.activate();
  const T = { 0: "invalid", 32: "string", 64: "int", 128: "bool" };

  // 1. DOM APIs in the shared system global (for a decode that outlives tabs)
  const g = Cu.getGlobalForObject(ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs"));
  log("SYSGLOBAL createImageBitmap=" + typeof g.createImageBitmap + " OffscreenCanvas=" + typeof g.OffscreenCanvas + " Blob=" + typeof g.Blob + " Image=" + typeof g.Image);
  try {
    const hw = Services.appShell.hiddenDOMWindow;
    log("HIDDENWIN " + (hw ? hw.location.href + " createImageBitmap=" + typeof hw.createImageBitmap + " OffscreenCanvas=" + typeof hw.OffscreenCanvas : "null"));
  } catch (e) {
    log("HIDDENWIN ERR " + e);
  }

  // 2. a process-wide user sheet with @-moz-document: does it reach a content-process error page and a chrome dialog?
  const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
  const css = `@-moz-document url-prefix("about:neterror"), url-prefix("about:certerror") { body { background: rgb(246, 247, 249) !important; } .title-text { color: rgb(1, 2, 3) !important; } }
@-moz-document url("chrome://global/content/commonDialog.xhtml") { :root { --color-accent-primary: #005fb8 !important; --color-accent-primary-hover: #1a6fc4 !important; --color-accent-primary-active: #2d7bca !important; } }`;
  const uri = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(css));
  sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
  log("SSS registered " + sss.sheetRegistered(uri, sss.USER_SHEET));
  const t = b.active();
  b.navigate(t, "http://nothing-here.invalid/");
  await waitFor(() => t.error, { timeout: 20000, what: "error page" }).catch((e) => log("NOTE " + e));
  await sleep(1500);
  const info = await new Promise((resolve) => {
    const mm = gBrowser.selectedBrowser.messageManager;
    const id = "P:" + Math.random();
    mm.addMessageListener(id, function on(m) {
      mm.removeMessageListener(id, on);
      resolve(m.data);
    });
    const src = `(function(){ const d = content.document; const cs = (el) => el ? content.getComputedStyle(el) : null; const t = d.querySelector('.title-text'); const btn = d.querySelector('#neterrorTryAgainButton'); const h = d.querySelector('.title'); sendAsyncMessage(${JSON.stringify(id)}, { url: d.documentURI.slice(0, 60), remote: Services.appinfo.remoteType, bodyBg: cs(d.body).backgroundColor, title: t && t.textContent, titleColor: t && cs(t).color, titleFont: t && cs(t).font, titleBgImage: h && cs(h).backgroundImage, btnText: btn && btn.textContent, btnBg: btn && cs(btn).backgroundColor, btnH: btn && btn.getBoundingClientRect().height, btnRadius: btn && cs(btn).borderRadius, accent: cs(d.documentElement).getPropertyValue('--color-accent-primary'), containerW: d.querySelector('.container') && d.querySelector('.container').getBoundingClientRect().width, classes: d.body.className, short: (d.getElementById('errorShortDesc') || {}).textContent }); })()`;
    mm.loadFrameScript("data:," + encodeURIComponent(src), false);
  });
  log("NETERROR " + JSON.stringify(info));
  log("TAB " + JSON.stringify({ url: t.url, title: t.title, error: t.error, kind: t.kind, winTitle: document.title }));
  await spike.capture("probe-neterror");

  // 3. the alert() prompt (a tab-modal dialog in the chrome document)
  const page = "data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><meta charset=utf-8><title>Alert</title><body style='margin:0;background:#f3eee4;font:16px Segoe UI'><p style='margin:140px 40px'>alert</p><script>setTimeout(()=>alert('Saved your changes.'),600)</scr" + "ipt>");
  b.navigate(t, page);
  await sleep(2500);
  let dinfo = null;
  try {
    const frames = [...document.querySelectorAll("browser.dialogFrame, .dialogFrame")];
    const dlg = frames.find((f) => f.contentDocument && f.contentDocument.documentURI.includes("commonDialog"));
    const dd = dlg.contentDocument;
    const dv = dd.defaultView;
    const ok = dd.querySelector("dialog").getButton("accept");
    dinfo = { url: dd.documentURI, frames: frames.length, accent: dv.getComputedStyle(dd.documentElement).getPropertyValue("--color-accent-primary").trim(), okBg: dv.getComputedStyle(ok).backgroundColor, okLabel: ok.label, okH: ok.getBoundingClientRect().height, font: dv.getComputedStyle(dd.body).font };
  } catch (e) {
    dinfo = "ERR " + e;
  }
  log("DIALOG " + JSON.stringify(dinfo));
  await spike.capture("probe-alert");
  spike.press("Escape");
  await sleep(400);

  // 4. prefs the fixes rely on
  for (const p of ["browser.theme.toolbar-theme", "browser.theme.content-theme", "layout.css.prefers-color-scheme.content-override", "widget.windows.overlay-scrollbars.enabled", "security.certerrors.felt-privacy-v1", "browser.nova.enabled", "toolkit.telemetry.unified", "browser.tabs.insertAfterCurrent"]) {
    const type = Services.prefs.getPrefType(p);
    let v = "(none)";
    try {
      v = type === 128 ? Services.prefs.getBoolPref(p) : type === 64 ? Services.prefs.getIntPref(p) : type === 32 ? Services.prefs.getStringPref(p) : "(none)";
    } catch (e) {
      v = "ERR " + e;
    }
    log("PREF " + p + " = " + JSON.stringify(v) + " (" + (T[type] || type) + ")");
  }
  log("SCROLLBARS overlay=" + matchMedia("(-moz-overlay-scrollbars)").matches);
});
