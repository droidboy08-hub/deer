// The product is called Deer wherever a person can see it: no "Vitre" left in the window titles,
// the taskbar id, Firefox's brand strings (Fluent terms and the legacy brand.properties), Deer's own
// layer, every Settings page (About Deer included) and the Downloads panel.
// Internal names stay (vitre.* prefs, chrome://vitre/, #vitre-root, the vitre.ico file name): they
// are not checked here.
//   python tools/run.py --test tests/core/brand.js --name core-brand --timeout 150
/* global spike, Services, ChromeUtils, Localization, gBrowser */
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const b = window.vitre;
  await spike.resize(1280, 820);
  await spike.activate();
  const OLD = /Vitre|VITRE/;

  // ---- window titles and taskbar id ----
  const page = b.newTab("data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><title>Frames</title><p>a page"));
  await waitFor(() => page.title === "Frames" && !page.loading, { timeout: 15000, what: "the page" });
  await sleep(300);
  check("a page's window title is '<title> – Deer'", document.title === "Frames – Deer", document.title);
  const home = b.newTab();
  await waitFor(() => home.url === "about:vitre-home" && !home.loading, { timeout: 15000, what: "Home" });
  if (b.omni.open) b.omni.close();
  await sleep(300);
  check("Home's window title is 'Deer' and its tab is called Home", document.title === "Deer" && home.title === "Home", { title: document.title, tab: home.title });
  const startup = b.sys("VitreStartup");
  check("the taskbar id (AppUserModelID) is Deer.Browser, as the installer's shortcuts", startup.APP_ID === "Deer.Browser", startup.APP_ID);

  const priv = await spike.openWindow({ private: true });
  await waitFor(() => priv.document.title === "Deer Private Browsing", { timeout: 5000, what: "the private window's title" }).catch(() => null);
  check("a private window's title is 'Deer Private Browsing'", priv.document.title === "Deer Private Browsing", priv.document.title);
  priv.close();
  await waitFor(() => priv.closed, { what: "the private window to close" });

  // ---- brand strings ----
  const legacy = Services.strings.createBundle("chrome://branding/locale/brand.properties");
  const names = ["brandShorterName", "brandShortName", "brandFullName"].map((k) => [k, legacy.GetStringFromName(k)]);
  check("brand.properties: shorter, short and full name are Deer", names.every(([, v]) => v === "Deer"), names);
  // As Firefox's documents do: the brand terms come from branding/brand.ftl, which Deer's L10n source provides.
  const fluent = (file, id) => new Localization(["branding/brand.ftl", file], true).formatValueSync(id);
  const terms = {
    "-brand-full-name": fluent("browser/browser.ftl", "browser-main-window-default-title"),
    "-brand-short-name": fluent("browser/aboutRestartRequired.ftl", "restart-button-label"),
    "-brand-shorter-name": fluent("browser/appmenu.ftl", "profiler-popup-presets-firefox-description"),
    "-brand-product-name": fluent("browser/aboutDialog.ftl", "aboutdialog-help-user"),
    "-vendor-short-name": fluent("browser/addonNotifications.ftl", "addon-removal-abuse-report-checkbox"),
  };
  check(
    "Fluent brand terms say Deer in Firefox's own strings",
    terms["-brand-full-name"] === "Deer" &&
      terms["-brand-short-name"] === "Restart Deer" &&
      terms["-brand-shorter-name"] === "Recommended preset for profiling Deer." &&
      terms["-brand-product-name"] === "Deer Help" &&
      terms["-vendor-short-name"] === "Report this extension to Deer",
    terms
  );

  // ---- what a person can read: text, labels, tooltips ----
  const ATTRS = ["aria-label", "title", "placeholder", "alt", "data-tip", "aria-description", "label", "tooltiptext"];
  const leftovers = (root) => {
    const found = [];
    if (!root) return found;
    const walker = document.createTreeWalker(root, 1 | 4);
    for (let n = walker.currentNode; n; n = walker.nextNode()) {
      if (n.nodeType === 3) {
        if (OLD.test(n.data)) found.push(n.data.trim().slice(0, 120));
      } else {
        for (const a of ATTRS) {
          const v = n.getAttribute?.(a);
          if (v && OLD.test(v)) found.push(`${n.localName}[${a}=${v.slice(0, 100)}]`);
        }
      }
    }
    return found;
  };
  check("Deer's layer (bar, pill, tooltips) never says Vitre", leftovers(b.root).length === 0, leftovers(b.root));

  // Every Settings page, the ones feature modules add included.
  const settings = await b.whenService("settings");
  settings.open("general");
  const panel = () => document.getElementById("vitre-settings");
  await waitFor(() => settings.isOpen() && panel() && !panel().hidden, { timeout: 5000, what: "Settings" });
  await sleep(400);
  const ids = [...panel().querySelectorAll(".vs-navitem")].map((n) => n.dataset.id);
  const labels = [...panel().querySelectorAll(".vs-navitem")].map((n) => n.textContent);
  log("settings pages: " + ids.join(", "));
  check("the last Settings page is 'About Deer'", labels[labels.length - 1] === "About Deer", labels);
  const perPage = {};
  for (const id of ids) {
    settings.open(id);
    await waitFor(() => panel().querySelector(".vs-content")?.dataset.page === id, { timeout: 5000, what: "page " + id });
    await sleep(250);
    const hits = leftovers(panel());
    if (hits.length) perPage[id] = hits;
  }
  check(`no Settings page says Vitre (${ids.length} pages)`, ids.length >= 9 && Object.keys(perPage).length === 0, perPage);
  settings.open("about");
  await waitFor(() => panel().querySelector(".vs-content")?.dataset.page === "about", { what: "About" });
  await sleep(300);
  const aboutText = panel().querySelector(".vs-content").textContent;
  check("About Deer names the browser Deer, with its version", /About Deer/.test(panel().textContent) && /Deer\s*Version \d+\.\d+\.\d+/.test(aboutText), aboutText.slice(0, 200));
  await spike.capture("brand-about");
  settings.close();
  await waitFor(() => !settings.isOpen(), { what: "Settings closed" });
  await sleep(300);

  // The Downloads panel.
  const downloads = b.service("downloads");
  if (downloads) {
    downloads.openPanel();
    await waitFor(() => downloads.isPanelOpen?.() && document.querySelector(".vd-panel"), { timeout: 5000, what: "the Downloads panel" });
    await sleep(400);
    check("the Downloads panel never says Vitre", leftovers(document.querySelector(".vd-panel")).length === 0, leftovers(document.querySelector(".vd-panel")));
    spike.press("Escape");
    await waitFor(() => !downloads.isPanelOpen(), { timeout: 5000, what: "the panel closed" });
  } else {
    check("the downloads module is in this build", false);
  }
  b.closeTab(home);
  b.closeTab(page);
  await sleep(200);
  check("the window title is still Deer's at the end", /Deer$/.test(document.title) && gBrowser.tabs.length >= 1, document.title);
});
