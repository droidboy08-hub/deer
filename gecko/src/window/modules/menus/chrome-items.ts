// Menus for Deer's own surfaces: the active tab pill, a background tab circle, the + circle and
// Deer's text fields (MenuChrome.dc.html, DESIGN-NOTES item lists). Ported from
// app/src/renderer/modules/menus/chrome-items.ts. The Home wallpaper's menu is a page menu here
// (Home is a page in a tab: page-items.ts); the peek's header and the downloads ring are drawn by
// their modules, which show their rows through the 'menus' service.
// Split view (../design/SPLIT-VIEW-SPEC.md "Menus", CtxMenu kinds pillsplit, circlesplit, circlepair,
// splitpill, capsule): "New tab in split view" in the pill's menu, "Open in split view" (or "... instead
// of <tab>") first in a circle's, a half of the split pill's menu and the pair capsule's menu. Below a
// 648 px window the split rows grey out with "Window too narrow" in the accelerator column.
import type { Browser, Pair } from '../../browser';
import type { Tab } from '../../model';
import { titleOf } from '../../split';
import { displayHost } from '../../../shared/url';
import * as gecko from './gecko';
import { pasteAndGo } from './page-items';
import { downloadsService, peekService, settingsService } from './services';
import { item, SEP, tidy, type MenuCommand, type MenuItem } from './types';

const w = window as any;

function duplicate(t: Tab): void {
  gecko.duplicateTab(t.node);
}

/** A lone tab has nowhere to move from: the row greys out rather than closing this window. */
function moveRow(b: Browser, t: Tab): MenuCommand {
  return item('Move tab to new window', 'newwindow', '', 'W', () => b.moveToNewWindow(t), { disabled: b.tabs.length < 2 });
}

function closeOthers(b: Browser, t: Tab): void {
  for (const other of [...b.tabs]) if (other.id !== t.id) b.closeTab(other);
  b.activate(t);
}

/** Tabs that have played sound get Mute tab (Unmute tab once muted). */
function muteRow(b: Browser, t: Tab): MenuCommand | null {
  if (!gecko.tabHasSound(t.node) && !t.audible && !t.muted) return null;
  return item(t.muted ? 'Unmute tab' : 'Mute tab', t.muted ? 'unmute' : 'mute', '', 'M', () => b.toggleMute(t));
}

const isWeb = (t: Tab): boolean => t.kind === 'web' && !!t.url && !/^about:blank$/i.test(t.url);

/** The key that toggles split view, as printed (Settings › Keyboard shortcuts may rebind it). */
export const splitKey = (b: Browser): string => b.settings.rebind?.splitView || 'Ctrl+Shift+U';

/**
 * A row that starts split view; under a 648 px window it greys out with "Window too narrow" where
 * the key would be (spec "Rules for every route": Too narrow). Popup windows never split.
 */
export function splitStartRow(b: Browser, label: string, access: string, key: string, run: () => void): MenuCommand | null {
  if (b.isPopup) return null;
  const narrow = b.splitView.refusal() === 'narrow';
  return item(label, 'split', narrow ? 'Window too narrow' : key, access, run, { disabled: narrow });
}

/** Up to 20 characters of a title, then an ellipsis (spec "How to start": "... instead of Tideline"). */
const short = (text: string): string => (text.length > 20 ? `${text.slice(0, 20).trimEnd()}…` : text);

/** Close every tab but the pair's two (Close other tabs on a half or a capsule keeps both sides). */
function closeOthersOfPair(b: Browser, p: Pair, keep: Tab): void {
  for (const other of [...b.tabs]) if (other !== p.left && other !== p.right) b.closeTab(other);
  b.activate(keep);
}

/** The active tab pill at rest (hangs at y 64). */
export function pillRows(b: Browser, t: Tab): MenuItem[] {
  const web = isWeb(t);
  if (b.isPopup) {
    // A popup window shows its one page in a read-only pill (bar.ts): no other tabs to close, and a
    // duplicate or a move would add a tab the popup's bar never shows.
    return tidy([
      web ? item('Copy address', 'link', '', 'A', () => gecko.copyText(t.url)) : null,
      SEP,
      muteRow(b, t),
      SEP,
      item('Close tab', 'close', 'Ctrl+W', 'C', () => b.closeTab(t)),
    ]);
  }
  return tidy([
    web ? item('Copy address', 'link', '', 'A', () => gecko.copyText(t.url)) : null,
    pasteAndGo((url) => b.navigate(t, url)),
    SEP,
    web ? item('Duplicate tab', '', '', 'D', () => duplicate(t)) : null,
    // Not on Home (the empty side would be the page itself).
    web ? splitStartRow(b, 'New tab in split view', 'N', splitKey(b), () => b.split('home')) : null,
    muteRow(b, t),
    web ? moveRow(b, t) : null,
    SEP,
    item('Close other tabs', '', '', 'O', () => closeOthers(b, t), { disabled: b.tabs.length < 2 }),
    item('Close tab', 'close', 'Ctrl+W', 'C', () => b.closeTab(t)),
  ]);
}

/**
 * "Open in split view" for a background circle: pairs it with the active tab. With a pair active it
 * reads "Open in split view instead of <the side it replaces>" (its Home side, else its unfocused
 * side). Left out where it would pair Home with Home, and for pinned tabs.
 */
function circleSplitRow(b: Browser, t: Tab): MenuCommand | null {
  const a = b.active();
  if (!a || t.pinned || a.pinned) return null;
  const pair = b.splitView.active();
  if (pair) {
    const out = b.splitView.replaced(pair);
    const kept = out === pair.left ? pair.right : pair.left;
    if (!out || (kept.kind === 'home' && t.kind === 'home')) return null;
    return splitStartRow(b, `Open in split view instead of ${short(titleOf(out))}`, 'S', '', () => b.split(t));
  }
  if (a.kind === 'home' && t.kind === 'home') return null;
  return splitStartRow(b, 'Open in split view', 'S', '', () => b.split(t));
}

/**
 * A half of the split pill (splitpill): it acts on that half's side. Separate tabs acts on the whole
 * pair, so its key is printed on both halves; Ctrl+W only on the focused half.
 */
export function splitHalfRows(b: Browser, t: Tab): MenuItem[] {
  const web = isWeb(t);
  const p = b.pairOf(t);
  if (!p) return pillRows(b, t);
  const focused = t.id === b.activeId;
  return tidy([
    web ? item('Copy address', 'link', '', 'A', () => gecko.copyText(t.url)) : null,
    pasteAndGo((url) => b.navigate(t, url)),
    SEP,
    item('Swap sides', 'swap', '', 'P', () => b.swapSides(t)),
    item('Separate tabs', '', splitKey(b), 'E', () => b.separate(t)),
    muteRow(b, t),
    SEP,
    item('Close other tabs', '', '', 'O', () => closeOthersOfPair(b, p, t), { disabled: b.tabs.length <= 2 }),
    item('Close tab', 'close', focused ? 'Ctrl+W' : '', 'C', () => b.closeTab(t)),
  ]);
}

/** The pair capsule (a pair while another tab is active). Ctrl+Shift+U acts on the active tab, not here. */
export function capsuleRows(b: Browser, p: Pair): MenuItem[] {
  const keep = b.mru.map((id) => b.tab(id)).find((x) => x === p.left || x === p.right) ?? p.left;
  return tidy([
    { caption: `${titleOf(p.left)} · ${titleOf(p.right)}` },
    SEP,
    item('Swap sides', 'swap', '', 'P', () => b.swapSides(p.left)),
    item('Separate tabs', '', '', 'E', () => b.separate(p.left)),
    SEP,
    item('Close other tabs', '', '', 'O', () => closeOthersOfPair(b, p, keep), { disabled: b.tabs.length <= 2 }),
    item('Close both tabs', 'close', '', 'C', () => b.splitView.closeBoth(p)),
  ]);
}

/** The caption names the tab, so Close other tabs is never a guess. */
export function circleCaption(t: Tab): string {
  if (t.kind === 'home') return 'Home';
  const host = displayHost(t.url);
  const title = t.title.trim();
  return title && title !== host ? `${title} · ${host}` : host || 'New tab';
}

/** A background tab circle. Close tab has no key: Ctrl+W closes the active tab. */
export function circleRows(b: Browser, t: Tab): MenuItem[] {
  const web = isWeb(t);
  const split = circleSplitRow(b, t);
  return tidy([
    { caption: circleCaption(t) },
    SEP,
    split,
    SEP,
    web ? item('Reload tab', 'reload', '', 'R', () => gecko.reloadTab(t.node)) : null,
    web ? item('Duplicate tab', '', '', 'D', () => duplicate(t)) : null,
    web ? item('Copy address', 'link', '', 'A', () => gecko.copyText(t.url)) : null,
    muteRow(b, t),
    web ? moveRow(b, t) : null,
    SEP,
    item('Close other tabs', '', '', 'O', () => closeOthers(b, t), { disabled: b.tabs.length < 2 }),
    item('Close tab', 'close', '', 'C', () => b.closeTab(t)),
  ]);
}

/** Closed windows SessionStore can bring back (SessionStore.getClosedWindowCount, sessionstore/SessionStore.sys.mjs). */
function closedWindows(): number {
  try {
    return Number(w.SessionStore.getClosedWindowCount()) || 0;
  } catch {
    return 0;
  }
}

/** "Restart to update" while Deer's updater has a new version waiting (VitreUpdater phase 'ready'). */
function updateRow(b: Browser): MenuCommand | null {
  try {
    const up = b.sys('VitreUpdater');
    if (up.state().phase !== 'ready') return null;
    return item('Restart to update', 'reload', '', 'U', () => void up.restartToUpdate());
  } catch {
    return null;
  }
}

/** The + circle: routes for the page-first keys a page could keep (Ctrl+J, Ctrl+comma) and F11; Restart to update while an update waits. */
export function plusRows(b: Browser): MenuItem[] {
  const peek = peekService(b);
  let reopen: MenuCommand;
  // Reads what comes back next: a warm peek, a tab, or a window; greyed when nothing would.
  if (peek && safeBool(() => (peek as any).canReopen?.())) {
    reopen = item('Reopen closed peek', '', 'Ctrl+Shift+T', 'R', () => (peekService(b) as any)?.reopen?.());
  } else if (b.closedCount() > 0) {
    reopen = item('Reopen closed tab', '', 'Ctrl+Shift+T', 'R', () => b.run('reopenClosed'));
  } else if (closedWindows() > 0) {
    reopen = item('Reopen closed window', '', 'Ctrl+Shift+T', 'R', () => b.run('reopenClosed'));
  } else {
    reopen = item('Reopen closed tab', '', 'Ctrl+Shift+T', 'R', () => undefined, { disabled: true });
  }
  return tidy([
    item('New window', 'newwindow', 'Ctrl+N', 'W', () => b.run('newWindow')),
    item('New private window', 'newwindow', 'Ctrl+Shift+N', 'P', () => b.run('newPrivateWindow')),
    reopen,
    SEP,
    downloadsService(b) ? item('Show downloads', 'download', 'Ctrl+J', 'S', () => downloadsService(b)?.openPanel()) : null,
    item('Full screen', '', 'F11', 'F', () => b.run('fullscreen'), { checked: !!window.fullScreen }),
    // Opens the panel (Ctrl+, toggles it; a menu row never closes it).
    settingsService(b) ? item('Settings', '', 'Ctrl+,', 'E', () => settingsService(b)?.open()) : null,
    SEP,
    updateRow(b),
  ]);
}

function safeBool(fn: () => unknown): boolean {
  try {
    return !!fn();
  } catch {
    return false;
  }
}

export const isTextField = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  !!el && (el.localName === 'textarea' || (el.localName === 'input' && /^(text|search|url|email|password|tel|number|)$/.test((el as HTMLInputElement).type || '')));

/**
 * A Deer text field (the address field, find, a settings search). Commands go to the field, which
 * keeps focus while the menu is open (goDoCommand on the focused element).
 */
export function fieldRows(b: Browser, field: HTMLInputElement | HTMLTextAreaElement, isAddress: boolean): MenuItem[] {
  const edit = (cmd: string) => () => {
    if (document.activeElement !== field) field.focus();
    gecko.doCommand(cmd);
  };
  const selected = (field.selectionEnd ?? 0) > (field.selectionStart ?? 0);
  const secret = field.localName === 'input' && (field as HTMLInputElement).type === 'password';
  const canPaste = !field.readOnly && !!gecko.clipboardText();
  const go = isAddress
    ? pasteAndGo((url) => {
        const t = b.active();
        b.omni.close(false);
        if (t) b.navigate(t, url);
      }, '')
    : null;
  return tidy([
    item('Undo', 'undo', 'Ctrl+Z', 'U', edit('cmd_undo'), { disabled: field.readOnly || !gecko.commandEnabled('cmd_undo') }),
    isAddress ? null : item('Redo', 'redo', 'Ctrl+Y', 'R', edit('cmd_redo'), { disabled: field.readOnly || !gecko.commandEnabled('cmd_redo') }),
    SEP,
    item('Cut', 'cut', 'Ctrl+X', 'T', edit('cmd_cut'), { disabled: !selected || secret || field.readOnly }),
    item('Copy', 'copy', 'Ctrl+C', 'C', edit('cmd_copy'), { disabled: !selected || secret }),
    item('Paste', 'paste', 'Ctrl+V', 'P', edit('cmd_paste'), { disabled: !canPaste }),
    go,
    item('Select all', '', 'Ctrl+A', 'A', edit('cmd_selectAll'), { disabled: !field.value }),
  ]);
}
