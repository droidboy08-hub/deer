// Settings › Keyboard shortcuts: the map from design/keymap.json, grouped the same way, with
// short labels for the list. `{peekLink}`-style tokens print the current (possibly rebound) key.
// Engine-independent: the same table as app/src/renderer/modules/settings/keymap.ts. The defaults
// in REBINDABLE are the specs src/shared/shortcuts.ts binds; tests/settings/rebind.js checks that.

export type RebindId = 'peekLink' | 'openAsTab' | 'switcherSearch' | 'downloadVideo';

export interface KeyRow {
  label: string;
  /** Primary key, in Windows spelling. May hold a {rebindId} token. */
  keys: string;
  /** Other keys or routes for the same thing. */
  alt?: string;
  /** Page-first: the site gets the key before Deer. */
  page?: boolean;
  /** Where the key works, when that is narrower than the whole window. */
  where?: string;
  /** A note that replaces the generated one. */
  note?: string;
  rebind?: RebindId;
}

export interface KeyGroup {
  name: string;
  rows: KeyRow[];
}

/** Deer's own verbs, the only keys that can be changed. */
export const REBINDABLE: Record<RebindId, { label: string; spec: string }> = {
  peekLink: { label: 'Peek', spec: 'Ctrl+Q' },
  openAsTab: { label: 'Open as tab', spec: 'Alt+Enter' },
  switcherSearch: { label: 'Search tabs', spec: 'Ctrl+Shift+A' },
  downloadVideo: { label: 'Download this video', spec: 'Ctrl+Shift+D' },
};

export const KEY_GROUPS: KeyGroup[] = [
  {
    name: 'Peek',
    rows: [
      { label: 'Peek a link', keys: 'Shift+click', page: true },
      { label: 'Peek the focused link', keys: 'Shift+Enter', page: true },
      { label: 'Peek the focused link, or the link under the pointer', keys: '{peekLink}', page: true, rebind: 'peekLink' },
      { label: 'Hop to another link', keys: 'Shift+click', where: 'On the dimmed page around a peek' },
      { label: 'Open as tab', keys: '{openAsTab}', page: true, rebind: 'openAsTab' },
      { label: 'Close peek', keys: 'Esc', note: 'Sites can use this first. Ctrl+W always closes' },
      { label: 'Close peek, even if the page uses Esc', keys: 'Esc Esc' },
      { label: 'Back or forward inside the peek', keys: 'Alt+Left', alt: 'Alt+Right', page: true },
    ],
  },
  {
    name: 'Tabs and windows',
    rows: [
      { label: 'New tab', keys: 'Ctrl+T' },
      { label: 'Close the tab', keys: 'Ctrl+W', alt: 'Ctrl+F4', note: 'Closes an open panel or peek first' },
      { label: 'Reopen the last closed tab or window', keys: 'Ctrl+Shift+T' },
      { label: 'New window', keys: 'Ctrl+N' },
      { label: 'New private window', keys: 'Ctrl+Shift+N' },
      { label: 'Close the window and all its tabs', keys: 'Ctrl+Shift+W' },
      { label: 'Next tab, in tab bar order', keys: 'Ctrl+Page Down' },
      { label: 'Previous tab, in tab bar order', keys: 'Ctrl+Page Up' },
      { label: 'Go to tab 1 to 8', keys: 'Ctrl+1 … Ctrl+8', page: true },
      { label: 'Go to the last tab', keys: 'Ctrl+9', page: true },
      { label: 'Move the tab left', keys: 'Ctrl+Shift+Page Up', page: true },
      { label: 'Move the tab right', keys: 'Ctrl+Shift+Page Down', page: true },
      { label: 'Full screen', keys: 'F11', page: true },
    ],
  },
  {
    name: 'Address and search',
    rows: [
      { label: 'Edit the address', keys: 'Ctrl+L', alt: 'Alt+D', page: true },
      { label: 'Recent history', keys: 'Ctrl+H', page: true },
      { label: 'Go to the address or search', keys: 'Enter', where: 'In the address field' },
      { label: 'Open in a new tab', keys: 'Alt+Enter', where: 'In the address field' },
      { label: 'Peek the highlighted result', keys: 'Shift+Enter', alt: '{peekLink}', where: 'In the address field' },
      { label: 'Add www. and .com, then go', keys: 'Ctrl+Enter', where: 'In the address field' },
      { label: 'Remove the highlighted history suggestion', keys: 'Shift+Delete', where: 'In the address field' },
      { label: 'Put the address back, then return to the page', keys: 'Esc', where: 'In the address field' },
    ],
  },
  {
    name: 'Page',
    rows: [
      { label: 'Back', keys: 'Alt+Left', alt: 'Mouse Back button', page: true },
      { label: 'Forward', keys: 'Alt+Right', alt: 'Mouse Forward button', page: true },
      { label: 'Reload', keys: 'Ctrl+R', alt: 'F5', page: true },
      { label: 'Hard reload, skipping the cache', keys: 'Ctrl+Shift+R', alt: 'Ctrl+F5, Shift+F5', page: true },
      { label: 'Stop loading', keys: 'Esc', page: true },
      { label: 'Leave video or element full screen', keys: 'Esc', where: 'In element full screen' },
      { label: 'Zoom in', keys: 'Ctrl+Plus', alt: 'Ctrl+=', page: true },
      { label: 'Zoom out', keys: 'Ctrl+Minus', page: true },
      { label: 'Reset zoom', keys: 'Ctrl+0', page: true },
      { label: 'Print', keys: 'Ctrl+P', page: true },
      { label: 'Save page as', keys: 'Ctrl+S', page: true },
      { label: 'View page source', keys: 'Ctrl+U', page: true },
      { label: 'Open a link in a background tab', keys: 'Ctrl+click', alt: 'Middle-click', page: true },
      { label: 'Open a link in a new tab and switch to it', keys: 'Ctrl+Shift+click', page: true },
    ],
  },
  {
    name: 'Find',
    rows: [
      { label: 'Find on page', keys: 'Ctrl+F', page: true },
      { label: 'Find again, next or previous', keys: 'F3', alt: 'Shift+F3, Ctrl+G, Ctrl+Shift+G', page: true },
      { label: 'Next match', keys: 'Enter', where: 'In the find field' },
      { label: 'Previous match', keys: 'Shift+Enter', where: 'In the find field' },
      { label: 'Match case', keys: 'Alt+C', where: 'In the find field' },
      { label: 'Close find and click the match', keys: 'Ctrl+Enter', where: 'In the find field' },
      { label: 'Close find and peek the match’s link', keys: '{peekLink}', where: 'In the find field' },
      { label: 'Move to the page, keeping find open', keys: 'F6', where: 'In the find field' },
      { label: 'Close find', keys: 'Esc', where: 'In the find field' },
    ],
  },
  {
    name: 'Tab switcher',
    rows: [
      { label: 'Switch to the previous tab', keys: 'Ctrl+Tab', note: 'A quick tap' },
      { label: 'Open the switcher', keys: 'Ctrl+Tab', note: 'Hold Ctrl' },
      { label: 'Previous card', keys: 'Ctrl+Shift+Tab' },
      { label: 'Open the selected card', keys: 'Release Ctrl', where: 'While switching' },
      { label: 'Close the selected card', keys: 'Ctrl+W', alt: 'Delete', where: 'While switching' },
      { label: 'Search tabs', keys: '{switcherSearch}', page: true, rebind: 'switcherSearch' },
      { label: 'Cancel and stay on your tab', keys: 'Esc', where: 'Once the switcher stays open' },
    ],
  },
  {
    name: 'Downloads',
    rows: [
      { label: 'Show or hide downloads', keys: 'Ctrl+J', page: true },
      { label: 'Download this video', keys: '{downloadVideo}', page: true, rebind: 'downloadVideo' },
      { label: 'Download a linked file', keys: 'Alt+click', page: true },
      { label: 'Download the suggested quality at once', keys: 'Shift+click', where: 'On the Download pill' },
    ],
  },
  {
    name: 'Menus and focus',
    rows: [
      { label: 'Open the menu for what’s focused', keys: 'Shift+F10', alt: 'Menu key', page: true },
      { label: 'Deer’s menu, even where a site has its own', keys: 'Shift+right-click' },
      { label: 'Move focus between the page and the address', keys: 'F6', alt: 'Shift+F6' },
      { label: 'Close a menu', keys: 'Esc', alt: 'Alt, F10', where: 'In a menu' },
    ],
  },
  {
    name: 'Popovers and prompts',
    rows: [
      { label: 'Move between choices', keys: 'Up', alt: 'Down', where: 'In a popover' },
      { label: 'Choose', keys: 'Enter', alt: 'Space', where: 'In a popover' },
      { label: 'Close and go back', keys: 'Esc', where: 'In a popover' },
    ],
  },
  {
    name: 'Panels and app',
    rows: [
      { label: 'Open or close Settings', keys: 'Ctrl+,', page: true },
      { label: 'Keyboard shortcuts', keys: 'F1', page: true },
      { label: 'Clear browsing data', keys: 'Ctrl+Shift+Delete', page: true },
      { label: 'Close the panel', keys: 'Esc', alt: 'Ctrl+W', where: 'With a panel open' },
      { label: 'Search the panel', keys: 'Ctrl+F', where: 'With a panel open' },
      { label: 'Developer tools', keys: 'F12', alt: 'Ctrl+Shift+I', page: true },
      { label: 'Developer tools console', keys: 'Ctrl+Shift+J', page: true },
      { label: 'Inspect element', keys: 'Ctrl+Shift+C', page: true },
    ],
  },
  {
    name: 'Editing',
    rows: [
      { label: 'Undo', keys: 'Ctrl+Z' },
      { label: 'Redo', keys: 'Ctrl+Y', alt: 'Ctrl+Shift+Z' },
      { label: 'Cut', keys: 'Ctrl+X', alt: 'Shift+Delete' },
      { label: 'Copy', keys: 'Ctrl+C', alt: 'Ctrl+Insert' },
      { label: 'Paste', keys: 'Ctrl+V', alt: 'Shift+Insert' },
      { label: 'Paste as plain text', keys: 'Ctrl+Shift+V' },
      { label: 'Select all', keys: 'Ctrl+A' },
      { label: 'Delete the previous or next word', keys: 'Ctrl+Backspace', alt: 'Ctrl+Delete' },
    ],
  },
];

/** "Different from Chrome": shown in its own card. `when` hides a row that no longer applies. */
export const DIFFERENT_FROM_CHROME: { text: string; link?: { label: string; section: string }; when?: 'shiftClickPeek' | 'mruOrder' }[] = [
  { text: 'Shift+click peeks instead of opening a window', when: 'shiftClickPeek' },
  { text: 'Ctrl+Tab goes in most-recent order', link: { label: 'Change in Tabs', section: 'tabs' }, when: 'mruOrder' },
  { text: 'F6 always leaves the page' },
  { text: 'Shift+Enter in the address field peeks' },
  { text: '{peekLink} peeks the focused link' },
  { text: 'Ctrl+H shows recent history in the address field' },
  { text: 'Ctrl+Shift+T also reopens a peek you just closed' },
  { text: 'Ctrl+J opens a panel, not a page' },
  { text: 'F1 opens these keyboard shortcuts' },
];

// ---- key specs ----

const DISPLAY: Record<string, string> = {
  Comma: ',',
  Plus: 'Plus',
  Minus: 'Minus',
  Equal: '=',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Escape: 'Esc',
  ' ': 'Space',
};

/** 'Ctrl+Shift+PageDown' → 'Ctrl+Shift+Page Down'. */
export function displaySpec(spec: string): string {
  const parts = spec.split('+');
  const key = parts.pop() ?? '';
  return [...parts, DISPLAY[key] ?? key].join('+');
}

/** The key a rebindable verb uses now. */
export function currentSpec(id: RebindId, rebind: Record<string, string>): string {
  return rebind[id] || REBINDABLE[id].spec;
}

/** Replace {peekLink}-style tokens with the current key, as printed. */
export function fillKeys(text: string, rebind: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_m, id: string) => (id in REBINDABLE ? displaySpec(currentSpec(id as RebindId, rebind)) : _m));
}

/** Lower-case, no spaces or plus signs: 'Ctrl + Q' and 'ctrl+q' both become 'ctrlq'. */
export function normalizeKeys(text: string): string {
  return text.toLowerCase().replace(/[\s+]/g, '');
}
