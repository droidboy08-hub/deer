// Menus for Vitre's own surfaces: the tab pill, a background tab circle, the + circle, the peek's
// header, the Home wallpaper and Vitre's text fields (MenuChrome.dc.html, DESIGN-NOTES item lists).
import type { Browser } from '../../app';
import type { Tab } from '../../model';
import { displayHost, looksLikeAddress, resolveInput } from '../../url';
import type { ClipboardInfo } from '../../../main/modules/menus';
import { act, changeBackground, copyText, openAsTabKey, openSettings, type PeekLike } from './actions';
import { item, SEP, tidy, type MenuItem, type MenuRow } from './types';

export interface ChromeEnv {
  b: Browser;
  /** The clipboard when the menu opened: Paste and go needs text. */
  clip: ClipboardInfo;
  /** Tabs that have played sound get Mute tab. */
  audible(t: Tab): boolean;
}

const pasted = (clip: ClipboardInfo) => clip.text.trim().slice(0, 4096);

/** Paste and go (an address) or Paste and search (anything else); null with no text to paste. */
function pasteAndGo(clip: ClipboardInfo, go: (url: string) => void, icon: 'paste' | '' = 'paste'): MenuItem | null {
  const text = pasted(clip);
  if (!text) return null;
  const run = () => go(resolveInput(text));
  return looksLikeAddress(text) ? item('Paste and go', icon, '', 'G', run) : item('Paste and search', icon, '', 'S', run);
}

function duplicate(b: Browser, t: Tab): void {
  b.newTab(t.url, { index: b.tabs.indexOf(t) + 1 });
}

function moveToNewWindow(b: Browser, t: Tab): void {
  window.vitre.win.newWindow(t.url);
  b.closeTab(t.id);
}

/** A lone tab has nowhere to move from: the row greys out rather than closing this window. */
function moveRow(b: Browser, t: Tab): MenuItem {
  return item('Move tab to new window', 'newwindow', '', 'W', () => moveToNewWindow(b, t), { disabled: b.tabs.length < 2 });
}

function closeOthers(b: Browser, t: Tab): void {
  for (const other of [...b.tabs]) if (other.id !== t.id) b.closeTab(other.id);
  b.activate(t.id);
}

function muteRow(env: ChromeEnv, t: Tab): MenuItem | null {
  const wv = t.webview;
  if (!wv || !t.ready || !env.audible(t)) return null;
  let muted = false;
  try {
    muted = wv.isAudioMuted();
  } catch {
    return null;
  }
  return item(muted ? 'Unmute tab' : 'Mute tab', muted ? 'unmute' : 'mute', '', 'M', () => wv.setAudioMuted(!muted));
}

/** The active tab pill at rest. */
export function pillRows(env: ChromeEnv, t: Tab): MenuRow[] {
  const { b } = env;
  const web = t.kind === 'web' && !!t.url;
  return tidy([
    web ? item('Copy address', 'link', '', 'A', () => copyText(t.url)) : null,
    pasteAndGo(env.clip, (url) => b.navigate(t.id, url)),
    SEP,
    web ? item('Duplicate tab', '', '', 'D', () => duplicate(b, t)) : null,
    muteRow(env, t),
    web ? moveRow(b, t) : null,
    SEP,
    item('Close other tabs', '', '', 'O', () => closeOthers(b, t), { disabled: b.tabs.length < 2 }),
    item('Close tab', 'close', 'Ctrl+W', 'C', () => b.closeTab(t.id)),
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
export function circleRows(env: ChromeEnv, t: Tab): MenuRow[] {
  const { b } = env;
  const web = t.kind === 'web' && !!t.url;
  const wv = t.webview;
  return tidy([
    { type: 'caption', label: circleCaption(t) },
    SEP,
    web && wv && t.ready ? item('Reload tab', 'reload', '', 'R', () => wv.reload()) : null,
    web ? item('Duplicate tab', '', '', 'D', () => duplicate(b, t)) : null,
    web ? item('Copy address', 'link', '', 'A', () => copyText(t.url)) : null,
    muteRow(env, t),
    web ? moveRow(b, t) : null,
    SEP,
    item('Close other tabs', '', '', 'O', () => closeOthers(b, t), { disabled: b.tabs.length < 2 }),
    item('Close tab', 'close', '', 'C', () => b.closeTab(t.id)),
  ]);
}

/** The + circle: routes for the page-first keys a page could keep (Ctrl+J, Ctrl+comma) and F11. */
export function plusRows({ b }: ChromeEnv): MenuRow[] {
  return tidy([
    item('New window', 'newwindow', 'Ctrl+N', 'W', () => window.vitre.win.newWindow()),
    item('Reopen closed tab', '', 'Ctrl+Shift+T', 'R', () => b.run('reopenClosed'), { disabled: b.closedStack.length === 0 }),
    SEP,
    item('Show downloads', 'download', 'Ctrl+J', 'S', () => b.run('downloads')),
    item('Full screen', '', 'F11', 'F', () => b.run('fullscreen'), { checked: document.body.classList.contains('fullscreen') }),
    // Opens the panel (Ctrl+, toggles it; a menu row never closes it).
    item('Settings', '', 'Ctrl+,', 'E', openSettings),
  ]);
}

/** The open peek's header. */
export function peekHeaderRows({ b }: ChromeEnv, peek: PeekLike): MenuRow[] {
  let url = '';
  try {
    url = peek.webview()?.getURL() ?? '';
  } catch {
    /* not attached yet */
  }
  const web = /^https?:/i.test(url);
  return tidy([
    item('Open as tab', 'opentab', openAsTabKey(b), 'T', () => peek.promote()),
    web ? item('Copy address', 'link', '', 'A', () => copyText(url)) : null,
    web
      ? item('Open in new window', 'newwindow', '', 'W', () => {
          window.vitre.win.newWindow(url);
          peek.close();
        })
      : null,
    SEP,
    item('Close peek', 'close', 'Esc', 'C', () => void peek.close()),
  ]);
}

/** The Home wallpaper. No Inspect here. */
export function homeRows(env: ChromeEnv): MenuRow[] {
  const { b } = env;
  return tidy([
    pasteAndGo(env.clip, (url) => b.navigate(b.activeId, url)),
    SEP,
    item('Change background…', 'image', '', 'B', changeBackground),
    item('Show tab bar', '', '', 'T', () => window.vitre.settings.set({ barAutoHide: !b.settings.barAutoHide }), { checked: !b.settings.barAutoHide }),
    SEP,
    item('Settings', '', 'Ctrl+,', 'E', openSettings),
  ]);
}

/** A Vitre text field (the address field, find, settings search). Commands go to the focused field. */
export function fieldRows(env: ChromeEnv, field: HTMLInputElement | HTMLTextAreaElement, isAddress: boolean): MenuRow[] {
  const { b } = env;
  const edit = (cmd: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') => () => {
    field.focus();
    void act({ op: 'chromeEdit', cmd });
  };
  const selected = (field.selectionEnd ?? 0) > (field.selectionStart ?? 0);
  const secret = field instanceof HTMLInputElement && field.type === 'password';
  const canPaste = !!pasted(env.clip) && !field.readOnly;
  const go = isAddress
    ? pasteAndGo(env.clip, (url) => {
        b.navigate(b.activeId, url);
        b.omni.close();
      }, '')
    : null;
  return tidy([
    item('Undo', 'undo', 'Ctrl+Z', 'U', edit('undo'), { disabled: field.readOnly }),
    isAddress ? null : item('Redo', 'redo', 'Ctrl+Y', 'R', edit('redo'), { disabled: field.readOnly }),
    SEP,
    item('Cut', 'cut', 'Ctrl+X', 'T', edit('cut'), { disabled: !selected || secret || field.readOnly }),
    item('Copy', 'copy', 'Ctrl+C', 'C', edit('copy'), { disabled: !selected || secret }),
    item('Paste', 'paste', 'Ctrl+V', 'P', edit('paste'), { disabled: !canPaste }),
    go,
    item('Select all', '', 'Ctrl+A', 'A', edit('selectAll'), { disabled: !field.value }),
  ]);
}
