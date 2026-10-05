// Right-click menus, main side. Every page's 'context-menu' is forwarded to the window that hosts
// it (Vitre draws the menu itself, never Electron's native Menu), together with what the page
// preload recorded about the click. The verbs that need the main process run here: clipboard,
// copy image, the spelling dictionary, downloads, saving a canvas, media verbs with a user gesture
// and replaying a right-click that dismissed a menu. While a page's menu is open the page keeps OS
// focus (its selection stays lit); its keys are caught here and handed to the menu.
import { app, BrowserWindow, clipboard, dialog, ipcMain, webContents, type ContextMenuParams, type WebContents, type WebFrameMain } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { MainContext } from '../context';
import type { PageMenuRecord } from '../../preload/page-modules/menus';

export type MenuSource = 'mouse' | 'keyboard' | 'touch' | 'pen';
export type MediaVerb = 'play' | 'pause' | 'mute' | 'unmute' | 'loop' | 'controls' | 'pip';

/** What the window's renderer gets for a page menu (channel 'menu:open'). */
export interface MenuOpenPayload {
  wcId: number;
  /** Pointer or Blink anchor, in the guest's view coordinates (DIP). */
  x: number;
  y: number;
  source: MenuSource;
  linkURL: string;
  linkText: string;
  srcURL: string;
  pageURL: string;
  frameURL: string;
  isMainFrame: boolean;
  mediaType: ContextMenuParams['mediaType'];
  hasImageContents: boolean;
  isEditable: boolean;
  isPassword: boolean;
  selectionText: string;
  misspelledWord: string;
  suggestions: string[];
  edit: ContextMenuParams['editFlags'];
  media: ContextMenuParams['mediaFlags'];
  /** Rich text on the clipboard: Paste as plain text is offered. */
  clipboardHtml: boolean;
  /** The page preload's notes about the same click (link rectangles, focused element...). */
  page: PageMenuRecord | null;
  /** Assistive technology is running: the menu takes real focus instead of borrowing the page's keys. */
  a11y: boolean;
}

/** A key the page didn't get because its menu is open (channel 'menu:key'). */
export interface MenuKey {
  /** The page it was pressed in: with no menu open for it, the renderer hands its keys back. */
  wcId: number;
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
}

/** Requests from the renderer (channel 'menu:act'). Page verbs carry the guest's webContents id. */
export type MenuAct =
  | { op: 'copyText'; text: string }
  | { op: 'context' }
  | { op: 'chromeEdit'; cmd: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll' }
  | { op: 'copyImage'; wcId: number; x: number; y: number }
  | { op: 'addWord'; wcId: number; word: string }
  | { op: 'download'; wcId: number; url: string }
  | { op: 'saveCanvas'; wcId: number }
  | { op: 'media'; wcId: number; verb: MediaVerb }
  | { op: 'replay'; wcId: number; x: number; y: number; shift: boolean };

export interface ClipboardInfo {
  text: string;
  html: boolean;
}

/** What a menu for Vitre's own surfaces needs to know before it opens (op 'context'). */
export interface ChromeMenuContext {
  clip: ClipboardInfo;
  /** Assistive technology is running: menus take real focus. */
  a11y: boolean;
}

interface LastMenu {
  frame: WebFrameMain | null;
  x: number;
  y: number;
  srcURL: string;
  isMainFrame: boolean;
}

/** The page's record arrives over a separate pipe; wait this long for it before opening without. */
const RECORD_WAIT_MS = 60;
const RECORD_FRESH_MS = 1500;

const records = new Map<number, PageMenuRecord>();
/** Pages whose keys go to their open menu. */
const capturing = new Set<number>();
const waiters = new Map<number, () => void>();
const lastMenus = new Map<number, LastMenu>();

function sourceOf(t: ContextMenuParams['menuSourceType']): MenuSource {
  if (t === 'keyboard') return 'keyboard';
  if (t === 'stylus') return 'pen';
  if (t === 'touch' || t === 'touchMenu' || t === 'longPress' || t === 'longTap' || t === 'touchHandle') return 'touch';
  return 'mouse';
}

function freshRecord(wcId: number): PageMenuRecord | null {
  const r = records.get(wcId);
  return r && Date.now() - r.t < RECORD_FRESH_MS ? r : null;
}

async function recordFor(wcId: number, isMainFrame: boolean): Promise<PageMenuRecord | null> {
  // The preload runs only in the main frame, so a menu from a subframe never gets a record.
  if (!isMainFrame) return null;
  const r = freshRecord(wcId);
  if (r) return r;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, RECORD_WAIT_MS);
    function done(): void {
      clearTimeout(timer);
      waiters.delete(wcId);
      resolve();
    }
    waiters.set(wcId, done);
  });
  return freshRecord(wcId);
}

const hasHtml = (): Promise<boolean> => clipboard.has('text/html').catch(() => false);

async function forward(wc: WebContents, params: ContextMenuParams): Promise<void> {
  const host = wc.hostWebContents;
  if (!host || host.isDestroyed()) return;
  const frame = params.frame;
  const isMainFrame = !frame || frame.frameTreeNodeId === wc.mainFrame.frameTreeNodeId;
  lastMenus.set(wc.id, { frame, x: params.x, y: params.y, srcURL: params.srcURL, isMainFrame });
  const page = await recordFor(wc.id, isMainFrame);
  records.delete(wc.id);
  const payload: MenuOpenPayload = {
    wcId: wc.id,
    x: params.x,
    y: params.y,
    source: sourceOf(params.menuSourceType),
    linkURL: params.linkURL,
    linkText: params.linkText,
    srcURL: params.srcURL,
    pageURL: params.pageURL,
    frameURL: params.frameURL,
    isMainFrame,
    mediaType: params.mediaType,
    hasImageContents: params.hasImageContents,
    isEditable: params.isEditable,
    isPassword: params.formControlType === 'input-password',
    selectionText: params.selectionText,
    misspelledWord: params.misspelledWord,
    suggestions: params.dictionarySuggestions ?? [],
    edit: params.editFlags,
    media: params.mediaFlags,
    clipboardHtml: await hasHtml(),
    page,
    a11y: app.accessibilitySupportEnabled,
  };
  if (!host.isDestroyed()) host.send('menu:open', payload);
}

/** The guest named by a request, only if it belongs to the window that asked. */
function guestFor(sender: WebContents, wcId: unknown): WebContents | null {
  if (typeof wcId !== 'number' || !Number.isInteger(wcId)) return null;
  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed() || wc.hostWebContents?.id !== sender.id) return null;
  return wc;
}

function liveFrame(wcId: number): { frame: WebFrameMain; last: LastMenu } | null {
  const last = lastMenus.get(wcId);
  const frame = last?.frame;
  if (!last || !frame) return null;
  try {
    if (frame.isDestroyed()) return null;
  } catch {
    return null;
  }
  return { frame, last };
}

/**
 * Finds the element the menu was opened on, in the frame's own world. In the main frame the
 * point is exact (view DIP divided by the zoom); in a subframe the media source decides.
 */
function pickScript(selector: string, cls: string, point: { x: number; y: number } | null, src: string): string {
  return `(() => {
    const pt = ${JSON.stringify(point)};
    let el = null;
    if (pt) el = document.elementsFromPoint(pt.x, pt.y).find((e) => e instanceof ${cls}) || null;
    if (!el) {
      const all = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      const src = ${JSON.stringify(src)};
      el = all.find((e) => src && (e.currentSrc === src || e.src === src)) || (all.length === 1 ? all[0] : null);
    }
    return el;
  })()`;
}

function pointIn(wc: WebContents, last: LastMenu): { x: number; y: number } | null {
  if (!last.isMainFrame) return null;
  const z = wc.getZoomFactor() || 1;
  return { x: last.x / z, y: last.y / z };
}

const MEDIA_CODE: Record<MediaVerb, string> = {
  play: 'el.play().catch(() => {});',
  pause: 'el.pause();',
  mute: 'el.muted = true;',
  unmute: 'el.muted = false;',
  loop: 'el.loop = !el.loop;',
  controls: 'el.controls = !el.controls;',
  pip: 'if (document.pictureInPictureElement === el) document.exitPictureInPicture(); else el.requestPictureInPicture().catch(() => {});',
};

async function mediaVerb(wc: WebContents, verb: MediaVerb): Promise<boolean> {
  const live = liveFrame(wc.id);
  if (!live) return false;
  const find = pickScript('video, audio', 'HTMLMediaElement', pointIn(wc, live.last), live.last.srcURL);
  // A user gesture, so play() and picture in picture are allowed.
  const code = `(() => { const el = ${find}; if (!el) return false; ${MEDIA_CODE[verb]} return true; })()`;
  try {
    return (await live.frame.executeJavaScript(code, true)) === true;
  } catch {
    return false;
  }
}

async function saveCanvas(wc: WebContents): Promise<void> {
  const live = liveFrame(wc.id);
  if (!live) return;
  const find = pickScript('canvas', 'HTMLCanvasElement', pointIn(wc, live.last), '');
  let data: unknown = null;
  try {
    data = await live.frame.executeJavaScript(`(() => { const el = ${find}; try { return el ? el.toDataURL('image/png') : null; } catch { return null; } })()`);
  } catch {
    return;
  }
  if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,')) return;
  const host = wc.hostWebContents;
  const win = host ? BrowserWindow.fromWebContents(host) : null;
  const options = { defaultPath: path.join(app.getPath('downloads'), 'image.png'), filters: [{ name: 'PNG image', extensions: ['png'] }] };
  const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (canceled || !filePath) return;
  await fs.writeFile(filePath, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')).catch(() => undefined);
}

/** Replays a right-click that dismissed a menu, so the page shows a fresh one where it landed. */
function replay(wc: WebContents, x: number, y: number, shift: boolean): void {
  const at = { x: Math.round(x), y: Math.round(y) };
  // Shift rides along, so a Shift+right-click outside still bypasses the page's own menu.
  const modifiers: Electron.InputEvent['modifiers'] = shift ? ['shift'] : [];
  wc.sendInputEvent({ type: 'mouseMove', ...at });
  wc.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, modifiers, ...at });
  wc.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, modifiers, ...at });
}

async function act(sender: WebContents, req: MenuAct): Promise<unknown> {
  switch (req.op) {
    case 'copyText':
      await clipboard.writeText(String(req.text));
      return true;
    case 'context': {
      const [text, html] = await Promise.all([clipboard.readText().catch(() => ''), hasHtml()]);
      const info: ChromeMenuContext = { clip: { text, html }, a11y: app.accessibilitySupportEnabled };
      return info;
    }
    case 'chromeEdit':
      // The chrome's own fields (address, find): the command goes to the focused element.
      if (['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].includes(req.cmd)) sender[req.cmd]();
      return true;
    default:
      break;
  }
  const wc = guestFor(sender, req.wcId);
  if (!wc) return false;
  switch (req.op) {
    case 'copyImage':
      wc.copyImageAt(Math.round(req.x), Math.round(req.y));
      return true;
    case 'addWord':
      return wc.session.addWordToSpellCheckerDictionary(String(req.word));
    case 'download':
      // The downloads module takes it from the session's will-download.
      if (/^(https?|data|blob|file):/i.test(req.url)) wc.downloadURL(req.url);
      return true;
    case 'saveCanvas':
      await saveCanvas(wc);
      return true;
    case 'media':
      return mediaVerb(wc, req.verb);
    case 'replay':
      replay(wc, req.x, req.y, !!req.shift);
      return true;
    default:
      return false;
  }
}

/** While its menu is open, the page's keys go to the menu instead (it never sees them). */
function captureKeys(wc: WebContents, e: Electron.Event, input: Electron.Input): void {
  if (!capturing.has(wc.id)) return;
  const host = wc.hostWebContents;
  // No window left to show a menu: the page gets its keys back.
  if (!host || host.isDestroyed()) {
    capturing.delete(wc.id);
    return;
  }
  e.preventDefault();
  if (input.type !== 'keyDown') return;
  const k: MenuKey = { wcId: wc.id, key: input.key, shiftKey: input.shift, ctrlKey: input.control, altKey: input.alt, metaKey: input.meta, repeat: input.isAutoRepeat };
  host.send('menu:key', k);
}

export function register(ctx: MainContext): void {
  ctx.onGuest((wc) => {
    const id = wc.id;
    wc.on('context-menu', (_e, params) => {
      forward(wc, params).catch((err) => console.error('menu forward failed', err));
    });
    wc.on('before-input-event', (e, input) => captureKeys(wc, e, input));
    wc.once('destroyed', () => {
      records.delete(id);
      lastMenus.delete(id);
      capturing.delete(id);
      waiters.get(id)?.();
    });
  });

  ipcMain.on('menu:keys', (e, wcId: number, on: boolean) => {
    const wc = guestFor(e.sender, wcId);
    if (!wc) return;
    if (on === true) capturing.add(wc.id);
    else capturing.delete(wc.id);
  });

  // The page preload's notes about a right-click, sent while the contextmenu event dispatches.
  ipcMain.on('menu:ctx', (e, rec: PageMenuRecord) => {
    if (e.sender.getType() !== 'webview' || !rec || typeof rec !== 'object') return;
    records.set(e.sender.id, { ...rec, t: Date.now() });
    waiters.get(e.sender.id)?.();
  });

  // Only Vitre's own window may ask: 'context' reads the clipboard.
  ipcMain.handle('menu:act', (e, req: MenuAct) => {
    if (e.sender.getType() !== 'window' || !req || typeof req !== 'object') return false;
    return act(e.sender, req);
  });
}
