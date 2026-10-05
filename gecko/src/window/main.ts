// Entry point of the per-window bundle (window/window.js). VitreShell.domContentLoaded loads it into
// every browser window with loadSubScript, so it runs once per window as a classic script in the
// window's own scope: gBrowser exists, nothing has painted yet.
// It builds the Browser, exposes it as window.vitre and boots it; VitreShell calls
// window.vitre.delayedStartup() and .destroy() later.
import { Browser } from './browser';

if (!window.vitre) {
  try {
    const b = new Browser();
    window.vitre = b;
    b.boot();
  } catch (e) {
    try {
      ChromeUtils.importESModule('chrome://vitre/content/modules/VitreShell.sys.mjs').VitreShell.report('window boot failed', e);
    } catch {
      console.error('Deer window boot failed', e);
    }
  }
}
