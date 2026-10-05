// Page menus: which menu a right-click gets (first match wins) and every item list, from the
// 'context-menu' params (DESIGN-NOTES "Which menu" and "Item lists", CtxMenu.dc.html).
import type { WebviewTag } from 'electron';
import type { Browser } from '../../app';
import type { Tab } from '../../model';
import { looksLikeAddress, resolveInput, searchUrl } from '../../url';
import type { MenuOpenPayload } from '../../../main/modules/menus';
import { act, canPeek, copyText, download, openAsTabKey, peek, peekable, peekApi, plainAddress, quote, union } from './actions';
import { item, SEP, tidy, type MenuItem, type MenuRow } from './types';
import { rowFits } from './view';

export type PageKind = 'misspelled' | 'editable' | 'media' | 'imagelink' | 'link' | 'image' | 'selection' | 'page';

export interface PageEnv {
  b: Browser;
  p: MenuOpenPayload;
  wv: WebviewTag;
  /** Undefined when the page is a peek rather than a tab. */
  tab: Tab | undefined;
  /** Window rectangles Peek grows from: the link's line boxes, the selection, the element. */
  linkRects: DOMRect[];
  selectionRect: DOMRect | null;
  targetRect: DOMRect | null;
}

/** Links to these download rather than open, so their menu keeps only the download rows. */
const FILE_EXT = /\.(zip|rar|7z|gz|tgz|bz2|xz|tar|zst|exe|msi|msix|msixbundle|appx|appxbundle|dmg|pkg|iso|img|apk|deb|rpm|torrent)$/i;

// Chromium hands javascript: links over as about:blank#blocked; both get the page menu.
const usableLink = (url: string) => !!url && !/^javascript:/i.test(url) && url !== 'about:blank#blocked';

export function kindOf(p: MenuOpenPayload): PageKind {
  const link = usableLink(p.linkURL);
  if (p.isEditable && p.misspelledWord) return 'misspelled';
  if (p.isEditable) return 'editable';
  if (p.mediaType === 'video' || p.mediaType === 'audio') return 'media';
  if (link && p.mediaType === 'image') return 'imagelink';
  if (link) return 'link';
  if (p.mediaType === 'image' || p.mediaType === 'canvas') return 'image';
  if (p.selectionText.trim()) return 'selection';
  return 'page';
}

const safe = (fn: () => boolean): boolean => {
  try {
    return fn();
  } catch {
    return false;
  }
};

function inspect({ wv, p }: PageEnv): MenuItem {
  return item('Inspect', 'inspect', '', 'N', () => wv.inspectElement(Math.round(p.x), Math.round(p.y)));
}

/** New tabs from a page open next to it. */
function nextTo(env: PageEnv): number | undefined {
  const i = env.tab ? env.b.tabs.indexOf(env.tab) : -1;
  return i >= 0 ? i + 1 : undefined;
}

function editRows({ wv, p }: PageEnv, opts: { undo: boolean }): (MenuRow | null)[] {
  const e = p.edit;
  const pw = p.isPassword;
  return [
    opts.undo ? item('Undo', 'undo', 'Ctrl+Z', 'U', () => wv.undo(), { disabled: !e.canUndo }) : null,
    opts.undo ? item('Redo', 'redo', 'Ctrl+Y', 'R', () => wv.redo(), { disabled: !e.canRedo }) : null,
    opts.undo ? SEP : null,
    item('Cut', 'cut', 'Ctrl+X', 'T', () => wv.cut(), { disabled: pw || !e.canCut }),
    item('Copy', 'copy', 'Ctrl+C', 'C', () => wv.copy(), { disabled: pw || !e.canCopy }),
    item('Paste', 'paste', 'Ctrl+V', 'P', () => wv.paste(), { disabled: !e.canPaste }),
    opts.undo && e.canEditRichly && p.clipboardHtml ? item('Paste as plain text', '', 'Ctrl+Shift+V', 'L', () => wv.pasteAndMatchStyle(), { disabled: !e.canPaste }) : null,
    item('Select all', '', 'Ctrl+A', 'A', () => wv.selectAll(), { disabled: !e.canSelectAll }),
  ];
}

function pageRows(env: PageEnv): MenuRow[] {
  const { b, p, wv, tab } = env;
  const nav = [
    item('Back', 'back', 'Alt+Left', 'B', () => wv.goBack(), { disabled: !safe(() => wv.canGoBack()) }),
    item('Forward', 'forward', 'Alt+Right', 'F', () => wv.goForward(), { disabled: !safe(() => wv.canGoForward()) }),
    item('Reload', 'reload', 'Ctrl+R', 'R', () => (tab && tab.id === b.activeId ? b.run('reload') : wv.reload())),
  ];
  const find = item('Find on page…', 'find', 'Ctrl+F', 'I', () => b.run('find'));
  const print = item('Print…', 'print', 'Ctrl+P', 'P', () => void wv.print().catch(() => undefined));
  if (!tab) {
    // The page inside a peek, starting with Open as tab.
    const api = peekApi();
    return tidy([
      api && api.webview() === wv ? item('Open as tab', 'opentab', openAsTabKey(b), 'T', () => api.promote()) : null,
      item('Copy address', 'link', '', 'A', () => copyText(p.pageURL)),
      SEP,
      ...nav,
      SEP,
      find,
      print,
      SEP,
      inspect(env),
    ]);
  }
  return tidy([
    ...nav,
    SEP,
    find,
    print,
    item('Save page as…', 'download', 'Ctrl+S', 'A', () => window.vitre.savePage(p.wcId)),
    SEP,
    item('View page source', '', 'Ctrl+U', 'V', () => b.newTab(`view-source:${p.pageURL}`, { index: nextTo(env) })),
    inspect(env),
  ]);
}

function isFileLink(p: MenuOpenPayload): boolean {
  if (p.page?.download) return true;
  try {
    return FILE_EXT.test(new URL(p.linkURL).pathname);
  } catch {
    return false;
  }
}

/** The link rows; `withInspect` false when image rows follow. */
function linkRows(env: PageEnv, withInspect: boolean): MenuRow[] {
  const { b, p, wv, tab } = env;
  const url = p.linkURL;
  const ins = withInspect ? inspect(env) : null;
  if (/^mailto:/i.test(url)) return tidy([item('Copy email address', 'copy', '', 'E', () => copyText(plainAddress(url))), SEP, ins]);
  if (/^tel:/i.test(url)) return tidy([item('Copy phone number', 'copy', '', 'E', () => copyText(plainAddress(url))), SEP, ins]);
  const copySelection = p.selectionText.trim() ? item('Copy', 'copy', 'Ctrl+C', 'C', () => wv.copy()) : null;
  const copyLink = item('Copy link address', 'link', '', 'E', () => copyText(url));
  const dl = item('Download linked file', 'download', '', 'D', (from) => download(p.wcId, url, p.pageURL, from));
  if (isFileLink(p)) return tidy([dl, copySelection, copyLink, SEP, ins]);
  // Shift+click is printed beside whichever of Peek and new window it does (Settings › Keyboard).
  const shiftPeeks = b.settings.shiftClick !== 'window';
  return tidy([
    item('Open link in new tab', 'newtab', '', 'T', () => b.newTab(url, { background: true, index: nextTo(env) })),
    tab && peekable(url) ? item('Peek link', 'peek', shiftPeeks && canPeek() ? 'Shift+click' : '', 'P', () => peek(b, url, union(env.linkRects) ?? env.targetRect)) : null,
    item('Open link in new window', 'newwindow', shiftPeeks ? '' : 'Shift+click', 'W', () => window.vitre.win.newWindow(url)),
    SEP,
    copySelection,
    copyLink,
    dl,
    SEP,
    ins,
  ]);
}

function imageRows(env: PageEnv, inLink: boolean): MenuRow[] {
  const { b, p, tab } = env;
  const src = p.srcURL;
  const save = item('Save image as…', 'download', '', 'V', (from) => {
    if (p.mediaType === 'canvas' || !src) void act({ op: 'saveCanvas', wcId: p.wcId });
    else download(p.wcId, src, p.pageURL, from);
  });
  const copy = item('Copy image', 'copy', '', 'Y', () => void act({ op: 'copyImage', wcId: p.wcId, x: p.x, y: p.y }));
  if (p.mediaType === 'canvas' || !src) return [save, copy];
  const open = item('Open image in new tab', 'image', '', 'I', () => b.newTab(src, { background: true, index: nextTo(env) }));
  if (inLink) return [open, save, copy];
  return tidy([
    open,
    tab && peekable(src) ? item('Peek image', 'peek', '', 'P', () => peek(b, src, env.targetRect)) : null,
    SEP,
    save,
    copy,
    item('Copy image address', 'link', '', 'O', () => copyText(src)),
  ]);
}

/** The longest quote (24 characters at most) that leaves “Find … on page” uncut at the widest menu. */
function fittedQuote(text: string): string {
  for (let n = 24; n > 8; n--) {
    const q = quote(text, n);
    if (rowFits(`Find ${q} on page`, 'Ctrl+F')) return q;
  }
  return quote(text, 8);
}

function selectionRows(env: PageEnv): MenuRow[] {
  const { b, p, wv, tab } = env;
  const text = p.selectionText.trim();
  const q = fittedQuote(text);
  const address = !/\s/.test(text) && looksLikeAddress(text);
  const search = () => {
    const url = searchUrl(text);
    // In a peek, peeks don't nest: the search opens a new tab.
    if (tab && b.settings.selectionSearchOpens === 'peek' && canPeek()) peek(b, url, env.selectionRect);
    else b.newTab(url, { index: nextTo(env) });
  };
  return tidy([
    item('Copy', 'copy', 'Ctrl+C', 'C', () => wv.copy()),
    SEP,
    address
      ? item(`Go to ${q.slice(1, -1)}`, 'newtab', '', 'G', () => b.newTab(resolveInput(text), { index: nextTo(env) }))
      : item(`Search for ${q}`, 'search', '', 'S', search),
    // Find seeds its field from the page's selection, which is this text.
    item(`Find ${q} on page`, 'find', 'Ctrl+F', 'I', () => b.run('find')),
    SEP,
    inspect(env),
  ]);
}

function mediaRows(env: PageEnv): MenuRow[] {
  const { b, p } = env;
  const m = p.media;
  const video = p.mediaType === 'video';
  const rec = p.page?.media;
  const noAddress = rec ? rec.noAddress : !p.srcURL || /^(blob|mediasource):/i.test(p.srcURL);
  const drm = !!rec?.drm;
  const verb = (v: 'play' | 'pause' | 'mute' | 'unmute' | 'loop' | 'controls' | 'pip') => () => void act({ op: 'media', wcId: p.wcId, verb: v });
  return tidy([
    m.isPaused ? item('Play', 'play', '', 'P', verb('play')) : item('Pause', 'pause', '', 'P', verb('pause')),
    m.isMuted ? item('Unmute', 'unmute', '', 'M', verb('unmute')) : item('Mute', 'mute', '', 'M', verb('mute')),
    item('Loop', '', '', 'L', verb('loop'), { checked: m.isLooping }),
    item('Show controls', '', '', 'C', verb('controls'), { checked: m.isControlsVisible, disabled: !m.canToggleControls }),
    video ? item('Picture in picture', '', '', 'I', verb('pip'), { checked: m.isShowingPictureInPicture, disabled: !m.canShowPictureInPicture }) : null,
    SEP,
    video
      ? item('Download video…', 'download', drm ? 'Protected' : 'Ctrl+Shift+D', 'D', () => b.run('downloadVideo'), { disabled: drm })
      : item('Download audio', 'download', '', 'D', (from) => download(p.wcId, p.srcURL, p.pageURL, from), { disabled: noAddress }),
    noAddress ? null : item(video ? 'Copy video address' : 'Copy audio address', 'link', '', 'O', () => copyText(p.srcURL)),
    SEP,
    inspect(env),
  ]);
}

export function pageMenu(env: PageEnv): { kind: PageKind; rows: MenuRow[] } {
  const kind = kindOf(env.p);
  const { p, wv } = env;
  switch (kind) {
    case 'misspelled':
      return {
        kind,
        rows: tidy([
          ...p.suggestions.slice(0, 3).map((s) => item(s, '', '', '', () => wv.replaceMisspelling(s), { bold: true })),
          item('Add to dictionary', '', '', 'D', () => void act({ op: 'addWord', wcId: p.wcId, word: p.misspelledWord })),
          SEP,
          ...editRows(env, { undo: false }),
          SEP,
          inspect(env),
        ]),
      };
    case 'editable':
      return { kind, rows: tidy([...editRows(env, { undo: true }), SEP, inspect(env)]) };
    case 'media':
      return { kind, rows: mediaRows(env) };
    case 'imagelink':
      return { kind, rows: tidy([...linkRows(env, false), SEP, ...imageRows(env, true), SEP, inspect(env)]) };
    case 'link':
      return { kind, rows: linkRows(env, true) };
    case 'image':
      return { kind, rows: tidy([...imageRows(env, false), SEP, inspect(env)]) };
    case 'selection':
      return { kind, rows: selectionRows(env) };
    default:
      return { kind, rows: pageRows(env) };
  }
}
