// Types of the menus module. MenuItem / MenusApi are the 'menus' service contract other modules use
// (b.service('menus')); Spec and Anchor are what the view draws.

/**
 * One row of a Deer menu.
 *   label     the text. A '&' marks the access key ("Show &downloads") and is not shown; '&&' shows
 *             one '&'. Text that is not yours (a page title, an extension or file name) must have
 *             its '&' doubled (view.ts literal()).
 *   key       the accelerator printed in the right column, Windows spelling, plain dim text
 *             ("Ctrl+W", "Shift+click", or a reason such as "Protected"). A single letter or digit
 *             here is taken as the access key instead and not printed (an accelerator is never one
 *             bare letter).
 *   access    the access-key letter; wins over a '&' marker. Underlined at the first word starting
 *             with it. '' means none.
 *   icon      a glyph name of the menu set (icons.ts: 'copy', 'download', 'link'...) or an image URL
 *             (chrome:, moz-extension:, data:, moz-remote-image:) drawn at 16 px. The icon column is
 *             always kept, so rows without an icon still line up.
 *   disabled  greyed (0.36), never runs, still reachable with the keyboard.
 *   checked   defined = a check item: a check in the icon column when true (role menuitemcheckbox).
 *   danger    a destructive verb. Drawn like any other row: MenuSpec has no coloured row text
 *             ("No accent in menus except the link target wash"); the ellipsis of a verb that asks
 *             first ("Remove extension…") is the signal. Kept so callers can say it.
 *   bold      Semibold label (spelling suggestions).
 *   run       what the row does. It runs at once; the menu fades out after it.
 *   submenu   child rows. The design has no submenus (DESIGN-NOTES "Right-click menus": "No
 *             submenus"): every menu is flattened before it shows (flatten below), the children
 *             listed in place under a 28 px caption with the row's label, set off by separators
 *             (an extension's nested menus.create items).
 */
export interface MenuCommand {
  label: string;
  key?: string;
  access?: string;
  icon?: string;
  disabled?: boolean;
  checked?: boolean;
  danger?: boolean;
  bold?: boolean;
  run?: () => void;
  submenu?: MenuItem[];
}

/** A row: a command, a separator (never leads, trails or doubles: tidied away) or a caption (28 px, not focusable). */
export type MenuItem = MenuCommand | { separator: true } | { caption: string };

/**
 * Options of menus.show().
 *   align     where the menu sits against `at`:
 *               for a point:   'start' (default; top-left at the point, flipping left / up near the
 *                              window edges), 'end' (top-right at the point), 'above-start', 'above-end';
 *               for an element:'start' (default; 8 px below it, left edges aligned, above it when there
 *                              is no room below), 'end' (right edges aligned), 'above-start', 'above-end'
 *                              (8 px above it: the downloads ring opens up and to the left).
 *   onClose   called once when the menu closes, however it closes (after the chosen row ran);
 *             also called once, at once, when nothing could be shown (no command row).
 *   keyboard  opened from the keyboard: the first enabled row is focused and access keys are
 *             underlined. Detected by itself when show() is called while a keyboard-triggered
 *             contextmenu event (Shift+F10, the Menu key) is being handled.
 *   label     accessible name of the menu (default "Context").
 *   owner     an element that keeps its pressed look (class vt-menu-owner) and aria-expanded while
 *             the menu is open (a bar circle, the downloads ring).
 *   gap       distance from an element anchor (default 8).
 *   touch     40 px rows (opened by touch or pen).
 */
export interface ShowOptions {
  align?: string;
  onClose?: () => void;
  keyboard?: boolean;
  label?: string;
  owner?: Element | null;
  gap?: number;
  touch?: boolean;
}

/** The 'menus' service (b.provide('menus', ...) by src/window/modules/menus). */
export interface MenusApi {
  /** Show a glass menu at a point (window coordinates) or hanging from an element. Replaces an open one. */
  show(items: MenuItem[], at: { x: number; y: number } | Element, opts?: ShowOptions): void;
  /** Close the open menu, if any (no motion). */
  close(): void;
  /** A menu is open. (Addition to the contract.) */
  isOpen(): boolean;
  /**
   * The standard editing rows for one of Deer's own text fields (Undo · Redo — Cut · Copy · Paste ·
   * Select all), with their enabled state read now, for a module that adds its own rows (the find
   * field's Match case). (Addition to the contract.)
   */
  editItems(field: HTMLInputElement | HTMLTextAreaElement): MenuItem[];
}

declare global {
  interface VitreServices {
    menus: MenusApi;
  }
}

/** 'touch' = 40 px rows (a finger or a pen; the anchor decides where the menu goes). */
export type MenuSource = 'mouse' | 'keyboard' | 'touch';

/** Where a menu goes, in window coordinates. */
export type Anchor =
  /** Mouse and pen: a corner at the hotspot, flipping left or up near the edges. */
  | { kind: 'point'; x: number; y: number; align?: string }
  /** Keyboard and elements: `gap` px below the box (or above it when there is no room), aligned to its left or right edge. */
  | { kind: 'below'; left: number; right: number; top: number; bottom: number; gap: number; align?: string }
  /** Touch: centred on the finger, its bottom edge 24 px above it. */
  | { kind: 'touch'; x: number; y: number }
  /** Tab bar surfaces: hang at a fixed top from a left edge. */
  | { kind: 'hang'; left: number; top: number };

/** What the view needs to open one menu. */
export interface Spec {
  rows: MenuItem[];
  label: string;
  anchor: Anchor;
  source: MenuSource;
  /** Link target wash, window rectangles. */
  wash?: DOMRect[];
  owner?: Element | null;
  /** The page under the menu, sampled for the raised dark material. */
  backdrop?: XULBrowser | null;
  /** The page whose navigation closes this menu (context loss), or null. */
  page?: XULBrowser | null;
  /** Called once when the menu has closed (after a chosen row ran). */
  onClose?: (how: CloseMode) => void;
}

export type CloseMode = 'chosen' | 'dismiss' | 'instant';

/** The parts of a keydown the menu reads. */
export interface MenuKey {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  repeat: boolean;
}

export const SEP: MenuItem = { separator: true };

export const isCommand = (r: MenuItem | null | undefined | false): r is MenuCommand => !!r && 'label' in r;
export const isSeparator = (r: MenuItem): r is { separator: true } => 'separator' in r;
export const isCaption = (r: MenuItem): r is { caption: string } => 'caption' in r;

/** A command row (the builders' shorthand): label, icon, accelerator, access key, run, extras. */
export function item(label: string, icon: string, key: string, access: string, run: () => void, extra: Partial<MenuCommand> = {}): MenuCommand {
  const r: MenuCommand = { label, run, ...extra };
  if (icon) r.icon = icon;
  if (key) r.key = key;
  if (access) r.access = access;
  return r;
}

/** Separators never lead, trail or double; empty entries are dropped. */
export function tidy(rows: (MenuItem | null | false | undefined)[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const r of rows) {
    if (!r) continue;
    if (isSeparator(r) && (!out.length || isSeparator(out[out.length - 1]))) continue;
    out.push(r);
  }
  while (out.length && isSeparator(out[out.length - 1])) out.pop();
  while (out.length && isSeparator(out[0])) out.shift();
  return out;
}

/**
 * No submenus (see `submenu` above): a row with children becomes a caption with its label and its
 * children in place; a group of the menu itself is set off by separators, a group nested in one is
 * only its caption. A disabled parent's children are disabled. A listed row whose access key
 * (`accessOf`, the view's labelOf) is already taken in the menu loses it: access keys stay unique.
 * Recursive.
 */
export function flatten(rows: MenuItem[], accessOf: (row: MenuCommand) => string = () => ''): MenuItem[] {
  if (!rows.some((r) => isCommand(r) && r.submenu)) return rows;
  const out: MenuItem[] = [];
  const taken = new Set(rows.filter((r): r is MenuCommand => isCommand(r) && !r.submenu).map(accessOf).filter(Boolean));
  const walk = (list: MenuItem[], depth: number, disabled: boolean): void => {
    for (const r of list) {
      if (isCommand(r) && r.submenu) {
        const { submenu, ...rest } = r;
        if (depth === 0) out.push(SEP);
        // The label's access marker goes ("&More" -> "More", "&&" -> "&"): a caption takes no key.
        out.push({ caption: rest.label.replace(/&(&?)/g, '$1') });
        walk(submenu, depth + 1, disabled || !!rest.disabled);
        if (depth === 0) out.push(SEP);
      } else if (isCommand(r) && depth > 0) {
        let row: MenuCommand = disabled ? { ...r, disabled: true } : r;
        const key = accessOf(row);
        if (key && taken.has(key)) row = { ...row, access: '' };
        else if (key) taken.add(key);
        out.push(row);
      } else out.push(r);
    }
  };
  walk(rows, 0, false);
  return tidy(out);
}
