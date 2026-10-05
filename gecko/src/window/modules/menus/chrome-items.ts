// Menus for Deer's own surfaces: the active tab pill, a background tab circle, the + circle and
// Deer's text fields (MenuChrome.dc.html, DESIGN-NOTES item lists). Ported from
// app/src/renderer/modules/menus/chrome-items.ts. The Home wallpaper's menu is a page menu here
// (Home is a page in a tab: page-items.ts); the peek's header and the downloads ring are drawn by
// their modules, which show their rows through the 'menus' service.
import type { Browser } from '../../browser';
import type { Tab } from '../../model';
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
    muteRow(b, t),
    web ? moveRow(b, t) : null,
    SEP,
    item('Close other tabs', '', '', 'O', () => closeOthers(b, t), { disabled: b.tabs.length < 2 }),
    item('Close tab', 'close', 'Ctrl+W', 'C', () => b.closeTab(t)),
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
  return tidy([
    { caption: circleCaption(t) },
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
