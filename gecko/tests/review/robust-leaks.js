// Robustness review: are closed windows collected? The test keeps only weak references.
//   python tools/run.py --app build-review-robustness --test tests/review/robust-leaks.js --name review-robust-leaks --timeout 180
// Control (stock Firefox interface, same harness): add --stock --env REVIEW_STOCK=1
/* global spike, Services, Cc, Ci, Cu, ChromeUtils, gBrowser */
spike.main(async () => {
  const { check, log, sleep, waitFor } = spike;
  const stock = !window.vitre;
  const browsers = () => [...Services.wm.getEnumerator("navigator:browser")];
  const page = (title) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><title>${title}</title><body style='background:#eee'><p style='margin:120px'>${title}`);

  async function gc() {
    for (let i = 0; i < 5; i++) {
      Cu.forceGC();
      Cu.forceCC();
      await sleep(200);
    }
    await new Promise((r) => Cu.schedulePreciseShrinkingGC(r));
    Cu.forceCC();
    Cu.forceGC();
    await sleep(200);
  }

  // Everything that touches the window lives in this function's frame; only weak references leave it.
  async function useAndClose(options, how) {
    let win = await spike.openWindow(options);
    const refs = { document: Cu.getWeakReference(win.document) };
    if (!stock) {
      refs.browser = Cu.getWeakReference(win.vitre);
      refs.bar = Cu.getWeakReference(win.vitre.bar);
      refs.keys = Cu.getWeakReference(win.vitre.keys);
    }
    win.resizeTo(900, 600);
    await sleep(300);
    if (!stock) {
      const v = win.vitre;
      v.navigate(v.active(), page("leak 1"));
      await sleep(600);
      v.newTab(page("leak 2"), { background: true });
      v.newTab(page("leak 3"));
      await sleep(600);
      if (how.includes("omni")) {
        v.editAddress();
        win.spike.type("leak");
        await sleep(400);
        v.omni.close();
      }
      if (how.includes("hold")) v.bar.hold("review"); // a module that forgot to release
      if (how.includes("zoom")) {
        v.run("zoomIn");
        await sleep(300);
        v.run("zoomReset");
      }
      if (how.includes("autohide")) {
        v.sys("VitreSettings").set({ barAutoHide: true });
        await sleep(600);
        v.sys("VitreSettings").reset();
        await sleep(300);
      }
      if (how.includes("panel")) {
        try {
          win.PanelUI.show();
          await sleep(700);
          win.PanelUI.hide();
          await sleep(300);
        } catch (e) {
          log("panel: " + e);
        }
      }
      if (how.includes("page")) await v.page(v.active()).query("core:ping", 1).catch(() => {});
      v.closeTab(v.tabs[0]);
      await sleep(200);
    } else {
      win.gBrowser.selectedBrowser.fixupAndLoadURIString(page("leak 1"), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      win.gBrowser.addTrustedTab(page("leak 2"));
      await sleep(900);
    }
    win.close();
    win = null;
    await sleep(300);
    return refs;
  }

  const count = browsers().length;
  const cases = [
    ["plain window", {}, []],
    ["window that used the address field, zoom and a page query", {}, ["omni", "zoom", "page"]],
    ["window with a bar hold never released", {}, ["hold"]],
    ["window through an auto-hide cycle", {}, ["autohide"]],
    ["window that opened Firefox's app menu", {}, ["panel"]],
    ["private window", { private: true }, ["omni"]],
  ];
  const all = [];
  for (const [name, options, how] of cases) all.push([name, await useAndClose(options, how)]);
  await waitFor(() => browsers().length === count, { timeout: 8000, what: "windows closed" }).catch(() => {});

  // SessionStore keeps closed-window DATA (not the window); forget it so it cannot matter.
  await sleep(1000);
  await gc();
  await sleep(2500);
  await gc();
  if (!stock) {
    // A broadcast after the windows are gone: a listener that survived would throw or resurrect state.
    const settings = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreSettings.sys.mjs").VitreSettings;
    settings.set({ closeButton: "always" });
    await sleep(200);
    settings.reset();
    await sleep(200);
    await gc();
  }
  for (const [name, refs] of all) {
    const alive = Object.entries(refs).filter(([, r]) => r.get() !== null).map(([k]) => k);
    check(`${stock ? "[stock] " : ""}${name}: collected after close`, alive.length === 0, "still reachable: " + alive.join(", "));
  }
  if (!stock) {
    const Shell = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreShell.sys.mjs").VitreShell;
    check("VitreShell.windows holds only the open window", Shell.windows.size === 1, Shell.windows.size);
    check("no boot errors", Shell.errors.length === 0, Shell.errors);
  }
});
