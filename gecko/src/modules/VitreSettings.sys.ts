// Deer settings: one pref per field under "vitre.", defaults on the default branch, one branch
// observer that fans out to every window. Recipe: spikes/switcher/RESULT.md section 6.
//
// Contract (same Settings interface as the Electron build, src/shared/settings.ts):
//   VitreSettings.get()            the whole Settings object (validated; bad values fall back)
//   VitreSettings.set(patch)       merge a patch (homeBackground may be partial), then savePrefFile
//   VitreSettings.onChange(fn)     fn(settings, changedKeys) once per set(), in every window and for
//                                  direct pref writes (about:config); returns an unsubscribe to call on
//                                  the window's unload
//   VitreSettings.reset(key?)      back to the default for one field path, or all of them
// The module is a process singleton and all browser windows live in the parent process, so "broadcast
// to every window" is calling the listeners. Windows use it through b.settings / b.on('settings').
// Page modules (src/actors/page) cannot import a singleton: they read their boolean settings from
// the same prefs in the content process (settingPref() in shared/settings.ts) and observe them with
// Services.prefs.addObserver. Gecko mirrors every pref change to the content processes, and the
// defaults installed by init() are there before the first content process starts.
// Pref names: vitre.<field>, with homeBackground split into vitre.homeBackground.kind / .path and
// rebind stored as a JSON string (read back through cleanRebind: only rebindable actions with a
// string spec survive, so about:config cannot empty the key map).
//
// Settings that Firefox's own code has to know about are mapped in syncEngine() below: that is the
// one place for engine mappings of the core's settings (newTabPosition, theme). A feature's own
// settings are the feature singleton's business: it observes onChange itself.
import { cleanRebind, DEFAULT_SETTINGS, type Settings } from '../shared/settings';

const BRANCH = 'vitre.';

type Kind = 'bool' | 'int' | 'string' | 'json';
type Spec = { kind: Kind; def: unknown; allowed?: readonly string[]; min?: number; max?: number };

/** Field path -> how it is stored. Covers every field of Settings. */
const SCHEMA: Record<string, Spec> = {
  theme: { kind: 'string', def: DEFAULT_SETTINGS.theme, allowed: ['system', 'light', 'dark'] },
  appIcon: { kind: 'string', def: DEFAULT_SETTINGS.appIcon, allowed: ['gold', 'orange'] },
  barAutoHide: { kind: 'bool', def: DEFAULT_SETTINGS.barAutoHide },
  pageInset: { kind: 'bool', def: DEFAULT_SETTINGS.pageInset },
  'homeBackground.kind': { kind: 'string', def: DEFAULT_SETTINGS.homeBackground.kind, allowed: ['windows', 'image', 'video', 'none'] },
  'homeBackground.path': { kind: 'string', def: DEFAULT_SETTINGS.homeBackground.path },
  switcherStyle: { kind: 'string', def: DEFAULT_SETTINGS.switcherStyle, allowed: ['deck', 'grid', 'strip'] },
  tabOrder: { kind: 'string', def: DEFAULT_SETTINGS.tabOrder, allowed: ['recent', 'bar'] },
  typeToSearch: { kind: 'bool', def: DEFAULT_SETTINGS.typeToSearch },
  closeButton: { kind: 'string', def: DEFAULT_SETTINGS.closeButton, allowed: ['hover', 'always'] },
  newTabPosition: { kind: 'string', def: DEFAULT_SETTINGS.newTabPosition, allowed: ['next', 'end'] },
  selectionSearchOpens: { kind: 'string', def: DEFAULT_SETTINGS.selectionSearchOpens, allowed: ['peek', 'tab'] },
  shiftClick: { kind: 'string', def: DEFAULT_SETTINGS.shiftClick, allowed: ['peek', 'window'] },
  rebind: { kind: 'json', def: DEFAULT_SETTINGS.rebind },
  searchEngine: { kind: 'string', def: DEFAULT_SETTINGS.searchEngine, allowed: ['google', 'bing', 'duckduckgo', 'brave'] },
  downloadsFolder: { kind: 'string', def: DEFAULT_SETTINGS.downloadsFolder },
  askWhereToSave: { kind: 'bool', def: DEFAULT_SETTINGS.askWhereToSave },
  connections: { kind: 'int', def: DEFAULT_SETTINGS.connections, min: 1, max: 32 },
  speedLimitKBps: { kind: 'int', def: DEFAULT_SETTINGS.speedLimitKBps, min: 0 },
  ffmpegPath: { kind: 'string', def: DEFAULT_SETTINGS.ffmpegPath },
};

/** A patch for set(): any subset of Settings; homeBackground may give only kind or only path. */
export type SettingsPatch = { [K in keyof Settings]?: K extends 'homeBackground' ? Partial<Settings[K]> : Settings[K] };
export type SettingsListener = (settings: Settings, changed: string[]) => void;

const defaults = () => Services.prefs.getDefaultBranch(BRANCH);
const prefs = () => Services.prefs.getBranch(BRANCH);

function writeTo(branch: any, key: string, kind: Kind, value: unknown): void {
  if (kind === 'bool') branch.setBoolPref(key, !!value);
  else if (kind === 'int') branch.setIntPref(key, Math.trunc(Number(value)) || 0);
  else if (kind === 'json') branch.setStringPref(key, JSON.stringify(value ?? {}));
  else branch.setStringPref(key, String(value ?? ''));
}

function read(key: string): unknown {
  const { kind, def, allowed, min, max } = SCHEMA[key];
  try {
    const p = prefs();
    if (kind === 'bool') return p.getBoolPref(key);
    if (kind === 'int') {
      const n = p.getIntPref(key);
      return Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n));
    }
    if (kind === 'json') {
      const v = JSON.parse(p.getStringPref(key));
      if (!v || typeof v !== 'object' || Array.isArray(v)) return def;
      return key === 'rebind' ? cleanRebind(v) : v;
    }
    const v = p.getStringPref(key);
    return allowed && !allowed.includes(v) ? def : v;
  } catch {
    return def; // wrong type in about:config, broken JSON...
  }
}

function setPath(obj: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts[parts.length - 1]] = value;
}

function getPath(obj: Record<string, any> | undefined, path: string): unknown {
  return path.split('.').reduce<any>((o, p) => (o == null ? undefined : o[p]), obj);
}

/** Windows' default Downloads folder (Services.dirsvc "DfltDwnld"). */
function defaultDownloads(): string {
  try {
    return Services.dirsvc.get('DfltDwnld', Ci.nsIFile).path;
  } catch {
    return '';
  }
}

const listeners = new Set<SettingsListener>();
let pending: Set<string> | null = null;
let started = false;

/**
 * Firefox's built-in themes, one per Appearance choice. The theme is what decides the colour scheme
 * of Firefox's own surfaces (prompts, native panels and menus) AND of web pages, because
 * layout.css.prefers-color-scheme.content-override defaults to 2 = "follow the browser theme"
 * (browser.theme.content-theme, which the theme writes). The default theme follows Windows.
 * Sources: toolkit/mozapps/extensions (built-in theme ids), gre/modules/LightweightThemeConsumer.sys.mjs.
 */
const THEME_ADDONS: Record<Settings['theme'], string> = {
  system: 'default-theme@mozilla.org',
  light: 'firefox-compact-light@mozilla.org',
  dark: 'firefox-compact-dark@mozilla.org',
};

/**
 * Settings that Firefox's own code has to know about.
 *   newTabPosition -> browser.tabs.insertAfterCurrent: where tabs opened by Firefox itself
 *                     (extensions, external links) go; tabs Deer opens are placed by Browser.newTab.
 *                     Source: Tabbrowser.sys.mjs addTab.
 *   theme          -> the enabled built-in theme (AddonManager, resource://gre/modules/AddonManager.sys.mjs):
 *                     Match Windows / Light / Dark for prompts, native popups and pages alike.
 * `changed` limits the work to what moved; without it everything is applied (startup).
 */
function syncEngine(s: Settings, changed?: string[]): void {
  if (!changed || changed.includes('newTabPosition')) {
    try {
      Services.prefs.setBoolPref('browser.tabs.insertAfterCurrent', s.newTabPosition === 'next');
    } catch (e) {
      console.error('VitreSettings: engine sync failed', e);
    }
  }
  if (!changed || changed.includes('theme')) void applyTheme(s.theme);
}

let themeApplying: Promise<void> | null = null;
/** Enable the built-in theme for an Appearance choice (a no-op when it is already the active one). */
async function applyTheme(theme: Settings['theme']): Promise<void> {
  const id = THEME_ADDONS[theme] ?? THEME_ADDONS.system;
  // One at a time: a quick Light -> Dark -> Light must end on Light.
  const previous = themeApplying ?? Promise.resolve();
  const mine = previous.then(async () => {
    try {
      const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      const addon = await AddonManager.getAddonByID(id);
      if (addon && !addon.isActive) await addon.enable();
    } catch (e) {
      console.error('VitreSettings: could not apply the theme', e);
    }
  });
  themeApplying = mine;
  await mine;
  if (themeApplying === mine) themeApplying = null;
}

export const VitreSettings = {
  BRANCH,
  /** Field paths, in Settings order. */
  keys: Object.keys(SCHEMA),

  /** Install the defaults and start observing. Idempotent; VitreStartup.init() calls it. Reads no user prefs. */
  init(): void {
    if (started) return;
    started = true;
    const d = defaults();
    for (const [key, spec] of Object.entries(SCHEMA)) writeTo(d, key, spec.kind, spec.def);
    Services.prefs.addObserver(BRANCH, VitreSettings);
  },

  /**
   * Push the settings Firefox's own code reads into its prefs. VitreStartup calls this once the
   * profile's prefs are loaded: init() itself may run at AutoConfig time, which is BEFORE prefs.js
   * and user.js are read (nsReadConfig observes prefservice:before-read-userprefs), so nothing in
   * init() may look at user values.
   */
  syncEngine(): void {
    syncEngine(VitreSettings.get());
  },

  /** The whole Settings object. downloadsFolder is resolved to the Windows Downloads folder when unset. */
  get(): Settings {
    VitreSettings.init();
    const out: Record<string, any> = {};
    for (const key of Object.keys(SCHEMA)) setPath(out, key, read(key));
    if (!out.downloadsFolder) out.downloadsFolder = defaultDownloads();
    return out as Settings;
  },

  /** Merge a patch. Listeners in every window hear about it once, in a microtask. */
  set(patch: SettingsPatch): void {
    VitreSettings.init();
    const p = prefs();
    for (const [key, spec] of Object.entries(SCHEMA)) {
      const v = getPath(patch, key);
      if (v !== undefined) writeTo(p, key, spec.kind, v);
    }
    // prefs.js is otherwise written 250-500 ms later; a crash in between would lose the change.
    try {
      Services.prefs.savePrefFile(null);
    } catch (e) {
      console.error('VitreSettings: savePrefFile failed', e);
    }
  },

  /** Back to the default: one field path ("homeBackground.path"), or everything. */
  reset(key?: string): void {
    const p = prefs();
    for (const k of key ? [key] : Object.keys(SCHEMA)) if (k in SCHEMA) p.clearUserPref(k);
    try {
      Services.prefs.savePrefFile(null);
    } catch {
      /* not fatal */
    }
  },

  /** fn(settings, changedKeys). Returns an unsubscribe function; call it when the window unloads. */
  onChange(fn: SettingsListener): () => void {
    VitreSettings.init();
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  // nsIObserver: pref observers fire synchronously, once per pref. Coalesce one set() into one call.
  observe(_subject: unknown, topic: string, name: string): void {
    if (topic !== 'nsPref:changed') return;
    const key = name.slice(BRANCH.length);
    if (!(key in SCHEMA)) return;
    if (!pending) {
      pending = new Set();
      Promise.resolve().then(() => {
        const changed = [...(pending ?? [])];
        pending = null;
        const s = VitreSettings.get();
        syncEngine(s, changed);
        for (const fn of [...listeners]) {
          try {
            fn(s, changed);
          } catch (e) {
            console.error('VitreSettings listener failed', e);
          }
        }
      });
    }
    pending.add(key);
  },

  QueryInterface: ChromeUtils.generateQI(['nsIObserver']),
};
