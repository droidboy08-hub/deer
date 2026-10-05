// Why did registerWindowActor not work in boot-devloop.js? Try option variants and look at what
// the content process knows about the runtime-registered chrome package.
/* global spike, gBrowser, Services, Cc, Ci, ChromeUtils, Components */
spike.main(async () => {
  await spike.loaded();
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsISubstitutingProtocolHandler);
  const bootDir = res.getSubstitution("vitre-boot").QueryInterface(Ci.nsIFileURL).file;
  const manifest = bootDir.clone();
  manifest.append("app");
  manifest.append("chrome.manifest");
  Components.manager.QueryInterface(Ci.nsIComponentRegistrar).autoRegister(manifest);

  // What does an ALREADY RUNNING content process see?
  const probeContent = (label) =>
    new Promise((resolve) => {
      const name = "Vitre:ProcProbe:" + label;
      const seen = [];
      const listener = (m) => {
        seen.push(m.data);
      };
      Services.ppmm.addMessageListener(name, listener);
      const code = `
        (() => {
          const out = { pid: Services.appinfo.processID, type: Services.appinfo.remoteType };
          const reg = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry);
          try { out.chrome = reg.convertChromeURL(Services.io.newURI("chrome://vitre/content/actors/VitreProbeChild.sys.mjs")).spec; } catch (e) { out.chrome = "ERR " + e.name; }
          try { out.skin = reg.convertChromeURL(Services.io.newURI("chrome://vitre/skin/vitre.css")).spec; } catch (e) { out.skin = "ERR " + e.name; }
          try { const r = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsISubstitutingProtocolHandler); out.resource = r.hasSubstitution("vitre") ? r.getSubstitution("vitre").spec : "none"; } catch (e) { out.resource = "ERR " + e.name; }
          try { out.importChrome = Object.keys(ChromeUtils.importESModule("chrome://vitre/content/actors/VitreProbeChild.sys.mjs")).join(","); } catch (e) { out.importChrome = "ERR " + e; }
          try { out.importResource = Object.keys(ChromeUtils.importESModule("resource://vitre/actors/VitreProbeChild.sys.mjs")).join(","); } catch (e) { out.importResource = "ERR " + e; }
          sendAsyncMessage(${JSON.stringify(name)}, out);
        })();`;
      Services.ppmm.loadProcessScript("data:text/javascript," + encodeURIComponent(code), false);
      setTimeout(() => {
        Services.ppmm.removeMessageListener(name, listener);
        resolve(seen);
      }, 2500);
    });
  for (const r of await probeContent("existing")) spike.log("process (existing) " + JSON.stringify(r));

  const P = "chrome://vitre/content/actors/VitreProbeParent.sys.mjs";
  const C = "chrome://vitre/content/actors/VitreProbeChild.sys.mjs";
  const variants = {
    A_noFlag: { parent: { esModuleURI: P }, child: { esModuleURI: C } },
    B_safeFlag: { parent: { esModuleURI: P }, child: { esModuleURI: C }, safeForUntrustedWebProcess: true },
    C_safeFlag_resourceChild: { parent: { esModuleURI: P }, child: { esModuleURI: "resource://vitre/actors/VitreProbeChild.sys.mjs" }, safeForUntrustedWebProcess: true },
    D_safe_matches_groups_events: {
      parent: { esModuleURI: P },
      child: { esModuleURI: C, events: { DOMContentLoaded: {} } },
      matches: ["http://*/*", "https://*/*"],
      messageManagerGroups: ["browsers"],
      safeForUntrustedWebProcess: true,
    },
  };
  const ask = async (browser, actorName) => {
    try {
      const actor = browser.browsingContext.currentWindowGlobal.getActor(actorName);
      return await Promise.race([actor.sendQuery("VitreProbe:Ping"), spike.sleep(4000).then(() => "TIMEOUT (no answer in 4 s)")]);
    } catch (e) {
      return "ERR " + e;
    }
  };
  const b = gBrowser.selectedBrowser;
  spike.log("existing tab: remoteType=" + b.remoteType + " uri=" + b.currentURI.spec);
  for (const [name, opts] of Object.entries(variants)) {
    // The actor NAME decides the class looked up in the module (<Name>Parent / <Name>Child), so
    // every variant registers as "VitreProbe" and is unregistered afterwards.
    const actorName = "VitreProbe";
    try {
      ChromeUtils.unregisterWindowActor(actorName);
      ChromeUtils.registerWindowActor(actorName, opts);
    } catch (e) {
      spike.log(name + " register ERR " + e);
      continue;
    }
    spike.log(name + " existing-tab -> " + JSON.stringify(await ask(b, actorName)));
  }
  // A page loaded AFTER registration, in a NEW content process (different site => new process)
  const tab = gBrowser.addTrustedTab("https://www.iana.org/help/example-domains", { inBackground: false });
  for (let i = 0; i < 150 && (tab.linkedBrowser.webProgress?.isLoadingDocument || tab.linkedBrowser.currentURI.spec === "about:blank"); i++) await spike.sleep(100);
  await spike.sleep(500);
  spike.log("new tab: remoteType=" + tab.linkedBrowser.remoteType + " uri=" + tab.linkedBrowser.currentURI.spec);
  for (const [name, opts] of Object.entries(variants)) {
    ChromeUtils.unregisterWindowActor("VitreProbe");
    ChromeUtils.registerWindowActor("VitreProbe", opts);
    spike.log(name + " new-tab -> " + JSON.stringify(await ask(tab.linkedBrowser, "VitreProbe")));
  }
  for (const r of await probeContent("after")) spike.log("process (after) " + JSON.stringify(r));

  const msgs = Services.console.getMessageArray().map((m) => String(m.message || m)).filter((m) => /vitre|JSActor|Actor/i.test(m));
  for (const m of msgs.slice(-12)) spike.log("console: " + m.slice(0, 400));
});
