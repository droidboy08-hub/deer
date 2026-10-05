// One menu at a time (plus its open submenus), drawn in the menus layer (z 50): frosted glass, 34 px
// rows, one plate for hover and keyboard focus, placement with flips near the window edges, and the
// open / choose / dismiss motion from MenuMotion.dc.html. Ported from app/src/renderer/modules/menus/
// view.ts. A full-window catcher under the menu absorbs the dismissing click; a right press on it
// hides it at once, so the contextmenu that follows lands on whatever is underneath and opens a
// fresh menu there (spikes/pagefeatures/RESULT.md, menus "Behaviour").
//
// Keys never reach the menu through focus: the page (or Deer's field) keeps focus and the module
// hands every keydown to handleKey() from the key router's hook (index.ts). With assistive
// technology running the menu takes real focus instead (aria-activedescendant follows the plate).
import type { Browser } from '../../browser';
import * as gecko from './gecko';
import { iconNode } from './icons';
import { isCaption, isCommand, isSeparator, tidy, type Anchor, type CloseMode, type MenuCommand, type MenuItem, type MenuKey, type Spec } from './types';

const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EXPAND = 'cubic-bezier(0.2, 0, 0, 1)';
const EXIT = 'cubic-bezier(0.4, 0, 1, 1)';
const MARGIN = 8;
const MIN_W = 264;
const MAX_W = 360;
const SEP_H = 9;
const CAPTION_H = 28;
/** Under this mean luma (of 255) the backdrop is dark: the menu sits lighter, on the raised tint. */
const RAISED_LUMA = 48 / 255;
const SUBMENU_DELAY = 250;
const HTMLNS = 'http://www.w3.org/1999/xhtml';

export type MenuTheme = 'dark' | 'light';

interface Entry {
  row: MenuCommand;
  el: HTMLElement;
  /** The access key, lower case ('' for none). */
  access: string;
}

interface Placed {
  left: number;
  top: number;
  up: boolean;
  leftward: boolean;
}

interface Panel {
  el: HTMLElement;
  list: HTMLElement;
  plate: HTMLElement;
  entries: Entry[];
  active: number;
  plateShown: boolean;
  pressed: number;
  parent: Panel | null;
  /** The row of the parent that opened this panel. */
  parentIndex: number;
  child: Panel | null;
  box: { left: number; top: number; width: number; height: number };
}

export interface MenuState {
  open: boolean;
  label: string;
  source: string;
  rows: { label: string; key: string; access: string; disabled: boolean; checked?: boolean; bold: boolean; danger: boolean; submenu: boolean; icon: string }[];
  captions: string[];
  active: number;
  /** The menu in window coordinates. */
  rect: { left: number; top: number; width: number; height: number } | null;
  classes: string;
  submenus: number;
  wash: number;
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const textWidth = (() => {
  let ctx: CanvasRenderingContext2D | null = null;
  return (text: string, px: number, weight = 400): number => {
    ctx ??= (document.createElementNS(HTMLNS, 'canvas') as HTMLCanvasElement).getContext('2d');
    if (!ctx) return text.length * px * 0.52;
    ctx.font = `${weight} ${px}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif`;
    return ctx.measureText(text).width;
  };
})();

/**
 * The label as shown and its access key (the rules of the 'menus' contract, types.ts MenuCommand):
 *   - '&' before a letter marks the access key and is not shown; '&&' shows one '&' (so text from
 *     a page, an extension or an add-on name goes through literal() first);
 *   - `access` names the key explicitly and wins over a marker; it is underlined at the first word
 *     that starts with it, else at its first occurrence;
 *   - a single letter or digit in `key` is read as the access key too (never printed: an
 *     accelerator is never one bare letter), for callers that put the access letter there.
 */
export function labelOf(row: MenuCommand): { text: string; index: number; access: string } {
  let text = '';
  let marker = -1;
  const s = row.label;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '&' && i + 1 < s.length) {
      if (s[i + 1] === '&') {
        text += '&';
        i++;
        continue;
      }
      if (marker < 0) marker = text.length;
      continue;
    }
    text += s[i];
  }
  const explicit = row.access !== undefined && row.access !== '' ? row.access : singleKey(row.key) ? row.key : undefined;
  if (explicit === undefined) {
    if (row.access === '') return { text, index: -1, access: '' };
    return { text, index: marker, access: marker >= 0 ? text[marker].toLowerCase() : '' };
  }
  const key = explicit.toLowerCase();
  const low = text.toLowerCase();
  let index = -1;
  for (let i = 0; i < low.length; i++) {
    if (low[i] === key && (i === 0 || /[\s“("'‘]/.test(low[i - 1]))) {
      index = i;
      break;
    }
  }
  if (index < 0) index = low.indexOf(key);
  return { text, index, access: key };
}

/** A `key` that is one letter or digit: an access key, not an accelerator (see labelOf). */
const singleKey = (key: string | undefined): key is string => !!key && /^[A-Za-z0-9]$/.test(key);

/** The accelerator printed in the right column ('' when `key` is really an access letter). */
export const accelOf = (row: MenuCommand): string => (row.key && !singleKey(row.key) ? row.key : '');

/** Text from a page, an extension or a file shown in a label: its '&' stays a literal '&'. */
export const literal = (text: string): string => text.replace(/&/g, '&&');

/** A row's natural width: icon column to x 44, label, 32 clear, accelerator (or submenu arrow), 16. */
function rowWidth(r: MenuCommand): number {
  const label = labelOf(r).text;
  const accel = accelOf(r);
  const tail = r.submenu ? 32 + 12 : accel ? 32 + textWidth(accel, 12) : 0;
  return 44 + textWidth(label, 14, r.bold ? 600 : 400) + tail + 16;
}

/** The row fits the widest menu (360) without its label being cut. */
export function rowFits(label: string, key?: string): boolean {
  return rowWidth({ label, key, access: '' }) <= MAX_W;
}

/** Width fits the content in 8 px steps, 264 to 360. */
export function menuWidth(rows: MenuItem[]): number {
  let need = 0;
  for (const r of rows) if (isCommand(r)) need = Math.max(need, rowWidth(r));
  return clamp(Math.ceil(need / 8) * 8, MIN_W, MAX_W);
}

/** 12 + 34 x rows + 9 x separators + 28 x captions. */
export function menuHeight(rows: MenuItem[], rowH: number): number {
  return 12 + rows.reduce((h, r) => h + (isSeparator(r) ? SEP_H : isCaption(r) ? CAPTION_H : rowH), 0);
}

/** Where a menu of w x h goes for an anchor, inside a W x H window with the 8 px margin. */
export function place(a: Anchor, w: number, h: number, W: number, H: number): Placed {
  let left = 0;
  let top = 0;
  let up = false;
  let leftward = false;
  const align = (a.kind === 'point' || a.kind === 'below' ? a.align : '') || 'start';
  const wantEnd = align.endsWith('end');
  const wantAbove = align.startsWith('above');
  switch (a.kind) {
    case 'point': {
      left = wantEnd ? a.x - w : a.x;
      leftward = wantEnd;
      if (!wantEnd && left + w > W - MARGIN) {
        left = a.x - w;
        leftward = true;
      } else if (wantEnd && left < MARGIN) {
        left = a.x;
        leftward = false;
      }
      top = wantAbove ? a.y - h : a.y;
      up = wantAbove;
      if (!wantAbove && top + h > H - MARGIN) {
        top = a.y - h;
        up = true;
      } else if (wantAbove && top < MARGIN) {
        top = a.y;
        up = false;
      }
      break;
    }
    case 'below': {
      left = wantEnd ? a.right - w : a.left;
      leftward = wantEnd;
      const below = a.bottom + a.gap;
      const above = a.top - a.gap - h;
      const roomBelow = H - MARGIN - below;
      const roomAbove = a.top - a.gap - MARGIN;
      if (wantAbove) {
        up = h <= roomAbove || roomAbove >= roomBelow;
      } else {
        up = h > roomBelow && (h <= roomAbove || roomAbove > roomBelow);
      }
      top = up ? above : below;
      break;
    }
    case 'touch':
      left = a.x - w / 2;
      top = a.y - 24 - h;
      up = true;
      if (top < MARGIN) {
        top = a.y + 24;
        up = false;
      }
      break;
    case 'hang':
      left = a.left;
      top = a.top;
      break;
  }
  return {
    left: Math.round(clamp(left, MARGIN, Math.max(MARGIN, W - MARGIN - w))),
    top: Math.round(clamp(top, MARGIN, Math.max(MARGIN, H - MARGIN - h))),
    up,
    leftward,
  };
}

function ariaKeys(accel: string | undefined): string | null {
  if (!accel || !/^(Ctrl|Alt|Shift|Esc|F\d)/.test(accel) || /click$/i.test(accel)) return null;
  return accel
    .replace(/\bCtrl\b/g, 'Control')
    .replace(/\bEsc\b/, 'Escape')
    .replace(/\bDel\b/, 'Delete')
    .replace(/\bLeft\b/, 'ArrowLeft')
    .replace(/\bRight\b/, 'ArrowRight');
}

function h(tag: string, cls: string, text?: string): HTMLElement {
  const n = document.createElementNS(HTMLNS, tag) as HTMLElement;
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function itemElement(r: MenuCommand, id: string): { el: HTMLElement; access: string } {
  const el = h('div', 'vt-mi');
  el.id = id;
  el.setAttribute('role', r.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
  if (r.checked !== undefined) el.setAttribute('aria-checked', String(r.checked));
  el.setAttribute('aria-disabled', String(!!r.disabled));
  if (r.submenu) el.setAttribute('aria-haspopup', 'menu');
  const accel = accelOf(r);
  const keys = ariaKeys(accel);
  if (keys) el.setAttribute('aria-keyshortcuts', keys);
  if (r.bold) el.classList.add('bold');
  if (r.danger) el.classList.add('danger');
  el.append(iconNode(r.checked === undefined ? r.icon : r.checked ? 'check' : undefined));

  const { text, index, access } = labelOf(r);
  const label = h('span', 'vt-mi-label');
  if (index >= 0) {
    const ak = h('span', 'vt-ak', text.slice(index, index + 1));
    label.append(text.slice(0, index), ak, text.slice(index + 1));
  } else {
    label.textContent = text;
  }
  el.append(label);
  if (r.submenu) {
    el.append(iconNode('chevron', 'vt-mi-sub'));
  } else if (accel) {
    el.append(h('span', 'vt-mi-accel', accel));
  }
  return { el, access };
}

export class MenuView {
  /** Context loss closes a menu at once: window deactivation is one. A test may turn it off. */
  closeOnBlur = true;
  /** Durations used by the last open (for tests). */
  lastMotion: { open: string; reduced: boolean } = { open: '', reduced: false };

  private readonly host: HTMLElement;
  private readonly catcher: HTMLElement;
  private top: HTMLElement | null = null;
  private spec: Spec | null = null;
  private root: Panel | null = null;
  /** The panel the keys go to: the root, or a submenu entered with the keyboard or the pointer. */
  private focus: Panel | null = null;
  private theme: MenuTheme = 'dark';
  private touchRows = false;
  private lastInput: 'mouse' | 'key' = 'mouse';
  private washes: HTMLElement[] = [];
  private timers: number[] = [];
  private subTimer = 0;
  private catcherHeld = false;
  private seq = 0;
  private prevFocus: Element | null = null;
  private tookFocus = false;
  /** Releasing the right button on an item runs it; the contextmenu that follows is swallowed until then. */
  quietUntil = 0;
  /** The chosen row's icon centre in window coordinates, set just before its action runs (a download flies from there). */
  lastIcon: { x: number; y: number } | null = null;

  constructor(
    private b: Browser,
    layer: HTMLElement
  ) {
    this.host = h('div', 'vt-menus');
    this.catcher = h('div', 'vt-catcher');
    this.catcher.setAttribute('data-off', '');
    this.host.append(this.catcher);
    layer.append(this.host);
    this.wireCatcher();
  }

  get isOpen(): boolean {
    return this.spec !== null;
  }

  /** The open menu, for tests and for the module (labels, active row, rectangle). */
  state(): MenuState {
    const p = this.root;
    const spec = this.spec;
    const rect = p ? p.el.getBoundingClientRect() : null;
    let submenus = 0;
    for (let c = p?.child ?? null; c; c = c.child) submenus++;
    return {
      open: !!spec,
      label: spec?.label ?? '',
      source: spec?.source ?? '',
      rows: (p?.entries ?? []).map((e) => ({ label: labelOf(e.row).text, key: accelOf(e.row), access: e.access, disabled: !!e.row.disabled, checked: e.row.checked, bold: !!e.row.bold, danger: !!e.row.danger, submenu: !!e.row.submenu, icon: e.row.icon ?? '' })),
      captions: spec ? spec.rows.filter(isCaption).map((c) => c.caption) : [],
      active: p?.active ?? -1,
      rect: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
      classes: p?.el.className ?? '',
      submenus,
      wash: this.washes.length,
    };
  }

  /** The panel that has the keys: a submenu opened by hover keeps them in its parent until Right or Enter. */
  private get keyPanel(): Panel | null {
    let p = this.root;
    while (p) {
      if (p === this.focus) return p;
      p = p.child;
    }
    return this.root;
  }

  /** The submenu panel `depth` levels down (1 = the first submenu), for tests. */
  panel(depth = 0): { rows: string[]; active: number; rect: DOMRect } | null {
    let p = this.root;
    for (let i = 0; i < depth && p; i++) p = p.child;
    if (!p) return null;
    return { rows: p.entries.map((e) => labelOf(e.row).text), active: p.active, rect: p.el.getBoundingClientRect() };
  }

  /** Row element of the root panel (tests click it). */
  rowElement(i: number, depth = 0): HTMLElement | null {
    let p = this.root;
    for (let d = 0; d < depth && p; d++) p = p.child;
    return p?.entries[i]?.el ?? null;
  }

  open(spec: Spec, theme: MenuTheme): void {
    if (this.spec) this.close('instant');
    const rows = tidy(spec.rows);
    if (!rows.some(isCommand)) return;
    spec.rows = rows;
    this.spec = spec;
    this.lastIcon = null;
    this.seq++;
    this.theme = theme;
    this.touchRows = spec.source === 'touch';
    const container = this.container();
    const off = container.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rowH = this.touchRows ? 40 : 34;
    const w = menuWidth(rows);
    const natural = menuHeight(rows, rowH);
    const hgt = Math.min(natural, H - 2 * MARGIN);
    const at = place(spec.anchor, w, hgt, W, H);

    const panel = this.build(rows, theme, null, -1);
    panel.el.setAttribute('aria-label', spec.label);
    panel.el.style.left = `${at.left - off.left}px`;
    panel.el.style.top = `${at.top - off.top}px`;
    panel.el.style.width = `${w}px`;
    panel.el.style.maxHeight = `${H - 2 * MARGIN}px`;
    panel.box = { left: at.left, top: at.top, width: w, height: hgt };
    this.root = panel;
    this.focus = panel;
    this.catcher.removeAttribute('data-off');
    this.host.append(panel.el);
    this.showWash(spec.wash ?? [], off);
    if (spec.owner) {
      spec.owner.classList.add('vt-menu-owner');
      spec.owner.setAttribute('aria-expanded', 'true');
    }
    this.takeFocus(panel.el);
    this.animateIn(panel.el, at);
    if (spec.source === 'keyboard') {
      panel.el.classList.add('keys');
      this.lastInput = 'key';
      const first = panel.entries.findIndex((e) => !e.row.disabled);
      this.setActive(panel, first >= 0 ? first : 0, 'key');
    } else {
      this.lastInput = 'mouse';
    }
    if (theme === 'dark') this.sampleBackdrop(panel.el, spec, at, w, hgt);
  }

  /** The spec of the open menu (the object given to open()), or null. */
  currentSpec(): Spec | null {
    return this.spec;
  }

  /**
   * Move the open menu to a better anchor that became known after it opened (a keyboard-opened page
   * menu learns the selection or the focused field a few ms later). Only while `spec` is still open
   * and the open motion is running, so a menu never jumps under the pointer.
   */
  reanchor(spec: Spec, anchor: Anchor): void {
    const p = this.root;
    if (!p || this.spec !== spec) return;
    spec.anchor = anchor;
    const off = this.container().getBoundingClientRect();
    const at = place(anchor, p.box.width, p.box.height, window.innerWidth, window.innerHeight);
    p.box.left = at.left;
    p.box.top = at.top;
    p.el.style.left = `${at.left - off.left}px`;
    p.el.style.top = `${at.top - off.top}px`;
    p.el.style.transformOrigin = `${at.leftward ? '100%' : '0'} ${at.up ? '100%' : '0'}`;
  }

  /**
   * Replace the rows of the open menu in place (an extension changed its items while the menu was
   * open: menus.refresh() from menus.onShown). Same corner, the height follows the new rows; the
   * focused row stays focused when its label is still there.
   */
  refresh(spec: Spec, rows: MenuItem[]): void {
    const old = this.root;
    if (!old || this.spec !== spec) return;
    const tidied = tidy(rows);
    if (!tidied.some(isCommand)) return;
    const activeLabel = old.active >= 0 ? old.entries[old.active]?.row.label : null;
    spec.rows = tidied;
    for (let c = old.child; c; c = c.child) c.el.remove();
    old.child = null;
    const panel = this.build(tidied, this.theme, null, -1);
    panel.el.className = old.el.className;
    panel.el.setAttribute('aria-label', spec.label);
    const off = this.container().getBoundingClientRect();
    const w = menuWidth(tidied);
    const hgt = Math.min(menuHeight(tidied, this.touchRows ? 40 : 34), window.innerHeight - 2 * MARGIN);
    const at = place(spec.anchor, w, hgt, window.innerWidth, window.innerHeight);
    panel.el.style.left = `${at.left - off.left}px`;
    panel.el.style.top = `${at.top - off.top}px`;
    panel.el.style.width = `${w}px`;
    panel.el.style.maxHeight = `${window.innerHeight - 2 * MARGIN}px`;
    panel.el.style.opacity = old.el.style.opacity || '1';
    panel.box = { left: at.left, top: at.top, width: w, height: hgt };
    old.el.replaceWith(panel.el);
    this.root = panel;
    this.focus = panel;
    const i = activeLabel === null ? -1 : panel.entries.findIndex((e) => e.row.label === activeLabel);
    if (i >= 0) this.setActive(panel, i, this.lastInput);
  }

  /** Add the link target wash to the open menu (its rectangles arrive from the page after opening). */
  addWash(rects: DOMRect[]): void {
    if (!this.spec || !rects.length || this.washes.length) return;
    this.showWash(rects, this.container().getBoundingClientRect());
  }

  /**
   * Close the menu. `mode`: 'chosen' (a row ran: 100 ms fade with the row lit), 'dismiss' (120 ms
   * fade and scale), 'instant' (context loss). spec.onClose runs after the teardown.
   */
  close(mode: CloseMode): void {
    const spec = this.teardown(mode);
    if (spec) this.finish(spec, mode);
  }

  /** Remove the menu without calling onClose; returns the spec that was open. */
  private teardown(mode: CloseMode): Spec | null {
    const spec = this.spec;
    const root = this.root;
    if (!spec || !root) return null;
    this.spec = null;
    this.root = null;
    this.focus = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    clearTimeout(this.subTimer);
    this.subTimer = 0;
    if (!this.catcherHeld) this.catcher.setAttribute('data-off', '');
    this.hideWash(mode === 'instant');
    if (spec.owner) {
      spec.owner.classList.remove('vt-menu-owner');
      spec.owner.removeAttribute('aria-expanded');
    }
    for (let c = root.child; c; c = c.child) c.el.remove();
    root.child = null;
    this.animateOut(root.el, mode);
    if (this.tookFocus) this.restoreFocus();
    this.tookFocus = false;
    this.prevFocus = null;
    if (this.top && !this.catcherHeld) this.releaseTop(mode === 'instant' ? 0 : 160);
    return spec;
  }

  private finish(spec: Spec, mode: CloseMode): void {
    try {
      spec.onClose?.(mode);
    } catch (err) {
      console.error('Deer: menu onClose failed', err);
    }
  }

  /** A keydown while a menu is open: menu keys act, everything else is swallowed. Returns false when closed. */
  handleKey(e: MenuKey): boolean {
    const p = this.keyPanel;
    if (!this.spec || !p) return false;
    const k = e.key;
    if (k === 'ArrowDown' || (k === 'Tab' && !e.shiftKey)) this.move(p, 1);
    else if (k === 'ArrowUp' || (k === 'Tab' && e.shiftKey)) this.move(p, -1);
    else if (k === 'Home') this.moveTo(p, 0);
    else if (k === 'End') this.moveTo(p, p.entries.length - 1);
    else if (k === 'ArrowRight') {
      const entry = p.entries[p.active];
      if (entry?.row.submenu && !entry.row.disabled) this.openSub(p, p.active, true);
    } else if (k === 'ArrowLeft') {
      if (p.parent) this.closeSub(p.parent);
    } else if (k === 'Enter' || k === ' ') {
      if (!e.repeat && p.active >= 0) this.activate(p, p.active);
    } else if (k === 'Escape') {
      if (e.repeat) return true;
      if (p.parent) this.closeSub(p.parent);
      else this.close('dismiss');
    } else if (k === 'Alt' || k === 'F10' || k === 'ContextMenu') {
      if (!e.repeat) this.close('dismiss');
    } else if (k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
      this.accessKey(p, k);
    }
    return true;
  }

  // ---- building ----

  /** Where menus are drawn: the layer, or a top-layer host while a page element is full screen. */
  private container(): HTMLElement {
    const fullscreen = document.documentElement.hasAttribute('inDOMFullscreen');
    if (!fullscreen) {
      if (this.top) this.releaseTop(0);
      return this.host;
    }
    // #vitre-root is display: none in element full screen: a popover in the top layer is the only
    // thing drawn above the full-screen <browser>. It cannot frost the page (outside the tab box).
    if (!this.top) {
      const top = h('div', '');
      top.id = 'vitre-menus-top';
      top.setAttribute('popover', 'manual');
      (document.body ?? document.documentElement).append(top);
      this.top = top;
    }
    if (this.host.parentElement !== this.top) this.top.append(this.host);
    try {
      (this.top as any).showPopover?.();
    } catch {
      /* already showing */
    }
    return this.host;
  }

  private releaseTop(delay: number): void {
    const top = this.top;
    if (!top) return;
    const done = (): void => {
      if (this.spec || this.top !== top) return;
      try {
        (top as any).hidePopover?.();
      } catch {
        /* not showing */
      }
      document.getElementById('layer-menus')?.append(this.host);
      top.remove();
      this.top = null;
    };
    if (delay) window.setTimeout(done, delay);
    else done();
  }

  private build(rows: MenuItem[], theme: MenuTheme, parent: Panel | null, parentIndex: number): Panel {
    const el = h('div', `vt-menu t-${theme}${this.touchRows ? ' touch' : ''}`);
    if (this.top) el.classList.add('solid');
    el.setAttribute('role', 'menu');
    el.tabIndex = -1;
    const list = h('div', 'vt-menu-list');
    const plate = h('div', 'vt-plate');
    list.append(plate);
    const panel: Panel = { el, list, plate, entries: [], active: -1, plateShown: false, pressed: -1, parent, parentIndex, child: null, box: { left: 0, top: 0, width: 0, height: 0 } };
    const depth = parent ? this.depthOf(parent) + 1 : 0;
    for (const r of rows) {
      if (isSeparator(r)) {
        const s = h('div', 'vt-sep');
        s.setAttribute('role', 'separator');
        list.append(s);
      } else if (isCaption(r)) {
        const c = h('div', 'vt-caption', r.caption);
        c.setAttribute('aria-hidden', 'true');
        list.append(c);
      } else {
        const { el: node, access } = itemElement(r, `vt-mi-${this.seq}-${depth}-${panel.entries.length}`);
        node.dataset.i = String(panel.entries.length);
        panel.entries.push({ row: r, el: node, access });
        list.append(node);
      }
    }
    el.append(list);
    this.wirePanel(panel);
    return panel;
  }

  private depthOf(p: Panel): number {
    let d = 0;
    for (let x = p.parent; x; x = x.parent) d++;
    return d;
  }

  private showWash(rects: DOMRect[], off: DOMRect): void {
    this.washes = rects.map((r) => {
      const d = h('div', 'vt-wash');
      d.style.left = `${r.x - off.left}px`;
      d.style.top = `${r.y - off.top}px`;
      d.style.width = `${r.width}px`;
      d.style.height = `${r.height}px`;
      this.host.insertBefore(d, this.catcher);
      return d;
    });
    if (this.washes.length) {
      const washes = this.washes;
      requestAnimationFrame(() => requestAnimationFrame(() => washes.forEach((d) => d.classList.add('on'))));
    }
  }

  private hideWash(instant: boolean): void {
    for (const d of this.washes) {
      if (instant) d.remove();
      else {
        d.classList.remove('on');
        window.setTimeout(() => d.remove(), 160);
      }
    }
    this.washes = [];
  }

  // ---- motion ----

  private animateIn(el: HTMLElement, at: Placed): void {
    el.style.transformOrigin = `${at.leftward ? '100%' : '0'} ${at.up ? '100%' : '0'}`;
    el.style.opacity = '0';
    const reduced = reducedMotion();
    if (reduced) {
      // Reduced motion: a 150 ms cross-fade, no scale or travel.
      el.getBoundingClientRect();
      el.style.transition = 'opacity 150ms ease, background-color 90ms ease';
      el.style.opacity = '1';
      this.lastMotion = { open: el.style.transition, reduced };
      return;
    }
    // Scale 0.96 -> 1 with 4 px of travel from the anchor corner on the spring, fading in 90 ms.
    el.style.transform = `translateY(${at.up ? 4 : -4}px) scale(0.96)`;
    el.getBoundingClientRect();
    el.style.transition = `opacity 90ms ${EXPAND}, transform 200ms ${SPRING}, background-color 90ms ease`;
    el.style.opacity = '1';
    el.style.transform = 'none';
    this.lastMotion = { open: el.style.transition, reduced };
    // Drop the transform when it lands so the text re-renders crisp.
    this.timers.push(
      window.setTimeout(() => {
        el.style.transition = 'background-color 90ms ease';
        el.style.transform = '';
      }, 200)
    );
  }

  private animateOut(el: HTMLElement, mode: CloseMode): void {
    el.style.pointerEvents = 'none';
    el.removeAttribute('role');
    if (mode === 'instant') {
      el.remove();
      return;
    }
    const reduced = reducedMotion();
    if (mode === 'chosen' || reduced) {
      el.style.transition = `opacity ${reduced ? 150 : 100}ms ease`;
    } else {
      el.style.transition = `opacity 120ms ${EXIT}, transform 120ms ${EXIT}`;
      el.style.transform = 'scale(0.985)';
    }
    el.style.opacity = '0';
    window.setTimeout(() => el.remove(), reduced ? 170 : 140);
  }

  // ---- plate and focus ----

  private setActive(p: Panel, i: number, how: 'mouse' | 'key'): void {
    const prev = p.active;
    p.active = i;
    p.entries.forEach((e, j) => e.el.classList.toggle('active', j === i));
    if (i < 0) {
      p.el.removeAttribute('aria-activedescendant');
      this.hidePlate(p);
      return;
    }
    const entry = p.entries[i];
    p.el.setAttribute('aria-activedescendant', entry.el.id);
    const dis = !!entry.row.disabled;
    // Disabled rows take keyboard focus (a faint plate) but never light up under the pointer.
    if (how === 'mouse' && dis) {
      this.hidePlate(p);
      return;
    }
    const glide = !reducedMotion() && p.plateShown && prev >= 0 && Math.abs(i - prev) === 1;
    p.plate.style.transition = glide ? `top 90ms ${SPRING}, opacity 60ms ease` : 'opacity 60ms ease';
    p.plate.style.top = `${entry.el.offsetTop}px`;
    p.plate.classList.toggle('dis', dis);
    p.plate.classList.remove('press');
    p.plate.style.opacity = '1';
    p.plateShown = true;
    if (how === 'key') entry.el.scrollIntoView({ block: 'nearest' });
  }

  private hidePlate(p: Panel): void {
    p.plate.style.transition = 'opacity 120ms ease';
    p.plate.style.opacity = '0';
    p.plateShown = false;
  }

  private move(p: Panel, dir: 1 | -1): void {
    const n = p.entries.length;
    if (!n) return;
    this.lastInput = 'key';
    const i = p.active < 0 ? (dir > 0 ? 0 : n - 1) : (p.active + dir + n) % n;
    this.setActive(p, i, 'key');
  }

  private moveTo(p: Panel, i: number): void {
    this.lastInput = 'key';
    this.setActive(p, i, 'key');
  }

  /** A letter: its access key runs at once; letters shared by several rows step through them. */
  private accessKey(p: Panel, ch: string): void {
    const k = ch.toLowerCase();
    const hits = p.entries.map((e, i) => (e.access === k && !e.row.disabled ? i : -1)).filter((i) => i >= 0);
    if (!hits.length) return;
    if (hits.length === 1) {
      this.setActive(p, hits[0], 'key');
      this.activate(p, hits[0]);
      return;
    }
    const next = hits.find((i) => i > p.active) ?? hits[0];
    this.setActive(p, next, 'key');
  }

  private activate(p: Panel, i: number): void {
    const entry = p.entries[i];
    if (!entry || entry.row.disabled) return;
    if (entry.row.submenu) {
      this.openSub(p, i, true);
      return;
    }
    // The chosen row stays lit while the menu fades; the action fires at once. It runs before the
    // owner's onClose (a page menu's onClose ends Firefox's context menu session, which the action
    // may still need: spelling, media and save commands read it).
    this.setActive(p, i, 'key');
    entry.el.classList.remove('pressed');
    const run = entry.row.run;
    const icon = (entry.el.querySelector('.vt-mi-icon') ?? entry.el).getBoundingClientRect();
    this.lastIcon = { x: Math.round(icon.left + icon.width / 2), y: Math.round(icon.top + icon.height / 2) };
    // Assistive technology moved focus to the menu: the page gets it back before an edit command runs.
    if (this.tookFocus) this.restoreFocus();
    const spec = this.teardown('chosen');
    try {
      run?.();
    } catch (err) {
      console.error('Deer: menu action failed', err);
    }
    if (spec) this.finish(spec, 'chosen');
  }

  // ---- submenus ----

  private openSub(p: Panel, i: number, focusFirst: boolean): void {
    clearTimeout(this.subTimer);
    this.subTimer = 0;
    const entry = p.entries[i];
    if (!entry?.row.submenu) return;
    if (p.child && p.child.parentIndex === i) {
      if (focusFirst) {
        this.focus = p.child;
        this.focusFirst(p.child);
      }
      return;
    }
    this.closeSub(p);
    const rows = tidy(entry.row.submenu);
    if (!rows.some(isCommand)) return;
    const off = this.container().getBoundingClientRect();
    const child = this.build(rows, this.theme, p, i);
    const w = menuWidth(rows);
    const H = window.innerHeight;
    const W = window.innerWidth;
    const hgt = Math.min(menuHeight(rows, this.touchRows ? 40 : 34), H - 2 * MARGIN);
    const r = entry.el.getBoundingClientRect();
    const pr = p.el.getBoundingClientRect();
    let left = pr.right - 2;
    let leftward = false;
    if (left + w > W - MARGIN) {
      left = pr.left - w + 2;
      leftward = true;
    }
    const top = clamp(r.top - 6, MARGIN, Math.max(MARGIN, H - MARGIN - hgt));
    left = clamp(left, MARGIN, Math.max(MARGIN, W - MARGIN - w));
    child.el.style.left = `${left - off.left}px`;
    child.el.style.top = `${top - off.top}px`;
    child.el.style.width = `${w}px`;
    child.el.style.maxHeight = `${H - 2 * MARGIN}px`;
    child.box = { left, top, width: w, height: hgt };
    if (this.root?.el.classList.contains('keys')) child.el.classList.add('keys');
    if (this.root?.el.classList.contains('t-raised')) child.el.classList.add('t-raised');
    p.child = child;
    entry.el.setAttribute('aria-expanded', 'true');
    this.host.append(child.el);
    this.animateIn(child.el, { left, top, up: false, leftward });
    if (focusFirst) {
      this.focus = child;
      this.focusFirst(child);
    }
  }

  /** The key panel is still one of the open panels. */
  private keyPanelOpen(): boolean {
    for (let p = this.root; p; p = p.child) if (p === this.focus) return true;
    return false;
  }

  private focusFirst(p: Panel): void {
    this.lastInput = 'key';
    const first = p.entries.findIndex((e) => !e.row.disabled);
    this.setActive(p, first >= 0 ? first : 0, 'key');
  }

  /** Close the submenus below `p` (p stays open, its row stays lit). */
  private closeSub(p: Panel): void {
    const child = p.child;
    if (!child) return;
    for (let c: Panel | null = child; c; c = c.child) c.el.remove();
    p.child = null;
    if (!this.keyPanelOpen()) this.focus = p;
    p.entries[child.parentIndex]?.el.removeAttribute('aria-expanded');
    if (this.lastInput === 'key' && p.active >= 0) this.setActive(p, p.active, 'key');
  }

  // ---- events ----

  private wirePanel(p: Panel): void {
    const indexOf = (t: EventTarget | null): number => {
      const row = (t as HTMLElement | null)?.closest?.('.vt-mi') as HTMLElement | null;
      return row && row.parentElement === p.list ? Number(row.dataset.i) : -1;
    };
    // Keep focus where it is: clicking the menu must not blur the page or a Deer field.
    p.el.addEventListener('mousedown', (e) => e.preventDefault());
    p.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    p.el.addEventListener('mousemove', (e) => {
      if (!this.spec) return;
      const i = indexOf(e.target);
      this.lastInput = 'mouse';
      // The pointer's menu has the keys (as in Windows).
      this.focus = p;
      // The pointer is back in this panel: its own submenu stays only while it hovers that row.
      if (i >= 0) {
        if (i !== p.active || !p.plateShown) this.setActive(p, i, 'mouse');
        const entry = p.entries[i];
        clearTimeout(this.subTimer);
        this.subTimer = 0;
        if (entry.row.submenu && !entry.row.disabled && p.child?.parentIndex !== i) {
          this.subTimer = window.setTimeout(() => this.spec && this.openSub(p, i, false), SUBMENU_DELAY);
        } else if (p.child && p.child.parentIndex !== i) {
          this.subTimer = window.setTimeout(() => this.spec && this.closeSub(p), SUBMENU_DELAY);
        }
      } else if ((e.target as HTMLElement).closest?.('.vt-caption')) {
        this.setActive(p, -1, 'mouse');
      }
    });
    p.el.addEventListener('mouseleave', () => {
      this.clearPressed(p);
      // A row whose submenu is open stays lit.
      if (this.lastInput === 'mouse' && !p.child) this.setActive(p, -1, 'mouse');
    });
    p.el.addEventListener('mousedown', (e) => {
      const i = indexOf(e.target);
      if (i < 0 || (e.button !== 0 && e.button !== 2) || p.entries[i].row.disabled) return;
      p.pressed = i;
      this.setActive(p, i, 'mouse');
      p.entries[i].el.classList.add('pressed');
      p.plate.classList.add('press');
    });
    p.el.addEventListener('mouseup', (e) => {
      const i = indexOf(e.target);
      this.clearPressed(p);
      // Left click, or releasing the right button on an item, runs it.
      if (i < 0 || (e.button !== 0 && e.button !== 2) || p.entries[i].row.disabled) return;
      if (e.button === 2) this.quietUntil = performance.now() + 400;
      this.activate(p, i);
    });
    let scrollTimer = 0;
    p.list.addEventListener('scroll', () => {
      p.list.classList.add('scrolling');
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => p.list.classList.remove('scrolling'), 700);
    });
  }

  private clearPressed(p: Panel): void {
    if (p.pressed < 0) return;
    p.entries[p.pressed]?.el.classList.remove('pressed');
    p.plate.classList.remove('press');
    p.pressed = -1;
  }

  private wireCatcher(): void {
    const c = this.catcher;
    const release = (): void => {
      this.catcherHeld = false;
      if (!this.spec) {
        c.setAttribute('data-off', '');
        if (this.top) this.releaseTop(0);
      }
    };
    c.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 2) {
        // A right press outside: the menu goes and the catcher with it, so the contextmenu that
        // follows the release lands on whatever is underneath and opens a fresh menu there.
        this.catcherHeld = false;
        this.close('dismiss');
        c.setAttribute('data-off', '');
        return;
      }
      // Any other press closes the menu and is absorbed (the link under it is not followed).
      this.catcherHeld = true;
      this.close('dismiss');
      window.setTimeout(release, 1500); // never leave the catcher up if the release is lost
    });
    c.addEventListener('mouseup', (e) => {
      e.stopPropagation();
      release();
    });
    c.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      release();
    });
    c.addEventListener(
      'wheel',
      () => {
        this.close('dismiss');
        c.setAttribute('data-off', '');
      },
      { passive: true }
    );
  }

  private takeFocus(el: HTMLElement): void {
    this.prevFocus = document.activeElement;
    this.tookFocus = false;
    // The page or Deer's field keeps focus (its selection stays lit, edit commands reach it) and the
    // key router hands the keys to the menu. Assistive technology gets the menu focused instead.
    if (!gecko.a11yActive()) return;
    this.tookFocus = true;
    el.focus({ preventScroll: true });
  }

  /** Put focus back before a row runs or when the menu closes (assistive technology only). */
  restoreFocus(): void {
    const prev = this.prevFocus;
    if (prev instanceof Element && prev.isConnected && (prev as HTMLElement).focus) (prev as HTMLElement).focus({ preventScroll: true });
  }

  /** Over code views, video and dark sites the menu takes the raised tint so it sits lighter. */
  private sampleBackdrop(el: HTMLElement, spec: Spec, at: Placed, w: number, hgt: number): void {
    const browser = spec.backdrop;
    if (!browser || !browser.isConnected) return;
    const r = browser.getBoundingClientRect();
    const x = clamp(at.left - r.left, 0, r.width);
    const y = clamp(at.top - r.top, 0, r.height);
    const rect = { x: Math.round(x), y: Math.round(y), width: Math.round(clamp(w, 1, r.width - x)), height: Math.round(clamp(hgt, 1, r.height - y)) };
    if (rect.width < 8 || rect.height < 8) return;
    this.b
      .luma(browser, rect)
      .then((luma) => {
        if (luma !== null && luma < RAISED_LUMA && this.root?.el === el) {
          el.classList.add('t-raised');
          for (let c = this.root.child; c; c = c.child) c.el.classList.add('t-raised');
        }
        el.dataset.luma = luma === null ? '' : luma.toFixed(3);
      })
      .catch(() => undefined);
  }
}
