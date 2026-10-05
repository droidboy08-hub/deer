// SPIKE switcher/6: settings storage and change broadcast.
// Run 1 (fresh profile):  python tools/run.py --boot spikes/switcher/settings.js --name switcher-settings --out spikes/switcher/out/settings --timeout 120
// Run 2 (same profile):   python tools/run.py --boot spikes/switcher/settings.js --name switcher-settings --out spikes/switcher/out/settings2 --timeout 120 --keep-profile
/* global gBrowser, Services, Ci, Cc, spike, vx, IOUtils, PathUtils, OpenBrowserWindow */
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js?" + Date.now(), window);

(() => {
  const { VitreSettings } = ChromeUtils.importESModule("resource://vitre-boot/modules/VitreSettings.sys.mjs");

  // The boot script runs in every browser window. A second window only listens.
  const windows = [...Services.wm.getEnumerator("navigator:browser")];
  if (windows.length > 1) {
    const off = VitreSettings.onChange((s, changed) => {
      document.documentElement.setAttribute("vitre-theme", s.theme);
      spike.log("   [window 2] heard change", changed, "-> theme attr", document.documentElement.getAttribute("vitre-theme"), "connections", s.connections);
    });
    window.addEventListener("unload", off);
    spike.log("   [window 2] listening");
    return;
  }

  spike.main(async () => {
    await spike.resize(1100, 700);
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const DEFAULTS = {
      theme: "system", barAutoHide: false, homeBackground: { kind: "windows", path: "" }, switcherStyle: "deck", tabOrder: "recent",
      typeToSearch: true, closeButton: "hover", newTabPosition: "next", selectionSearchOpens: "peek", shiftClick: "peek", rebind: {},
      searchEngine: "google", downloadsFolder: "", askWhereToSave: false, connections: 8, speedLimitKBps: 0,
    };
    const CHANGED = {
      theme: "dark", barAutoHide: true, homeBackground: { kind: "video", path: "D:\\Médias\\Zoë\\Vidéos\\море #1.webm" }, switcherStyle: "grid", tabOrder: "bar",
      typeToSearch: false, closeButton: "always", newTabPosition: "end", selectionSearchOpens: "tab", shiftClick: "window",
      rebind: { peek: "Ctrl+E", "search-tabs": "Ctrl+Shift+K" }, searchEngine: "duckduckgo", downloadsFolder: "D:\\Téléchargements", askWhereToSave: true,
      connections: 16, speedLimitKBps: 2048,
    };
    const order = (o) => Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, o[k]]));
    const prefsFile = PathUtils.join(PathUtils.profileDir, "prefs.js");
    const vitreLines = async () => (await IOUtils.readUTF8(prefsFile).catch(() => "")).split("\n").filter((l) => l.includes('"vitre.')).length;

    VitreSettings.init();
    const second = Services.prefs.getBoolPref("vitre.spike.secondRun", false);

    if (second) {
      // ---- run 2: did everything survive a restart? ----
      const s = order(VitreSettings.get());
      spike.log("RUN 2 restored from prefs.js equals what run 1 stored:", eq(s, CHANGED));
      spike.log("RUN 2 settings", s);
      spike.log("RUN 2 reset one field: homeBackground.path");
      VitreSettings.reset("homeBackground.path");
      VitreSettings.reset("homeBackground.kind");
      spike.log("RUN 2 after reset", VitreSettings.get().homeBackground);
      return;
    }

    // ---- 1. defaults ----
    let t0 = performance.now();
    const d = VitreSettings.get();
    spike.log("1 get() in", vx.ms(t0), "ms; downloadsFolder default resolves to", d.downloadsFolder.replace(/Users\\[^\\]+/, "Users\\<user>"));
    spike.log("1 defaults match DEFAULT_SETTINGS (downloadsFolder aside):", eq({ ...order(d), downloadsFolder: "" }, DEFAULTS));
    spike.log("1 prefs on the default branch:", Services.prefs.getDefaultBranch("vitre.").getChildList("").length, "user-set:", Services.prefs.getBranch("vitre.").getChildList("").filter((k) => Services.prefs.prefHasUserValue("vitre." + k)).length);

    // ---- 2. listeners: this window + a second window ----
    const heard = [];
    VitreSettings.onChange((s, changed) => heard.push({ at: performance.now(), changed, theme: s.theme }));
    const win2 = OpenBrowserWindow();
    await new Promise((r) => {
      const obs = (w) => {
        if (w === win2) {
          Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
          r();
        }
      };
      Services.obs.addObserver(obs, "browser-delayed-startup-finished");
    });
    await spike.sleep(500);
    spike.log("2 second window open; windows:", [...Services.wm.getEnumerator("navigator:browser")].length);

    // ---- 3. one set() with every field ----
    t0 = performance.now();
    VitreSettings.set(CHANGED);
    const setMs = vx.ms(t0);
    await spike.sleep(50);
    spike.log("3 set(all 16 fields) took", setMs, "ms; listener calls in this window:", heard.length, "(coalesced), delivered",
      heard[0] ? (heard[0].at - t0).toFixed(2) + " ms after set() started" : "never", "changed keys", heard[0]?.changed.length);
    spike.log("3 round trip equals input:", eq(order(VitreSettings.get()), CHANGED));
    spike.log("3 window 2 saw it:", win2.document.documentElement.getAttribute("vitre-theme"));
    spike.log("3 raw prefs: vitre.homeBackground.path =", Services.prefs.getStringPref("vitre.homeBackground.path"), "| vitre.rebind =", Services.prefs.getStringPref("vitre.rebind"),
      "| vitre.connections type", Services.prefs.getPrefType("vitre.connections") === Services.prefs.PREF_INT ? "int" : "?");

    // ---- 4. a change from outside the module (about:config, another module) ----
    heard.length = 0;
    Services.prefs.setIntPref("vitre.connections", 4);
    await spike.sleep(50);
    spike.log("4 direct pref write heard by this window:", heard.map((h) => h.changed), "connections", VitreSettings.get().connections);
    // bad values typed in about:config fall back to defaults instead of breaking the UI
    Services.prefs.setStringPref("vitre.theme", "purple");
    Services.prefs.setStringPref("vitre.rebind", "{not json");
    await spike.sleep(50);
    spike.log("4 invalid values -> theme", VitreSettings.get().theme, "rebind", VitreSettings.get().rebind);
    VitreSettings.set({ theme: "dark", rebind: CHANGED.rebind, connections: 16 });
    await spike.sleep(50);

    // ---- 5. persistence without asking: is prefs.js written on its own? ----
    spike.log("5 vitre.* lines in prefs.js right after set():", await vitreLines());
    await spike.sleep(1500);
    spike.log("5 vitre.* lines in prefs.js 1.5 s later (no explicit save):", await vitreLines());
    t0 = performance.now();
    Services.prefs.savePrefFile(null);
    spike.log("5 after savePrefFile(null):", await vitreLines(), "lines; save took", vx.ms(t0), "ms");

    // ---- 6. the JSON-file alternative, for comparison ----
    const jsonPath = PathUtils.join(PathUtils.profileDir, "vitre-settings.json");
    const times = { write: [], read: [] };
    for (let i = 0; i < 10; i++) {
      t0 = performance.now();
      await IOUtils.writeJSON(jsonPath, CHANGED, { tmpPath: jsonPath + ".tmp" });
      times.write.push(performance.now() - t0);
      t0 = performance.now();
      await IOUtils.readJSON(jsonPath);
      times.read.push(performance.now() - t0);
    }
    const med = (a) => a.sort((x, y) => x - y)[a.length >> 1].toFixed(2);
    let obsHeard = 0;
    const o = () => obsHeard++;
    Services.obs.addObserver(o, "vitre-settings-changed");
    Services.obs.notifyObservers(null, "vitre-settings-changed");
    Services.obs.removeObserver(o, "vitre-settings-changed");
    spike.log("6 JSON file: IOUtils.writeJSON median", med(times.write), "ms (async, atomic via tmpPath), readJSON median", med(times.read),
      "ms (async: settings are not available synchronously at startup); observer-service broadcast heard", obsHeard);
    t0 = performance.now();
    for (let i = 0; i < 1000; i++) VitreSettings.get();
    spike.log("6 prefs: 1000 x get() of the whole object", vx.ms(t0), "ms (synchronous)");

    Services.prefs.setBoolPref("vitre.spike.secondRun", true);
    Services.prefs.savePrefFile(null);
    win2.close();
    await spike.sleep(300);
  });
})();
