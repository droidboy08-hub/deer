// Verify / improve claim 4 (Esc closes a peek, page-first; "flaky when another window has OS focus").
// Hypothesis: the flake is not about Esc at all. When the browser window is not the focus manager's
// ACTIVE window there is no focused content document, so a synthesized key goes nowhere useful.
// A user can only press Esc in an active window, so the real product never sees that state.
//   R1: window active                               -> expect all three Esc behaviours to work
//   R2: another browser window active, ours not     -> expect the spike's failure, deterministically
//   R3: ours re-activated inside Gecko only (focusmanager.testmode + window.focus()), whatever the
//       OS foreground is                            -> expect everything to work again
/* global Services, Cc, Ci, gBrowser, spike, pf, v, VitrePeek, VitreMenu, VitreFind, OpenBrowserWindow */
Services.scriptloader.loadSubScript("resource://vitre-boot/vlib.js", window);
v.vload("common.js", "vitre-menu.js", "vitre-find.js", "vitre-peek.js", "vitre-actors.js");
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1280, 900);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    VitreMenu.install();
    VitreFind.install();
    VitrePeek.install();
    const w32 = v.win32();
    const esc = (br) => pf.inContent(br, (w) => +w.document.documentElement.dataset.esc || 0);
    const token = (br) => pf.inContent(br, (w) => w.document.documentElement.dataset.token);
    const open = async (q) => {
      VitrePeek.open(pf.base + "counter.html" + q, { opener: b });
      const p = VitrePeek.current;
      await pf.browserLoaded(p.browser, "counter");
      await spike.sleep(700);
      p.browser.focus();
      await spike.sleep(200);
      return p;
    };
    const round = async (label) => {
      const env = { gecko_active: Services.focus.activeWindow === window, os_foreground: w32.isForeground() };
      // 1. page does not use Esc
      let p = await open("?r=" + label);
      const tok = await token(p.browser);
      const focusOk = Services.focus.focusedContentBrowsingContext === p.browser.browsingContext;
      pf.key("KEY_Escape");
      await pf.until(() => !VitrePeek.current, 2500);
      const closed1 = !VitrePeek.current;
      let warmSame = null;
      if (closed1) {
        const re = VitrePeek.reopen();
        await spike.sleep(500);
        warmSame = !!re && (await token(re.browser)) === tok;
      }
      if (VitrePeek.current) VitrePeek.close("test", { discard: true });
      // 2. page uses Esc itself
      p = await open("?trapesc&r=" + label);
      pf.key("KEY_Escape");
      await spike.sleep(700);
      const stayed = !!VitrePeek.current;
      const pageEsc = stayed ? await esc(p.browser) : "n/a";
      pf.key("KEY_Escape");
      await spike.sleep(60);
      pf.key("KEY_Escape");
      await spike.sleep(500);
      const closed2 = !VitrePeek.current;
      if (VitrePeek.current) VitrePeek.close("test", { discard: true });
      if (VitrePeek.warm) gBrowser.removeTab(VitrePeek.warm.tab);
      spike.log(label, env, { focusedContentIsPeek: focusOk, "Esc closes (page ignores Esc)": closed1, "warm reopen same instance": warmSame, "Esc on a page that eats it: peek stays": stayed, "page saw Esc": pageEsc, "Esc Esc closes": closed2 });
    };

    await v.activate();
    await round("R1 window active");

    const w2 = OpenBrowserWindow();
    await pf.until(() => w2.gBrowser && w2.pf, 15000, 100);
    await spike.sleep(800);
    for (let i = 0; i < 20 && Services.focus.activeWindow !== w2; i++) {
      w2.focus();
      await spike.sleep(50);
    }
    await round("R2 another window active, no re-activation");

    await v.activate();
    await round("R3 re-activated inside Gecko only");
    w2.close();
  });
