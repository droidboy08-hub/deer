// Process-wide part of the extensions feature (Firefox add-ons; the per-window part is
// src/window/modules/extensions). Recipe: spikes/extensions/RESULT.md approach (a) with the
// verifier's corrections (they are numbered "correction N" below).
//
// init() is idempotent and is called by the window module at the first window's DOMContentLoaded,
// before Firefox's CustomizableUI initialises that window (so the pill's toolbar is found by id).
// It:
//   - registers the CustomizableUI area AREA ("vitre-ext-bar"): the pinned extension buttons that
//     live in the active pill. Pinned = the widget's area is not CustomizableUI.AREA_ADDONS
//     (the extensions panel). Placements persist in browser.uiCustomization.state.
//   - re-homes extension widgets that land in Firefox's hidden toolbars (default_area "navbar",
//     the overflow panel, the bookmarks toolbar) into AREA: one CustomizableUI listener for the
//     process plus a scan at start (correction 2).
//   - locks extensions.unifiedExtensions.button.always_visible to true (correction 1: with false the
//     extensions button disappears and nothing is left to reach unpinned extensions) and turns off
//     Firefox's abuse report entry points (extensions.abuseReport.enabled: "Report" is not offered).
//   - loads the add-ons the user loaded from a folder or file ("Load temporary add-on") again, as
//     temporary add-ons, at every start (correction 11, the no-patch route). Signing is never
//     waived: an unsigned add-on cannot be installed permanently on this runtime.
//   - follows ExtensionsUI's parked prompts (correction 8): updates that ask for new permissions and
//     add-ons installed by another program wait in ExtensionsUI.updates / .sideloaded behind
//     Firefox's hidden app-menu badge; windows show their own indicator from pending() and
//     onChange(), and review(entry, gBrowser) opens Firefox's prompt (anchored to Deer's bar).
//
// API (b.sys('VitreExtensions') in window code)
//   AREA                          the CustomizableUI area id of the pill toolbar
//   init()
//   pending(): Review[]           permission reviews waiting for the user
//   review(entry, gBrowser)       open the prompt for one
//   onChange(fn) -> unsubscribe   reviews or add-ons changed (installed, removed, enabled, disabled,
//                                 private access, temporary list)
//   list(): Promise<AddonInfo[]>  every extension the user can see (not hidden, not built in)
//   setEnabled(id, on), setPrivateAllowed(id, on), remove(id)
//   checkForUpdates() -> { checked, installed, review, failed, errors }
//   temporary(): TemporaryAddon[] the add-ons Deer loads again at start; loadTemporary(path),
//                                 forgetTemporary(id or path); restored: resolves after the start-up reload
//   isTemporary(id)
//
// Firefox 157 internals used here (checked against reference/omni; re-check on a runtime update):
//   CustomizableUI   gre/moz-src/browser/components/customizableui/CustomizableUI.sys.mjs
//                    registerArea, addListener({ onWidgetAdded, onWidgetMoved }), areas,
//                    getWidgetIdsInArea, isWebExtensionWidget, addWidgetToArea, AREA_ADDONS
//   ExtensionsUI     browser/modules/ExtensionsUI.sys.mjs: updates, sideloaded (Sets), on/off('change'),
//                    showUpdate(gBrowser, info), showSideloaded(gBrowser, addon)
//   AddonManager     gre/modules/AddonManager.sys.mjs: getAddonsByTypes, getAddonByID,
//                    installTemporaryAddon(nsIFile), addAddonListener, PERM_* masks,
//                    UPDATE_WHEN_USER_REQUESTED, updatePromptHandler; addon.findUpdates / enable /
//                    disable / uninstall / reload
//   ExtensionPermissions gre/modules/ExtensionPermissions.sys.mjs: add / remove / get with
//                    "internal:privateBrowsingAllowed" (as about:addons' addon-card.mjs does)
//   prefs            extensions.unifiedExtensions.button.always_visible (browser-addons.js),
//                    extensions.abuseReport.enabled (gAddonAbuseReportEnabled, browser-addons.js)

// Timers are not globals of a system module: gre/modules/Timer.sys.mjs.
import { clearInterval, setInterval, setTimeout } from 'resource://gre/modules/Timer.sys.mjs';

/** The CustomizableUI area of the pinned extension buttons (the toolbar inside the active pill). */
export const AREA = 'vitre-ext-bar';

/** Where the remembered temporary add-ons are kept: JSON [{ path, id, name }]. */
const TEMP_PREF = 'vitre.extensions.temporary';
const BUTTON_PREF = 'extensions.unifiedExtensions.button.always_visible';
const REPORT_PREF = 'extensions.abuseReport.enabled';
const PRIVATE_PERM = 'internal:privateBrowsingAllowed';

export interface TemporaryAddon {
  /** A folder (with manifest.json) or an .xpi / .zip file. */
  path: string;
  /** The add-on id once it loaded; '' before the first load. */
  id: string;
  name: string;
  /** Why the last load failed, '' when it loaded. */
  error: string;
}

export interface Review {
  kind: 'update' | 'sideload';
  id: string;
  name: string;
  /** The add-on's icon (may be empty). */
  icon: string;
  /** The ExtensionsUI entry (update info or add-on), handed back to review(). */
  entry: unknown;
}

export interface AddonInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  /** The add-on object, for window code that needs Firefox's own calls (icon, options). */
  addon: any;
  enabled: boolean;
  /** The user may turn it on or off / remove it / change private access. */
  canDisable: boolean;
  canEnable: boolean;
  canRemove: boolean;
  canChangePrivate: boolean;
  privateAllowed: boolean;
  /** Firefox says it can never run in private windows (manifest incognito: "not_allowed"). */
  privateNotAllowed: boolean;
  temporary: boolean;
  /** Loaded by Deer from the user's folder or file (re-installed at each start). */
  vitreTemporary: boolean;
  canUpdate: boolean;
  optionsURL: string;
  /** AddonManager.OPTIONS_TYPE_*: 3 = its own tab, 5 = inline (about:addons). */
  optionsType: number;
  /** "Appears disabled" for a reason the user cannot change (blocklist, signature, app version). */
  appDisabled: boolean;
}

let inited = false;
let cui: any = null;
let restoredResolve: () => void = () => {};
const listeners = new Set<() => void>();
let temps: TemporaryAddon[] = [];

// ---- Firefox modules (one import each) ----

/** CustomizableUI (gre/moz-src/browser/components/customizableui/CustomizableUI.sys.mjs). */
function CUI(): any {
  cui ??= ChromeUtils.importESModule('moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs').CustomizableUI;
  return cui;
}
/** AddonManager (gre/modules/AddonManager.sys.mjs). */
function AM(): any {
  return ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs').AddonManager;
}
/** ExtensionsUI (browser/modules/ExtensionsUI.sys.mjs), a singleton EventEmitter. */
function EUI(): any {
  return ChromeUtils.importESModule('resource:///modules/ExtensionsUI.sys.mjs').ExtensionsUI;
}
/** ExtensionPermissions (gre/modules/ExtensionPermissions.sys.mjs). */
function EP(): any {
  return ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs').ExtensionPermissions;
}

function localFile(path: string): any {
  const f = Cc['@mozilla.org/file/local;1'].createInstance(Ci.nsIFile);
  f.initWithPath(path);
  return f;
}

function emit(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.error('VitreExtensions: listener failed', e);
    }
  }
}

// ---- prefs ----

/** Correction 1 and "Report hidden": product values on the default branch, the first one locked. */
function applyPrefs(): void {
  const defaults = Services.prefs.getDefaultBranch('');
  try {
    if (Services.prefs.prefIsLocked(BUTTON_PREF)) Services.prefs.unlockPref(BUTTON_PREF);
    defaults.setBoolPref(BUTTON_PREF, true);
    // A user value of false (a profile used with stock Firefox) would hide the button: drop it.
    if (Services.prefs.prefHasUserValue(BUTTON_PREF)) Services.prefs.clearUserPref(BUTTON_PREF);
    Services.prefs.lockPref(BUTTON_PREF);
  } catch (e) {
    console.error('VitreExtensions: could not lock the extensions button visible', e);
  }
  try {
    defaults.setBoolPref(REPORT_PREF, false);
  } catch (e) {
    console.error('VitreExtensions: could not turn off abuse reports', e);
  }
}

// ---- the pill area and the re-homing of widgets (correction 2) ----

/** A widget an extension placed in one of Firefox's hidden toolbars goes to the pill instead. */
function rehome(id: string, area: string | null | undefined): void {
  const C = CUI();
  if (!area || area === AREA || area === C.AREA_ADDONS) return;
  if (!C.isWebExtensionWidget(id)) return;
  try {
    C.addWidgetToArea(id, AREA);
  } catch (e) {
    console.error('VitreExtensions: could not move', id, 'to the pill', e);
  }
}

function registerArea(): void {
  const C = CUI();
  // defaultCollapsed: null, so a toolbar reset never collapses (hides) the pill's toolbar.
  C.registerArea(AREA, { type: C.TYPE_TOOLBAR, defaultPlacements: [], defaultCollapsed: null });
  C.addListener({
    onWidgetAdded: (id: string, area: string) => rehome(id, area),
    onWidgetMoved: (id: string, area: string) => rehome(id, area),
  });
  for (const area of C.areas as string[]) {
    if (area === AREA || area === C.AREA_ADDONS) continue;
    for (const id of C.getWidgetIdsInArea(area) as string[]) rehome(id, area);
  }
}

// ---- parked prompts (correction 8) ----

function watchReviews(): void {
  try {
    EUI().on('change', emit);
  } catch (e) {
    console.error('VitreExtensions: ExtensionsUI is not available', e);
  }
  try {
    AM().addAddonListener({
      onInstalled: emit,
      onUninstalled: (addon: any) => {
        // A temporary add-on Deer loaded and the user removed (about:addons, the button menu):
        // it is not loaded again. Removals at shutdown, and the replacement a reload makes (the
        // add-on is there again a moment later), do not count.
        const id = addon?.id;
        if (id && !Services.startup.shuttingDown && temps.some((t) => t.id === id)) {
          setTimeout(() => {
            AM()
              .getAddonByID(id)
              .then((still: unknown) => {
                if (!still && !Services.startup.shuttingDown) forgetTemporary(id);
              }, () => {});
          }, 500);
        }
        emit();
      },
      onEnabled: emit,
      onDisabled: emit,
      onPropertyChanged: emit,
      onOperationCancelled: emit,
    });
  } catch (e) {
    console.error('VitreExtensions: could not follow add-on changes', e);
  }
}

function pending(): Review[] {
  const out: Review[] = [];
  let ui: any;
  try {
    ui = EUI();
  } catch {
    return out;
  }
  for (const info of ui.updates as Set<any>) {
    const addon = info?.addon;
    if (!addon) continue;
    out.push({ kind: 'update', id: String(addon.id), name: String(addon.name ?? addon.id), icon: String(addon.iconURL ?? ''), entry: info });
  }
  for (const addon of ui.sideloaded as Set<any>) {
    if (!addon) continue;
    out.push({ kind: 'sideload', id: String(addon.id), name: String(addon.name ?? addon.id), icon: String(addon.iconURL ?? ''), entry: addon });
  }
  return out;
}

/** Open Firefox's prompt for a parked review: it opens about:addons and asks there (ExtensionsUI). */
function review(entry: Review, gBrowser: any): void {
  const ui = EUI();
  if (entry.kind === 'update') ui.showUpdate(gBrowser, entry.entry);
  else ui.showSideloaded(gBrowser, entry.entry);
}

// ---- temporary add-ons (correction 11, no-patch route) ----

function readTemps(): TemporaryAddon[] {
  try {
    const raw = JSON.parse(Services.prefs.getStringPref(TEMP_PREF, '[]'));
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t: any) => t && typeof t.path === 'string' && t.path)
      .map((t: any) => ({ path: String(t.path), id: typeof t.id === 'string' ? t.id : '', name: typeof t.name === 'string' ? t.name : '', error: '' }));
  } catch {
    return [];
  }
}

function saveTemps(): void {
  try {
    Services.prefs.setStringPref(TEMP_PREF, JSON.stringify(temps.map(({ path, id, name }) => ({ path, id, name }))));
    Services.prefs.savePrefFile(null);
  } catch (e) {
    console.error('VitreExtensions: could not save the temporary add-ons', e);
  }
}

/** A picked manifest.json means its folder (as about:debugging takes it). */
function normalisePath(path: string): string {
  const f = localFile(path);
  // nsIFile.isFile() throws NS_ERROR_FILE_NOT_FOUND on a missing path: say it in words instead.
  if (!f.exists()) throw new Error('The folder or file is no longer there.');
  if (f.isFile() && f.leafName.toLowerCase() === 'manifest.json') return f.parent.path;
  return f.path;
}

async function installTemporary(path: string): Promise<any> {
  const file = localFile(path);
  if (!file.exists()) throw new Error('The folder or file is no longer there.');
  return AM().installTemporaryAddon(file);
}

async function loadTemporary(path: string): Promise<{ id: string; name: string }> {
  const clean = normalisePath(path);
  const addon = await installTemporary(clean);
  const id = String(addon.id);
  const name = String(addon.name ?? id);
  temps = temps.filter((t) => t.path.toLowerCase() !== clean.toLowerCase() && t.id !== id);
  temps.push({ path: clean, id, name, error: '' });
  saveTemps();
  emit();
  return { id, name };
}

/** Stop loading a remembered add-on, by its id or (one that never loaded) its path. */
function forgetTemporary(key: string, notify = true): void {
  if (!key) return;
  const before = temps.length;
  temps = temps.filter((t) => t.id !== key && t.path !== key);
  if (temps.length !== before) saveTemps();
  if (notify) emit();
}

/** Load every remembered add-on again. One failure does not stop the others; it is shown in Settings. */
async function restoreTemporary(): Promise<void> {
  temps = readTemps();
  for (const t of temps) {
    try {
      const addon = await installTemporary(t.path);
      t.id = String(addon.id);
      t.name = String(addon.name ?? t.id);
      t.error = '';
    } catch (e) {
      t.error = String((e as Error)?.message ?? e);
      console.error(`VitreExtensions: could not load the temporary add-on ${t.path}`, e);
    }
  }
  saveTemps();
  emit();
}

// ---- management ----

async function list(): Promise<AddonInfo[]> {
  const A = AM();
  const addons: any[] = await A.getAddonsByTypes(['extension']);
  const out: AddonInfo[] = [];
  for (const a of addons) {
    if (a.hidden || a.isBuiltin || a.isSystem) continue;
    let privateAllowed = false;
    try {
      const perms = await EP().get(a.id);
      privateAllowed = !!perms?.permissions?.includes(PRIVATE_PERM);
    } catch {
      privateAllowed = false;
    }
    const p = Number(a.permissions) || 0;
    out.push({
      id: String(a.id),
      name: String(a.name ?? a.id),
      version: String(a.version ?? ''),
      description: String(a.description ?? ''),
      addon: a,
      // The user's choice; appDisabled says when Firefox keeps it off anyway.
      enabled: !a.userDisabled,
      canDisable: !!(p & A.PERM_CAN_DISABLE),
      canEnable: !!(p & A.PERM_CAN_ENABLE),
      canRemove: !!(p & A.PERM_CAN_UNINSTALL),
      canChangePrivate: !!(p & A.PERM_CAN_CHANGE_PRIVATEBROWSING_ACCESS) && a.incognito !== 'not_allowed',
      privateAllowed,
      privateNotAllowed: a.incognito === 'not_allowed',
      temporary: !!a.temporarilyInstalled,
      vitreTemporary: temps.some((t) => t.id === a.id),
      canUpdate: !!(p & A.PERM_CAN_UPGRADE) && !a.temporarilyInstalled,
      optionsURL: String(a.optionsURL ?? ''),
      optionsType: Number(a.optionsType) || 0,
      appDisabled: !!a.appDisabled,
    });
  }
  out.sort((x, y) => x.name.localeCompare(y.name));
  return out;
}

async function setEnabled(id: string, on: boolean): Promise<void> {
  const a = await AM().getAddonByID(id);
  if (!a) return;
  if (on) await a.enable();
  else await a.disable();
}

/** As about:addons does it (addon-card.mjs): the permission, then a reload of a running add-on. */
async function setPrivateAllowed(id: string, on: boolean): Promise<void> {
  const a = await AM().getAddonByID(id);
  if (!a) return;
  const extension = (globalThis as any).WebExtensionPolicy?.getByID(id)?.extension;
  const perms = { permissions: [PRIVATE_PERM], origins: [] };
  if (on) await EP().add(id, perms, extension);
  else await EP().remove(id, perms, extension);
  if (a.isActive) await a.reload();
  emit();
}

async function remove(id: string): Promise<void> {
  const a = await AM().getAddonByID(id);
  if (!a) return;
  forgetTemporary(id, false);
  await a.uninstall();
}

/**
 * What about:addons' "Check for updates" does: ask every add-on that can be updated, install what
 * is found. An update that asks for new permissions is parked by ExtensionsUI (it shows up in
 * pending()) instead of installing.
 */
async function checkForUpdates(): Promise<{ checked: number; installed: number; review: number; failed: number; errors: string[] }> {
  const A = AM();
  const addons: any[] = await A.getAddonsByTypes(['extension']);
  const result = { checked: 0, installed: 0, review: 0, failed: 0, errors: [] as string[] };
  await Promise.all(
    addons
      .filter((a) => !a.hidden && !a.isBuiltin && !a.isSystem && !a.temporarilyInstalled && Number(a.permissions) & A.PERM_CAN_UPGRADE)
      .map(
        (a) =>
          new Promise<void>((resolve) => {
            result.checked++;
            let install: any = null;
            try {
              a.findUpdates(
                {
                  onUpdateAvailable: (_addon: unknown, found: any) => {
                    install = found;
                  },
                  onUpdateFinished: async (_addon: unknown, error: number) => {
                    if (!install) {
                      if (error) {
                        result.failed++;
                        result.errors.push(`${a.id}: update check error ${error}`);
                      }
                      resolve();
                      return;
                    }
                    try {
                      install.promptHandler = (info: unknown) => A.updatePromptHandler(info);
                      // A permission-adding update is parked for the user's review (pending()):
                      // the check ends when it installed, failed or was parked.
                      const outcome = await new Promise<string>((done) => {
                        const started = Date.now();
                        const poll = setInterval(() => {
                          if (pending().some((r) => r.kind === 'update' && r.id === a.id)) finish('review');
                          else if (Date.now() - started > 60000) finish('waiting');
                        }, 100);
                        const finish = (how: string): void => {
                          clearInterval(poll);
                          done(how);
                        };
                        install.install().then(
                          () => finish('installed'),
                          (e: unknown) => {
                            result.errors.push(`${a.id}: install ${String(e)} (state ${install.state}, error ${install.error})`);
                            finish('failed');
                          }
                        );
                      });
                      if (outcome === 'installed') result.installed++;
                      else if (outcome === 'review') result.review++;
                      else if (outcome === 'failed') result.failed++;
                    } catch {
                      result.failed++;
                    }
                    resolve();
                  },
                },
                A.UPDATE_WHEN_USER_REQUESTED
              );
            } catch {
              result.failed++;
              resolve();
            }
          })
      )
  );
  return result;
}

export const VitreExtensions = {
  AREA,
  restored: new Promise<void>((resolve) => (restoredResolve = resolve)),

  /** Idempotent; see the header. */
  init(): void {
    if (inited) return;
    inited = true;
    applyPrefs();
    try {
      registerArea();
    } catch (e) {
      console.error('VitreExtensions: could not register the pill toolbar area', e);
    }
    watchReviews();
    restoreTemporary().then(restoredResolve, (e) => {
      console.error('VitreExtensions: restoring temporary add-ons failed', e);
      restoredResolve();
    });
  },

  get inited(): boolean {
    return inited;
  },

  pending,
  review,

  onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  list,
  setEnabled,
  setPrivateAllowed,
  remove,
  checkForUpdates,

  temporary(): TemporaryAddon[] {
    return temps.map((t) => ({ ...t }));
  },
  isTemporary(id: string): boolean {
    return temps.some((t) => t.id === id);
  },
  loadTemporary,
  /** By id, or by path for one that never loaded. */
  forgetTemporary(key: string): void {
    forgetTemporary(key);
  },
};
