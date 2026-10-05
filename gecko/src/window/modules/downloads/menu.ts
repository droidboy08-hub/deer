// Menus for the downloads surfaces (the ring, a row's "More" button and right-click, the speed
// limit). They go through the 'menus' service (src/window/modules/menus: Deer's one glass menu
// system), read at the moment of use. When that module is not in the build, a small menu built to
// the same spec (frost, 34 px rows, icon column at 16, label at 44, accelerators right as plain dim
// text, access keys underlined when opened by keyboard) stands in; it is the Electron build's
// app/src/renderer/modules/downloads/menu.ts.
import type { Browser } from '../../browser';
import { el } from '../../dom';
import { ic, node } from './icons';

export interface Entry {
  label: string;
  /** Accelerator printed on the right ("Ctrl+J", "Delete"). */
  key?: string;
  /** Access key: a letter of the label. */
  access?: string;
  /** Glyph name of the menus module's set ('download', 'folder', 'copy', 'pause', 'play', 'reload'...). */
  icon?: string;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  run: () => void;
}
export type MenuEntry = Entry | 'separator';

/** Where a menu opens: hanging from an element, or at a window point. */
export type Place = { at: Element; align?: 'start' | 'end' | 'above-start' | 'above-end' } | { x: number; y: number; align?: 'start' | 'end' | 'above-start' | 'above-end' };

/** The 'menus' service, typed by its provider (menus/types.ts MenusApi); null when the build has none. */
function menusService(b: Browser): VitreServices['menus'] | null {
  const s = b.service('menus');
  return s && typeof s.show === 'function' ? s : null;
}

/** The fallback menu's glyphs (markup), by the menus module's names. */
const GLYPHS: Record<string, string> = {
  download: ic.download(16, 1.5),
  folder: ic.folder(),
  copy: ic.copy,
  pause: ic.pause(14),
  play: ic.play(14),
  reload: ic.retry,
  open: ic.open,
  close: ic.cancel,
  remove: ic.remove,
  link: ic.link,
};

let current: { close: (how: 'dismiss' | 'activate') => void } | null = null;

export function closeMenu(b: Browser): void {
  current?.close('dismiss');
  try {
    menusService(b)?.close();
  } catch {
    /* their menu is gone already */
  }
}

export function openMenu(b: Browser, label: string, entries: MenuEntry[], place: Place, opts: { keyboard?: boolean; owner?: Element | null; returnFocus?: HTMLElement | null } = {}): void {
  const menus = menusService(b);
  if (menus) {
    const items = entries.map((e) =>
      e === 'separator' ? { separator: true as const } : { label: e.label, key: e.key, access: e.access, icon: e.icon, checked: e.checked, disabled: e.disabled, danger: e.danger, run: e.run }
    );
    const at = 'at' in place ? place.at : { x: place.x, y: place.y };
    menus.show(items, at, {
      align: place.align ?? 'start',
      keyboard: !!opts.keyboard,
      label,
      owner: opts.owner ?? null,
      onClose: () => {
        if (opts.returnFocus?.isConnected && !document.activeElement?.closest?.('#vitre-root [role="dialog"]')) opts.returnFocus.focus({ preventScroll: true });
      },
    });
    return;
  }
  fallbackMenu(b, label, entries, place, opts);
}

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Menus follow Deer's appearance (Match Windows by default), never the page. */
function menuTheme(b: Browser): 'dark' | 'light' {
  const t = b.settings.theme;
  if (t === 'dark' || t === 'light') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function underlined(label: string, key?: string): (Node | string)[] {
  if (!key) return [label];
  const i = label.toLowerCase().indexOf(key.toLowerCase());
  if (i < 0) return [label];
  return [label.slice(0, i), el('span', { class: 'vd-ak' }, label[i]), label.slice(i + 1)];
}

function fallbackMenu(b: Browser, label: string, entries: MenuEntry[], place: Place, opts: { keyboard?: boolean; returnFocus?: HTMLElement | null }): void {
  current?.close('dismiss');
  const layer = b.layer('downloads-menu', 50);
  const catcher = el('div', { class: 'vd-menu-catcher' });
  const menu = el('div', { class: `vd-menu ${menuTheme(b)}${opts.keyboard ? ' keys' : ''}`, role: 'menu', 'aria-label': label, tabindex: '-1' });
  const rows: HTMLElement[] = [];
  const items: Entry[] = [];
  for (const e of entries) {
    if (e === 'separator') {
      if (!menu.lastElementChild || menu.lastElementChild.classList.contains('vd-sep')) continue;
      menu.append(el('div', { class: 'vd-sep', role: 'separator' }));
      continue;
    }
    const iconCell = el('span', { class: 'vd-mi-icon' });
    const glyph = e.checked ? ic.check : e.icon ? GLYPHS[e.icon] : '';
    if (glyph) iconCell.append(node(glyph));
    const row = el(
      'div',
      {
        class: `vd-mi${e.danger ? ' danger' : ''}`,
        role: e.checked === undefined ? 'menuitem' : 'menuitemcheckbox',
        'aria-checked': e.checked === undefined ? null : String(e.checked),
        'aria-disabled': e.disabled ? 'true' : null,
        'aria-keyshortcuts': e.key && /^(Ctrl|Alt|Shift|Delete|Space|Enter|F\d)/.test(e.key) ? e.key.replace(/\s+/g, '') : null,
        tabindex: '-1',
      },
      iconCell,
      el('span', { class: 'vd-mi-label' }, ...underlined(e.label, e.access)),
      e.key ? el('span', { class: 'vd-mi-accel' }, e.key) : null
    );
    rows.push(row);
    items.push(e);
    menu.append(row);
  }
  while (menu.lastElementChild?.classList.contains('vd-sep')) menu.lastElementChild.remove();
  layer.append(catcher, menu);

  // Width fits the content in 8 px steps, 264 to 360.
  const width = Math.min(360, Math.max(264, Math.ceil(menu.scrollWidth / 8) * 8));
  menu.style.width = `${width}px`;
  const h = menu.offsetHeight;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const align = place.align ?? 'start';
  let left: number;
  let top: number;
  if ('at' in place) {
    const r = place.at.getBoundingClientRect();
    left = align.endsWith('end') ? r.right - width : r.left;
    top = align.startsWith('above') ? r.top - 8 - h : r.bottom + 8;
  } else {
    left = align.endsWith('end') ? place.x - width : place.x;
    top = align.startsWith('above') ? place.y - h : place.y;
  }
  left = Math.max(8, Math.min(left, W - width - 8));
  top = Math.max(8, Math.min(top, H - h - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const fromRight = align.endsWith('end');
  const fromBottom = align.startsWith('above');
  menu.style.transformOrigin = `${fromRight ? 'right' : 'left'} ${fromBottom ? 'bottom' : 'top'}`;
  if (!reduced()) {
    menu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 90, easing: 'cubic-bezier(0.2,0,0,1)' });
    menu.animate([{ transform: `translate(${fromRight ? 4 : -4}px, ${fromBottom ? 4 : -4}px) scale(0.96)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(0.22,1,0.36,1)' });
  } else menu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });

  let sel = -1;
  const select = (i: number): void => {
    sel = i;
    rows.forEach((r, j) => r.classList.toggle('sel', j === i));
    if (i >= 0) rows[i].focus({ preventScroll: true });
    else menu.focus({ preventScroll: true });
  };
  const move = (dir: 1 | -1): void => {
    if (!rows.length) return;
    select(((sel < 0 ? (dir > 0 ? -1 : 0) : sel) + dir + rows.length) % rows.length);
  };
  let closed = false;
  const lost = new AbortController();
  const close = (how: 'dismiss' | 'activate'): void => {
    if (closed) return;
    closed = true;
    current = null;
    lost.abort();
    unEsc();
    catcher.remove();
    menu.style.pointerEvents = 'none';
    const done = (): void => menu.remove();
    if (reduced()) menu.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150 }).onfinish = done;
    else menu.animate(how === 'activate' ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.985)' }], { duration: how === 'activate' ? 100 : 120, easing: 'ease-out', fill: 'forwards' }).onfinish = done;
    opts.returnFocus?.focus({ preventScroll: true });
  };
  const activate = (i: number): void => {
    const item = items[i];
    if (!item || item.disabled) return;
    close('activate');
    item.run();
  };
  const unEsc = b.addEscLayer(20, () => {
    close('dismiss');
    return true;
  });
  current = { close };

  catcher.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    close('dismiss');
  });
  catcher.addEventListener('contextmenu', (e) => e.preventDefault());
  menu.addEventListener('contextmenu', (e) => e.preventDefault());
  rows.forEach((row, i) => {
    row.addEventListener('pointerenter', () => select(i));
    row.addEventListener('pointerleave', () => {
      if (sel === i) select(-1);
    });
    row.addEventListener('click', () => activate(i));
  });
  menu.addEventListener('keydown', (e) => {
    if (closed) return;
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) move(1);
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) move(-1);
    else if (e.key === 'Home') select(0);
    else if (e.key === 'End') select(rows.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      if (sel >= 0) activate(sel);
    } else if (e.key === 'Escape' || e.key === 'Alt' || e.key === 'F10') close('dismiss');
    else if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
      const i = items.findIndex((it) => !it.disabled && it.access?.toLowerCase() === e.key.toLowerCase());
      if (i >= 0) activate(i);
      else return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  // Context loss (blur, resize) closes the menu; the listeners go with it.
  window.addEventListener('blur', () => close('dismiss'), { signal: lost.signal });
  window.addEventListener('resize', () => close('dismiss'), { signal: lost.signal });
  if (opts.keyboard) {
    const first = items.findIndex((it) => !it.disabled);
    select(first >= 0 ? first : 0);
  } else menu.focus({ preventScroll: true });
}
