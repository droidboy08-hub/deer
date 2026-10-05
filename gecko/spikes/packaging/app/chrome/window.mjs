// ES module loaded into the browser window (window global, not the system global).
import { helper } from "chrome://vitre/content/chrome/helper.mjs";
export const where = "window.mjs";
window.VitreWindowModuleProbe = {
  loaded: "window.mjs v1",
  helper: helper(),
  hasGBrowser: typeof window.gBrowser !== "undefined",
  globalIsWindow: globalThis === window,
};
