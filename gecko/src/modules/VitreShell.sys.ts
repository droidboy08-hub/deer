// Deer shell: the per-window entry point. One instance for the whole application.
//
// Firefox 157 calls the three hooks below for EVERY browser window (normal, private, popup, restored,
// torn off) through the category entries in chrome.manifest (browser-init.js ->
// BrowserUtils.callModulesFromCategory):
//   browser-window-before-initial-xul-layout -> beforeLayout      no gBrowser yet, nothing painted
//   browser-window-domcontentloaded          -> domContentLoaded  gBrowser exists
//   browser-window-delayed-startup           -> delayedStartup    Firefox's lazy UI objects exist
// adopt(win) runs all three for a window that was already open when the package was registered.
//
// Hook order facts (spikes/shell/RESULT.md, verifier):
//   - Entries of a category run sorted by module URL. chrome://vitre/ runs after Firefox's
//     chrome://browser/ consumers (CustomTitlebar.init, gUnifiedExtensions.init) and BEFORE its
//     moz-src: and resource: ones: at domContentLoaded, CustomizableUI.handleNewBrowserWindow and
//     BrowserWindowTracker.track have not run for this window yet, and eleven Firefox consumers still
//     follow at delayed startup. Code that needs those waits for b.whenReady / the 'ready' event.
//   - beforeLayout runs with paintCount 0: a sheet loaded there with loadSheetUsingURIString applies
//     to the first layout (a <link> would arrive two paints later).
//   - Session restore of the first window starts only after browser-delayed-startup-finished, so
//     anything registered by domContentLoaded (about: pages, actors) is early enough.
//   - The window bundle is a classic script: it is loaded again for every window, while this module
//     and every other .sys.mjs is loaded once per process.
import { VitreStartup } from 'chrome://vitre/content/modules/VitreStartup.sys.mjs';

// Author sheets every window gets before its first layout: the shell (hide rules, layer base), the
// glass tokens and structure, the tab bar and window controls, the address field.
const SHEETS = ['shell', 'glass', 'bar', 'omnibox'].map((name) => `chrome://vitre/content/skin/${name}.css`);
const WINDOW_SCRIPT = 'chrome://vitre/content/window/window.js';

type Note = { ms: number; hook: string; win: number; [extra: string]: unknown };
const t0 = ChromeUtils.now();
let clicksPatched = false;

function report(what: string, e: unknown): void {
  // "ERROR" at the start of the line makes tools/run.py count the run as failed.
  const text = `ERROR vitre: ${what}: ${e}\n${(e as Error)?.stack ?? ''}`;
  VitreShell.errors.push(text);
  VitreStartup.log(text);
  console.error(`Deer ${what}`, e);
}

/**
 * No native caption, in any window. CustomTitlebar removes the root's customtitlebar attribute when
 * a "condition" disallows it: the browser.tabs.inTitlebar pref ("pref") and popup windows
 * ("non-popup", re-asserted by TabBarVisibility.update on every tab change). Deer draws its own
 * caption everywhere, so every condition is answered with "allowed".
 * Source: browser/chrome/browser/content/browser/browser-customtitlebar.js (allowedBy, _update).
 */
function lockCustomTitlebar(win: any): void {
  const ct = win.CustomTitlebar;
  if (!ct || ct.vitreLocked) return;
  const allowedBy = ct.allowedBy;
  ct.vitreLocked = true;
  ct.allowedBy = function (this: unknown, condition: string, _allow: boolean) {
    return allowedBy.call(this, condition, true);
  };
  // CustomTitlebar.init already ran: its category entry (chrome://browser/...) sorts before ours.
  ct.allowedBy('pref', true);
  ct.allowedBy('non-popup', true);
}

/**
 * Links the page wants opened somewhere else (Shift+click, Ctrl+click, middle click, Alt+click) go
 * to the window's Browser first, so a feature can take them (Peek takes Shift+click). Declined
 * requests fall through to Firefox's own handling.
 * Source: browser/actors/ClickHandlerParent.sys.mjs (contentAreaClick; the child only sends clicks
 * the page did not preventDefault) and gre/modules/BrowserUtils.sys.mjs (whereToOpenLink).
 */
function patchClicks(): void {
  if (clicksPatched) return;
  clicksPatched = true;
  const { ClickHandlerParent } = ChromeUtils.importESModule('resource:///actors/ClickHandlerParent.sys.mjs');
  const { BrowserUtils } = ChromeUtils.importESModule('resource://gre/modules/BrowserUtils.sys.mjs');
  const original = ClickHandlerParent.prototype.contentAreaClick;
  ClickHandlerParent.prototype.contentAreaClick = function (this: any, data: any) {
    try {
      const browser = this.manager.browsingContext.top.embedderElement;
      const b = (browser?.documentGlobal ?? browser?.ownerGlobal)?.vitre;
      const where = data?.href ? BrowserUtils.whereToOpenLink(data) : 'current';
      if (b && where !== 'current') {
        const background = Services.prefs.getBoolPref('browser.tabs.loadInBackground', true);
        const disposition =
          where === 'window' ? 'new-window' : where === 'save' ? 'save' : (where === 'tab') === background ? 'background-tab' : 'foreground-tab';
        if (b.offerOpen({ url: data.href, disposition, source: 'click', browser, click: data })) return undefined;
      }
    } catch (e) {
      report('link interception failed', e);
    }
    return original.call(this, data);
  };
}

export const VitreShell = {
  /** Open browser windows that have the shell. */
  windows: new Set<Window>(),
  /** [{ms, hook, window id, ...}] for startup diagnostics and tests. */
  timeline: [] as Note[],
  /** Errors from loading or booting the window bundle (also in the harness log). */
  errors: [] as string[],

  note(win: any, hook: string, extra: Record<string, unknown> = {}): void {
    let id = -1;
    let paints: unknown = 'n/a';
    try {
      id = win.docShell.outerWindowID;
      paints = win.windowUtils.paintCount;
    } catch {
      /* window going away */
    }
    VitreShell.timeline.push({ ms: Math.round(ChromeUtils.now() - t0), hook, win: id, paints, ...extra });
  },

  beforeLayout(win: any): void {
    const root = win.document.documentElement;
    if (root.hasAttribute('vitre')) return;
    try {
      root.setAttribute('vitre', 'true');
      // Synchronous, so the very first layout already has Firefox's interface hidden.
      for (const sheet of SHEETS) win.windowUtils.loadSheetUsingURIString(sheet, win.windowUtils.AUTHOR_SHEET);
      VitreStartup.brandWindow(win);
      lockCustomTitlebar(win);
    } catch (e) {
      report('beforeLayout failed', e);
    }
    VitreShell.note(win, 'beforeLayout', { customtitlebar: root.hasAttribute('customtitlebar') });
  },

  domContentLoaded(win: any): void {
    if (win.vitre) return;
    VitreShell.beforeLayout(win);
    try {
      patchClicks();
    } catch (e) {
      report('click hook failed', e);
    }
    try {
      // Builds window.vitre (the Browser), mounts #vitre-root and installs the feature modules.
      Services.scriptloader.loadSubScript(WINDOW_SCRIPT, win);
    } catch (e) {
      report('window bundle failed', e);
    }
    VitreShell.windows.add(win);
    win.addEventListener(
      'unload',
      () => {
        VitreShell.windows.delete(win);
        try {
          win.vitre?.destroy();
        } catch (e) {
          report('window teardown failed', e);
        }
      },
      { once: true }
    );
    VitreShell.note(win, 'domContentLoaded', { tabs: win.gBrowser?.tabs.length, vitre: !!win.vitre });
  },

  delayedStartup(win: any): void {
    VitreShell.note(win, 'delayedStartup', { tabs: win.gBrowser?.tabs.length });
    try {
      win.vitre?.delayedStartup();
    } catch (e) {
      report('delayedStartup failed', e);
    }
  },

  /** For a window that already finished starting (package registered late). */
  adopt(win: any): void {
    VitreStartup.init();
    VitreShell.beforeLayout(win);
    VitreShell.domContentLoaded(win);
    VitreShell.delayedStartup(win);
  },

  /** Used by the window bundle to surface its own boot errors in the same place. */
  report,
};
