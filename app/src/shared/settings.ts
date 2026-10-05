// User settings. Stored by the main process (userData/settings.json), mirrored in every window.

export interface Settings {
  /** Appearance */
  theme: 'system' | 'light' | 'dark';
  barAutoHide: boolean;
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
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  barAutoHide: false,
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
};

export const SEARCH_ENGINES: Record<Settings['searchEngine'], { name: string; url: string }> = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
};
