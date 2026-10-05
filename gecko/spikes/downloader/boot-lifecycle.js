// Spike 7: persistence and lifecycle. go.py --phase refuse | background
//   refuse     : with a download running, closing the last window and File > Exit are refused
//                (quit-application-requested); a real prompt is shown and captured; the taskbar
//                button shows the download's progress (nsITaskbarProgress); the JSON store is atomic.
//   background : the last window is closed and the download carries on with no window
//                (nsIAppStartup.enterLastWindowClosingSurvivalArea); when it finishes the process exits.
/* global spike, ChromeUtils, Services, Ci, Cc, IOUtils, PathUtils, window, document, BrowserCommands, goQuitApplication */
(async () => {
  const phase = Services.env.get("VITRE_DL_PHASE");
  const H = ChromeUtils.importESModule("resource://vitre-boot/engine/SpikeHarness.sys.mjs");
  const { VitreDownloads } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreDownloads.sys.mjs");
  const { runTool } = ChromeUtils.importESModule("resource://vitre-boot/engine/VitreFfmpeg.sys.mjs");
  const check = (name, ok, detail = "") => spike.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " - " + detail : ""}`);
  try {
    await spike.resize(1100, 700);
    const dir = PathUtils.join(H.DATA, "downloads-lifecycle-" + phase);
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
    await VitreDownloads.init({ dir, connections: 8, keepAliveWithoutWindows: phase === "background" });
    Services.scriptloader.loadSubScript("resource://vitre-boot/overlay.js", window);
    window.vitreOverlay.setNote("lifecycle test: " + phase);
    const id = VitreDownloads.start(`${H.BASE}/blob/big?rate=${phase === "background" ? 2048 : 1024}`, { filename: "lifecycle.bin", named: true });
    const view = () => VitreDownloads.list().find((v) => v.id === id);
    while (view().received < 20 * 1048576) await spike.sleep(50);

    if (phase === "background") {
      const { watchBackground } = ChromeUtils.importESModule("resource://vitre-boot/engine/TestLifecycle.sys.mjs");
      await spike.capture("lifecycle-background-before-close");
      watchBackground(id);
      spike.log("closing the last window (BrowserCommands.tryToCloseWindow, what the X button runs)");
      BrowserCommands.tryToCloseWindow({});
      return; // the window is gone; engine/TestLifecycle.sys.mjs reports from the system scope
    }

    // ---- the store ----
    await spike.sleep(1200);
    const store = await IOUtils.readJSON(VitreDownloads.storePath);
    const rec = store.items[0];
    check("the list is persisted as JSON in the profile while downloading", store.version === 1 && rec.state === "downloading" && rec.file.segments.length === 8 && rec.file.etag !== "",
      `${VitreDownloads.storePath}: ${rec.file.segments.length} segments, ${rec.received} bytes recorded, ETag ${rec.file.etag}; temp file left behind: ${await IOUtils.exists(VitreDownloads.storePath + ".tmp")}`);

    // ---- refusing to quit ----
    const asked = [];
    VitreDownloads.confirmQuit = (n, lastWindow) => {
      asked.push({ n, lastWindow });
      return false;
    };
    BrowserCommands.tryToCloseWindow({});
    await spike.sleep(400);
    check("closing the last window is refused while a download runs", !window.closed && asked.length === 1 && asked[0].lastWindow === true, `confirmQuit asked ${JSON.stringify(asked)}; window.closed=${window.closed}`);
    const quit = goQuitApplication({});
    await spike.sleep(400);
    check("File > Exit (goQuitApplication) is refused while a download runs", quit === false && asked.length === 2 && asked[1].lastWindow === false && view().state === "downloading", `goQuitApplication returned ${quit}; download still ${view().state}`);

    // ---- a real prompt, as the default confirmQuit would show (window-modal, drawn inside the browser window) ----
    let pressed = null;
    VitreDownloads.confirmQuit = (n) => {
      // The prompt is its own modal window and spins a nested event loop (this window's timers
      // are suspended meanwhile): a system-scope timer screenshots it by title and presses its
      // second button.
      H.later(700, async () => {
        const shot = await runTool("python.exe", [PathUtils.join(Services.env.get("VITRE_DL_HERE"), "server", "dialog_helper.py"), "Quit Vitre?", PathUtils.join(spike.outDir, "lifecycle-quit-prompt.png"), "none", "8"]).catch((e) => ({ stdout: String(e) }));
        const win = [...Services.wm.getEnumerator(null)].find((w) => w.document?.title === "Quit Vitre?" || w.document?.documentURI?.includes("commonDialog"));
        const dialog = win?.document.querySelector("dialog");
        spike.log("prompt window:", shot.stdout.trim().slice(0, 200), "| found in-process:", !!dialog, "| text:", win?.document.getElementById("infoBody")?.textContent ?? "");
        if (dialog) dialog.getButton("cancel").click();
        else win?.close();
      });
      const flags = Ci.nsIPromptService.BUTTON_TITLE_IS_STRING * Ci.nsIPromptService.BUTTON_POS_0 + Ci.nsIPromptService.BUTTON_TITLE_IS_STRING * Ci.nsIPromptService.BUTTON_POS_1 + Ci.nsIPromptService.BUTTON_POS_1_DEFAULT;
      pressed = Services.prompt.confirmExBC(window.browsingContext, Ci.nsIPromptService.MODAL_TYPE_WINDOW, "Quit Vitre?",
        `${n} download is still in progress. If you quit now it will pause, and you can resume it next time.`, flags, "Quit", "Keep Downloading", null, null, {});
      return pressed === 0;
    };
    const quit2 = goQuitApplication({});
    check("a quit prompt can be shown; choosing Keep Downloading cancels the quit", quit2 === false && pressed === 1 && view().state === "downloading", `button pressed: ${pressed} (0 Quit, 1 Keep Downloading)`);

    // ---- taskbar progress ----
    const taskbar = Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar);
    const progress = taskbar.getTaskbarProgress(window.docShell);
    const v = view();
    progress.setProgressState(Ci.nsITaskbarProgress.STATE_NORMAL, v.received, v.total);
    await spike.sleep(700);
    const here = Services.env.get("VITRE_DL_HERE");
    const shot1 = await runTool("python.exe", [PathUtils.join(here, "server", "capture_window.py"), "Shell_TrayWnd", PathUtils.join(spike.outDir, "lifecycle-taskbar-normal.png")]);
    progress.setProgressState(Ci.nsITaskbarProgress.STATE_PAUSED, v.received, v.total);
    await spike.sleep(700);
    const shot2 = await runTool("python.exe", [PathUtils.join(here, "server", "capture_window.py"), "Shell_TrayWnd", PathUtils.join(spike.outDir, "lifecycle-taskbar-paused.png")]);
    progress.setProgressState(Ci.nsITaskbarProgress.STATE_NO_PROGRESS);
    check("nsITaskbarProgress accepts the download's progress", taskbar.available === true, `taskbar.available=${taskbar.available}; set NORMAL ${v.received}/${v.total}, then PAUSED; captures: ${shot1.stdout.trim()} ${shot2.stdout.trim()}`);

    VitreDownloads.confirmQuit = () => true;
    VitreDownloads.cancel(id);
    await VitreDownloads.whenSettled(id);
    await spike.sleep(300);
    check("cancel removes the partial file", !(await IOUtils.exists(PathUtils.join(dir, "lifecycle.bin.part"))) && view().state === "cancelled");
    await IOUtils.remove(dir, { recursive: true, ignoreAbsent: true });
  } catch (e) {
    spike.log("ERROR " + e + "\n" + (e.stack || ""));
  }
  spike.quit();
})();
