// Verifier: which window icon / AUMID does each kind of window end up with?
// The runner prints title / aumid and dumps <name>.icon.png (WM_GETICON) for the LARGEST window of
// the process at every capture, so each window under test is made the largest one in turn.
/* global spike, gBrowser, Services, Cc, Ci, ChromeUtils, OpenBrowserWindow */
const once = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreProbe.sys.mjs").VitreProbe;
// config.js runs the boot script in EVERY new browser window: only the first one drives the test.
if (!once.__verifyRan) {
  once.__verifyRan = true;
  spike.main(main);
}
async function main() {
  await spike.resize(900, 600);
  await spike.loaded();
  const { VitreStartup } = ChromeUtils.importESModule("chrome://vitre/content/modules/VitreStartup.sys.mjs");
  spike.log("ENV icon_attr=" + Services.env.get("VITRE_ICON_ATTR") + " from_exe=" + Services.env.get("VITRE_ICON_FROM_EXE") + " skip_seticon=" + Services.env.get("VITRE_SKIP_SETICON") + " skip_aumid=" + Services.env.get("VITRE_SKIP_AUMID"));
  spike.log("ROOT icon attr=" + document.documentElement.getAttribute("icon"));
  const dirs = [];
  try {
    const e = Services.dirsvc.get("AChromDL", Ci.nsISimpleEnumerator);
    while (e.hasMoreElements()) dirs.push(e.getNext().QueryInterface(Ci.nsIFile).path);
  } catch (e) {
    dirs.push("ERR " + e.name);
  }
  let achrom = "";
  try {
    achrom = Services.dirsvc.get("AChrom", Ci.nsIFile).path;
  } catch (e) {
    achrom = "ERR " + e.name;
  }
  spike.log("DIRS AChromDL=" + JSON.stringify(dirs) + " AChrom=" + achrom);
  await spike.capture("icon-1-main");

  // second normal window
  const opened = (topic) =>
    new Promise((r) => {
      const obs = (w) => {
        Services.obs.removeObserver(obs, topic);
        r(w);
      };
      Services.obs.addObserver(obs, topic);
    });
  let p = opened("browser-delayed-startup-finished");
  OpenBrowserWindow();
  const win2 = await p;
  win2.resizeTo(1000, 700);
  await spike.sleep(800);
  spike.log("WIN2 title=" + win2.document.title + " icon attr=" + win2.document.documentElement.getAttribute("icon"));
  await spike.capture("icon-2-second-window");
  win2.close();

  // private window
  p = opened("browser-delayed-startup-finished");
  OpenBrowserWindow({ private: true });
  const pw = await p;
  pw.resizeTo(1040, 720);
  await spike.sleep(1200);
  spike.log("PRIVATE title=" + pw.document.title + " icon attr=" + pw.document.documentElement.getAttribute("icon"));
  await spike.capture("icon-3-private-window");
  pw.close();

  // About (manifest override) window
  const about = Services.ww.openWindow(null, "chrome://browser/content/aboutDialog.xhtml", "_blank", "chrome,dialog=no,resizable,width=1080,height=740", null);
  await new Promise((r) => about.addEventListener("load", r, { once: true }));
  about.resizeTo(1080, 740);
  await spike.sleep(800);
  spike.log("ABOUT title=" + about.document.title + " icon attr=" + about.document.documentElement.getAttribute("icon"));
  await spike.capture("icon-4-about");
  about.close();

  // Library (a stock Firefox XUL window: places.xhtml)
  const lib = Services.ww.openWindow(null, "chrome://browser/content/places/places.xhtml", "_blank", "chrome,dialog=no,resizable,width=1100,height=760", null);
  await new Promise((r) => lib.addEventListener("load", r, { once: true }));
  lib.resizeTo(1100, 760);
  await spike.sleep(1000);
  spike.log("LIBRARY title=" + lib.document.title + " icon attr=" + lib.document.documentElement.getAttribute("icon"));
  await spike.capture("icon-5-library");
  lib.close();

  spike.log("TIMELINE " + JSON.stringify(VitreStartup.timeline.filter((t) => /icon|ERROR/.test(t[0]))));
}
