import type { WebviewTag } from 'electron';
import type { IconName } from './icons';

export interface MenuItem {
  type: 'item';
  label: string;
  icon?: IconName;
  /** Printed in the accelerator column: a key in Windows spelling, or a reason ("Protected"). */
  accel?: string;
  /** Access-key letter. */
  key?: string;
  disabled?: boolean;
  /** Defined for check items: a check in the icon column when true. */
  checked?: boolean;
  /** Spelling suggestions. */
  bold?: boolean;
  /** `from` is the centre of the row's icon in window pixels: a download flies from there. */
  run(from: Point): void;
}

export interface Point {
  x: number;
  y: number;
}

export type MenuRow = MenuItem | { type: 'sep' } | { type: 'caption'; label: string };

export type MenuSource = 'mouse' | 'keyboard' | 'touch' | 'pen';

/** Where a menu goes, in window coordinates. */
export type MenuAnchor =
  /** Mouse and pen: top-left at the hotspot, flipping left or up near the edges. */
  | { kind: 'point'; x: number; y: number }
  /** Keyboard: 4 px below the element, left-aligned to it; above it when there's no room. */
  | { kind: 'below'; left: number; top: number; bottom: number }
  /** Touch: centred on the finger, its bottom edge 24 px above it. */
  | { kind: 'touch'; x: number; y: number }
  /** Tab bar surfaces: hang at a fixed top from a left edge. */
  | { kind: 'hang'; left: number; top: number };

export interface MenuSpec {
  rows: MenuRow[];
  /** Accessible name of the menu. */
  label: string;
  anchor: MenuAnchor;
  source: MenuSource;
  /** Link target wash, in window coordinates. */
  wash?: DOMRect[];
  /** A chrome element that keeps its pressed look while its menu is open... */
  owner?: HTMLElement | null;
  /** ...and its button, which reports the open menu (aria-expanded). */
  ownerButton?: HTMLElement | null;
  /** The page under the menu, sampled for the raised dark material. */
  backdrop?: WebviewTag | null;
  /** The page the menu belongs to: navigating or closing it closes the menu. */
  guest?: WebviewTag | null;
  /**
   * When set and the page has focus, the page keeps it (its selection stays lit) and its keys are
   * routed to the menu (on) or back to the page (off). Otherwise the menu takes focus.
   */
  borrowKeys?: ((on: boolean) => void) | null;
}

/** The parts of a keydown a menu reads (a DOM KeyboardEvent, or a page key forwarded by main). */
export interface MenuKeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
}

export const SEP: MenuRow = { type: 'sep' };

export function item(label: string, icon: IconName | '', accel: string, key: string, run: (from: Point) => void, extra: Partial<MenuItem> = {}): MenuItem {
  return { type: 'item', label, icon: icon || undefined, accel: accel || undefined, key: key || undefined, run, ...extra };
}

/** Separators never lead, trail or double. */
export function tidy(rows: (MenuRow | null | false | undefined)[]): MenuRow[] {
  const out: MenuRow[] = [];
  for (const r of rows) {
    if (!r) continue;
    if (r.type === 'sep' && (!out.length || out[out.length - 1].type === 'sep')) continue;
    out.push(r);
  }
  while (out.length && out[out.length - 1].type === 'sep') out.pop();
  return out;
}
