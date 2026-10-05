// Page menus: which menu a right-click gets (first match wins) and every item list, built from
// Firefox's context data (gContextMenu, an nsContextMenu) instead of Electron's 'context-menu'
// params. DESIGN-NOTES "Which menu" and "Item lists", CtxMenu.dc.html; ported from
// app/src/renderer/modules/menus/page-items.ts.
//
// Actions that belong to another module go through its service (peek.open, downloads.download /
// videoPicker, find.open, settings.open) and the row is left out when that service is missing.
// Page-derived URLs load through b.openLink with the page's principals (nsContextMenu.
// _openLinkInParameters), never with the system principal.
import type { Browser, OpenRequest } from '../../browser';
import type { DownloadOptions } from '../downloads/index';
import * as fx from '../../firefox';
import type { Tab } from '../../model';
import { isHomeUrl, looksLikeAddress, resolveInput, searchUrl } from '../../../shared/url';
import * as gecko from './gecko';
import { downloadsService, findService, peekService, settingsService } from './services';
import { item, SEP, tidy, type MenuCommand, type MenuItem } from './types';
import { literal, rowFits } from './view';

export type PageKind = 'misspelled' | 'editable' | 'media' | 'imagelink' | 'link' | 'image' | 'selection' | 'page' | 'home';

export interface PageEnv {
  b: Browser;
  /** The nsContextMenu Firefox built for this click (alive until the menu's teardown). */
  cm: any;
  browser: XULBrowser;
  /** Undefined when the page is a peek rather than a tab. */
  tab: Tab | undefined;
  inPeek: boolean;
  /** Window rectangles, filled in when the page module's record arrives (a few ms after opening). */
  linkRects: DOMRect[];
  selectionRect: DOMRect | null;
  targetRect: DOMRect | null;
  /** The chosen row's icon centre in window coordinates (a download flies from there). */
  from: () => { x: number; y: number } | null;
  /** Where the click fell relative to the selection (null: unknown, the selection counts). */
  hit?: SelectionHit | null;
}

/** Links to these download rather than open, so their menu keeps only the download rows. */
const FILE_EXT = /\.(zip|rar|7z|gz|tgz|bz2|xz|tar|zst|exe|msi|msix|msixbundle|appx|appxbundle|dmg|pkg|iso|img|apk|deb|rpm|torrent)$/i;

/** Peek shows web pages; other addresses never get a Peek row (Electron rule, kept). */
export const peekable = (url: string): boolean => /^https?:/i.test(url);

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/**
 * Where the right-click fell relative to the page's selection (the page module's menus:hit, sent
 * just before Firefox builds its menu). Null when it did not come: the selection then counts.
 */
export interface SelectionHit {
  inSelection: boolean;
  linkSelected: boolean;
}

/** Which menu (DESIGN-NOTES "Which menu", first match wins; chrome elements are handled before). */
export function kindOf(cm: any, home: boolean, hit: SelectionHit | null = null): PageKind {
  const editable = !!(cm.onTextInput || cm.onEditable || cm.isDesignMode);
  if (editable && gecko.spelling(cm)) return 'misspelled';
  if (editable) return 'editable';
  if (cm.onVideo || cm.onAudio) return 'media';
  const link = !!cm.onLink && !!cm.linkURL && cm.linkProtocol !== 'javascript';
  if (link && (cm.onImage || cm.onCanvas)) return 'imagelink';
  if (link) return 'link';
  if (cm.onImage || cm.onCanvas) return 'image';
  if (home) return 'home';
  // Gecko keeps the selection on a right-click elsewhere: only a click on it gets its menu.
  if (cm.isTextSelected && (!hit || hit.inSelection)) return 'selection';
  return 'page';
}

/** New tabs from a page open next to it. */
function nextTo(env: PageEnv): number | undefined {
  const i = env.tab ? env.b.tabs.indexOf(env.tab) : -1;
  return i >= 0 ? i + 1 : undefined;
}

/** Open as tab is rebindable (Settings › Keyboard shortcuts); menus print the current key. */
export const openAsTabKey = (b: Browser): string => b.settings.rebind?.openAsTab || 'Alt+Enter';

const devtoolsAllowed = (): boolean => !gecko.devtoolsDisabled();

function inspect(env: PageEnv): MenuCommand | null {
  if (!devtoolsAllowed()) return null;
  return item('Inspect', 'inspect', '', 'N', () => {
    // DevTools selects the tab it inspects: a peek becomes a tab first (pagefeatures correction 11).
    if (env.inPeek) safe(() => peekService(env.b)?.promote(), undefined);
    gecko.inspect(env.browser, env.cm.targetIdentifier);
  });
}

/** The smallest rectangle around a set of rectangles (a wrapped link's line boxes). */
export function union(rects: DOMRect[]): DOMRect | null {
  if (!rects.length) return null;
  const l = Math.min(...rects.map((r) => r.left));
  const t = Math.min(...rects.map((r) => r.top));
  const r = Math.max(...rects.map((x) => x.right));
  const btm = Math.max(...rects.map((x) => x.bottom));
  return new DOMRect(l, t, r - l, btm - t);
}

/** Quoted text: the first line, at most `max` (24) characters plus an ellipsis, in curly quotes. */
export function quote(text: string, max = 24): string {
  let q = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  q = q.replace(/\s+/g, ' ').trim();
  if (q.length > max) q = `${q.slice(0, max).trimEnd()}…`;
  return `“${q}”`;
}

/** The longest quote (24 characters at most) that leaves “Find … on page” uncut at the widest menu. */
function fittedQuote(text: string): string {
  for (let n = 24; n > 8; n--) {
    const q = quote(text, n);
    if (rowFits(`Find ${q} on page`, 'Ctrl+F')) return q;
  }
  return quote(text, 8);
}

/** The page's load data for a URL it shows, as an OpenRequest (Peek, downloads). */
function requestFor(env: PageEnv, url: string, disposition: OpenRequest['disposition'] = 'foreground-tab'): OpenRequest {
  const p = gecko.linkParams(env.cm);
  return {
    url,
    disposition,
    source: 'click',
    opener: env.tab,
    browser: env.browser,
    click: {
      href: url,
      triggeringPrincipal: p.triggeringPrincipal,
      originPrincipal: p.originPrincipal,
      originStoragePrincipal: p.originStoragePrincipal,
      referrerInfo: p.referrerInfo,
      policyContainer: p.policyContainer,
      originAttributes: { userContextId: env.cm.contentData?.userContextId ?? 0 },
    },
  };
}

/** Load a page-derived URL in a new tab next to the page, with the page's principals. */
function openTab(env: PageEnv, url: string, background = true): void {
  const p = gecko.linkParams(env.cm);
  env.b.openLink(url, 'tab', {
    background,
    index: nextTo(env),
    triggeringPrincipal: p.triggeringPrincipal,
    originPrincipal: p.originPrincipal,
    originStoragePrincipal: p.originStoragePrincipal,
    referrerInfo: p.referrerInfo,
    policyContainer: p.policyContainer,
    userContextId: env.cm.contentData?.userContextId,
  });
}

function openWindow(env: PageEnv, url: string): void {
  const p = gecko.linkParams(env.cm);
  env.b.openLink(url, 'window', {
    triggeringPrincipal: p.triggeringPrincipal,
    originPrincipal: p.originPrincipal,
    originStoragePrincipal: p.originStoragePrincipal,
    referrerInfo: p.referrerInfo,
    policyContainer: p.policyContainer,
    userContextId: env.cm.contentData?.userContextId,
    private: env.b.isPrivate,
  });
}

/**
 * Hand a URL the page shows to the downloader (Deer's engine) as Firefox's Save Link As would fetch
 * it: the page's principal, the link's (or page's) referrer info and the page's cookie jar
 * (nsContextMenu.sys.mjs saveLink / saveMedia -> saveHelper).
 */
function download(env: PageEnv, url: string, extra: { filename?: string; saveAs?: boolean; referrerInfo?: unknown; triggeringPrincipal?: unknown } = {}): void {
  const api = downloadsService(env.b);
  if (!api) return;
  const cm = env.cm;
  const opts: DownloadOptions = {
    browser: env.browser,
    referrerInfo: extra.referrerInfo ?? (cm.onLink ? gecko.linkReferrerInfo(cm) : gecko.pageReferrerInfo(cm)),
    triggeringPrincipal: extra.triggeringPrincipal ?? gecko.pagePrincipal(cm),
    // Additions of the downloads service: where the glass file circle flies from, privacy, the page's cookie jar.
    origin: env.from() ?? undefined,
    isPrivate: gecko.isPrivateBrowser(env.browser),
    cookieJarSettings: gecko.pageCookieJar(cm),
  };
  if (extra.filename) opts.filename = extra.filename;
  if (extra.saveAs) opts.saveAs = true;
  api.download(url, opts);
}

function editRows(env: PageEnv, opts: { undo: boolean }): (MenuItem | null)[] {
  const cm = env.cm;
  const en = gecko.commandEnabled;
  const pw = !!cm.onPassword;
  const run = (id: string) => () => gecko.doCommand(id);
  const rich = !!(cm.isDesignMode || (cm.onEditable && !cm.onTextInput));
  return [
    opts.undo ? item('Undo', 'undo', 'Ctrl+Z', 'U', run('cmd_undo'), { disabled: !en('cmd_undo') }) : null,
    opts.undo ? item('Redo', 'redo', 'Ctrl+Y', 'R', run('cmd_redo'), { disabled: !en('cmd_redo') }) : null,
    opts.undo ? SEP : null,
    item('Cut', 'cut', 'Ctrl+X', 'T', run('cmd_cut'), { disabled: pw || !en('cmd_cut') }),
    item('Copy', 'copy', 'Ctrl+C', 'C', run('cmd_copy'), { disabled: pw || !en('cmd_copy') }),
    item('Paste', 'paste', 'Ctrl+V', 'P', run('cmd_paste'), { disabled: !en('cmd_paste') }),
    opts.undo && rich && gecko.clipboardHasHtml() ? item('Paste as plain text', '', 'Ctrl+Shift+V', 'L', run('cmd_pasteNoFormatting'), { disabled: !en('cmd_paste') }) : null,
    item('Select all', '', 'Ctrl+A', 'A', run('cmd_selectAll'), { disabled: !en('cmd_selectAll') }),
  ];
}

function pageRows(env: PageEnv): MenuItem[] {
  const { b, browser } = env;
  const nav = [
    item('Back', 'back', 'Alt+Left', 'B', () => browser.goBack(), { disabled: !safe(() => browser.canGoBack, false) }),
    item('Forward', 'forward', 'Alt+Right', 'F', () => browser.goForward(), { disabled: !safe(() => browser.canGoForward, false) }),
    item('Reload', 'reload', 'Ctrl+R', 'R', () => fx.reload(browser)),
  ];
  const finder = findService(b);
  const find = finder ? item('Find on page…', 'find', 'Ctrl+F', 'I', () => findService(b)?.open({ browser })) : null;
  const print = item('Print…', 'print', 'Ctrl+P', 'P', () => fx.print(browser));
  if (env.inPeek) {
    // The page inside a peek, starting with Open as tab.
    const peek = peekService(b);
    return tidy([
      peek ? item('Open as tab', 'opentab', openAsTabKey(b), 'T', () => peekService(b)?.promote()) : null,
      item('Copy address', 'link', '', 'A', () => gecko.copyText(browser.currentURI.spec)),
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
    item('Save page as…', 'download', 'Ctrl+S', 'A', () => fx.savePage(browser)),
    SEP,
    item('View page source', '', 'Ctrl+U', 'V', () => fx.viewSource(browser)),
    inspect(env),
  ]);
}

function isFileLink(cm: any, url: string): boolean {
  if (gecko.linkDownloadName(cm)) return true;
  try {
    return FILE_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** The link rows; `withInspect` false when image rows follow. */
function linkRows(env: PageEnv, withInspect: boolean): MenuItem[] {
  const { b, cm } = env;
  const url: string = cm.linkURL;
  const ins = withInspect ? inspect(env) : null;
  if (cm.linkProtocol === 'mailto') return tidy([item('Copy email address', 'copy', '', 'E', () => gecko.copyEmail(cm)), SEP, ins]);
  if (cm.linkProtocol === 'tel') return tidy([item('Copy phone number', 'copy', '', 'E', () => gecko.copyPhone(cm)), SEP, ins]);
  // Copy only for a selection inside the link (DESIGN-NOTES Link), not one elsewhere on the page.
  const copySelection = cm.isTextSelected && (!env.hit || env.hit.linkSelected) ? item('Copy', 'copy', 'Ctrl+C', 'C', () => gecko.doCommand('cmd_copy')) : null;
  const copyLink = item('Copy link address', 'link', '', 'E', () => gecko.copyLink(cm));
  const dl =
    downloadsService(b) && gecko.saveableLink(cm)
      ? item('Download linked file', 'download', '', 'D', () => download(env, url, { filename: gecko.linkDownloadName(cm) || undefined, referrerInfo: gecko.linkReferrerInfo(cm) }))
      : null;
  if (isFileLink(cm, url)) return tidy([dl, copySelection, copyLink, SEP, ins]);
  // Shift+click is printed beside whichever of Peek and new window it does (Settings › Keyboard).
  const peek = !env.inPeek && peekable(url) ? peekService(b) : null;
  const shiftPeeks = b.settings.shiftClick !== 'window' && !!peekService(b);
  return tidy([
    item('Open link in new tab', 'newtab', '', 'T', () => openTab(env, url)),
    peek
      ? item('Peek link', 'peek', shiftPeeks ? 'Shift+click' : '', 'P', () => {
          const origin = union(env.linkRects) ?? env.targetRect;
          peekService(b)?.open(requestFor(env, url), origin ? { origin } : {});
        })
      : null,
    item('Open link in new window', 'newwindow', !shiftPeeks && !env.inPeek ? 'Shift+click' : '', 'W', () => openWindow(env, url)),
    SEP,
    copySelection,
    copyLink,
    dl,
    SEP,
    ins,
  ]);
}

function saveImage(env: PageEnv): void {
  const cm = env.cm;
  if (cm.onCanvas) {
    // The canvas as a blob: URL made by the page's own process (ContextMenu:Canvas:ToBlobURL).
    void gecko
      .canvasBlobURL(cm)
      .then((url) => {
        if (url) download(env, url, { filename: 'canvas.png', saveAs: true, triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
      })
      .catch((e) => console.error('Deer: canvas save failed', e));
    return;
  }
  download(env, cm.mediaURL, { saveAs: true, referrerInfo: gecko.pageReferrerInfo(cm) });
}

function imageRows(env: PageEnv, inLink: boolean): MenuItem[] {
  const { b, cm } = env;
  const src: string = cm.mediaURL || '';
  const save = downloadsService(b) ? item('Save image as…', 'download', '', 'V', () => saveImage(env)) : null;
  const copy = item('Copy image', 'copy', '', 'Y', () => (cm.onCanvas ? gecko.copyCanvasImage(cm) : gecko.doCommand('cmd_copyImage')));
  if (cm.onCanvas || !src) return tidy([save, copy]);
  const open = item('Open image in new tab', 'image', '', 'I', () => gecko.viewMedia(cm));
  if (inLink) return tidy([open, save, copy]);
  const peek = !env.inPeek && peekable(src) ? peekService(b) : null;
  return tidy([
    open,
    peek
      ? item('Peek image', 'peek', '', 'P', () => {
          const origin = env.targetRect;
          peekService(b)?.open(requestFor(env, src), origin ? { origin } : {});
        })
      : null,
    SEP,
    save,
    copy,
    item('Copy image address', 'link', '', 'O', () => gecko.copyMediaLocation(cm)),
  ]);
}

function selectionRows(env: PageEnv): MenuItem[] {
  const { b, cm } = env;
  const text = String(cm.selectionInfo?.fullText || cm.selectedText || '').trim();
  const q = literal(fittedQuote(text));
  const address = !/\s/.test(text) && looksLikeAddress(text);
  const finder = findService(b);
  const search = (): void => {
    const url = searchUrl(text);
    const peek = peekService(b);
    // Inside a peek peeks don't nest: the search opens a new tab.
    if (env.tab && !env.inPeek && b.settings.selectionSearchOpens === 'peek' && peek) {
      const origin = env.selectionRect;
      peek.open(url, origin ? { origin } : {});
    } else {
      b.newTab(url, { index: nextTo(env) });
    }
  };
  return tidy([
    item('Copy', 'copy', 'Ctrl+C', 'C', () => gecko.doCommand('cmd_copy')),
    SEP,
    address ? item(`Go to ${q.slice(1, -1)}`, 'newtab', '', 'G', () => openTab(env, resolveInput(text), false)) : item(`Search for ${q}`, 'search', '', 'S', search),
    // Find seeds its field from this text and starts on the selected occurrence.
    finder ? item(`Find ${q} on page`, 'find', 'Ctrl+F', 'I', () => findService(b)?.open({ query: text.split(/\r?\n/)[0].slice(0, 120), browser: env.browser })) : null,
    SEP,
    inspect(env),
  ]);
}

function mediaRows(env: PageEnv): MenuItem[] {
  const { b, cm } = env;
  const t = cm.target ?? {};
  const video = !!cm.onVideo;
  const drm = !!cm.onDRMMedia;
  const src: string = cm.mediaURL || '';
  const dl = downloadsService(b);
  const verb = (v: string) => () => gecko.mediaCommand(cm, v);
  const paused = !!(t.paused || t.ended);
  // A page-made source (blob:, MSE): no address to copy or fetch from outside the page.
  const noAddress = !src || /^(blob|mediasource):/i.test(src);
  const pip = gecko.inPictureInPicture(cm);
  const pipAllowed = video && gecko.pipEnabled() && Number(t.readyState) > 0;
  return tidy([
    paused ? item('Play', 'play', '', 'P', verb('play')) : item('Pause', 'pause', '', 'P', verb('pause')),
    t.muted ? item('Unmute', 'unmute', '', 'M', verb('unmute')) : item('Mute', 'mute', '', 'M', verb('mute')),
    item('Loop', '', '', 'L', verb('loop'), { checked: !!t.loop }),
    item('Show controls', '', '', 'C', verb(t.controls ? 'hidecontrols' : 'showcontrols'), { checked: !!t.controls }),
    video ? item('Picture in picture', '', '', 'I', verb('pictureinpicture'), { checked: pip, disabled: !pipAllowed && !pip }) : null,
    SEP,
    // DRM-protected media is never downloadable: the row stays, disabled, with the reason.
    dl
      ? video
        ? item('Download video…', 'download', drm ? 'Protected' : 'Ctrl+Shift+D', 'D', () => downloadsService(b)?.videoPicker(), { disabled: drm })
        : item('Download audio', 'download', drm ? 'Protected' : '', 'D', () => download(env, src), { disabled: drm || noAddress })
      : null,
    // Not for blob: or MSE sources (DESIGN-NOTES Video; Electron's noAddress): a page-made address
    // means nothing outside the page.
    !noAddress && !drm ? item(video ? 'Copy video address' : 'Copy audio address', 'link', '', 'O', () => gecko.copyMediaLocation(cm)) : null,
    SEP,
    inspect(env),
  ]);
}

/** Home's background is a video that plays: Home is an in-process page (src/pages/home), read directly. */
function homeVideo(env: PageEnv): HTMLVideoElement | null {
  try {
    const doc = env.browser.contentDocument;
    return (doc?.querySelector('video') as HTMLVideoElement | null) ?? null;
  } catch {
    return null;
  }
}

/** Paste and go (an address) or Paste and search (anything else); null with no text to paste. */
export function pasteAndGo(go: (url: string) => void, icon = 'paste'): MenuCommand | null {
  const text = gecko.clipboardText().trim().slice(0, 4096);
  if (!text) return null;
  const run = (): void => go(resolveInput(text));
  return looksLikeAddress(text) ? item('Paste and go', icon, '', 'G', run) : item('Paste and search', icon, '', 'S', run);
}

/** The Home wallpaper (MenuChrome, "Home"). No Inspect here. */
function homeRows(env: PageEnv): MenuItem[] {
  const { b } = env;
  const settings = settingsService(b);
  const video = homeVideo(env);
  const tab = env.tab;
  return tidy([
    pasteAndGo((url) => (tab ? b.navigate(tab, url) : undefined)),
    SEP,
    // Home's Background popover (MenuChrome); a settings module without it opens Home and background.
    settings
      ? item('Change background…', 'image', '', 'B', () => {
          const s = settingsService(b);
          if (typeof s?.changeBackground === 'function') s.changeBackground();
          else s?.open('home');
        })
      : null,
    video ? item(video.paused ? 'Play background' : 'Pause background', video.paused ? 'play' : 'pause', '', 'P', () => (video.paused ? void video.play().catch(() => undefined) : video.pause())) : null,
    item('Show tab bar', '', '', 'T', () => b.sys('VitreSettings').set({ barAutoHide: !b.settings.barAutoHide }), { checked: !b.settings.barAutoHide }),
    SEP,
    settings ? item('Settings', '', 'Ctrl+,', 'E', () => settingsService(b)?.open()) : null,
  ]);
}

/** The rows for this click, before extension items are added. */
export function pageMenu(env: PageEnv, kind: PageKind): MenuItem[] {
  const { cm } = env;
  switch (kind) {
    case 'misspelled': {
      const sp = gecko.spelling(cm) ?? { word: '', suggestions: [] };
      return tidy([
        ...sp.suggestions.slice(0, 3).map((s) => item(literal(s), '', '', '', () => gecko.replaceMisspelling(s), { bold: true, access: '' })),
        item('Add to dictionary', '', '', 'D', () => gecko.addToDictionary()),
        SEP,
        ...editRows(env, { undo: false }),
        SEP,
        inspect(env),
      ]);
    }
    case 'editable':
      return tidy([...editRows(env, { undo: true }), SEP, inspect(env)]);
    case 'media':
      return mediaRows(env);
    case 'imagelink':
      return tidy([...linkRows(env, false), SEP, ...imageRows(env, true), SEP, inspect(env)]);
    case 'link':
      return linkRows(env, true);
    case 'image':
      return tidy([...imageRows(env, false), SEP, inspect(env)]);
    case 'selection':
      return selectionRows(env);
    case 'home':
      return homeRows(env);
    default:
      return pageRows(env);
  }
}

/** Home (about:vitre-home) in a tab. */
export const isHome = (browser: XULBrowser, tab: Tab | undefined): boolean => (tab ? tab.kind === 'home' : safe(() => isHomeUrl(browser.currentURI.spec), false));

/** Extension items (ext-menus.js nodes) as menu rows; a <menu> becomes a submenu. */
export function extensionRows(nodes: gecko.ExtNode[]): MenuItem[] {
  const rows: MenuItem[] = [];
  for (const n of nodes) {
    if (n.kind === 'separator') {
      rows.push(SEP);
      continue;
    }
    // ext-menus.js already turned the extension's '&' markers into the accesskey attribute.
    const base: MenuCommand = { label: literal(n.label), access: n.access, disabled: n.disabled };
    if (n.image) base.icon = n.image;
    if (n.kind === 'menu') {
      rows.push({ ...base, submenu: extensionRows(n.children) });
    } else {
      if (n.type === 'checkbox' || n.type === 'radio') base.checked = n.checked;
      const node = n.node;
      base.run = () => gecko.runExtensionNode(node);
      rows.push(base);
    }
  }
  return tidy(rows);
}

/** Extension rows go just before the final Inspect group (or at the end), set off by separators. */
export function withExtensions(rows: MenuItem[], ext: MenuItem[]): MenuItem[] {
  if (!ext.length) return rows;
  const last = rows[rows.length - 1];
  if (last && 'label' in last && last.label === 'Inspect') return tidy([...rows.slice(0, -1), SEP, ...ext, SEP, last]);
  return tidy([...rows, SEP, ...ext]);
}
