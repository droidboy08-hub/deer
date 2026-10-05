// Small helpers the menu items share: main-process verbs, the clipboard, Peek and quoting.
import type { WebviewTag } from 'electron';
import type { Browser } from '../../app';
import type { ChromeMenuContext, MenuAct } from '../../../main/modules/menus';
import type { Point } from './types';

export function act(req: MenuAct): Promise<unknown> {
  return window.vitre.ipc.invoke('menu:act', req).catch((err) => {
    console.error('menu:act failed', req.op, err);
    return null;
  });
}

export function copyText(text: string): void {
  void act({ op: 'copyText', text });
}

/**
 * Download a file the page shows. Web addresses go to the downloads module, which flies a glass
 * circle from the row's icon to the ring; anything else (data:, blob:, file:) goes through
 * Chromium, whose will-download the downloads module takes over.
 */
export function download(wcId: number, url: string, pageUrl: string, from: Point): void {
  if (/^https?:/i.test(url)) window.dispatchEvent(new CustomEvent('vitre:download', { detail: { url, origin: from, pageUrl } }));
  else void act({ op: 'download', wcId, url });
}

export async function chromeContext(): Promise<ChromeMenuContext> {
  const ctx = (await act({ op: 'context' })) as ChromeMenuContext | null;
  return ctx ?? { clip: { text: '', html: false }, a11y: false };
}

/** What the menus use of Peek's API (window.vitrePeek, published by the peek module). */
export interface PeekLike {
  open(url: string, origin?: { x: number; y: number; width: number; height: number }): void;
  isOpen(): boolean;
  webview(): WebviewTag | null;
  close(): boolean;
  promote(): void;
}

export function peekApi(): PeekLike | null {
  return (window as unknown as { vitrePeek?: PeekLike }).vitrePeek ?? null;
}

/** Peek is installed: menus offer Peek link, Peek image and searches in a peek. */
export function canPeek(): boolean {
  return !!peekApi();
}

/** Open as tab is rebindable (Settings › Keyboard shortcuts); menus print the current key. */
export function openAsTabKey(b: Browser): string {
  return b.settings.rebind?.openAsTab || 'Alt+Enter';
}

/** Peek shows web pages only; other addresses (data:, file:, blob:) never get a Peek row. */
export function peekable(url: string): boolean {
  return /^https?:/i.test(url);
}

/** Peek a URL, growing the sheet from `origin` (window pixels); without Peek, a background tab. */
export function peek(b: Browser, url: string, origin?: DOMRect | null): void {
  const api = peekApi();
  if (api && peekable(url)) api.open(url, origin ? { x: origin.x, y: origin.y, width: origin.width, height: origin.height } : undefined);
  else b.newTab(url, { background: true });
}

/** The settings module listens for these: its panel, and Home's background popover. */
export function openSettings(): void {
  document.dispatchEvent(new CustomEvent('vitre:open-settings'));
}

export function changeBackground(): void {
  document.dispatchEvent(new CustomEvent('vitre:change-background'));
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

/** The address of a mailto: or tel: link, without the scheme or query. */
export function plainAddress(url: string): string {
  const raw = url.replace(/^(mailto|tel):/i, '').split('?')[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
