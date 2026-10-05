// Verifier: how far does the "brand.ftl L10n source" rebranding reach, and what is left over?
/* global spike, gBrowser, Services, Cc, Ci, ChromeUtils, OpenBrowserWindow, Localization, L10nRegistry */
const once = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreProbe.sys.mjs").VitreProbe;
if (!once.__verifyRan) {
  once.__verifyRan = true;
  spike.main(main);
}
async function main() {
  const check = (name, ok, detail) =>
    spike.log((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? " :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""));
  await spike.resize(1200, 800);
  await spike.loaded();
  const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");
  spike.log("BUILD MOZ_REQUIRE_SIGNING=" + AppConstants.MOZ_REQUIRE_SIGNING + " MOZ_APP_NAME=" + AppConstants.MOZ_APP_NAME + " DISPLAYNAME=" + AppConstants.MOZ_APP_DISPLAYNAME_DO_NOT_USE + " MOZ_UPDATE_CHANNEL=" + AppConstants.MOZ_UPDATE_CHANNEL + " MOZ_OFFICIAL_BRANDING=" + AppConstants.MOZ_OFFICIAL_BRANDING + " appinfo.name=" + Services.appinfo.name);
  spike.log("L10N sources=" + JSON.stringify(L10nRegistry.getInstance().getSourceNames()));

  // 1. window titles: page, tab switch, about: page, private window
  check("V1 title on a real page", document.title.endsWith(" — Vitre") && !/Firefox|Mozilla/.test(document.title), document.title);
  const tab2 = gBrowser.addTrustedTab("https://www.iana.org/help/example-domains", { inBackground: false });
  await spike.loaded(tab2.linkedBrowser);
  await spike.sleep(400);
  const t2 = document.title;
  gBrowser.selectedTab = gBrowser.tabs[0];
  await spike.sleep(400);
  check("V2 title follows a tab switch", /Example Domains.* — Vitre$/.test(t2) && /^Example Domain — Vitre$/.test(document.title), { second: t2, backToFirst: document.title });

  // 2. Fluent strings Firefox itself formats with brand terms
  const loc = new Localization(["branding/brand.ftl", "toolkit/branding/brandings.ftl", "browser/browser.ftl", "browser/appmenu.ftl", "browser/menubar.ftl", "browser/preferences/preferences.ftl", "browser/aboutDialog.ftl", "toolkit/about/aboutSupport.ftl", "browser/tabbrowser.ftl"], true);
  const ids = ["browser-main-window-default-title", "browser-main-window-private-window-title", "appmenuitem-exit2", "appmenu-about", "menu-about", "quit-dialog-title", "private-browsing-shortcut-text-2", "browser-shortcut-description", "is-default", "update-application-title", "aboutDialog-title", "appmenuitem-update-banner"];
  const out = {};
  for (const id of ids) {
    try {
      const msgs = loc.formatMessagesSync([{ id }]);
      const m = msgs[0];
      out[id] = m ? [m.value, ...(m.attributes || []).map((a) => a.name + "=" + a.value)].filter(Boolean).join(" | ") : null;
    } catch (e) {
      out[id] = "ERR " + e;
    }
  }
  spike.log("FLUENT " + JSON.stringify(out));
  const leftovers = Object.entries(out).filter(([, v]) => v && /Firefox|Mozilla/.test(v));
  check("V3 brand-term strings say Vitre (none of the sampled ids still says Firefox/Mozilla)", leftovers.length === 0, leftovers);

  // 3. legacy string bundle + branding images (manifest override lines added by the verifier)
  let legacy = "";
  try {
    const b = Services.strings.createBundle("chrome://branding/locale/brand.properties");
    legacy = b.GetStringFromName("brandShortName") + " / " + b.GetStringFromName("brandFullName");
  } catch (e) {
    legacy = "ERR " + e;
  }
  check("V4 legacy brand.properties overridden by a manifest override line", legacy === "Vitre / Vitre", legacy);
  const bytes = async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  try {
    const a = await bytes("chrome://branding/content/icon32.png");
    const b = await bytes("chrome://vitre/skin/icon64.png");
    check("V5 chrome://branding/content/icon32.png overridden (same bytes as Vitre's icon)", a.length === b.length && a.every((x, i) => x === b[i]), { branding: a.length, vitre: b.length });
  } catch (e) {
    check("V5 branding image override", false, String(e));
  }

  // 4. whole window: any visible label still saying Firefox / Mozilla?
  const scan = (doc) => {
    const hits = new Set();
    const walk = doc.createTreeWalker(doc, 1 | 4);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.nodeType === 3) {
        const p = n.parentNode?.localName;
        if (p !== "script" && p !== "style" && /Firefox|Mozilla/.test(n.nodeValue)) hits.add("text: " + n.nodeValue.trim().slice(0, 90));
      } else if (n.attributes) {
        for (const a of ["label", "tooltiptext", "aria-label", "title", "value", "placeholder", "aria-description"]) {
          const v = n.getAttribute(a);
          if (v && /Firefox|Mozilla/.test(v)) hits.add(a + ": " + v.slice(0, 90));
        }
      }
    }
    return [...hits];
  };
  // open the app menu so its lazily-translated items exist
  try {
    PanelUI.show();
    await spike.sleep(1200);
  } catch (e) {
    spike.log("appmenu ERR " + e);
  }
  const chromeHits = scan(document);
  spike.log("SCAN browser.xhtml (app menu open): " + chromeHits.length + " leftover(s) " + JSON.stringify(chromeHits.slice(0, 12)));
  await spike.capture("brand-1-appmenu");
  try {
    PanelUI.hide();
  } catch (e) {}

  // 5. settings page
  const tab = gBrowser.addTrustedTab("about:preferences", { inBackground: false });
  for (let i = 0; i < 100 && tab.linkedBrowser.contentDocument?.readyState !== "complete"; i++) await spike.sleep(100);
  await spike.sleep(2500);
  const prefHits = scan(tab.linkedBrowser.contentDocument);
  spike.log("SCAN about:preferences: " + prefHits.length + " leftover(s) " + JSON.stringify(prefHits.slice(0, 20)));
  const bodyText = tab.linkedBrowser.contentDocument.body.textContent;
  spike.log("about:preferences mentions Vitre " + (bodyText.match(/Vitre/g) || []).length + "x, Firefox " + (bodyText.match(/Firefox/g) || []).length + "x; tab label=" + tab.label + " window title=" + document.title);
  await spike.capture("brand-2-preferences");

  // 6. private window title
  const opened = new Promise((r) => {
    const obs = (w) => {
      Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
      r(w);
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  });
  OpenBrowserWindow({ private: true });
  const pw = await opened;
  pw.resizeTo(1280, 860);
  await spike.sleep(1500);
  check("V6 private window title", pw.document.title === "Vitre Private Browsing", pw.document.title);
  const pHits = scan(pw.gBrowser.selectedBrowser.contentDocument || pw.document);
  spike.log("SCAN about:privatebrowsing: " + JSON.stringify(pHits.slice(0, 8)));
  await spike.capture("brand-3-private");
  pw.close();
}
