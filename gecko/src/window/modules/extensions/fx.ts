// Every Firefox 157 internal the extensions window module uses, each behind one small function with
// the file under gecko/reference/omni it was checked against. A runtime update is this file (plus
// the header of src/modules/VitreExtensions.sys.ts).
//
// Recipe: spikes/extensions/RESULT.md approach (a) and the verifier's corrections.

const w = window as any;

// ---- gUnifiedExtensions: browser/chrome/browser/content/browser/browser-addons.js ----

/** The window's gUnifiedExtensions (initialised at delayed startup). */
export const unified = (): any => w.gUnifiedExtensions;

/** Firefox's extensions button, a fixed node of #nav-bar (navigator-toolbox.inc.xhtml); Deer moves it into the pill. */
export const extensionsButton = (): any => document.getElementById('unified-extensions-button');

/**
 * Open or close Firefox's extensions panel. Called without an event on purpose: togglePanel(event)
 * opens about:addons instead of the panel when every extension is pinned, and Deer decides that
 * itself (it also counts the pinned buttons that did not fit in the pill).
 */
export function togglePanel(): Promise<void> {
  return Promise.resolve(unified()?.togglePanel());
}

/** The panel (or a popup anchored to the button) is open: gUnifiedExtensions.isPanelOpen(). */
export const panelOpen = (): boolean => !!unified()?.isPanelOpen?.();

/** The lazily built #unified-extensions-panel (gUnifiedExtensions.panel getter builds it from its template). */
export const panel = (): any => unified()?.panel ?? null;

/** Where Firefox lists extension buttons of collapsed toolbars inside the panel (#overflowed-extensions-list). */
export const overflowList = (): Element | null => panel()?.querySelector('#overflowed-extensions-list') ?? null;

/** The panel's "Manage extensions" footer button (#unified-extensions-manage-extensions). */
export const MANAGE_BUTTON_ID = 'unified-extensions-manage-extensions';

/**
 * Firefox's items about extensions that Deer shows, in Deer's words (Deer has no toolbar: pinned
 * extensions sit in the tab bar, as Deer's own menus say). browser.xhtml ids: the panel's gear
 * menu (#unified-extensions-context-menu), the "was added" notice's checkbox, the toolbar menu of
 * the fallback (#toolbar-context-menu, no 'menus' service).
 */
export const VITRE_LABELS: readonly [id: string, label: string, accesskey: string][] = [
  ['unified-extensions-context-menu-pin-to-toolbar', 'Pin to tab bar', ''],
  ['unified-extensions-context-menu-manage-extension', 'Manage extension', ''],
  ['unified-extensions-context-menu-remove-extension', 'Remove extension…', ''],
  ['addon-pin-toolbarbutton-checkbox', 'Pin to tab bar', 'P'],
  ['toolbar-context-manage-extension', 'Manage extension', 'E'],
  ['toolbar-context-remove-extension', 'Remove extension…', 'v'],
  ['toolbar-context-pin-to-toolbar', 'Pin to tab bar', 'P'],
];

/**
 * Give a Firefox item Deer's label. Its Fluent id goes (data-l10n-id / data-lazy-l10n-id, which
 * Firefox's lazy menus turn into data-l10n-id when they first open): Fluent would put Firefox's
 * label back. Not a .ftl override in Deer's L10n source: with several overridden files the ids
 * missing from them stopped falling through to Firefox's (the extensions panel lost its title and
 * footer; verifier probe).
 */
export function relabel(id: string, label: string, accesskey: string): void {
  const node = document.getElementById(id);
  if (!node) return;
  node.removeAttribute('data-lazy-l10n-id');
  node.removeAttribute('data-l10n-id');
  node.removeAttribute('data-l10n-args');
  node.setAttribute('label', label);
  if (accesskey) node.setAttribute('accesskey', accesskey);
  else node.removeAttribute('accesskey');
}

/**
 * "Remove Extension" in the panel's gear menu (#unified-extensions-context-menu) and in the toolbar
 * menu of the fallback (#toolbar-context-menu), browser.xhtml; main-popupset.js runs them with
 * BrowserAddonUI.removeAddon (Firefox's window-modal confirmation).
 */
export const REMOVE_ITEM_IDS: readonly string[] = ['unified-extensions-context-menu-remove-extension', 'toolbar-context-remove-extension'];

/**
 * The extension a gear or toolbar menu was opened for: the data-extensionid of its trigger node, as
 * gUnifiedExtensions._getExtensionId (browser-addons.js) and ToolbarContextMenu._getExtensionId
 * (gre/moz-src/browser/components/customizableui/ToolbarContextMenu.sys.mjs) read it.
 */
export function menuExtensionId(menu: any): string {
  try {
    return String(menu?.triggerNode?.closest?.('[data-extensionid]')?.getAttribute('data-extensionid') ?? '');
  } catch {
    return '';
  }
}

/** WebExtensionPolicy objects of the extensions that run in this window (private access respected): getActivePolicies(). */
export function activePolicies(): any[] {
  try {
    return unified()?.getActivePolicies() ?? [];
  } catch {
    return [];
  }
}

/** Some active extension is listed in the panel (not pinned): hasExtensionsInPanel(policies). */
export function hasExtensionsInPanel(policies: any[]): boolean {
  try {
    return !!unified()?.hasExtensionsInPanel(policies);
  } catch {
    return false;
  }
}

/** A private window that hides extensions without private access: isPrivateWindowMissingExtensionsWithoutPBMAccess(). */
export function privateWindowMissingExtensions(): boolean {
  try {
    return !!unified()?.isPrivateWindowMissingExtensionsWithoutPBMAccess();
  } catch {
    return false;
  }
}

/** { isAnyDisabled, isAnyEnableable }: getDisabledExtensionsInfo(). */
export async function disabledExtensionsInfo(): Promise<{ isAnyDisabled: boolean; isAnyEnableable: boolean }> {
  try {
    return (await unified()?.getDisabledExtensionsInfo()) ?? { isAnyDisabled: false, isAnyEnableable: false };
  } catch {
    return { isAnyDisabled: false, isAnyEnableable: false };
  }
}

/**
 * Every "Pin to Toolbar" (panel gear menu, toolbar context menu, the "was added" checkbox) goes
 * through gUnifiedExtensions.pinToToolbar(widgetId, pin): replaced per window so pinning means the
 * pill (recipe step 4).
 */
export function overridePinToToolbar(fn: (widgetId: string, pin: boolean) => void): void {
  const u = unified();
  if (u) u.pinToToolbar = fn;
}

/**
 * Add-on doorhangers (install, permissions, "could not be installed") anchor to the element
 * gUnifiedExtensions.getPopupAnchorID(browser, window) leaves on the browser as
 * browser["unified-extensions-buttonpopupnotificationanchor"] (it caches the button's first child
 * once per browser). Replaced so the anchor is Deer's hang element over the button, whatever the
 * browser. PopupNotifications.sys.mjs getAnchorFromBrowser accepts only a XUL element there
 * (ChromeUtils.getClassName(anchor) == "XULElement"; anything else throws or is looked up by id),
 * so the hang element must be a XUL element. Null keeps Firefox's anchor.
 */
export function overridePopupAnchor(anchor: () => Element | null): void {
  const u = unified();
  if (!u) return;
  const original = u.getPopupAnchorID.bind(u);
  u.getPopupAnchorID = (browser: any, win: Window): string => {
    const id = original(browser, win);
    try {
      const el = anchor();
      if (el && browser) browser[id + 'popupnotificationanchor'] = el;
    } catch (e) {
      console.error('Deer extensions: doorhanger anchor failed', e);
    }
    return id;
  };
}

/**
 * Show a widget node as a row of the panel or as a toolbar button: gUnifiedExtensions
 * ._updateWidgetClassName(id, inPanel) toggles subviewbutton / toolbarbutton-1 on its buttons.
 * Done by hand when the internal is missing.
 */
export function setWidgetLook(id: string, node: Element, inPanel: boolean): void {
  try {
    if (typeof unified()?._updateWidgetClassName === 'function') {
      unified()._updateWidgetClassName(id, inPanel);
      return;
    }
  } catch {
    /* fall through */
  }
  for (const sel of ['.unified-extensions-item-action-button', '.unified-extensions-item-menu-button']) {
    const b = node.querySelector(sel);
    b?.classList.toggle('subviewbutton', inPanel);
    b?.classList.toggle('subviewbutton-iconic', inPanel);
    b?.classList.toggle('toolbarbutton-1', !inPanel);
  }
}

/**
 * The attributes Firefox gives a widget it moves into the panel because its toolbar is collapsed
 * (onToolbarVisibilityChange): the node is shown as an overflowed panel row and its popup anchors
 * to the extensions button (cui-anchorid).
 */
export function markOverflowed(node: Element, on: boolean): void {
  if (on) {
    node.setAttribute('overflowedItem', 'true');
    node.setAttribute('artificallyOverflowed', 'true');
    node.setAttribute('cui-anchorid', 'unified-extensions-button');
  } else {
    node.removeAttribute('overflowedItem');
    node.removeAttribute('artificallyOverflowed');
    node.removeAttribute('cui-anchorid');
  }
}

// ---- CustomizableUI: gre/moz-src/browser/components/customizableui/CustomizableUI.sys.mjs ----

const cui = (): any => w.CustomizableUI;

/** The area a widget is placed in, or null. getPlacementOfWidget(id). */
export function areaOf(widgetId: string): string | null {
  try {
    return cui().getPlacementOfWidget(widgetId)?.area ?? null;
  } catch {
    return null;
  }
}

/** Widget ids placed in an area, in order. getWidgetIdsInArea(area). */
export function widgetIdsIn(area: string): string[] {
  try {
    return cui().getWidgetIdsInArea(area) ?? [];
  } catch {
    return [];
  }
}

/** The area of the extensions panel: CustomizableUI.AREA_ADDONS ("unified-extensions-area"). */
export const AREA_ADDONS = (): string => cui()?.AREA_ADDONS ?? 'unified-extensions-area';

export function moveWidget(widgetId: string, area: string, position?: number): void {
  cui().addWidgetToArea(widgetId, area, position);
}

/** This window's node of a widget: getWidget(id).forWindow(window).node. */
export function widgetNode(widgetId: string): Element | null {
  try {
    return cui().getWidget(widgetId)?.forWindow(window)?.node ?? null;
  } catch {
    return null;
  }
}

/** Register a toolbar node for a CUI area (no-op if it already is): registerToolbarNode(node). */
export function registerToolbarNode(node: Element): void {
  cui().registerToolbarNode(node);
}


// ---- BrowserAddonUI: browser-addons.js ----

/** about:addons at the add-on's details: BrowserAddonUI.manageAddon(id, source). */
export function manageAddon(id: string): void {
  void w.BrowserAddonUI?.manageAddon(id, 'unifiedExtensions');
}

/** Firefox's "Remove <name>?" confirmation, then the uninstall: BrowserAddonUI.removeAddon(id, source). */
export function removeAddon(id: string): void {
  void w.BrowserAddonUI?.removeAddon(id, 'unifiedExtensions');
}

/** about:addons at a view ("addons://list/extension", "addons://detail/<id>/preferences"): openAddonsMgr(view). */
export function openAddonsManager(view: string): void {
  void w.BrowserAddonUI?.openAddonsMgr(view);
}

// ---- ExtensionParent: gre/modules/ExtensionParent.sys.mjs, browser/.../parent/ext-*.js ----

let parent: any = null;
const extensionParent = (): any => (parent ??= ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs').ExtensionParent);

/** The parent-side browserAction API object (ext-browserAction.js global.browserActionFor). */
export const browserActionFor = (extension: any): any => extensionParent().apiManager.global.browserActionFor?.(extension) ?? null;

/** The parent-side pageAction API object (ext-pageAction.js global.pageActionFor). */
export const pageActionFor = (extension: any): any => extensionParent().apiManager.global.pageActionFor?.(extension) ?? null;

/** Extension lifecycle (Extension.sys.mjs: Management.emit("ready" | "shutdown", extension)). */
export function onExtensionLifecycle(fn: (extension: any) => void): () => void {
  const api = extensionParent().apiManager;
  const handler = (_event: string, extension: any): void => fn(extension);
  api.on('ready', handler);
  api.on('shutdown', handler);
  return () => {
    api.off('ready', handler);
    api.off('shutdown', handler);
  };
}

/**
 * An icon URL for an extension at `size` CSS px: IconDetails.getPreferredIcon(icons, extension,
 * size) and IconDetails.escapeUrl (gre/modules/ExtensionParent.sys.mjs).
 */
export function preferredIcon(icons: unknown, extension: any, size: number): string {
  try {
    const { IconDetails } = extensionParent();
    const { icon } = IconDetails.getPreferredIcon(icons, extension, size * window.devicePixelRatio);
    return icon ? IconDetails.escapeUrl(icon) : '';
  } catch {
    return '';
  }
}

/**
 * Fill a never-shown <menupopup> with an extension's own items for its button
 * (ext-menus.js global.actionContextMenu: contexts browser_action / action / page_action).
 * The items run with element.doCommand(); dispatch "popuphidden" on the popup afterwards so
 * gMenuBuilder cleans up and tells the extension (menus.onHidden).
 */
export function fillActionMenu(extension: any, kind: 'onBrowserAction' | 'onAction' | 'onPageAction', menu: Element): boolean {
  if (!extension?.hasPermission?.('menus') && !extension?.hasPermission?.('contextMenus')) return false;
  extensionParent().apiManager.global.actionContextMenu({ extension, [kind]: true, menu });
  return true;
}

// ---- AddonManager: gre/modules/AddonManager.sys.mjs ----

/** AddonManager.getPreferredIconURL(addon, size, window). */
export function addonIcon(addon: any, size: number): string {
  try {
    const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
    return AddonManager.getPreferredIconURL(addon, size, window) || '';
  } catch {
    return '';
  }
}

// ---- AppMenuNotifications: gre/modules/AppMenuNotifications.sys.mjs ----

/** The notification the app-menu doorhanger (#appMenu-notification-popup) is showing now. */
export function activeAppMenuNotification(): string {
  try {
    const { AppMenuNotifications } = ChromeUtils.importESModule('resource://gre/modules/AppMenuNotifications.sys.mjs');
    return String(AppMenuNotifications.activeNotification?.id ?? '');
  } catch {
    return '';
  }
}

/** The "<name> was added" doorhanger is AppMenuNotifications "addon-installed" (ExtensionsUI showInstallNotification). */
export const ADDON_INSTALLED_NOTIFICATION = 'addon-installed';

// ---- popup ids (browser.xhtml, panelUI.js, browser-pageActions.js) ----

/** The temporary panel of a toolbar widget's view: an extension popup (panelUI.js showSubView). */
export const WIDGET_PANEL_ID = 'customizationui-widget-panel';
/** ExtensionCommon.sys.mjs makeWidgetId: the id Firefox derives from an extension id for its widgets. */
export const makeWidgetId = (id: string): string => id.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
/** An extension page action's popup: ExtensionPopups.sys.mjs PanelPopup, id makeWidgetId(id) + "-panel". */
export const pageActionPanelId = (extensionId: string): string => makeWidgetId(extensionId) + '-panel';
/** The app-menu doorhanger ("<name> was added", update prompts) (panelUI.js notificationPanel). */
export const APPMENU_NOTIFICATION_ID = 'appMenu-notification-popup';
/** The extensions panel (browser-addons.js gUnifiedExtensions.panel). */
export const EXTENSIONS_PANEL_ID = 'unified-extensions-panel';
/** The context menu of toolbar buttons (browser.xhtml). Used only when the 'menus' service is missing. */
export const TOOLBAR_CONTEXT_MENU_ID = 'toolbar-context-menu';
/** The gear menu of an extension row in the extensions panel (browser.xhtml). */
export const PANEL_CONTEXT_MENU_ID = 'unified-extensions-context-menu';

// ---- nsIFilePicker: dom/base/nsIFilePicker.idl ----

/**
 * The native Open dialog for "Load temporary add-on": an .xpi or .zip, or a manifest.json (which
 * stands for its folder, as about:debugging takes it). Resolves with a path or null.
 */
export function pickAddonFile(title: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const fp = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
      fp.init((window as any).browsingContext, title, Ci.nsIFilePicker.modeOpen);
      fp.appendFilter('Add-on (.xpi, .zip, manifest.json)', '*.xpi;*.zip;manifest.json');
      fp.appendFilters(Ci.nsIFilePicker.filterAll);
      fp.open((result: number) => resolve(result === Ci.nsIFilePicker.returnOK && fp.file ? fp.file.path : null));
    } catch (e) {
      console.error('Deer extensions: file picker failed', e);
      resolve(null);
    }
  });
}

/** "Get add-ons": addons.mozilla.org, opened by Deer (b.newTab, a Deer-chosen URL). */
export const AMO_URL = 'https://addons.mozilla.org/firefox/';
