// Can the chrome layer register its own JSWindowActor whose child module is loaded from the boot
// folder (resource://vitre-boot/, a file: substitution outside the install directory)?
// Variant "actor-data": the same child logic delivered as a data: frame script instead.
/* global Services, Cc, Ci, gBrowser, spike, pf, VitreActors, ChromeUtils, PathUtils, IOUtils */
for (const f of ["common.js", "vitre-actors.js"]) Services.scriptloader.loadSubScript("resource://vitre-boot/" + f, window);
if (!pf.secondary)
  spike.main(async () => {
    await spike.resize(1100, 760);
    await spike.loaded();
    const b = gBrowser.selectedBrowser;
    const seen = [];
    const cl = {
      observe(m) {
        const s = String(m.message || m);
        if (/Vitre|vitre-boot|JSWindowActor|JSActor/i.test(s)) seen.push(s.slice(0, 400));
      },
    };
    Services.console.registerListener(cl);
    Services.obs.addObserver((subject, topic) => seen.push("observer " + topic), "ipc:content-shutdown");

    spike.log("sandbox level", Services.prefs.getIntPref("security.sandbox.content.level"), "remoteType", b.remoteType, "pid", b.frameLoader.remoteTab.osPid);
    // vitre.pf.actor = "boot" (default): modules straight from the boot folder.
    //                  "profile": copied into <profile>/chrome/vitre/, which the Windows content
    //                  sandbox lets content processes read (it is where userContent.css lives).
    const mode = Services.prefs.getStringPref("vitre.pf.actor", "boot");
    let baseURL = "resource://vitre-boot/";
    if (mode === "profile") baseURL = await VitreActors.installToProfile();
    spike.log("mode", mode, "baseURL", baseURL);
    spike.log("register", VitreActors.register(baseURL));
    for (let i = 0; i < 2; i++) {
      try {
        const r = await VitreActors.query(b, "Vitre:Ping");
        spike.log("PING ok", r);
      } catch (e) {
        spike.log("PING failed", String(e));
      }
      await spike.sleep(500);
    }
    spike.log("tab crashed", gBrowser.selectedTab.hasAttribute("crashed"), "remoteTab alive", !!b.frameLoader?.remoteTab, "pid now", b.frameLoader?.remoteTab?.osPid);
    try {
      spike.log("frame script still works", await pf.inContent(b, (w) => w.document.title));
    } catch (e) {
      spike.log("frame script failed", String(e));
    }
    spike.log("console", seen);
    await spike.capture("actor");

    // A new tab after registration: DOMDocElementInserted should have created the actor and set the
    // find colours before anything is searched.
    const t = gBrowser.addTrustedTab(pf.base + "article.html");
    gBrowser.selectedTab = t;
    await pf.browserLoaded(t.linkedBrowser, "article");
    await spike.sleep(500);
    try {
      spike.log("PING new tab", await VitreActors.query(t.linkedBrowser, "Vitre:Ping"));
      await pf.inContent(t.linkedBrowser, (w) => w.document.getElementById("link1").focus());
      spike.log("LINK", await VitreActors.query(t.linkedBrowser, "Vitre:Link"));
      Services.prefs.setBoolPref("findbar.highlightAll", true);
      Services.prefs.setStringPref("ui.textSelectAttentionBackground", "#ff9632");
      Services.prefs.setStringPref("ui.textSelectAttentionForeground", "#000000");
      t.linkedBrowser.finder.fastFind("glass", false, false);
      await spike.sleep(1200);
      await spike.capture("actor-find-colours");
    } catch (e) {
      spike.log("new tab actor failed", String(e));
    }
    spike.log("console", seen.slice(-6));
  });
