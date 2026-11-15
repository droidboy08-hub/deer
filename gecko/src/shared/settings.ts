// User settings. Same interface as app/src/shared/settings.ts (the Electron build).
// On Gecko they are stored as vitre.* prefs by src/modules/VitreSettings.sys.ts (get / set / onChange)
// and mirrored in every window as b.settings.
import { isMac } from './os';

export interface Settings {
  /** Appearance */
  theme: 'system' | 'light' | 'dark';
  /** The icon on the taskbar, window and Deer's shortcuts (src/modules/VitreAppIcon.sys.ts). */
  appIcon: 'gold' | 'orange';
  barAutoHide: boolean;
  /** Pages start below the bar: a strip of the bar area's height, in the page's own colour, that
   *  scrolls away with the page (src/actors/page/inset.ts). */
  pageInset: boolean;
  /** Home and background */
  homeBackground: { kind: 'windows' | 'image' | 'video' | 'none'; path: string };
  /** Tabs */
  switcherStyle: 'deck' | 'grid' | 'strip';
  tabOrder: 'recent' | 'bar';
  typeToSearch: boolean;
  closeButton: 'hover' | 'always';
  newTabPosition: 'next' | 'end';
  selectionSearchOpens: 'peek' | 'tab';
  /** Keyboard */
  shiftClick: 'peek' | 'window';
  rebind: Record<string, string>;
  /** Search */
  searchEngine: SearchEngine;
  /** The engine of private windows (their address field, selected text and peek searches). */
  privateSearchEngine: SearchEngine;
  /** Downloads */
  downloadsFolder: string;
  askWhereToSave: boolean;
  connections: number;
  speedLimitKBps: number;
  /**
   * Downloads a quit or a crash stopped continue by themselves when Deer starts, 10 s after the first
   * window opens (spikes/downloader/RESUME-DESIGN.md G4; the owner's decision 5, on by default). Rows the
   * person paused stay paused either way.
   */
  continueDownloadsOnStart: boolean;
  /**
   * When a download's link stops working, Deer opens its page out of sight to find a fresh one
   * (spikes/downloader/RESUME-DESIGN.md G1 step 3, G2 step 4; the owner's decision 6, on by default). Off:
   * only the original address, the stream's master playlist, yt-dlp and the person renew it.
   */
  renewFromPage: boolean;
  /** ffmpeg.exe for joining video and audio ('' = look beside the app, then for the copy Deer downloaded, then on PATH). Downloads module. */
  ffmpegPath: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  appIcon: 'gold',
  // Owner's choice (2026-10-06): the bar (and the window controls) show when the pointer is at the top.
  barAutoHide: true,
  pageInset: true,
  homeBackground: { kind: 'windows', path: '' },
  switcherStyle: 'deck',
  tabOrder: 'recent',
  typeToSearch: true,
  closeButton: 'hover',
  newTabPosition: 'next',
  selectionSearchOpens: 'peek',
  shiftClick: 'peek',
  rebind: {},
  searchEngine: 'google',
  // Owner's choice (2026-10-10): private windows search with a search engine that keeps no profile.
  privateSearchEngine: 'duckduckgo',
  downloadsFolder: '',
  askWhereToSave: false,
  connections: 8,
  speedLimitKBps: 0,
  continueDownloadsOnStart: true,
  renewFromPage: true,
  ffmpegPath: '',
};

/**
 * The pref behind a top-level setting: VitreSettings stores Settings[key] as vitre.<key>.
 * Page modules (src/actors/page) read their boolean settings straight from it in the content
 * process, see src/actors/page/README.
 */
export function settingPref(key: Exclude<keyof Settings, 'homeBackground'>): string {
  return 'vitre.' + key;
}

/** Only Deer's own verbs can be rebound (Settings › Keyboard shortcuts); the ids are ActionIds of shortcuts.ts. */
export const REBINDABLE_ACTIONS = ['peekLink', 'openAsTab', 'switcherSearch', 'downloadVideo', 'splitView'] as const;

/** A stored key's spelling: [Ctrl+][Alt+][Shift+]Key in any order; macOS also Mod and MacCtrl. */
const REBIND_SPEC = isMac ? /^(?:(?:Ctrl|Alt|Shift|Mod|MacCtrl)\+)*[^+\s]+$/ : /^(?:(?:Ctrl|Alt|Shift)\+)*[^+\s]+$/;

/**
 * A rebind map as stored: only rebindable actions, each with a non-empty "Ctrl+Shift+K" style
 * string. Anything else (a number from about:config, an unknown action) is dropped, never applied.
 * The modifiers are Ctrl, Alt and Shift as Deer has always written them; on macOS also Mod and
 * MacCtrl (rebindToSpec below says what each means there). Windows accepts exactly what it always
 * has, so a value only a Mac writes is dropped there, as before.
 */
export function cleanRebind(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const action of REBINDABLE_ACTIONS) {
    const spec = (value as Record<string, unknown>)[action];
    if (typeof spec === 'string' && REBIND_SPEC.test(spec.trim())) out[action] = spec.trim();
  }
  return out;
}

/**
 * A stored rebind as a spec of shortcuts.ts ([Mod+][Ctrl+][Alt+][Shift+]Key, "Ctrl" being the
 * Control key) for one system. Stored values are read the way Firefox reads a WebExtension's
 * shortcut (gre/modules/ShortcutUtils.sys.mjs chromeModifierKeyMap: Ctrl and Command are accel,
 * MacCtrl is control):
 *   Windows  unchanged: "Ctrl+Shift+K" is Ctrl+Shift+K, as always ("MacCtrl" and "Mod" are Ctrl too).
 *   macOS    "Ctrl" (every rebind made on Windows) and "Mod" are ⌘; "MacCtrl" is the Control key.
 * So a rebind saved before the Mac port means on a Mac what Ctrl means there for every other key
 * (Ctrl+K is ⌘K), and nothing stored has to be rewritten.
 */
export function rebindToSpec(stored: string, os: 'win' | 'mac'): string {
  if (os !== 'mac') return stored.replace(/(^|\+)MacCtrl(?=\+)/g, '$1Ctrl');
  const parts = stored.split('+');
  const key = parts.pop() ?? '';
  const has = (m: string): boolean => parts.includes(m);
  const mods = [has('Mod') || has('Ctrl') ? 'Mod' : '', has('MacCtrl') ? 'Ctrl' : '', has('Alt') ? 'Alt' : '', has('Shift') ? 'Shift' : ''];
  return [...mods.filter(Boolean), key].join('+');
}

/**
 * The value to store for a spec of shortcuts.ts (Settings' capture, shortcuts.ts eventSpec). Windows
 * keeps the spelling it has always written ("Ctrl+Shift+K"); macOS writes ⌘ as "Mod" and the Control
 * key as "MacCtrl", which rebindToSpec reads back as the same keys.
 */
export function specToRebind(spec: string, os: 'win' | 'mac'): string {
  const parts = spec.split('+');
  const key = parts.pop() ?? '';
  const mods = parts.map((m) => (os === 'mac' ? (m === 'Ctrl' ? 'MacCtrl' : m) : m === 'Mod' || m === 'MacCtrl' ? 'Ctrl' : m));
  return [...mods, key].join('+');
}

export type SearchEngine = 'google' | 'bing' | 'duckduckgo' | 'brave';

export const SEARCH_ENGINES: Record<SearchEngine, { name: string; url: string }> = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
};
