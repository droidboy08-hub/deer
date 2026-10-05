// VERIFY (claims 22, 23, 24): media and DRM detection beyond the spike's own fixture.
//   1  a page that asks for Widevine (com.widevine.alpha) while no CDM is installed
//   2  media in a background tab of a SECOND window: attribution and tabFor()
//   3  real pages: an hls.js player page and a page with a plain <video> in a cross-origin iframe
//   4  claim 24: can a content process load the child actor from the dev folder through a
//      directory junction placed in <profile>\chrome ?
// Run with prefs that stop Firefox fetching any CDM (see VERIFY.md).
/* global spike, ChromeUtils, Services, gBrowser, window, document, IOUtils, PathUtils, Cc, Ci, OpenBrowserWindow */
if (Services.prefs.getBoolPref("vitre.verify.started", false)) {
  // second window: not the test
} else {
  Services.prefs.setBoolPref("vitre.verify.started", true);
  spike.main(async () => {
    const H = ChromeUtils.importESModule("resource://vitre-boot/engine/SpikeHarness.sys.mjs");
    const { VitreMedia } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreMedia.sys.mjs");
    const { runTool } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreFfmpeg.sys.mjs");
    const check = (name, ok, detail = "") => spike.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
    const system = Services.scriptSecurityManager.getSystemPrincipal();
    const only = (Services.env.get("VITRE_V_ONLY") || "").split(",").filter(Boolean);
    const want = (k) => !only.length || only.includes(k);
    const here = Services.env.get("VITRE_VERIFY_HERE");
    const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    const dirURI = (path) => {
      const f = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      f.initWithPath(path);
      return Services.io.newFileURI(f);
    };

    await spike.resize(1200, 760);
    const actors = PathUtils.join(PathUtils.profileDir, "chrome", "vitre-actors");
    await IOUtils.makeDirectory(actors, { createAncestors: true, ignoreExisting: true });
    await IOUtils.copy(PathUtils.join(here, "engine", "actors", "VitreMediaChild.sys.mjs"), PathUtils.join(actors, "VitreMediaChild.sys.mjs"));
    res.setSubstitution("vitre-actors", dirURI(actors));
    const link = PathUtils.join(PathUtils.profileDir, "chrome", "vitre-dev");
    const viaJunction = Services.env.get("VITRE_V_ACTOR") === "junction";
    if (viaJunction) {
      // Claim 24: the child actor is loaded straight from the dev folder, through a junction.
      const made = await runTool("cmd.exe", ["/c", "mklink", "/J", link, PathUtils.join(here, "engine", "actors")]);
      spike.log("mklink:", made.stdout.trim() || made.stderr.trim());
      res.setSubstitution("vitre-dev", dirURI(link));
    }
    VitreMedia.install({ childActorURI: viaJunction ? "resource://vitre-dev/VitreMediaChild.sys.mjs" : "resource://vitre-actors/VitreMediaChild.sys.mjs" });
    spike.log("child actor module:", viaJunction ? "resource://vitre-dev/ (junction in <profile>\chrome -> dev folder)" : "resource://vitre-actors/ (copy in <profile>\chrome)");
    const emeSeen = [];
    Services.obs.addObserver((s, t, d) => emeSeen.push(t + (d ? ":" + d : "")), "EMEVideo:CDMMissing");

    const waitFor = async (fn, ms = 15000) => {
      for (let i = 0; i < ms / 100; i++) {
        const v = await fn();
        if (v) return v;
        await spike.sleep(100);
      }
      return null;
    };
    const loadTab = async (win, url, background = false) => {
      const tab = win.gBrowser.addTab(url, { triggeringPrincipal: system });
      if (!background) win.gBrowser.selectedTab = tab;
      await waitFor(() => !tab.linkedBrowser.webProgress?.isLoadingDocument && tab.linkedBrowser.currentURI.spec !== "about:blank", 30000);
      return tab;
    };
    const dump = (id) => [...(VitreMedia.tabs.get(id)?.items.values() ?? [])].map((c) => `${c.kind}/${c.type} ${c.mime} ${c.bytes}B ${c.url.slice(0, 90)}${c.frameUrl ? " [frame " + c.frameUrl.slice(0, 50) + "]" : ""}`);

    // ---- 1: Widevine request, no CDM ----
    if (want("1")) {
      spike.log("--- 1: a page asking for com.widevine.alpha (no CDM installed, CDM downloads blocked by pref)");
      for (const ks of ["com.widevine.alpha", "com.microsoft.playready.recommendation"]) {
        const tab = await loadTab(window, `${H.BASE}/eme.html?ks=${ks}`);
        const id = tab.linkedBrowser.browsingContext.browserId;
        await waitFor(() => VitreMedia.isProtected(id), 6000);
        await spike.sleep(500);
        const t = VitreMedia.tabs.get(id);
        const pageLog = await new Promise((resolve) => {
          const mm = tab.linkedBrowser.messageManager;
          mm.addMessageListener("vitre-verify:log", function on(m) {
            mm.removeMessageListener("vitre-verify:log", on);
            resolve(m.data);
          });
          mm.loadFrameScript("data:,sendAsyncMessage('vitre-verify:log', content.document.getElementById('log').textContent)", false);
        });
        spike.log(`${ks}: page says ${JSON.stringify(pageLog)}; reports ${JSON.stringify(t ? { drm: [...t.drm.entries()], by: [...(t.sources ?? [])] } : null)}`);
        check(`${ks}: the tab is marked protected even though no CDM is there`, VitreMedia.isProtected(id));
        if (ks === "com.widevine.alpha") await spike.capture("media2-1-widevine");
        gBrowser.removeTab(tab);
      }
      spike.log("EMEVideo:CDMMissing notifications (Firefox would fetch the CDM on these):", JSON.stringify(emeSeen));
    }

    // ---- 2: background tab in a second window ----
    if (want("2")) {
      spike.log("--- 2: media in a background tab of a second window");
      const w2 = await new Promise((resolve) => {
        const win = OpenBrowserWindow({});
        const obs = (subject) => {
          if (subject !== win) return;
          Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
          resolve(win);
        };
        Services.obs.addObserver(obs, "browser-delayed-startup-finished");
      });
      w2.resizeTo(1000, 640);
      const bg = await loadTab(w2, `${H.BASE}/media.html`, true);
      const id = bg.linkedBrowser.browsingContext.browserId;
      await waitFor(() => (VitreMedia.tabs.get(id)?.items.size ?? 0) >= 4, 6000);
      await spike.sleep(800);
      spike.log("background tab, not yet shown:", JSON.stringify(dump(id)));
      const kinds = () => [...(VitreMedia.tabs.get(id)?.items.values() ?? [])].map((c) => c.kind);
      check("2: playlists fetched by a background tab are attributed to it", kinds().filter((k) => k === "hls").length >= 2 && kinds().includes("dash"));
      const hadVideo = kinds().includes("video");
      const found = VitreMedia.tabFor(id);
      check("2: tabFor() finds the tab in the other window", found === bg && found.ownerDocument.defaultView === w2,
        `same tab ${found === bg}; ownerGlobal ${typeof found?.ownerGlobal} ${found?.ownerGlobal === w2}; ownerDocument.defaultView === w2 ${found?.ownerDocument?.defaultView === w2}; bg.ownerGlobal === w2 ${bg.ownerGlobal === w2}`);
      w2.gBrowser.selectedTab = bg;
      await waitFor(() => kinds().includes("video"), 6000);
      check("2: the <video> file is seen", kinds().includes("video"), hadVideo ? "already while in the background" : "only once the tab was brought to the front (autoplay is held in background tabs)");
      // Switch away and back: nothing is lost, nothing is duplicated.
      const before = VitreMedia.tabs.get(id).items.size;
      w2.gBrowser.selectedTab = w2.gBrowser.tabs[0];
      await spike.sleep(400);
      w2.gBrowser.selectedTab = bg;
      await spike.sleep(400);
      check("2: a tab switch keeps the tab's list", VitreMedia.tabs.get(id).items.size === before, `${before} item(s)`);
      w2.close();
    }

    // ---- 3: real pages ----
    if (want("3")) {
      spike.log("--- 3: real pages");
      const pages = (Services.env.get("VITRE_V_PAGES") || "https://hls-js.netlify.app/demo/|https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video").split("|");
      let shot = 0;
      for (const url of pages) {
        const tab = await loadTab(window, url);
        const id = tab.linkedBrowser.browsingContext.browserId;
        await waitFor(() => (VitreMedia.tabs.get(id)?.items.size ?? 0) > 0, 15000);
        await spike.sleep(3000);
        const items = dump(id);
        spike.log(`${url} -> tab "${tab.label}" at ${tab.linkedBrowser.currentURI.spec.slice(0, 80)}: ${items.length} item(s), protected ${VitreMedia.isProtected(id)}`);
        for (const line of items.slice(0, 8)) spike.log("    " + line);
        check(`real page ${new URL(url).host}: media is detected and mapped to its tab`, items.length > 0 && VitreMedia.tabFor(id) === tab);
        await spike.capture("media2-3-real-" + ++shot);
        gBrowser.removeTab(tab);
      }
    }

    // ---- 4: junction in <profile>\chrome pointing at the dev folder ----
    if (want("4")) {
      spike.log("--- 4: a directory junction <profile>\\chrome\\vitre-dev -> the dev folder");
      if (!viaJunction) {
        const made = await runTool("cmd.exe", ["/c", "mklink", "/J", link, PathUtils.join(here, "engine", "actors")]);
        spike.log("mklink:", made.stdout.trim() || made.stderr.trim());
        res.setSubstitution("vitre-dev", dirURI(link));
      }
      const tab = await loadTab(window, `${H.BASE}/page.html`);
      const probe = await new Promise((resolve) => {
        const mm = tab.linkedBrowser.messageManager;
        mm.addMessageListener("vitre-verify:probe", function on(m) {
          mm.removeMessageListener("vitre-verify:probe", on);
          resolve(m.data);
        });
        const script = () => {
          const out = {};
          for (const [k, u] of [["copyInProfileChrome", "resource://vitre-actors/VitreMediaChild.sys.mjs"], ["junctionInProfileChrome", "resource://vitre-dev/VitreMediaChild.sys.mjs"], ["devFolder", "resource://vitre-boot/engine/actors/VitreMediaChild.sys.mjs"]]) {
            try {
              ChromeUtils.importESModule(u);
              out[k] = "loaded";
            } catch (e) {
              out[k] = String(e).slice(0, 80);
            }
          }
          sendAsyncMessage("vitre-verify:probe", out);
        };
        mm.loadFrameScript(`data:,(${encodeURIComponent(script.toString())})()`, false);
      });
      spike.log("content process import:", JSON.stringify(probe));
      check("4: a junction in <profile>\\chrome lets a sandboxed content process load modules from the dev folder", probe.junctionInProfileChrome === "loaded", JSON.stringify(probe));
      await runTool("cmd.exe", ["/c", "rmdir", link]);
    }
    Services.prefs.clearUserPref("vitre.verify.started");
  });
}
