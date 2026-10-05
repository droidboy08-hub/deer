// Gecko globals for Deer's privileged code, typed loosely on purpose: Firefox 157 ships no types
// for its internals, and every internal Deer uses sits behind a small commented function anyway
// (src/window/firefox.ts for the window, the top of each .sys.ts for modules).
// This file is a global script (no imports or exports).

/* ---- available in every privileged scope (system modules, actors, chrome windows) ---- */
declare const Services: any;
declare const ChromeUtils: any;
declare const Components: any;
declare const Cc: any;
declare const Ci: any;
declare const Cu: any;
declare const Cr: any;
declare const IOUtils: any;
declare const PathUtils: any;
declare const L10nRegistry: any;
declare const L10nFileSource: any;
/** Chrome-only (dom/chrome-webidl/InspectorUtils.webidl); the inset page module reads matching rules with it. */
declare const InspectorUtils: any;
declare function dump(text: string): void;
/** Deer's version, "version" in gecko/package.json, replaced at build time (tools/build.mjs define). */
declare const __DEER_VERSION__: string;
/** The release key's public half (gecko/update-key.txt, base64), or '' (tools/build.mjs define). */
declare const __DEER_UPDATE_KEY__: string;

/* ---- JSWindowActor base classes (dom/chrome-webidl/JSWindowActor.webidl) ---- */
declare class JSWindowActorParent {
  /** The WindowGlobalParent this actor belongs to. */
  readonly manager: any;
  readonly browsingContext: any;
  readonly windowContext: any;
  sendAsyncMessage(name: string, data?: unknown): void;
  sendQuery(name: string, data?: unknown): Promise<any>;
}
declare class JSWindowActorChild {
  /** The WindowGlobalChild this actor belongs to. */
  readonly manager: any;
  readonly browsingContext: any;
  readonly contentWindow: (Window & typeof globalThis) | null;
  readonly document: Document | null;
  readonly docShell: any;
  sendAsyncMessage(name: string, data?: unknown): void;
  sendQuery(name: string, data?: unknown): Promise<any>;
}
/** What receiveMessage gets. */
interface ActorMessage {
  name: string;
  data: any;
}

/* ---- browser.xhtml elements ---- */
/**
 * A page's <browser> element (tab or peek): toolkit/content/widgets/browser-custom-element.mjs.
 * Only the members Deer uses are declared (no index signature, so a typo does not compile); an
 * internal not listed here goes through `(browser as any)` next to a comment naming its source.
 * Never cache browsingContext: a process switch replaces it.
 */
interface XULBrowser extends HTMLElement {
  readonly currentURI: { spec: string; scheme: string; host?: string };
  readonly browsingContext: any | null;
  readonly isRemoteBrowser: boolean;
  readonly remoteType: string | null;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly webProgress: any | null;
  readonly contentTitle: string;
  readonly contentPrincipal: any;
  /** In-process pages only (Home, about: pages); null for a remote browser. */
  readonly contentWindow: (Window & typeof globalThis) | null;
  readonly contentDocument: Document | null;
  readonly messageManager: any;
  /** The chrome window that owns the element (Firefox 157: documentGlobal; ownerGlobal before). */
  readonly documentGlobal: Window | undefined;
  readonly ownerGlobal: Window | undefined;
  readonly finder: any;
  fullZoom: number;
  docShellIsActive: boolean;
  /** The address a load that has not committed yet is for (Tabbrowser.sys.mjs addTab sets it). */
  userTypedValue: string | null;
  goBack(): void;
  goForward(): void;
  reload(): void;
  reloadWithFlags(flags: number): void;
  stop(): void;
  fixupAndLoadURIString(uri: string, options: Record<string, unknown>): void;
}
/** A <tab> element of gBrowser (tabbrowser/content/tab.js). Same rule: only what Deer uses. */
interface XULTab extends HTMLElement {
  readonly linkedBrowser: XULBrowser;
  readonly linkedPanel: string;
  label: string;
  readonly selected: boolean;
  readonly pinned: boolean;
  readonly closing: boolean;
  readonly lastAccessed: number;
  readonly userContextId: number;
  toggleMuteAudio(): void;
}

/**
 * What the core uses of Peek. The Peek module sets window.vitrePeek (and may declare more members
 * by merging into this interface). Until it does, page keys act on the active tab.
 */
interface VitrePeekHook {
  /** The page in the open sheet (the topmost surface for page keys), or null when no peek is open. */
  browser(): XULBrowser | null;
  /** Close the peek. True when one was open. */
  close(): boolean;
  /** Peek a URL over the active tab (Shift+Enter in the address field). */
  open?(url: string): void;
}

interface Window {
  /** This window's Browser (src/window/browser.ts). Set while the window bundle loads. */
  vitre: import('../window/browser').Browser;
  vitrePeek?: VitrePeekHook;
  gBrowser: any;
  windowUtils: any;
  docShell: any;
  /** Chrome-window methods (dom/webidl/Window.webidl, ChromeOnly). */
  minimize(): void;
  maximize(): void;
  restore(): void;
  fullScreen: boolean;
}

/** Singletons reachable through b.sys(name). Feature modules add theirs by declaration merging. */
interface VitreSysModules {
  VitreSettings: typeof import('../modules/VitreSettings.sys').VitreSettings;
  VitreStartup: typeof import('../modules/VitreStartup.sys').VitreStartup;
  VitreShell: typeof import('../modules/VitreShell.sys').VitreShell;
  VitreHome: typeof import('../modules/VitreHome.sys').VitreHome;
}

/**
 * APIs feature modules offer each other in one window (b.provide / b.service / b.whenService).
 * A module adds its entry here by declaration merging, next to its code:
 *   declare global { interface VitreServices { peek: PeekApi } }
 */
interface VitreServices {}

/* ---- Firefox's own modules, imported by URL: untyped ---- */
declare module 'resource://*';
declare module 'moz-src://*';
declare module 'chrome://browser/*';
declare module 'chrome://global/*';
declare module 'chrome://remote/*';
