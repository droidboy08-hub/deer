// Process-wide startup singleton. runtime\config.js (AutoConfig) registers the chrome package and
// calls VitreStartup.init() about 100 ms after process start, before any window exists.
//
// init() is idempotent and applies nothing visual itself. It:
//   - installs the vitre.* setting defaults (VitreSettings.init)
//   - registers the VitrePage window actor (page-side modules, src/actors)
//   - registers Deer's brand strings (window titles say "Deer") and its few string overrides
//   - registers skin/pages.css as a process-wide user sheet (Firefox's own pages and prompts in
//     Deer's colours: the error card, the accent of the design-system tokens)
//   - registers about: pages whose files are in the package (about:vitre-home once src/pages/home exists)
//     and makes Home the new-tab and home page
//   - gives every top-level window Deer's icon and taskbar group
//   - starts Deer's updater at final-ui-startup (VitreUpdater: it only reads the install there; its
//     first check of GitHub is minutes later, and only in an installed release)
//   - under the test harness (VITRE_LOG set) mirrors Deer's console errors into the run log
// Per-window work is VitreShell's (category hooks in chrome.manifest).
//
// Timing facts (spikes/packaging/RESULT.md, verifier):
//   - AutoConfig runs before prefs.js and user.js are read: init() must not read user prefs. Things
//     that depend on them run on "final-ui-startup".
//   - The profile is already selected and locked at init(); ProfD is readable.
//   - After an in-place restart the command line is a bare exe: never key behaviour on it.
//
// Feature authors: a process-wide part of a feature is its own src/modules/<Name>.sys.ts singleton
// with an idempotent init(), called from the feature's window module (install(b) runs at the first
// window's DOMContentLoaded, before session restore). Nothing needs to be added here, except a new
// about: page (ABOUT_PAGES below).
import { VitreAppIcon } from 'chrome://vitre/content/modules/VitreAppIcon.sys.mjs';
import { VitreSettings } from 'chrome://vitre/content/modules/VitreSettings.sys.mjs';
import { VitreUpdater } from 'chrome://vitre/content/modules/VitreUpdater.sys.mjs';
import { HOME_URL } from '../shared/home';

const PACKAGE = 'chrome://vitre/content/';
/** Taskbar identity (AppUserModelID) shared by all of Deer's windows: the installer's shortcuts and file types carry the same. */
const APP_ID = 'Deer.Browser';

/** about:<what> -> a page in the package. Registered only when the file exists in this build. */
const ABOUT_PAGES: { what: string; url: string; home?: boolean }[] = [
  { what: 'vitre-home', url: PACKAGE + 'pages/home/home.html', home: true },
];

type Mark = [what: string, ms: number];
const timeline: Mark[] = [];
const mark = (what: string): void => {
  let ms = 0;
  try {
    ms = Math.round(Services.telemetry.msSinceProcessStart());
  } catch {
    /* telemetry not up yet */
  }
  timeline.push([what, ms]);
};

let inited = false;
const about = new Map<string, string>();
let homeRegistered = false;

/** Does chrome://vitre/content/<path> exist in this build? (nsIChromeRegistry.convertChromeURL) */
function packageHas(url: string): boolean {
  try {
    const registry = Cc['@mozilla.org/chrome/chrome-registry;1'].getService(Ci.nsIChromeRegistry);
    const file = registry.convertChromeURL(Services.io.newURI(url));
    return file.QueryInterface(Ci.nsIFileURL).file.exists();
  } catch {
    return false;
  }
}

/** Append a line to the harness log (VITRE_LOG), if there is one. */
function harnessLog(line: string): void {
  try {
    const path = Services.env.get('VITRE_LOG');
    if (!path) return;
    const file = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
    file.initWithPath(path);
    const out = Cc['@mozilla.org/network/file-output-stream;1'].createInstance(Ci.nsIFileOutputStream);
    out.init(file, 0x02 | 0x08 | 0x10, 0o644, 0);
    const bytes = new TextEncoder().encode(line.replace(/\r?\n/g, '\n    ') + '\n');
    const bin = Cc['@mozilla.org/binaryoutputstream;1'].createInstance(Ci.nsIBinaryOutputStream);
    bin.setOutputStream(out);
    bin.writeByteArray(bytes);
    out.close();
  } catch {
    /* logging must never throw */
  }
}

const OURS = /chrome:\/\/vitre\/|resource:\/\/vitre-(boot|lib)\//;

/**
 * Test runs only: copy errors and warnings that come from Deer's own code into the run log, so a
 * broken module shows up in the output of tools/run.py instead of an invisible browser console.
 * nsIConsoleService carries script errors; console.error() calls arrive as console-api-log-event.
 */
function mirrorConsole(): void {
  if (!Services.env.get('VITRE_LOG')) return;
  const listener = {
    observe(message: any): void {
      try {
        if (!(message instanceof Ci.nsIScriptError)) return;
        const source = String(message.sourceName ?? '');
        if (!OURS.test(source) && !OURS.test(String(message.errorMessage))) return;
        const warning = (message.flags & Ci.nsIScriptError.warningFlag) !== 0;
        harnessLog(`[console.${warning ? 'warn' : 'error'}] ${message.errorMessage} @ ${source}:${message.lineNumber}`);
      } catch {
        /* ignore */
      }
    },
    QueryInterface: ChromeUtils.generateQI(['nsIConsoleListener']),
  };
  Services.console.registerListener(listener);
  Services.obs.addObserver((subject: any) => {
    try {
      const event = subject.wrappedJSObject;
      if (event.level !== 'error' && event.level !== 'warn') return;
      if (!OURS.test(String(event.filename ?? ''))) return;
      const text = Array.from(event.arguments ?? [], (a: any) => {
        if (a instanceof Error || (a && typeof a === 'object' && 'stack' in a && 'message' in a)) return `${a}\n${a.stack ?? ''}`;
        if (typeof a === 'string') return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }).join(' ');
      harnessLog(`[console.${event.level}] ${text} @ ${event.filename}:${event.lineNumber}`);
    } catch {
      /* ignore */
    }
  }, 'console-api-log-event');
}

/** One about:<what> page that loads a chrome:// document and keeps the about: URL in the tab. */
class AboutRedirector {
  classDescription: string;
  classID = Services.uuid.generateUUID();
  contractID: string;
  QueryInterface = ChromeUtils.generateQI(['nsIAboutModule', 'nsIFactory']);

  constructor(
    what: string,
    private target: string
  ) {
    this.classDescription = 'about:' + what;
    this.contractID = '@mozilla.org/network/protocol/about;1?what=' + what;
  }

  newChannel(uri: any, loadInfo: any): any {
    const channel = Services.io.newChannelFromURIWithLoadInfo(Services.io.newURI(this.target), loadInfo);
    channel.originalURI = uri;
    return channel;
  }

  getURIFlags(): number {
    // Not URI_SAFE_FOR_UNTRUSTED_CONTENT: web pages cannot link to it or frame it.
    // Not URI_MUST_LOAD_IN_CHILD: it runs in the parent process with the system principal, so the
    // page must stay static, carry a strict CSP and never insert page-derived HTML.
    return Ci.nsIAboutModule.ALLOW_SCRIPT | Ci.nsIAboutModule.IS_SECURE_CHROME_UI;
  }

  getChromeURI(): any {
    return Services.io.newURI(this.target);
  }

  createInstance(iid: any): any {
    return this.QueryInterface(iid);
  }
}

export const VitreStartup = {
  APP_ID,
  HOME_URL,
  /** [what, ms since process start] for startup diagnostics and tests. */
  timeline,
  options: {} as { appDir?: string; loader?: string },

  init(options: { appDir?: string; loader?: string } = {}): void {
    if (inited) return;
    inited = true;
    VitreStartup.options = options;
    mark('init');
    mirrorConsole();
    const step = (name: string, fn: () => void): void => {
      try {
        fn();
        mark(name);
      } catch (e) {
        mark(`${name} FAILED: ${e}`);
        harnessLog(`ERROR vitre: startup step "${name}" failed: ${e}\n${(e as Error)?.stack ?? ''}`);
        console.error(`Deer startup step "${name}" failed`, e);
      }
    };
    step('settings', () => VitreSettings.init());
    step('brand', () => VitreStartup.registerBrand());
    step('pages sheet', () => VitreStartup.registerPagesSheet());
    step('actors', () => VitreStartup.registerActors());
    step('about', () => {
      for (const page of ABOUT_PAGES) {
        if (!packageHas(page.url)) continue;
        VitreStartup.registerAbout(page.what, page.url);
        if (page.home) homeRegistered = true;
      }
      // The default branch can be written before user prefs are read.
      if (homeRegistered) Services.prefs.getDefaultBranch('').setStringPref('browser.startup.homepage', HOME_URL);
    });
    step('observers', () => {
      Services.obs.addObserver(VitreStartup, 'domwindowopened');
      Services.obs.addObserver(VitreStartup, 'final-ui-startup');
    });
  },

  get inited(): boolean {
    return inited;
  },

  observe(subject: any, topic: string): void {
    if (topic === 'domwindowopened') {
      VitreStartup.brandWindow(subject);
    } else if (topic === 'final-ui-startup') {
      mark('final-ui-startup');
      // User prefs are loaded now.
      try {
        VitreSettings.syncEngine();
        VitreAppIcon.init();
        if (homeRegistered) VitreStartup.useHomeAsNewTab();
      } catch (e) {
        console.error('Deer final-ui-startup failed', e);
      }
      try {
        VitreUpdater.init();
      } catch (e) {
        console.error('Deer: the updater did not start', e);
      }
    }
  },

  /**
   * Window titles and Firefox's own strings say "Deer": an extra L10nRegistry source that carries
   * only branding/brand.ftl and sorts before Firefox's. (toolkit: L10nRegistry, L10nFileSource.)
   */
  registerBrand(): void {
    if (!packageHas(PACKAGE + 'locales/en-US/branding/brand.ftl')) return;
    L10nRegistry.getInstance().registerSources([new L10nFileSource('0-vitre-brand', 'app', ['en-US'], PACKAGE + 'locales/{locale}/')]);
  },

  /**
   * Firefox's own pages and prompts in Deer's colours: skin/pages.css is registered as a user
   * sheet with nsIStyleSheetService (gre, @mozilla.org/content/style-sheet-service;1). A user sheet
   * applies to every document of the process and is sent to content processes with the rest of the
   * registered sheets; its @-moz-document blocks pick the documents (error pages, the prompt
   * dialog). User-level !important beats the pages' own author rules, which is how the accent and
   * the error card get through.
   */
  registerPagesSheet(): void {
    const url = PACKAGE + 'skin/pages.css';
    if (!packageHas(url)) return;
    const sss = Cc['@mozilla.org/content/style-sheet-service;1'].getService(Ci.nsIStyleSheetService);
    const uri = Services.io.newURI(url);
    if (!sss.sheetRegistered(uri, sss.USER_SHEET)) sss.loadAndRegisterSheet(uri, sss.USER_SHEET);
  },

  /**
   * The VitrePage actor pair. The child's events come from the page modules bundled into it, so the
   * child module is imported here once to read them (it has no top-level side effects).
   * safeForUntrustedWebProcess is mandatory on 157: without it getActor throws "doesn't match
   * remote type" in web content processes.
   */
  registerActors(): void {
    const child = PACKAGE + 'actors/VitrePageChild.sys.mjs';
    let events: Record<string, object> = {};
    try {
      events = ChromeUtils.importESModule(child).PAGE_EVENTS;
    } catch (e) {
      console.error('Deer: could not read the page modules’ events', e);
    }
    ChromeUtils.registerWindowActor('VitrePage', {
      parent: { esModuleURI: PACKAGE + 'actors/VitrePageParent.sys.mjs' },
      child: { esModuleURI: child, events },
      allFrames: true,
      messageManagerGroups: ['browsers'],
      safeForUntrustedWebProcess: true,
    });
  },

  /**
   * Register about:<what> as a redirector to a page in the package. Idempotent per name.
   * Call it synchronously at startup: a restored tab on the page must find it registered.
   */
  registerAbout(what: string, url: string): void {
    if (about.has(what)) return;
    const module = new AboutRedirector(what, url);
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar).registerFactory(module.classID, module.classDescription, module.contractID, module);
    about.set(what, url);
  },

  /** New tabs open Home. In memory only, so it runs at every start. (browser/modules/AboutNewTab.sys.mjs) */
  useHomeAsNewTab(): void {
    const { AboutNewTab } = ChromeUtils.importESModule('resource:///modules/AboutNewTab.sys.mjs');
    AboutNewTab.newTabURL = HOME_URL;
  },

  /**
   * Deer's icon and taskbar group for any top-level chrome window (browser, About, Library...).
   * The icon attribute must be on the root element before the window's first layout; Gecko then
   * loads the multi-size .ico itself, with no flash of the Firefox icon: icon="vitre" loads
   * <runtime>\browser\chrome\icons\default\vitre.ico. Which icon follows Settings › App icon (VitreAppIcon).
   * setGroupIdForWindow (nsIWinTaskbar) throws NS_ERROR_ILLEGAL_VALUE for windows that have no
   * native widget yet; VitreShell calls this again for browser windows before layout.
   */
  brandWindow(win: any): void {
    const setIcon = (): void => {
      try {
        const root = win.document?.documentElement;
        if (root && !root.hasAttribute('icon')) root.setAttribute('icon', VitreAppIcon.iconName());
      } catch {
        /* window is going away */
      }
    };
    try {
      // At domwindowopened the window still shows its initial about:blank; the real document comes later.
      if (win.document?.documentElement && win.document.documentURI !== 'about:blank') setIcon();
      win.addEventListener('DOMContentLoaded', setIcon, { once: true, capture: true });
      win.addEventListener('MozBeforeInitialXULLayout', setIcon, { once: true, capture: true });
    } catch {
      /* not a DOM window */
    }
    try {
      Cc['@mozilla.org/windows-taskbar;1'].getService(Ci.nsIWinTaskbar).setGroupIdForWindow(win, APP_ID);
    } catch {
      /* no native widget yet */
    }
  },

  /** For the test harness and for modules that need a line in the run log. No-op outside test runs. */
  log(...parts: unknown[]): void {
    harnessLog(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
  },

  QueryInterface: ChromeUtils.generateQI(['nsIObserver']),
};
