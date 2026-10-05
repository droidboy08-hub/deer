// VERIFY claim 23 (Chrome Web Store "not possible"). The store's own install button can never
// work (confirmed by the original boot-cws.js). This script asks the narrower question: if Vitre
// itself fetched a CRX, what would Gecko 157 do with Chrome-style packages? Local test packages
// only (verify/ext/chrome-*), nothing is downloaded.
Services.scriptloader.loadSubScript("resource://vitre-boot/lib.js", window);
spike.main(async () => {
  await spike.resize(1280, 800);
  xt.hideFirefoxUI();
  const ui = xt.buildBar();
  xt.installExtensionBar(ui);
  const { AddonManager } = xt;
  const { XPIExports } = ChromeUtils.importESModule("resource://gre/modules/addons/XPIExports.sys.mjs");
  await xt.nav(xt.page());
  spike.log("pref extensions.backgroundServiceWorker.enabled=" + Services.prefs.getBoolPref("extensions.backgroundServiceWorker.enabled", false));

  const title = (id) => xt.actionData(id)?.title;
  // 1. temporary load of unpacked Chrome-style folders
  for (const name of ["chrome-mv2", "chrome-dual", "chrome-sw"]) {
    try {
      const a = await AddonManager.installTemporaryAddon(xt.file("ext", name));
      await xt.waitFor(() => xt.extension(a.id), 5000);
      await xt.sleep(1200);
      const ext = xt.extension(a.id);
      spike.log(`temporary ${name}: loaded id=${a.id} isActive=${a.isActive} manifestVersion=${ext?.manifestVersion} background ran -> action title=${JSON.stringify(title(a.id))} warnings=${JSON.stringify((ext?.warnings || []).slice(0, 4))} errors=${JSON.stringify((ext?.errors || []).slice(0, 4))}`);
    } catch (e) {
      spike.log(`temporary ${name}: REFUSED: ${String(e).replace(/\s+/g, " ").slice(0, 500)}`);
    }
  }
  await xt.sleep(500);
  await spike.capture("cws-v-1-chrome-style-temporary");
  for (const a of await AddonManager.getAddonsByTypes(["extension"])) if (a.temporarilyInstalled) await a.uninstall();
  await xt.sleep(500);

  // 2. permanent install of CRX files: stock, then with XPIDatabase.mustSign replaced
  const tryInstall = async (label, file) => {
    const install = await AddonManager.getInstallForFile(xt.file("www", file), "application/x-xpinstall");
    let line = `${label} ${file}: state=${AddonManager.stateToString(install.state)} error=${install.error} ${AddonManager.errorToString(install.error) || ""}`;
    if (install.state === AddonManager.STATE_DOWNLOADED) {
      try {
        await install.install();
        const a = install.addon;
        await xt.waitFor(() => xt.extension(a.id), 5000);
        await xt.sleep(1000);
        line += ` -> installed id=${a.id} temporary=${a.temporarilyInstalled} isActive=${a.isActive} title=${JSON.stringify(title(a.id))}`;
      } catch (e) { line += " -> install() failed: " + String(e).slice(0, 300); }
    }
    spike.log(line);
  };
  for (const f of ["chrome-mv2.crx", "chrome-dual.crx", "chrome-sw.crx"]) await tryInstall("stock release", f);
  XPIExports.XPIDatabase.mustSign = function () { return false; };
  for (const f of ["chrome-mv2.crx", "chrome-dual.crx", "chrome-sw.crx", "vitre-install.crx"]) await tryInstall("mustSign patched", f);
  await xt.sleep(500);
  spike.log("installed now:", JSON.stringify((await AddonManager.getAddonsByTypes(["extension"])).filter((a) => !a.isSystem && !a.isBuiltin).map((a) => ({ id: a.id, name: a.name, temporary: a.temporarilyInstalled, active: a.isActive }))));
  await spike.capture("cws-v-2-crx-permanent-with-patch");
});
