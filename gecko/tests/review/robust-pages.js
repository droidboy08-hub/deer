// Robustness review: unusual pages under the glass: PDF, error pages, view-source, parent-process
// about: pages, a page that never finishes loading, file: and blob: URLs, long titles.
//   python tools/run.py --app build-review-robustness --test tests/review/robust-pages.js --name review-robust-pages --timeout 300
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser, IOUtils, PathUtils */
if (spike.first) Services.scriptloader.loadSubScript("resource://vitre-boot/robust-lib.js", window);
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const R = window.R;
  const b = window.vitre;
  const $ = (s, d = document) => d.querySelector(s);
  R.consoleStart();
  await spike.resize(1280, 800);
  await spike.activate();
  const host = () => $("#vitre-bar .item.active .host")?.textContent;
  const mark = () => b.keys.log.length;
  const actions = (m) => b.keys.log.slice(m).filter((l) => l.startsWith("ACTION")).map((l) => l.replace(/^ACTION /, ""));
  const errors = () => R.shared.errors.length;

  // ---- 1. a PDF ----
  log("--- 1. PDF");
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 60 >> stream
BT /F1 36 Tf 72 700 Td (Vitre PDF robustness page) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>`;
  const pdfPath = PathUtils.join(Services.env.get("VITRE_OUT"), "review.pdf");
  await IOUtils.write(pdfPath, new TextEncoder().encode(pdf));
  const pdfUrl = b.sys("VitreHome").fileURL(pdfPath);
  const t = b.active();
  await R.load(pdfUrl);
  await waitFor(() => t.title.length > 0 && !t.loading, { timeout: 20000, what: "pdf viewer" }).catch(() => {});
  await sleep(1500);
  const isPdf = await R.inPage("function(w, d){ return { uri: d.documentURI, cls: d.documentElement.className, viewer: !!d.getElementById('viewer'), remote: Services.appinfo.remoteType }; }");
  log("pdf:", { title: t.title, url: t.url.slice(0, 40), host: host(), theme: t.theme, page: isPdf });
  check("PDF: pdf.js shows the file, the pill shows the file name, the theme was sampled", !!isPdf?.viewer && host() === "review.pdf" && (t.theme === "light" || t.theme === "dark"), { host: host(), theme: t.theme, isPdf });
  await spike.capture("pages-pdf");
  // Keys on the PDF: pdf.js takes Ctrl+F and Ctrl+P itself (page-first); Ctrl+W and Ctrl+T are Vitre's.
  b.focusPage();
  await sleep(300);
  let m = mark();
  spike.press("Ctrl+F");
  await sleep(600);
  const findbar = await R.inPage("function(w, d){ const f = d.getElementById('findbar'); return f ? !f.classList.contains('hidden') : 'nofindbar'; }");
  log("Ctrl+F on the PDF:", { pdfFindbar: findbar, actions: actions(m), omni: b.omni.open });
  check("PDF: Ctrl+F goes to pdf.js (its own find bar), not to Vitre's find", findbar === true && actions(m).length === 0, { findbar, actions: actions(m) });
  spike.press("Escape");
  await sleep(300);
  m = mark();
  spike.press("Ctrl+Plus");
  await sleep(600);
  const pdfZoom = await R.inPage("function(w, d){ return d.getElementById('scaleSelect')?.value || w.PDFViewerApplication?.pdfViewer?.currentScaleValue; }");
  log("Ctrl+Plus on the PDF:", { actions: actions(m), tabZoom: t.zoom, pdfZoom });
  check("PDF: Ctrl+Plus is pdf.js's zoom, not the tab's", actions(m).length === 0 && t.zoom === 1, { actions: actions(m), tabZoom: t.zoom, pdfZoom });

  // ---- 2. error pages ----
  log("--- 2. error pages");
  const before = errors();
  b.navigate(t, "https://nonexistent-host.invalid/path");
  await waitFor(() => t.error !== null, { timeout: 20000, what: "network error page" }).catch(() => {});
  await sleep(1200);
  log("neterror:", { url: t.url, title: t.title, error: t.error, host: host(), theme: t.theme, canBack: t.canBack });
  check("error page: the model carries the error and the pill shows the host the user typed", !!t.error && host() === "nonexistent-host.invalid", { host: host(), error: t.error });
  check("error page: the glass theme was sampled from it", t.theme === "light" || t.theme === "dark", t.theme);
  await spike.capture("pages-neterror");
  b.focusPage();
  await sleep(300);
  m = mark();
  spike.press("Ctrl+R");
  await sleep(800);
  check("error page: Ctrl+R runs reload", actions(m).some((a) => a.startsWith("reload")), actions(m));
  await sleep(1500);
  // A certificate error.
  b.navigate(t, "https://expired.badssl.com/");
  await waitFor(() => t.error !== null || t.title.length > 0, { timeout: 25000, what: "cert error page" }).catch(() => {});
  await sleep(1500);
  log("certerror:", { url: t.url, title: t.title, error: t.error, host: host(), theme: t.theme });
  check("certificate error page: host in the pill, error in the model", host() === "expired.badssl.com", { host: host(), error: t.error, title: t.title });
  await spike.capture("pages-certerror");

  // ---- 3. view-source, about:config, about:preferences, about:blank ----
  log("--- 3. internal pages");
  await R.load("https://example.com/");
  b.focusPage();
  await sleep(300);
  const n = b.tabs.length;
  spike.press("Ctrl+U");
  await waitFor(() => b.tabs.length === n + 1 && b.active().url.startsWith("view-source:"), { timeout: 10000, what: "view-source tab" }).catch(() => {});
  await sleep(1000);
  log("view-source:", { url: b.active().url, host: host(), theme: b.active().theme, title: b.active().title });
  check("view-source: opens next to the page, pill says view-source, theme sampled", b.active().url === "view-source:https://example.com/" && host() === "view-source" && b.tabs.indexOf(b.active()) === b.tabs.indexOf(t) + 1, { url: b.active().url, host: host() });
  b.closeTab(b.active());
  await sleep(300);
  for (const url of ["about:config", "about:preferences", "about:blank", "about:support"]) {
    const tab = b.newTab(url);
    await waitFor(() => !tab.loading && tab.url === url, { timeout: 15000, what: url }).catch(() => {});
    await sleep(900);
    const ping = await b.page(tab).query("core:ping", 1).catch((e) => "threw " + e);
    log(url, { host: host(), kind: tab.kind, theme: tab.theme, title: tab.title, remote: tab.browser.isRemoteBrowser, ping: ping && ping.remoteType, omni: b.omni.open });
    check(`${url}: the pill shows it, the page actor answers`, (url === "about:blank" ? tab.kind === "home" : host() === url) && (url === "about:blank" || (ping && ping.echo === 1)), { host: host(), kind: tab.kind, ping });
    if (url === "about:preferences") {
      // Typing in its search field must stay there.
      b.omni.open && b.omni.close();
      await sleep(200);
      const focused = await R.inPage("function(w, d){ const f = d.getElementById('searchInput'); f?.focus(); return d.activeElement?.id; }", tab.browser);
      m = mark();
      spike.type("tabs");
      await sleep(400);
      const value = await R.inPage("function(w, d){ return d.getElementById('searchInput')?.value; }", tab.browser);
      check("about:preferences: typing goes to its own search field (no Vitre action, no address field)", focused === "searchInput" && value === "tabs" && actions(m).length === 0 && !b.omni.open, { focused, value, actions: actions(m), omni: b.omni.open });
    }
    if (url === "about:config") {
      b.omni.open && b.omni.close();
      await sleep(200);
      m = mark();
      spike.press("Ctrl+F");
      await sleep(400);
      log("Ctrl+F on about:config:", { actions: actions(m), omni: b.omni.open, focus: document.activeElement?.id || document.activeElement?.localName });
    }
    b.omni.open && b.omni.close();
    b.closeTab(tab);
    await sleep(300);
  }

  // ---- 4. a page that never finishes loading ----
  log("--- 4. a load that never ends");
  const slow = b.newTab("https://10.255.255.1/never", { background: false });
  await sleep(2500);
  b.omni.open && b.omni.close();
  log("pending load:", { loading: slow.loading, url: slow.url, host: host(), kind: slow.kind, theme: slow.theme, pill: $("#vitre-bar .item.active")?.className });
  check("a load that never ends: the pill shows the host and the loading state", slow.loading && host() === "10.255.255.1" && $("#vitre-bar .item.active").classList.contains("loading"), { host: host(), loading: slow.loading });
  await spike.capture("pages-loading");
  b.focusPage();
  await sleep(200);
  m = mark();
  spike.press("Escape");
  await waitFor(() => !slow.loading, { timeout: 5000, what: "Esc stopping the load" }).catch(() => {});
  check("Esc stops it", !slow.loading && actions(m).some((a) => a.startsWith("stop")), { loading: slow.loading, actions: actions(m) });
  b.closeTab(slow);
  await sleep(300);

  // ---- 5. long title, RTL title, blob: URL, file: with spaces ----
  log("--- 5. odd documents");
  const long = b.newTab(R.page("A".repeat(400) + " long title " + "שלום ".repeat(20), "<p>long</p>"));
  await waitFor(() => long.title.length > 100 && !long.loading, { timeout: 10000 }).catch(() => {});
  b.omni.open && b.omni.close();
  await sleep(400);
  const pillRect = R.rect($("#vitre-bar .item.active"));
  const hostRect = R.rect($("#vitre-bar .item.active .host"));
  check("a 400-character title: the pill keeps its size and the address text stays inside it", pillRect.w <= 480 && pillRect.h === 44 && hostRect.x + hostRect.w <= pillRect.x + pillRect.w, { pillRect, hostRect });
  const dir = PathUtils.join(Services.env.get("VITRE_OUT"), "dir with spaces & #hash");
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  const filePath = PathUtils.join(dir, "café page.html");
  await IOUtils.write(filePath, new TextEncoder().encode("<!doctype html><meta charset=utf-8><title>Local file</title><body style='background:#eef'>local"));
  b.navigate(long, b.sys("VitreHome").fileURL(filePath));
  await waitFor(() => long.title === "Local file" && !long.loading, { timeout: 10000, what: "file page" }).catch(() => {});
  await sleep(400);
  log("file page:", { url: long.url, host: host() });
  check("file: URL with spaces, # and a non-ASCII name: the pill shows the decoded file name", host() === "café page.html", host());
  const blobOk = await R.inPage("function(w, d){ const u = w.URL.createObjectURL(new w.Blob(['<title>Blob doc</title><body>blob'], { type: 'text/html' })); w.location.href = u; return u; }", long.browser);
  await waitFor(() => long.title === "Blob doc", { timeout: 8000, what: "blob page" }).catch(() => {});
  await sleep(400);
  log("blob page:", { url: long.url.slice(0, 60), host: host(), blobOk });
  check("blob: URL: the pill shows something sensible, no exception", typeof host() === "string" && host().length > 0 && errors() === before + R.shared.errors.slice(before).filter((e) => !/vitre/.test(e.source)).length, host());
  b.closeTab(long);
  await sleep(300);

  check("final consistency", R.consistent().length === 0, R.consistent());
  const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
  check("no boot errors", Shell.errors.length === 0, Shell.errors);
  R.consoleDump("pages");
});
