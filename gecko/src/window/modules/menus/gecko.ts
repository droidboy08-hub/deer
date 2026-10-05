// Every Firefox 157 internal the menus module touches, each behind one small function with its
// source file under gecko/reference/omni, so a runtime update is a checklist: re-check this file.
// Recipe: spikes/pagefeatures/RESULT.md, "MENUS" and the verifier's corrections 7-10.
//
// How a page menu happens on Gecko:
//   content contextmenu -> ContextMenuChild (browser/actors/ContextMenuChild.sys.mjs) -> the parent
//   actor (ContextMenuParent.sys.mjs #openContextMenu) sets nsContextMenu.contentData and calls
//   #contentAreaContextMenu.openPopupAtScreen() -> "popupshowing" on that popup -> Firefox's own
//   listener (browser-context.js) builds gContextMenu = new nsContextMenu(popup, shiftKey), which
//   also lets extensions add their XUL items (ext-menus.js, "on-build-contextmenu"). Deer's
//   listener runs after it (bubble phase on the window), reads everything from gContextMenu,
//   cancels the native popup and draws its own. When Deer's menu closes, popuphiding + popuphidden
//   are dispatched on the never-shown popup, so Firefox's teardown runs (gContextMenu.hiding() ->
//   ContextMenu:Hiding to the page, spellchecker uninit; ext-menus cleanup and menus.onHidden).
const w = window as any;

/** browser.xhtml <menupopup id="contentAreaContextMenu"> (browser-context.inc). */
export const contextPopup = (): any => document.getElementById('contentAreaContextMenu');

/** The nsContextMenu of the popup being shown (browser-context.js sets the global gContextMenu on popupshowing). */
export const currentContextMenu = (): any => w.gContextMenu ?? null;

/**
 * Firefox's teardown for a context menu Deer drew instead: the popuphiding listener in
 * browser-context.js (gContextMenu.hiding(), gContextMenu = null) and ext-menus.js gMenuBuilder
 * (handleEvent "popuphidden": removes extension items, fires menus.onHidden). The XUL popup never
 * opened, so its real state is "closed" throughout (risk 4 in the recipe).
 */
export function endContextMenu(popup: any): void {
  try {
    popup.dispatchEvent(new Event('popuphiding', { bubbles: true }));
  } catch (e) {
    console.error('Deer: context menu teardown (hiding) failed', e);
  }
  try {
    popup.dispatchEvent(new Event('popuphidden', { bubbles: true }));
  } catch (e) {
    console.error('Deer: context menu teardown (hidden) failed', e);
  }
}

/**
 * The menu's point in window coordinates: ContextMenuChild sends context.screenXDevPx/screenYDevPx
 * (device pixels); ContextMenuParent builds its own event from them the same way.
 */
export function contextPoint(cm: any): { x: number; y: number } {
  const c = cm.contentData?.context ?? {};
  const dpr = window.devicePixelRatio || 1;
  return { x: Number(c.screenXDevPx) / dpr - w.mozInnerScreenX, y: Number(c.screenYDevPx) / dpr - w.mozInnerScreenY };
}

/** This window's viewport on the screen, CSS px (Window.mozInnerScreenX/Y, dom/webidl/Window.webidl). */
export const innerScreen = (): { x: number; y: number } => ({ x: Number(w.mozInnerScreenX) || 0, y: Number(w.mozInnerScreenY) || 0 });

/** MouseEvent.MOZ_SOURCE_* of the click (dom/webidl/MouseEvent.webidl): 1 mouse, 2 pen, 5 touch, 6 keyboard. */
export const contextInputSource = (cm: any): number => Number(cm.contentData?.context?.inputSource) || 0;
export const SOURCE_PEN = 2;
export const SOURCE_TOUCH = 5;
export const SOURCE_KEYBOARD = 6;

/**
 * Whether an edit command is enabled for the focused element, the way goUpdateCommand does it
 * (gre/chrome/toolkit/content/global/globalOverlay.js): the content process reports the editing
 * state of the page's focused field to the parent (ContextMenuChild calls updateCommands
 * ("contentcontextmenu") before sending the menu).
 */
export function commandEnabled(id: string): boolean {
  try {
    const ctl = (document as any).commandDispatcher.getControllerForCommand(id);
    return !!ctl && ctl.isCommandEnabled(id);
  } catch {
    return false;
  }
}

/** goDoCommand(id) (globalOverlay.js): runs an edit command on the focused element, a page's included. */
export function doCommand(id: string): void {
  w.goDoCommand(id);
}

/** nsIClipboardHelper.copyString (widget/nsIClipboardHelper.idl). */
export function copyText(text: string): void {
  Cc['@mozilla.org/widget/clipboardhelper;1'].getService(Ci.nsIClipboardHelper).copyString(String(text));
}

/** Plain text on the clipboard: browser.js readFromClipboard() (the address bar's paste-and-go uses it). */
export function clipboardText(): string {
  try {
    return String(w.readFromClipboard() ?? '');
  } catch {
    return '';
  }
}

/** Rich text on the clipboard (Paste as plain text is offered): nsIClipboard.hasDataMatchingFlavors. */
export function clipboardHasHtml(): boolean {
  try {
    return !!Services.clipboard.hasDataMatchingFlavors(['text/html'], Ci.nsIClipboard.kGlobalClipboard);
  } catch {
    return false;
  }
}

/**
 * Inspect: DevToolsShim.inspectNode(tab, targetIdentifier) (devtools-startup DevToolsShim.sys.mjs).
 * nsContextMenu.inspectNode() always names gBrowser.selectedTab; the tab owning the clicked browser
 * is named here so a peek is inspected (after Peek promoted it).
 */
export function inspect(browser: XULBrowser, targetIdentifier: unknown): void {
  const { DevToolsShim } = ChromeUtils.importESModule('chrome://devtools-startup/content/DevToolsShim.sys.mjs');
  const tab = w.gBrowser.getTabForBrowser(browser) ?? w.gBrowser.selectedTab;
  void Promise.resolve(DevToolsShim.inspectNode(tab, targetIdentifier)).catch((e: unknown) => console.error('Deer: inspect failed', e));
}

/**
 * Spelling (gre/modules/InlineSpellChecker.sys.mjs through the window's InlineSpellCheckerUI, which
 * nsContextMenu.setContext initialises from the page with initFromRemote). Suggestions come in the
 * context (contentData.spellInfo); they exist only while the window is active (correction 10).
 */
export function spelling(cm: any): { word: string; suggestions: string[] } | null {
  const ui = w.InlineSpellCheckerUI;
  try {
    if (!ui?.overMisspelling) return null;
    const word = String(cm.contentData?.spellInfo?.misspelling ?? '');
    const suggestions = Array.isArray(cm.spellSuggestions) ? cm.spellSuggestions.map(String) : [];
    return { word, suggestions };
  } catch {
    return null;
  }
}
export const replaceMisspelling = (word: string): void => w.InlineSpellCheckerUI.replaceMisspelling(word);
export const addToDictionary = (): void => w.InlineSpellCheckerUI.addToDictionary();

/**
 * Load parameters for a page-derived URL from this menu, as Firefox's own "open link" items use
 * them: nsContextMenu._openLinkInParameters (triggering and origin principals, policy container,
 * referrer info of the link or the document).
 */
export function linkParams(cm: any): Record<string, any> {
  try {
    return cm._openLinkInParameters({});
  } catch {
    return { triggeringPrincipal: cm.principal, referrerInfo: cm.contentData?.referrerInfo };
  }
}

// ---- nsContextMenu members the rows use (browser/chrome/browser/content/browser/nsContextMenu.sys.mjs) ----

/** The page's principal (setContext: this.principal = context.principal, the WindowGlobalParent's documentPrincipal). */
export const pagePrincipal = (cm: any): unknown => cm.principal ?? null;
/** The link's referrer info (contentData.linkReferrerInfo: rel=noreferrer, referrerpolicy, the document's policy). */
export const linkReferrerInfo = (cm: any): unknown => cm.contentData?.linkReferrerInfo ?? null;
/** The document's referrer info (contentData.referrerInfo), for an image or a media element. */
export const pageReferrerInfo = (cm: any): unknown => cm.contentData?.referrerInfo ?? null;
/** The document's cookie jar settings (contentData.cookieJarSettings, browser/actors/ContextMenuParent.sys.mjs: wgp.cookieJarSettings). */
export const pageCookieJar = (cm: any): unknown => cm.contentData?.cookieJarSettings ?? null;
/** The link can be saved (setContext: this.onSaveableLink, from ContextMenuChild). */
export const saveableLink = (cm: any): boolean => !!cm.onSaveableLink;
/** The link's download="" name (setContext: this.linkDownload), '' without one. */
export const linkDownloadName = (cm: any): string => String(cm.linkDownload || '');
/** The clicked video is in picture-in-picture now (setContext: this.onPiPVideo). */
export const inPictureInPicture = (cm: any): boolean => !!cm.onPiPVideo;
/** copyEmail(): the mailto: address without its scheme and query. */
export const copyEmail = (cm: any): void => cm.copyEmail();
/** copyPhone(): the tel: number. */
export const copyPhone = (cm: any): void => cm.copyPhone();
/** copyLink(): the link address (with Firefox's own clean-up of the URL). */
export const copyLink = (cm: any): void => cm.copyLink();
/** copyCanvasImage(): the clicked canvas as an image on the clipboard. */
export const copyCanvasImage = (cm: any): void => cm.copyCanvasImage();
/** copyMediaLocation(): the image, video or audio address. */
export const copyMediaLocation = (cm: any): void => cm.copyMediaLocation();
/** mediaCommand(verb): play, pause, mute, unmute, loop, showcontrols, hidecontrols, pictureinpicture (ContextMenuChild handles it in the page). */
export const mediaCommand = (cm: any, verb: string): void => cm.mediaCommand(verb);

/** Developer tools are switched off by policy (pref devtools.policy.disabled, devtools/startup DevToolsShim.isDisabledByPolicy). */
export function devtoolsDisabled(): boolean {
  try {
    return Services.prefs.getBoolPref('devtools.policy.disabled', false);
  } catch {
    return false;
  }
}

/** Picture-in-picture is available (pref media.videocontrols.picture-in-picture.enabled, which nsContextMenu checks for its own row). */
export function pipEnabled(): boolean {
  try {
    return Services.prefs.getBoolPref('media.videocontrols.picture-in-picture.enabled', true);
  } catch {
    return true;
  }
}

/** nsContextMenu.viewMedia(event): the image or canvas in a new tab (middle-click semantics, BrowserUtils.whereToOpenLink). */
export function viewMedia(cm: any): void {
  cm.viewMedia({ button: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, target: {} });
}

/** A blob: URL of the clicked canvas (ContextMenuParent.canvasToBlobURL, checked as nsContextMenu #canvasToBlobURL does). */
export async function canvasBlobURL(cm: any): Promise<string | null> {
  const url = await cm.actor.canvasToBlobURL(cm.targetIdentifier);
  return typeof url === 'string' && ChromeUtils.isBlobURLValid(cm.principal, url) ? url : null;
}

/** The private-browsing state of a browser (PrivateBrowsingUtils.isBrowserPrivate). */
export const isPrivateBrowser = (browser: XULBrowser): boolean => {
  try {
    return !!w.PrivateBrowsingUtils.isBrowserPrivate(browser);
  } catch {
    return false;
  }
};

// ---- extension items (browser/chrome/browser/content/browser/parent/ext-menus.js) ----

/**
 * The XUL nodes ext-menus.js put into a popup for this menu: menuitem / menu / menuseparator whose
 * id is `${makeWidgetId(extension.id)}-menuitem-${id}` (customizeElement), with the attributes
 * label, accesskey, image (menuitem-iconic), type checkbox | radio, checked, disabled. A <menu>
 * holds a <menupopup> with its children. The item's own "command" listener runs it
 * (element.doCommand()), so it must be fired before popuphidden removes the node.
 */
export interface ExtNode {
  kind: 'item' | 'menu' | 'separator';
  id: string;
  label: string;
  access: string;
  image: string;
  type: string;
  checked: boolean;
  disabled: boolean;
  node: any;
  children: ExtNode[];
}

export function extensionNodes(popup: any): ExtNode[] {
  const out: ExtNode[] = [];
  for (const n of Array.from(popup?.children ?? []) as any[]) {
    if (!n.id || !String(n.id).includes('-menuitem-') || n.hidden) continue;
    const base = {
      id: String(n.id),
      label: String(n.getAttribute('label') ?? ''),
      access: String(n.getAttribute('accesskey') ?? ''),
      image: String(n.getAttribute('image') ?? ''),
      type: String(n.getAttribute('type') ?? ''),
      checked: n.getAttribute('checked') === 'true',
      disabled: n.getAttribute('disabled') === 'true',
      node: n,
      children: [] as ExtNode[],
    };
    if (n.localName === 'menuseparator') out.push({ ...base, kind: 'separator' });
    else if (n.localName === 'menu') out.push({ ...base, kind: 'menu', children: extensionNodes(n.querySelector(':scope > menupopup')) });
    else if (n.localName === 'menuitem') out.push({ ...base, kind: 'item' });
  }
  return out;
}

/** Fire an extension item: ext-menus.js listens for "command" on the element (once). */
export function runExtensionNode(node: any): void {
  node.doCommand();
}

/**
 * Extension items for one of Deer's own surfaces (contexts: ["tab"] on a tab circle or the pill).
 * ext-menus.js builds into whatever menupopup the "on-build-contextmenu" subject names (gMenuBuilder.
 * build(contextData)), so it gets a scratch popup that is never shown; endExtensionScratch() (a
 * popuphidden on it) removes the items and fires menus.onHidden.
 */
export function extensionScratch(data: { tab: XULTab; pageUrl: string }): any {
  let scratch = document.getElementById('vitre-menus-ext-scratch') as any;
  if (!scratch) {
    scratch = (document as any).createXULElement('menupopup');
    scratch.id = 'vitre-menus-ext-scratch';
    (document.getElementById('mainPopupSet') ?? document.documentElement).appendChild(scratch);
  }
  const subject: any = { menu: scratch, tab: data.tab, pageUrl: data.pageUrl, onTab: true };
  subject.wrappedJSObject = subject;
  Services.obs.notifyObservers(subject, 'on-build-contextmenu');
  return scratch;
}
export function endExtensionScratch(scratch: any): void {
  try {
    scratch.dispatchEvent(new Event('popuphidden', { bubbles: true }));
  } catch (e) {
    console.error('Deer: extension menu teardown failed', e);
  }
}

// ---- tabs and window (Tabbrowser.sys.mjs, browser.js) ----

/**
 * gBrowser.duplicateTab(tab, true, { tabIndex }) (Tabbrowser.sys.mjs -> SessionStore.duplicateTab):
 * a copy with its history, in the background, right after the original. Without tabIndex the copy
 * of a tab that is not selected lands after the SELECTED tab (addTrustedTab's default place);
 * Firefox's own tab menu puts it after the original the same way (tab-context-menu.js
 * duplicateSelectedTabs: tab.index + 1). tab.index is the place among all tabs (tab.js).
 */
export function duplicateTab(tab: XULTab): any {
  const index = Number((tab as any).index);
  return w.gBrowser.duplicateTab(tab, true, Number.isFinite(index) ? { tabIndex: index + 1 } : undefined);
}

/** gBrowser.reloadTab(tab) (Tabbrowser.sys.mjs). */
export const reloadTab = (tab: XULTab): void => w.gBrowser.reloadTab(tab);

/** The tab has played sound since it loaded: tab.js keeps "soundplaying" while it plays; Firefox shows Mute only then too. */
export const tabHasSound = (tab: XULTab): boolean => tab.hasAttribute('soundplaying') || tab.hasAttribute('muted') || tab.hasAttribute('activemedia-blocked');

/** Assistive technology is running (nsIXULRuntime.accessibilityEnabled): menus take real focus then. */
export function a11yActive(): boolean {
  try {
    return !!Services.appinfo.accessibilityEnabled;
  } catch {
    return false;
  }
}

/**
 * Windows' own system menu at a screen point (CSS px), for the drag strip and the window controls
 * (the design keeps it there). A real right-click on the strip reaches the chrome document as a
 * contextmenu event (Gecko answers WM_NCHITTEST itself, so DefWindowProc never sees a caption click,
 * and it ignores WM_POPUPSYSTEMMENU), so the menu is shown the way Gecko's own nsWindow.cpp
 * DisplaySystemMenu does it: GetSystemMenu, item states for the window's size mode, TrackPopupMenu
 * with TPM_RETURNCMD, then WM_SYSCOMMAND with the chosen command. TrackPopupMenu runs a modal loop;
 * it is started from a timer (never inside an event dispatch) and Gecko keeps running timers and
 * painting meanwhile (tests/menus/chrome.js). user32 through js-ctypes (gre/modules/ctypes.sys.mjs).
 */
interface User32 {
  sysMenu: (x: number, y: number, mode: 'normal' | 'maximized' | 'minimized') => number;
  post: (msg: number, wParam: number, lParam: number) => boolean;
}
let user32: User32 | null = null;
function win32(): User32 {
  if (!user32) {
    const { ctypes } = ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
    const lib = ctypes.open('user32.dll');
    const PostMessageW = lib.declare('PostMessageW', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
    const GetSystemMenu = lib.declare('GetSystemMenu', ctypes.winapi_abi, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.int32_t);
    const EnableMenuItem = lib.declare('EnableMenuItem', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.uint32_t);
    const TrackPopupMenu = lib.declare('TrackPopupMenu', ctypes.winapi_abi, ctypes.int32_t, ctypes.voidptr_t, ctypes.uint32_t, ctypes.int32_t, ctypes.int32_t, ctypes.int32_t, ctypes.voidptr_t, ctypes.voidptr_t);
    const hwnd = (): any => ctypes.voidptr_t(ctypes.UInt64(w.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).nativeHandle));
    const SC = { SIZE: 0xf000, MOVE: 0xf010, MINIMIZE: 0xf020, MAXIMIZE: 0xf030, RESTORE: 0xf120 };
    user32 = {
      sysMenu: (x, y, mode) => {
        const h = hwnd();
        const menu = GetSystemMenu(h, 0);
        if (menu.isNull()) return 0;
        const MF_GRAYED = 1;
        for (const id of Object.values(SC)) EnableMenuItem(menu, id, 0);
        const off = mode === 'maximized' ? [SC.SIZE, SC.MOVE, SC.MAXIMIZE] : mode === 'minimized' ? [SC.MINIMIZE] : [SC.RESTORE];
        for (const id of off) EnableMenuItem(menu, id, MF_GRAYED);
        const TPM_RIGHTBUTTON = 0x2;
        const TPM_RETURNCMD = 0x100;
        const cmd = TrackPopupMenu(menu, TPM_RIGHTBUTTON | TPM_RETURNCMD, x, y, 0, h, null);
        if (cmd) PostMessageW(h, 0x0112 /* WM_SYSCOMMAND */, cmd, 0);
        return cmd;
      },
      post: (msg, wParam, lParam) => !!PostMessageW(hwnd(), msg, wParam, lParam),
    };
  }
  return user32;
}
export function systemMenu(screenX: number, screenY: number): void {
  const dpr = window.devicePixelRatio || 1;
  const x = Math.round(screenX * dpr);
  const y = Math.round(screenY * dpr);
  const root = document.documentElement;
  const mode = root.getAttribute('sizemode') === 'maximized' || root.hasAttribute('inFullscreen') ? 'maximized' : 'normal';
  window.setTimeout(() => {
    try {
      win32().sysMenu(x, y, mode);
    } catch (e) {
      console.error('Deer: system menu failed', e);
    }
  }, 0);
}