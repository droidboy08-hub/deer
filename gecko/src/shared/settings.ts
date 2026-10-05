// User settings. Same interface as app/src/shared/settings.ts (the Electron build).
// On Gecko they are stored as vitre.* prefs by src/modules/VitreSettings.sys.ts (get / set / onChange)
// and mirrored in every window as b.settings.

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
  searchEngine: 'google' | 'bing' | 'duckduckgo' | 'brave';
  /** Downloads */
  downloadsFolder: string;
  askWhereToSave: boolean;
  connections: number;
  speedLimitKBps: number;
  /** ffmpeg.exe for joining video and audio ('' = look beside the app, then for the copy Deer downloaded, then on PATH). Downloads module. */
  ffmpegPath: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  appIcon: 'gold',
  barAutoHide: false,
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
  downloadsFolder: '',
  askWhereToSave: false,
  connections: 8,
  speedLimitKBps: 0,
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
export const REBINDABLE_ACTIONS = ['peekLink', 'openAsTab', 'switcherSearch', 'downloadVideo'] as const;

/**
 * A rebind map as stored: only rebindable actions, each with a non-empty "Ctrl+Shift+K" style
 * string. Anything else (a number from about:config, an unknown action) is dropped, never applied.
 */
export function cleanRebind(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const action of REBINDABLE_ACTIONS) {
    const spec = (value as Record<string, unknown>)[action];
    if (typeof spec === 'string' && /^(?:(?:Ctrl|Alt|Shift)\+)*[^+\s]+$/.test(spec.trim())) out[action] = spec.trim();
  }
  return out;
}

export const SEARCH_ENGINES: Record<Settings['searchEngine'], { name: string; url: string }> = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
};
