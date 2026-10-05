// The extensions cluster against the core: auto-hide, F11, element full screen, the address field
// open, tab switches (popup, badge per tab), light and dark glass (theme icons), Peek and the Esc
// ladder, Settings over the page.
//   python tests/extensions/runx.py --test tests/extensions-verify/core.js --name extensions-verify-core --app build-extensions-verify-all --out tests/extensions-verify/out/core
// Captures: core-1-autohide-popup, core-2-f11-popup, core-3-elementfs, core-4-address-open,
// core-5-address-popup, core-6-light-themed, core-7-dark-themed, core-8-peek-popup.
/* global spike, gBrowser, Services, Cc, Ci, ChromeUtils, CustomizableUI, xt, vx */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
spike.main(async () => {
  const b = window.vitre;
  const { check, log, capture, sleep } = spike;
  const settings = b.sys("VitreSettings");
  await spike.resize(1280, 800);
  await spike.activate();
  await xt.nav(xt.page());
  for (const name of ["command", "blocker", "popup", "pageaction"]) await xt.install(name);
  await vx.install("themed");
  await xt.waitFor(() => xt.button("command") && xt.button("blocker") && document.getElementById(vx.widgetId("themed")), 6000);
  await xt.nav(xt.page() + "?core");
  await sleep(600);
  const pill = () => xt.rect(b.bar.item(b.activeId));
  const away = () => spike.click(640, 600, { type: "mousemove" });
  const section = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      check(name + ": ran without throwing", false, String(e) + " " + (e.stack || "").slice(0, 300));
    }
    await xt.closePopups();
  };
  const inPage = (browser, src) =>
    new Promise((resolve) => {
      const id = "vx-page:" + Math.random();
      const mm = browser.messageManager;
      const on = (m) => {
        mm.removeMessageListener(id, on);
        resolve(m.data);
      };
      mm.addMessageListener(id, on);
      mm.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent("(() => { let r; try { r = (" + src + ")(content); } catch (e) { r = String(e); } sendAsyncMessage(" + JSON.stringify(id) + ", r === undefined ? null : r); })()"), false);
    });
  log("visible pinned", xt.visibleInPill());

  // ---- 1. auto-hide: a popup from a keyboard command holds the bar and hangs at 64 ----
  await section("auto-hide", async () => {
    settings.set({ barAutoHide: true });
    away();
    await xt.waitFor(() => b.bar.hidden, 4000);
    check("auto-hide: the bar is hidden", b.bar.hidden);
    xt.realKey("Ctrl+Shift+Y");
    const wp = await xt.waitFor(() => xt.widgetPanel(), 5000);
    await sleep(800);
    log("auto-hide popup", xt.rect(wp), "button", xt.rect(xt.button("command")), "pill", pill(), "hidden", b.bar.hidden);
    check("auto-hide: the command popup opens and the bar comes back for it", !!wp && !b.bar.hidden);
    check("auto-hide: it hangs 8 px under the pill, right edge on its button", !!wp && Math.abs(xt.rect(wp).y + 4 - 64) <= 2 && Math.abs(xt.rect(wp).r - 4 - xt.rect(xt.button("command")).r) <= 2, { wp: xt.rect(wp), button: xt.rect(xt.button("command")) });
    await capture("core-1-autohide-popup");
    await xt.closePopups();
    away();
    await xt.waitFor(() => b.bar.hidden, 4000);
    check("auto-hide: the bar leaves again once the popup closed", b.bar.hidden);
    b.service("extensions").openPanel();
    const panel = await xt.waitFor(() => { const p = document.getElementById("unified-extensions-panel"); return p?.state === "open" ? p : null; }, 5000);
    await sleep(800);
    log("auto-hide panel", xt.rect(panel), "hidden", b.bar.hidden, "ext button", xt.rect(xt.extButton()));
    check("auto-hide: openPanel() shows the bar and the panel hangs at 64 under the extensions button", !!panel && !b.bar.hidden && Math.abs(xt.rect(panel).y + 4 - 64) <= 2 && Math.abs(xt.rect(panel).r - 4 - xt.rect(xt.extButton()).r) <= 2, xt.rect(panel));
    await xt.closePopups();
    away();
    await xt.waitFor(() => b.bar.hidden, 4000);
    check("auto-hide: hidden again after the panel", b.bar.hidden);
    // An add-on doorhanger (an install from the page, refused: the package is unsigned) while the
    // bar is away: it hangs from the extensions button, so the bar must come back for it.
    gBrowser.selectedBrowser.fixupAndLoadURIString(xt.page("/xpi/pin1.xpi"), {
      triggeringPrincipal: Services.scriptSecurityManager.createContentPrincipalFromOrigin(xt.SITE),
      hasValidUserGestureActivation: true,
    });
    const door = await xt.waitFor(() => {
      xt.keepActive();
      const n = PopupNotifications.panel.firstElementChild;
      return PopupNotifications.panel.state === "open" && n && n.getAttribute("popupid") !== "addon-progress" ? n : null;
    }, 15000, 200);
    await sleep(900);
    log("auto-hide doorhanger", door?.getAttribute("popupid"), xt.rect(PopupNotifications.panel), "hidden", b.bar.hidden, "anchor", PopupNotifications.panel.anchorNode?.className);
    check("auto-hide: an add-on doorhanger brings the bar back and hangs at 64 under the extensions button", !!door && !b.bar.hidden && Math.abs(xt.rect(PopupNotifications.panel).y + 4 - 64) <= 2 && Math.abs(xt.rect(PopupNotifications.panel).r - 4 - xt.rect(xt.extButton()).r) <= 2, { rect: xt.rect(PopupNotifications.panel), hidden: b.bar.hidden });
    await capture("core-1b-autohide-doorhanger");
    PopupNotifications.panel.hidePopup();
    await xt.closePopups();
    away();
    await xt.waitFor(() => b.bar.hidden, 4000);
    check("auto-hide: hidden again after the doorhanger", b.bar.hidden);
    await xt.nav(xt.page() + "?core");
    settings.set({ barAutoHide: false });
    await sleep(600);
  });

  // ---- 2. F11 full screen ----
  await section("F11", async () => {
    b.run("fullscreen");
    await xt.waitFor(() => window.fullScreen && b.root.classList.contains("fullscreen"), 5000);
    away();
    await xt.waitFor(() => b.bar.hidden, 4000);
    await sleep(500);
    xt.realKey("Ctrl+Shift+Y");
    const wp = await xt.waitFor(() => xt.widgetPanel(), 5000);
    await sleep(800);
    log("F11 popup", xt.rect(wp), "button", xt.rect(xt.button("command")), "pill", pill());
    const widths = [...xt.toolbar().querySelectorAll("toolbaritem:not(.vx-overflow) .unified-extensions-item-action-button")].map((n) => Math.round(n.getBoundingClientRect().width));
    check("F11: the pinned buttons are still drawn (28 px each)", widths.length >= 4 && widths.every((x) => x === 28) && getComputedStyle(xt.toolbar()).visibility === "visible", { widths, visibility: getComputedStyle(xt.toolbar()).visibility });
    check("F11: the popup opens under its button with the bar shown", !!wp && !b.bar.hidden && Math.abs(xt.rect(wp).y + 4 - (pill().b + 8)) <= 2 && Math.abs(xt.rect(wp).r - 4 - xt.rect(xt.button("command")).r) <= 2, { wp: xt.rect(wp), pill: pill() });
    await capture("core-2-f11-popup");
    await xt.closePopups();
    b.run("fullscreen");
    await xt.waitFor(() => !window.fullScreen && !b.root.classList.contains("fullscreen"), 5000);
    await sleep(800);
  });

  // ---- 3. element full screen: nothing of Vitre is drawn; afterwards the cluster is back ----
  await section("element full screen", async () => {
    Services.prefs.setBoolPref("full-screen-api.allow-trusted-requests-only", false);
    Services.prefs.setCharPref("full-screen-api.transition-duration.enter", "0 0");
    Services.prefs.setCharPref("full-screen-api.transition-duration.leave", "0 0");
    const root = document.documentElement;
    for (let i = 0; i < 4 && !root.hasAttribute("inDOMFullscreen"); i++) {
      await spike.activate();
      b.focusPage();
      await sleep(200);
      await inPage(gBrowser.selectedBrowser, "(c) => { c.document.documentElement.requestFullscreen().catch(() => {}); return 1; }");
      await xt.waitFor(() => root.hasAttribute("inDOMFullscreen"), 3000);
    }
    await sleep(800);
    check("element full screen started", root.hasAttribute("inDOMFullscreen"));
    xt.realKey("Ctrl+Shift+Y");
    const wp = await xt.waitFor(() => xt.widgetPanel(), 4000);
    await sleep(800);
    log("element fs popup", xt.rect(wp), "state", wp?.state);
    await capture("core-3-elementfs");
    await xt.closePopups();
    await inPage(gBrowser.selectedBrowser, "(c) => { c.document.exitFullscreen(); return 1; }");
    await xt.waitFor(() => !root.hasAttribute("inDOMFullscreen"), 5000);
    await sleep(1000);
    check("after element full screen: the cluster is drawn in the active pill again", window.vitreExtensions.bar.drawn() && !!xt.cluster().closest(".item.active") && xt.visibleInPill().length >= 2, xt.visibleInPill());
  });

  // ---- 4. the address field open over the pill ----
  await section("address field", async () => {
    b.editAddress();
    await xt.waitFor(() => b.omni.open, 3000);
    await sleep(500);
    const br = xt.rect(xt.button("blocker"));
    const hit = document.elementFromPoint(br.x + br.w / 2, br.y + br.h / 2);
    log("address open: at the blocker button", hit?.id || hit?.className, "cluster", xt.rect(xt.cluster()), "drawn", window.vitreExtensions.bar.drawn());
    check("address open: the field covers the cluster (no extension button over or through it)", !xt.cluster().contains(hit), hit?.id || hit?.className);
    await capture("core-4-address-open");
    // A keyboard command while the field is open: the popup opens and the field gives way
    // (focus went to the popup) or stays; either way the popup must not hang under the field's list.
    xt.realKey("Ctrl+Shift+Y");
    const wp = await xt.waitFor(() => xt.widgetPanel(), 4000);
    await sleep(800);
    log("address + popup", xt.rect(wp), "omni open", b.omni.open, "focused", vx.focused());
    await capture("core-5-address-popup");
    check("address open + command popup: the popup opens and the field closed for it", !!wp && !b.omni.open, { popup: !!wp, omni: b.omni.open });
    await xt.closePopups();
    if (b.omni.open) b.omni.close?.();
    await sleep(300);
  });

  // ---- 5. tab switches: the popup closes, badges are per tab, the cluster follows ----
  await section("tab switch", async () => {
    const first = b.active();
    await xt.waitFor(() => xt.button("blocker")?.querySelector(".toolbarbutton-badge")?.textContent === "2", 6000);
    const badge = () => xt.button("blocker")?.querySelector(".toolbarbutton-badge")?.textContent ?? "";
    check("tab A: blocker badge 2", badge() === "2", badge());
    spike.click(xt.button("popup"));
    const wp = await xt.waitFor(() => xt.widgetPanel(), 5000);
    await sleep(500);
    b.newTab(xt.page("/install.html"));
    await xt.waitFor(() => gBrowser.selectedBrowser.currentURI.spec.endsWith("/install.html") && !b.active()?.loading, 8000);
    await sleep(800);
    log("after switch: popup", xt.rect(xt.widgetPanel()), "hang", xt.rect(window.vitreExtensions.bar.hang), "cluster", xt.rect(xt.cluster()));
    check("a popup open on tab A does not stay open over tab B", !!wp && !xt.widgetPanel(), vx.openPopups());
    check("tab B: the cluster is in B's pill", !!xt.cluster().closest(".item.active") && b.bar.item(b.activeId).contains(xt.cluster()));
    check("tab B: blocker badge empty (nothing blocked there)", badge() === "", badge());
    b.activate(first);
    await sleep(800);
    check("back on tab A: badge 2 again", badge() === "2", badge());
    // Rapid switching: the cluster always ends in the active pill.
    for (let i = 0; i < 20; i++) {
      b.activate(b.tabs[i % b.tabs.length]);
      await new Promise((r) => requestAnimationFrame(r));
    }
    await sleep(700);
    check("after 20 rapid switches the cluster is in the active pill, drawn", b.bar.item(b.activeId).contains(xt.cluster()) && window.vitreExtensions.bar.drawn());
    b.activate(first);
    await sleep(500);
  });

  // ---- 6. light and dark glass: theme icons ----
  await section("theme icons", async () => {
    const icon = () => {
      const n = document.getElementById(vx.widgetId("themed"))?.querySelector(".toolbarbutton-icon");
      return n ? getComputedStyle(n).listStyleImage : "";
    };
    await xt.nav("data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><title>Light</title><body style='margin:0;background:#fafafa;color:#222;font:16px Segoe UI'><div style='padding:120px 80px'>A light page</div>"));
    await xt.waitFor(() => b.theme() === "light", 4000);
    await sleep(500);
    const light = icon();
    log("light glass icon", light.slice(0, 120));
    check("light glass: the extension's icon for light themes (dark glyph)", /dark\.svg/.test(light), light.slice(0, 120));
    await capture("core-6-light-themed");
    await xt.nav("data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><title>Dark</title><body style='margin:0;background:#121316;color:#ddd;font:16px Segoe UI'><div style='padding:120px 80px'>A dark page</div>"));
    await xt.waitFor(() => b.theme() === "dark", 4000);
    await sleep(500);
    const dark = icon();
    log("dark glass icon", dark.slice(0, 120));
    check("dark glass: the extension's icon for dark themes (light glyph)", /light\.svg/.test(dark), dark.slice(0, 120));
    const br = getComputedStyle(xt.button("blocker"));
    log("dark glass button colour", br.color, "badge ring", getComputedStyle(xt.button("blocker").querySelector(".toolbarbutton-badge")).boxShadow);
    await capture("core-7-dark-themed");
  });

  // ---- 7. Peek open: a popup's Esc closes the popup, not the peek ----
  await section("peek", async () => {
    await xt.nav(xt.page() + "?peek");
    const peek = b.service("peek");
    if (!peek) {
      log("no peek service in this build: skipped");
      return;
    }
    peek.open(xt.page("/install.html"));
    await xt.waitFor(() => peek.isOpen() && peek.browser()?.currentURI?.spec?.endsWith("/install.html"), 8000);
    await sleep(1200);
    spike.click(xt.button("popup"));
    const wp = await xt.waitFor(() => xt.widgetPanel(), 5000);
    await sleep(700);
    log("peek + popup", xt.rect(wp), "peek header", peek.headerRect?.());
    check("Peek open: an extension button still opens its popup (the bar stays above the dim)", !!wp);
    await capture("core-8-peek-popup");
    spike.press("Escape");
    await xt.waitFor(() => !xt.widgetPanel(), 3000);
    await sleep(500);
    check("Esc closes the popup and leaves the peek open", !xt.widgetPanel() && peek.isOpen());
    peek.close();
    await xt.waitFor(() => !peek.isOpen(), 4000);
  });

  // ---- 8. Settings open over the page: the cluster stays usable, popups above the panel ----
  await section("settings panel", async () => {
    const s = b.service("settings");
    if (!s) return;
    s.open("general");
    await sleep(800);
    xt.realKey("Ctrl+Shift+Y");
    const wp = await xt.waitFor(() => xt.widgetPanel(), 4000);
    log("settings + popup", xt.rect(wp));
    check("Settings open: a command popup still opens under its button", !!wp && Math.abs(xt.rect(wp).y + 4 - 64) <= 2);
    await xt.closePopups();
    s.close?.();
    await sleep(500);
  });

  // ---- 9. Appearance Light / Dark: the native panels take the menu material of that mode ----
  await section("appearance", async () => {
    await xt.nav(xt.page() + "?appearance");
    const bg = (p) => {
      const part = p?.shadowRoot?.querySelector("[part~=content]");
      return part ? getComputedStyle(part).backgroundColor : "";
    };
    for (const [mode, want] of [["light", "rgb(249, 249, 249)"], ["dark", "rgb(44, 44, 44)"]]) {
      settings.set({ theme: mode });
      await sleep(1500);
      spike.click(xt.extButton());
      const panel = await xt.waitFor(() => { const p = document.getElementById("unified-extensions-panel"); return p?.state === "open" ? p : null; }, 5000);
      await sleep(700);
      log(mode, "panel background", bg(panel), "radius", panel?.shadowRoot && getComputedStyle(panel.shadowRoot.querySelector("[part~=content]")).borderRadius);
      check(`Appearance ${mode}: the extensions panel is ${want}`, bg(panel) === want, bg(panel));
      await capture(`core-9-panel-${mode}`);
      await xt.closePopups();
    }
    settings.set({ theme: "system" });
    await sleep(800);
  });

  log("vitre errors", vx.errors());
  check("no errors from the extensions module", vx.extErrors().length === 0, vx.extErrors());
});
