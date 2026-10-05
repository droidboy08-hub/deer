// A small Vitre menu for the downloads surfaces (ring, row "More", speed limit), built to the
// right-click menu spec: frost, 34 px rows, icon column at 16, label at 44, accelerators right,
// access keys underlined when opened by keyboard, Up/Down/Home/End/Enter/Space/Esc.
import type { Browser } from '../../app';
import { esc } from './format';
import { ic } from './icons';

export interface MenuItem {
  label: string;
  /** Access key, a letter of the label. */
  key?: string;
  accel?: string;
  icon?: string;
  checked?: boolean;
  disabled?: boolean;
  run: () => void;
}

export type MenuEntry = MenuItem | 'separator';

export interface MenuPlace {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let current: { close: (how: 'dismiss' | 'activate') => void } | null = null;

export function closeMenu(): void {
  current?.close('dismiss');
}

export function openMenu(b: Browser, label: string, entries: MenuEntry[], place: MenuPlace, opts: { keyboard?: boolean; returnFocus?: HTMLElement | null } = {}): void {
  current?.close('dismiss');
  const layer = b.layer('downloads-menu', 50);
  const catcher = document.createElement('div');
  catcher.className = 'vd-menu-catcher';
  const menu = document.createElement('div');
  menu.className = `vd-menu ${menuTheme(b)}${opts.keyboard ? ' keys' : ''}`;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);
  menu.tabIndex = -1;
  const rows: HTMLElement[] = [];
  const items: MenuItem[] = [];
  for (const e of entries) {
    if (e === 'separator') {
      if (!menu.lastElementChild || menu.lastElementChild.classList.contains('vd-sep')) continue;
      const sep = document.createElement('div');
      sep.className = 'vd-sep';
      sep.setAttribute('role', 'separator');
      menu.append(sep);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'vd-mi';
    row.setAttribute('role', e.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (e.checked !== undefined) row.setAttribute('aria-checked', String(e.checked));
    if (e.disabled) row.setAttribute('aria-disabled', 'true');
    if (e.accel) row.setAttribute('aria-keyshortcuts', e.accel.replace(/\s+/g, ''));
    row.tabIndex = -1;
    row.innerHTML = `<span class="vd-mi-icon">${e.checked ? ic.check : (e.icon ?? '')}</span><span class="vd-mi-label">${underline(e.label, e.key)}</span>${e.accel ? `<span class="vd-mi-accel">${esc(e.accel)}</span>` : ''}`;
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
  let left = place.left ?? (place.right !== undefined ? place.right - width : 8);
  let top = place.top ?? (place.bottom !== undefined ? place.bottom - h : 8);
  left = Math.max(8, Math.min(left, W - width - 8));
  top = Math.max(8, Math.min(top, H - h - 8));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  const fromRight = place.right !== undefined && place.left === undefined;
  const fromBottom = place.bottom !== undefined && place.top === undefined;
  menu.style.transformOrigin = `${fromRight ? 'right' : 'left'} ${fromBottom ? 'bottom' : 'top'}`;
  if (!reduced()) {
    menu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 90, easing: 'cubic-bezier(0.2,0,0,1)' });
    menu.animate([{ transform: `translate(${fromRight ? 4 : -4}px, ${fromBottom ? 4 : -4}px) scale(0.96)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(0.22,1,0.36,1)' });
  } else {
    menu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
  }

  let sel = -1;
  const select = (i: number) => {
    sel = i;
    rows.forEach((r, j) => r.classList.toggle('sel', j === i));
    if (i >= 0) rows[i].focus({ preventScroll: true });
    else menu.focus({ preventScroll: true });
  };
  const move = (dir: 1 | -1) => {
    if (!rows.length) return;
    select(((sel < 0 ? (dir > 0 ? -1 : 0) : sel) + dir + rows.length) % rows.length);
  };
  let closed = false;
  const close = (how: 'dismiss' | 'activate') => {
    if (closed) return;
    closed = true;
    current = null;
    lost.abort();
    unEsc();
    catcher.remove();
    menu.style.pointerEvents = 'none';
    const done = () => menu.remove();
    if (reduced()) menu.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150 }).onfinish = done;
    else menu.animate(how === 'activate' ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.985)' }], { duration: how === 'activate' ? 100 : 120, easing: 'ease-out', fill: 'forwards' }).onfinish = done;
    opts.returnFocus?.focus({ preventScroll: true });
  };
  const activate = (i: number) => {
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
      const i = items.findIndex((it) => !it.disabled && it.key?.toLowerCase() === e.key.toLowerCase());
      if (i >= 0) activate(i);
      else return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  // Context loss (blur, resize) closes the menu; the listeners go with it.
  const lost = new AbortController();
  window.addEventListener('blur', () => close('dismiss'), { signal: lost.signal });
  window.addEventListener('resize', () => close('dismiss'), { signal: lost.signal });
  if (opts.keyboard) {
    const first = items.findIndex((it) => !it.disabled);
    select(first >= 0 ? first : 0);
  } else menu.focus({ preventScroll: true });
}

function underline(label: string, key?: string): string {
  if (!key) return esc(label);
  const i = label.toLowerCase().indexOf(key.toLowerCase());
  if (i < 0) return esc(label);
  return `${esc(label.slice(0, i))}<span class="vd-ak">${esc(label[i])}</span>${esc(label.slice(i + 1))}`;
}

/** Menus follow Vitre's appearance (Match Windows by default), never the page. */
export function menuTheme(b: Browser): 'dark' | 'light' {
  const t = b.settings.theme;
  if (t === 'dark' || t === 'light') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
