// macOS menu bar: Deer's menus as data, how they are built into a document as XUL, and the hidden
// window's copy. Shared by the browser window's menu bar (index.ts) and VitreShell (the hidden
// window); it uses no window globals, so it bundles into VitreShell.sys.mjs as well.
//
// The menus, their order, separators and labels are the approved board (design canvas
// MacMenuReference, "Deer for Mac, every menu"):
//   Deer     About Deer, Check for Updates… | Settings… ⌘, | Services | Hide Deer ⌘H, Hide Others ⌥⌘H,
//            Show All | Quit Deer ⌘Q
//   File     New Tab, New Window, New Private Window | Open Location… | Close Tab, Close Window,
//            Reopen Closed Tab | Download This Video
//   Edit     Undo, Redo | Cut, Copy, Paste, Select All | Find…, Find Next, Find Previous
//   View     Reload, Reload Ignoring Cache, Stop | Zoom In, Zoom Out, Actual Size | Search Tabs,
//            Split View | Enter Full Screen | Developer › (Developer Tools, Web Console, Inspect
//            Element, Page Source)
//   History  Back, Forward | Show All History, Recently Closed › (closed tabs newest first | closed
//            windows) | Clear Browsing Data…
//   Window   Minimize, Zoom | Show Next Tab, Show Previous Tab | Downloads | Bring All to Front |
//            the open windows, which macOS adds
//   Help     Keyboard Shortcuts, Deer on GitHub
// No access keys: macOS menus type-select (a letter moves the highlight, Return runs the item).
// Every item runs the Deer action its key runs. Keys: index.ts asks the window's key router
// (b.keys.chordFor); the hidden window reads the Mac map of shortcuts.ts.
//
// How Firefox 157 makes a Mac menu bar of XUL (widget/cocoa unless noted):
//   - xpfe/appshell/AppWindow.cpp LoadNativeMenus: once a window's document has loaded
//     (OnChromeLoaded, network STATE_STOP, after DOMContentLoaded) and its L10n is ready, the FIRST
//     menubar:not([nonnative]) of the document becomes the window's NSMenu (nsMenuBarX). Its <menu>
//     children are its menus; other children are ignored.
//   - nsMenuBarX.mm: the app menu is built ONCE, from the first menu bar that gets a menu, which is
//     the hidden window's (on macOS it loads its menus before any browser window: AppWindow.cpp
//     sWaitingForHiddenWindowToLoadNativeMenus). CreateApplicationMenu takes these elements by id
//     (getElementById: the first in the document wins), reading their label and key once:
//     aboutName, menu_referralsPage, menu_settings (macOS 13 and later; menu_preferences before),
//     menu_accountmgr, menu_setAsDefault, menu_mac_services, menu_mac_hide_app,
//     menu_mac_hide_others, menu_mac_show_all, menu_mac_touch_bar, menu_FileQuitItem. An element
//     with collapsed="true" is left out. Choosing one sends "command" to that element in the hidden
//     window (NativeMenuItemTarget menuItemHit:); Hide, Hide Others, Show All and Services are
//     macOS's own. menu_referralsPage shows only while browser.referrals.enabled is true
//     (ApplicationMenuOpened): Deer's "Check for Updates…" sits in that slot, the only one between
//     About and Settings.
//   - nsMenuX.mm: <menu id="windowMenu"> becomes NSApp.windowsMenu (macOS lists the open windows in
//     it; browser/base/content/browser-menubar.inc.xhtml warns not to change that menu while the app
//     runs), id="helpMenu" NSApp.helpMenu, and id="edit-menu" is never rebuilt on open.
//   - nsMenuItemX.mm: items with id menu_undo, menu_redo, menu_cut, menu_copy, menu_paste and
//     menu_selectAll send undo:, copy:... through the responder chain (so native text fields in
//     sheets get them, and macOS 26 draws its symbols); toolkit/xre/MacApplicationDelegate.mm hands
//     them back to the item, whose command="cmd_copy" runs Firefox's own command
//     (toolkit/content/editMenuOverlay.js, goDoCommand).
//   - nsMenuBarX::ObserveContentInserted puts a child added to a LIVE menu bar at its DOM index into
//     an nsTArray (InsertElementAt aborts past the end, and non-menu children count): a menu bar is
//     built whole before it goes into the document, and its top-level menus never change after.
//     Inside a menu anything may change (nsMenuX rebuilds itself when it opens).
import { bindingsFor, specOf, type Binding } from '../../../shared/shortcuts';
import { keyAttrs } from './keyattr';

/** Things an item does that are not Deer actions. */
export type Verb = 'about' | 'updates' | 'zoom' | 'front' | 'github' | 'bookmark' | 'bookmarksLibrary' | 'savedLogins';

export interface Item {
  /** The element id: Deer's own ("vitre-mb-..."), or the id Firefox's menu code looks for. */
  id: string;
  label: string;
  /** The Deer action it runs (b.run), the same one its key runs. */
  action?: string;
  arg?: number;
  verb?: Verb;
  /** A key the menu itself owns, not one of Deer's (Edit's system keys, Hide). */
  fixed?: string;
  /** A Firefox <command> it forwards to (Edit's standard items). */
  command?: string;
  /**
   * From the hidden window's menu bar (no Deer window in front): 'app' runs in the front Deer window,
   * opening one first when there is none; 'new' opens a window. Without it the item acts on a page
   * or a window, so it is dimmed there.
   */
  hidden?: 'app' | 'new';
}

export interface Menu {
  id: string;
  label: string;
  items: Entry[];
}

/** null is a separator. */
export type Entry = Item | Menu | null;

export const GITHUB_URL = 'https://github.com/droidboy08-hub/deer';
/** Deer's menu bar (each document has one: a browser window, or the hidden window). */
export const BAR_ID = 'vitre-menubar';
/** The <key> elements of its key equivalents (outside every <keyset>: keyattr.ts). */
export const KEYS_ID = 'vitre-menubar-keys';
/** The app-menu items, in the hidden window (nsMenuBarX reads them by id). */
export const APP_ID = 'vitre-menubar-app';
/** Menus are "vitre-menu-...", items "vitre-mb-<action>" (an item and a menu must never share an id). */
export const VIEW_ID = 'vitre-menu-view';
export const HISTORY_ID = 'vitre-menu-history';
export const RECENT_ID = 'vitre-menu-recent';
/** A Recently Closed entry: "tab:<index>:<source window id>" or "window:<index>". */
export const RECENT_ATTR = 'vitre-recent';

const act = (action: string, label: string, extra: Partial<Item> = {}): Item => ({ id: `vitre-mb-${action}`, label, action, ...extra });
const edit = (id: string, label: string, command: string, fixed: string): Item => ({ id, label, command, fixed });

/** The app menu, in nsMenuBarX's order (its separators are its own). */
export const APP_ITEMS: Item[] = [
  { id: 'aboutName', label: 'About Deer', verb: 'about', hidden: 'app' },
  { id: 'menu_referralsPage', label: 'Check for Updates…', verb: 'updates', hidden: 'app' },
  { id: 'menu_settings', label: 'Settings…', action: 'settings', hidden: 'app' },
  { id: 'menu_preferences', label: 'Settings…', action: 'settings', hidden: 'app' },
  { id: 'menu_mac_services', label: 'Services' },
  { id: 'menu_mac_hide_app', label: 'Hide Deer', fixed: 'Mod+H' },
  { id: 'menu_mac_hide_others', label: 'Hide Others', fixed: 'Mod+Alt+H' },
  { id: 'menu_mac_show_all', label: 'Show All' },
  { id: 'menu_FileQuitItem', label: 'Quit Deer', action: 'quit', hidden: 'app' },
];
/** App-menu slots Deer leaves out (Firefox's set-as-default, Thunderbird's accounts, the Touch Bar). */
const APP_LEFT_OUT = ['menu_setAsDefault', 'menu_accountmgr', 'menu_mac_touch_bar'];

export const MENUS: Menu[] = [
  {
    id: 'vitre-menu-file',
    label: 'File',
    items: [
      act('newTab', 'New Tab', { hidden: 'new' }),
      act('newWindow', 'New Window', { hidden: 'new' }),
      act('newPrivateWindow', 'New Private Window', { hidden: 'new' }),
      null,
      act('focusAddress', 'Open Location…'),
      null,
      act('closeTab', 'Close Tab'),
      act('closeWindow', 'Close Window'),
      act('reopenClosed', 'Reopen Closed Tab', { hidden: 'app' }),
      null,
      act('downloadVideo', 'Download This Video'),
    ],
  },
  {
    id: 'edit-menu',
    label: 'Edit',
    items: [
      edit('menu_undo', 'Undo', 'cmd_undo', 'Mod+Z'),
      edit('menu_redo', 'Redo', 'cmd_redo', 'Mod+Shift+Z'),
      null,
      edit('menu_cut', 'Cut', 'cmd_cut', 'Mod+X'),
      edit('menu_copy', 'Copy', 'cmd_copy', 'Mod+C'),
      edit('menu_paste', 'Paste', 'cmd_paste', 'Mod+V'),
      edit('menu_selectAll', 'Select All', 'cmd_selectAll', 'Mod+A'),
      null,
      act('find', 'Find…'),
      act('findNext', 'Find Next'),
      act('findPrev', 'Find Previous'),
    ],
  },
  {
    id: VIEW_ID,
    label: 'View',
    items: [
      act('reload', 'Reload'),
      act('hardReload', 'Reload Ignoring Cache'),
      act('stop', 'Stop'),
      null,
      act('zoomIn', 'Zoom In'),
      act('zoomOut', 'Zoom Out'),
      act('zoomReset', 'Actual Size'),
      null,
      act('switcherSearch', 'Search Tabs'),
      act('splitView', 'Split View'),
      null,
      act('fullscreen', 'Enter Full Screen'),
      null,
      {
        id: 'vitre-menu-developer',
        label: 'Developer',
        items: [act('devtools', 'Developer Tools'), act('devtoolsConsole', 'Web Console'), act('devtoolsInspect', 'Inspect Element'), act('viewSource', 'Page Source')],
      },
    ],
  },
  {
    id: HISTORY_ID,
    label: 'History',
    items: [
      act('back', 'Back'),
      act('forward', 'Forward'),
      null,
      act('history', 'Show All History', { hidden: 'app' }),
      { id: RECENT_ID, label: 'Recently Closed', items: [] },
      null,
      act('clearData', 'Clear Browsing Data…', { hidden: 'app' }),
    ],
  },
  {
    id: 'vitre-menu-bookmarks',
    label: 'Bookmarks',
    items: [
      { id: 'vitre-mb-bookmark-tab', label: 'Bookmark Current Tab…', verb: 'bookmark' },
      { id: 'vitre-mb-manage-bookmarks', label: 'Manage Bookmarks…', verb: 'bookmarksLibrary', hidden: 'app' },
      null,
      { id: 'vitre-mb-saved-logins', label: 'Saved Logins and Passwords…', verb: 'savedLogins', hidden: 'app' },
    ],
  },
  {
    // Built as Firefox builds its own (browser-menubar.inc.xhtml #windowMenu): a separator first,
    // above which macOS puts its own window items (Fill, Center, Move & Resize...), and one last,
    // below which it lists the open windows. Nothing in it changes while Deer runs.
    id: 'windowMenu',
    label: 'Window',
    items: [
      null,
      act('minimize', 'Minimize'),
      { id: 'vitre-mb-zoom', label: 'Zoom', verb: 'zoom' },
      null,
      act('nextTab', 'Show Next Tab'),
      act('prevTab', 'Show Previous Tab'),
      null,
      act('downloads', 'Downloads', { hidden: 'app' }),
      null,
      { id: 'vitre-mb-front', label: 'Bring All to Front', verb: 'front', hidden: 'app' },
      null,
    ],
  },
  {
    id: 'helpMenu',
    label: 'Help',
    items: [act('shortcutsHelp', 'Keyboard Shortcuts', { hidden: 'app' }), { id: 'vitre-mb-github', label: 'Deer on GitHub', verb: 'github', hidden: 'app' }],
  },
];

const isMenu = (e: Entry): e is Menu => !!e && 'items' in e;

/** Every item of MENUS (submenus included) and of the app menu, by element id. */
export const ITEMS: ReadonlyMap<string, Item> = (() => {
  const all = new Map<string, Item>();
  const walk = (entries: Entry[]): void => {
    for (const e of entries) {
      if (isMenu(e)) walk(e.items);
      else if (e) all.set(e.id, e);
    }
  };
  for (const m of MENUS) walk(m.items);
  for (const a of APP_ITEMS) all.set(a.id, a);
  return all;
})();

export const popupId = (menuId: string): string => `${menuId}-popup`;

/** The key an item shows, as a spec of shortcuts.ts, or null for none. */
export type KeyFor = (item: Item) => string | null;

const xul = (doc: Document, tag: string): Element => (doc as any).createXULElement(tag);

/**
 * Give a menu item the key equivalent for `spec` (null: none), through its own <key> in `keys`.
 * nsMenuItemX reads the <key> again only when the item's key attribute changes, so the attribute
 * is taken off and put back; nothing is touched when the key is already right (the Window menu must
 * not change while Deer runs).
 */
export function setKey(keys: Element, el: Element, spec: string | null): void {
  const attrs = spec ? keyAttrs(spec) : null;
  const want = attrs ? `${attrs.modifiers} ${attrs.key ?? ''} ${attrs.keycode ?? ''}` : '';
  if (el.getAttribute('vitre-chord') === want) return;
  el.setAttribute('vitre-chord', want);
  el.removeAttribute('key');
  if (!attrs) return;
  const doc = el.ownerDocument;
  const id = `vitre-mbk-${el.id}`;
  let key: Element | null = doc.getElementById(id);
  if (!key) {
    key = xul(doc, 'key');
    key.id = id;
    keys.append(key);
  }
  key.setAttribute('modifiers', attrs.modifiers);
  if (attrs.key !== undefined) {
    key.setAttribute('key', attrs.key);
    key.removeAttribute('keycode');
  } else {
    key.setAttribute('keycode', attrs.keycode ?? '');
    key.removeAttribute('key');
  }
  el.setAttribute('key', id);
}

/** One menuitem. In the hidden window an item that needs a Deer window is dimmed. */
function buildItem(doc: Document, keys: Element, item: Item, keyFor: KeyFor, hiddenWindow: boolean): Element {
  const el = xul(doc, 'menuitem');
  el.id = item.id;
  el.setAttribute('label', item.label);
  if (item.command) el.setAttribute('command', item.command);
  if (hiddenWindow && !item.hidden && !item.command) el.setAttribute('disabled', 'true');
  setKey(keys, el, keyFor(item));
  return el;
}

function buildMenu(doc: Document, keys: Element, menu: Menu, keyFor: KeyFor, hiddenWindow: boolean): Element {
  const el = xul(doc, 'menu');
  el.id = menu.id;
  el.setAttribute('label', menu.label);
  const popup = xul(doc, 'menupopup');
  popup.id = popupId(menu.id);
  menu.items.forEach((entry, i) => {
    if (!entry) {
      const sep = xul(doc, 'menuseparator');
      // The window list's separator: the hidden window lists no windows of its own, so Firefox hides
      // it there (browser/base/content/nonbrowser-mac.js, "sep-window-list").
      if (hiddenWindow && menu.id === 'windowMenu' && i === menu.items.length - 1) sep.setAttribute('hidden', 'true');
      popup.append(sep);
    } else if (isMenu(entry)) {
      popup.append(buildMenu(doc, keys, entry, keyFor, hiddenWindow));
    } else {
      popup.append(buildItem(doc, keys, entry, keyFor, hiddenWindow));
    }
  });
  // A submenu whose items all need a Deer window (Developer, in the hidden window) is dimmed whole.
  if (hiddenWindow && menu.items.length && menu.items.every((e) => !!e && !isMenu(e) && !e.hidden && !e.command)) el.setAttribute('disabled', 'true');
  el.append(popup);
  return el;
}

/**
 * Deer's <menubar> with every menu, and the hidden box of its <key> elements. Built whole, before
 * either goes into the document (see the header: a live menu bar must not get new menus).
 */
export function buildMenubar(doc: Document, keyFor: KeyFor, hiddenWindow = false): { bar: Element; keys: Element } {
  const keys = xul(doc, 'box');
  keys.id = KEYS_ID;
  keys.setAttribute('hidden', 'true');
  const bar = xul(doc, 'menubar');
  bar.id = BAR_ID;
  for (const menu of MENUS) bar.append(buildMenu(doc, keys, menu, keyFor, hiddenWindow));
  return { bar, keys };
}

/** Set every item's key again (the router's map changed: a rebind). Only changed keys are touched. */
export function refreshKeys(doc: Document, keyFor: KeyFor): void {
  const keys = doc.getElementById(KEYS_ID);
  if (!keys) return;
  for (const item of ITEMS.values()) {
    const el = doc.getElementById(item.id);
    if (el?.closest(`#${BAR_ID}`)) setKey(keys, el, keyFor(item));
  }
}

/**
 * The key equivalent of an action from the Mac map itself (rebinds not applied), for the hidden
 * window, which has no key router: the action's first key held with ⌘, ⌃ or ⌥, as
 * b.keys.chordFor picks it (shortcuts.ts printedBinding).
 */
export function mapKeyFor(item: Item): string | null {
  if (item.fixed) return item.fixed;
  if (!item.action) return null;
  const all = macMap().filter((b) => b.action === item.action && !b.key.startsWith('Browser'));
  const exact = all.filter((b) => b.arg === item.arg);
  const pick = (exact.length ? exact : all).find((b) => b.meta || b.ctrl || b.alt);
  return pick ? specOf(pick) : null;
}

let macBindings: Binding[] | null = null;
const macMap = (): Binding[] => (macBindings ??= bindingsFor('mac'));

// ---- Recently Closed (browser/components/sessionstore/RecentlyClosedTabsAndWindowsMenuUtils.sys.mjs) ----

/** Firefox's session store (moz-src:///browser/components/sessionstore/SessionStore.sys.mjs). */
const sessionStore = (): any => ChromeUtils.importESModule('moz-src:///browser/components/sessionstore/SessionStore.sys.mjs').SessionStore;
/** Firefox's reopen helpers (moz-src:///browser/components/sessionstore/SessionWindowUI.sys.mjs). */
const sessionWindowUI = (): any => ChromeUtils.importESModule('moz-src:///browser/components/sessionstore/SessionWindowUI.sys.mjs').SessionWindowUI;

/** A closed tab's title, else its address (SessionStore tab state: entries[index - 1]). */
function closedTitle(tab: any): string {
  if (tab?.title) return String(tab.title);
  const state = tab?.state;
  const entry = state?.entries?.[(state?.index ?? 1) - 1];
  return String(entry?.url ?? '');
}

/**
 * Fill a Recently Closed popup: the window's closed tabs, newest first, then a separator and the
 * closed windows, as RecentlyClosedTabsAndWindowsMenuUtils reads them (getTabsFragment:
 * SessionStore.getClosedTabDataForWindow; getWindowsFragment: SessionStore.getClosedWindowData). A
 * closed window reads "<its title> and 3 more tabs". `win` null (the hidden window): windows only.
 * Returns how many entries there are.
 */
export function fillRecent(popup: Element, win: Window | null): number {
  const doc = popup.ownerDocument;
  popup.replaceChildren();
  const ss = sessionStore();
  let tabs: any[] = [];
  let windows: any[] = [];
  try {
    tabs = win ? Array.from(ss.getClosedTabDataForWindow(win) ?? []) : [];
    windows = Array.from(ss.getClosedWindowData() ?? []);
  } catch (e) {
    console.error('Deer: the closed tabs could not be read', e);
  }
  tabs.forEach((tab, index) => {
    const item = xul(doc, 'menuitem');
    item.setAttribute('label', closedTitle(tab) || 'Untitled');
    item.setAttribute(RECENT_ATTR, `tab:${index}:${tab?.sourceWindowId ?? ''}`);
    popup.append(item);
  });
  if (tabs.length && windows.length) popup.append(xul(doc, 'menuseparator'));
  windows.forEach((w, index) => {
    const more = Math.max(0, (w?.tabs?.length ?? 1) - 1);
    const selected = w?.tabs?.[(w?.selected ?? 1) - 1];
    const title = String(w?.title || closedTitle(selected) || 'Window');
    const item = xul(doc, 'menuitem');
    item.setAttribute('label', more ? `${title} and ${more} more ${more === 1 ? 'tab' : 'tabs'}` : title);
    item.setAttribute(RECENT_ATTR, `window:${index}`);
    popup.append(item);
  });
  return tabs.length + windows.length;
}

/**
 * Reopen a Recently Closed entry (its RECENT_ATTR value) into `win`, as the entries Firefox builds do
 * (RecentlyClosedTabsAndWindowsMenuUtils createEntry): SessionWindowUI.undoCloseTab(window, index,
 * sourceWindowId) or SessionWindowUI.undoCloseWindow(index).
 */
export function reopenRecent(value: string, win: Window | null): void {
  const [kind, index, source] = value.split(':');
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) return;
  if (kind === 'window') sessionWindowUI().undoCloseWindow(i);
  else if (kind === 'tab' && win) sessionWindowUI().undoCloseTab(win, i, source || undefined);
}

// ---- verbs ----

/** Firefox's tracker of browser windows (resource:///modules/BrowserWindowTracker.sys.mjs). */
const windowTracker = (): any => ChromeUtils.importESModule('resource:///modules/BrowserWindowTracker.sys.mjs').BrowserWindowTracker;

/** Window › Zoom: toolkit/content/macWindowMenu.js zoomWindow(), on this window. */
function zoomWindow(win: any): void {
  if (win.windowState === win.STATE_NORMAL) win.maximize();
  else win.restore();
}

/**
 * Window › Bring All to Front. macOS's own (NSApplication arrangeInFront:) is not reachable from
 * script, and Firefox leaves the item out (browser-menubar.inc.xhtml, "uncomment when
 * BringAllToFront is implemented"): raise every browser window that is not in the Dock, back to
 * front (BrowserWindowTracker.orderedWindows is front first), so their order stays.
 */
function bringAllToFront(): void {
  const wins: any[] = Array.from(windowTracker().orderedWindows ?? []);
  for (const w of wins.reverse()) {
    if (!w.closed && w.windowState !== w.STATE_MINIMIZED) w.focus();
  }
}

/** Run a verb in a browser window (window.vitre is its Browser). */
export function runVerb(verb: Verb, win: any): void {
  const b = win?.vitre;
  switch (verb) {
    case 'about':
      b?.service('settings')?.open('about');
      break;
    case 'updates': {
      // Settings › About shows the check and its result (settings/pages.ts updatesRow).
      b?.service('settings')?.open('about');
      const up = b?.sys('VitreUpdater');
      if (up && up.state().phase !== 'ready') void up.check({ manual: true });
      break;
    }
    case 'zoom':
      zoomWindow(win);
      break;
    case 'front':
      bringAllToFront();
      break;
    case 'github':
      b?.newTab(GITHUB_URL);
      break;
    case 'bookmark':
      try {
        win?.PlacesCommandHook?.bookmarkPage?.();
      } catch (e) {
        console.warn('Deer menu: bookmark failed', e);
      }
      break;
    case 'bookmarksLibrary':
      try {
        win?.PlacesCommandHook?.showPlacesOrganizer?.('AllBookmarks');
      } catch (e) {
        console.warn('Deer menu: bookmarksLibrary failed', e);
      }
      break;
    case 'savedLogins':
      b?.newTab('about:logins');
      break;
  }
}

// ---- the hidden window ----

/**
 * The front Deer window, raised; or a new one once Deer has set it up
 * (BrowserWindowTracker.promiseOpenWindow resolves at browser-delayed-startup-finished, after
 * VitreShell.delayedStartup).
 */
async function frontWindow(): Promise<any> {
  const tracker = windowTracker();
  const top = tracker.getTopWindow();
  if (top) {
    top.focus();
    return top;
  }
  return tracker.promiseOpenWindow({});
}

/** An item chosen in the hidden window's menu bar (no Deer window is the main window). */
async function runFromHidden(item: Item, hiddenWin: any, event: any): Promise<void> {
  const tracker = windowTracker();
  switch (item.action) {
    case 'newWindow':
      tracker.openWindow({});
      return;
    case 'newPrivateWindow':
      tracker.openWindow({ private: true });
      return;
    case 'newTab': {
      // With no window, a new window is the new tab: it opens on Home.
      const top = tracker.getTopWindow();
      if (!top) {
        tracker.openWindow({});
        return;
      }
      top.focus();
      top.vitre?.run('newTab');
      return;
    }
    case 'quit': {
      // ⌘Q with no Deer window in front arrives with ⌘ held: Firefox's goQuitApplication counts that
      // as the shortcut and asks first while browser.warnOnQuitShortcut is on (as the router's ⌘Q
      // does); a click quits as the built-in does (gre/chrome/toolkit/content/global/globalOverlay.js).
      const top = tracker.getTopWindow();
      if (top?.vitre && !event?.metaKey) top.vitre.run('quit');
      else hiddenWin.goQuitApplication(event ?? {});
      return;
    }
    case 'reopenClosed': {
      const top = tracker.getTopWindow();
      if (!top && sessionStore().getClosedWindowCount() > 0) {
        sessionWindowUI().undoCloseWindow(0);
        return;
      }
      break;
    }
  }
  if (!item.hidden) return;
  const win = await frontWindow();
  // Show All History opens the panel, never closes it (as in a window's menu bar: index.ts header).
  const history = item.action === 'history' ? win?.vitre?.service('history') : undefined;
  if (item.verb) runVerb(item.verb, win);
  else if (history) history.open();
  else if (item.action) win?.vitre?.run(item.action, item.arg);
}

/** Firefox's hidden-window menus that open Firefox UI Deer hides (left on screen only by a late start). */
const FIREFOX_ONLY_MENUS = ['view-menu', 'history-menu', 'bookmarksMenu', 'profiles-menu', 'tools-menu', 'helpMenu'];

/**
 * Give the hidden window (browser.hiddenWindowChromeURL, Firefox's hiddenWindowMac.xhtml) Deer's
 * menu bar: the menu bar macOS shows while no Deer window is the main window (none open, all in the
 * Dock, or a window of its own such as the developer tools in front), and the source of the app
 * menu. Idempotent.
 *
 * In time (Firefox has not made the hidden window's menus yet): Deer's app-menu items and menu bar
 * go in before Firefox's #main-menubar, which is marked nonnative, so nsMenuBarX takes Deer's for
 * both, and browser.referrals.enabled shows "Check for Updates…" in its slot.
 * Late (Firefox's menu bar is already native, the app menu already made from Firefox's items): a
 * live menu bar cannot take new menus (header), so Firefox's menus that open Firefox UI are hidden
 * (hiding is safe: nsMenuX -> nsMenuBarX::MenuChildChangedVisibility), File, Edit and Window stay
 * Firefox's, and the app menu keeps Firefox's items, which read the same ("About Deer", "Settings…",
 * "Quit Deer") but have no "Check for Updates…". Their commands still reach the listener below, so
 * About and Settings open Deer's. Only a hook that runs before the hidden window has loaded (at
 * AutoConfig, VitreStartup.init) is always in time.
 * Returns which menu bar macOS got: 'deer', or 'firefox' when it was late (null: done before).
 */
export function installHiddenMenus(hiddenWin: any): 'deer' | 'firefox' | null {
  const doc: Document | null = hiddenWin?.document ?? null;
  const root = doc?.documentElement;
  if (!doc || !root || root.hasAttribute('vitre-menubar')) return null;
  const ffBar = doc.getElementById('main-menubar');
  // nsMenuBarX::AquifyMenuBar hides the About item as soon as a menu bar is native.
  const late = doc.getElementById('aboutName')?.getAttribute('hidden') === 'true';
  root.setAttribute('vitre-menubar', late ? 'firefox' : 'deer');

  if (late) {
    for (const id of FIREFOX_ONLY_MENUS) doc.getElementById(id)?.setAttribute('hidden', 'true');
  } else {
    const { bar, keys } = buildMenubar(doc, mapKeyFor, true);
    const app = xul(doc, 'box');
    app.id = APP_ID;
    app.setAttribute('hidden', 'true');
    for (const item of APP_ITEMS) {
      const el = xul(doc, 'menuitem');
      el.id = item.id;
      el.setAttribute('label', item.label);
      setKey(keys, el, mapKeyFor(item));
      app.append(el);
    }
    for (const id of APP_LEFT_OUT) {
      const el = xul(doc, 'menuitem');
      el.id = id;
      el.setAttribute('collapsed', 'true');
      app.append(el);
    }
    ffBar?.setAttribute('nonnative', 'true');
    // The app-menu items go before Firefox's menu bar, so they are the first of each id in the
    // document; Deer's menu bar after it (Firefox's code keeps finding its own elements by id), and
    // it is the first menubar:not([nonnative]).
    if (ffBar) {
      ffBar.before(app);
      ffBar.after(keys, bar);
    } else {
      root.append(app, keys, bar);
    }
    // The slot of "Check for Updates…" (nsMenuBarX::ApplicationMenuOpened reads it each time the app
    // menu opens). Only here: when Firefox's items made the app menu, that slot says "Share Deer".
    Services.prefs.getDefaultBranch('').setBoolPref('browser.referrals.enabled', true);
  }

  hiddenWin.addEventListener(
    'command',
    (e: Event) => {
      const target = e.target as Element | null;
      const recent = target?.getAttribute?.(RECENT_ATTR);
      if (recent) {
        e.stopPropagation();
        try {
          reopenRecent(recent, null);
        } catch (err) {
          console.error('Deer: reopen from the menu bar failed', err);
        }
        return;
      }
      const item = target?.id ? ITEMS.get(target.id) : undefined;
      // Firefox's own items with these ids (a late start) reach here too; its Quit forwards to
      // cmd_quitApplication and is left to Firefox, which quits the same way.
      if (!item || (!item.action && !item.verb)) return;
      e.stopPropagation();
      runFromHidden(item, hiddenWin, e).catch((err) => console.error(`Deer: menu bar item ${item.id} failed`, err));
    },
    true
  );
  hiddenWin.addEventListener(
    'popupshowing',
    (e: Event) => {
      const popup = e.target as Element | null;
      if (popup?.id === popupId(HISTORY_ID)) {
        const menu = doc.getElementById(RECENT_ID);
        const list = doc.getElementById(popupId(RECENT_ID));
        // A XUL boolean attribute counts by its presence (Element::GetBoolAttr): never "false".
        if (menu && list) {
          if (fillRecent(list, null) === 0) menu.setAttribute('disabled', 'true');
          else menu.removeAttribute('disabled');
        }
      }
    },
    true
  );
  return late ? 'firefox' : 'deer';
}
