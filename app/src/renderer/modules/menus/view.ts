// One menu at a time, drawn in the menus layer (z 50): frosted glass, 34 px rows, one plate for
// hover and keyboard focus, placement with flips near the edges, and the open / choose / dismiss
// motion from MenuMotion. A full-window catcher under the menu absorbs the dismissing click.
import { iconSvg } from './icons';
import type { MenuAnchor, MenuItem, MenuKeyLike, MenuRow, MenuSpec } from './types';

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

export type MenuTheme = 'dark' | 'light';
type CloseMode = 'chosen' | 'dismiss' | 'instant';

interface Entry {
  row: MenuItem;
  el: HTMLElement;
}

interface Placed {
  left: number;
  top: number;
  up: boolean;
  leftward: boolean;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const textWidth = (() => {
  const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
  return (text: string, px: number, weight = 400): number => {
    ctx.font = `${weight} ${px}px 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif`;
    return ctx.measureText(text).width;
  };
})();

/** A row's natural width: icon column to x 44, label, 32 clear, accelerator, 16. */
function rowWidth(label: string, accel?: string, bold = false): number {
  return 44 + textWidth(label, 14, bold ? 600 : 400) + (accel ? 32 + textWidth(accel, 12) : 0) + 16;
}

/** The row fits the widest menu (360) without its label being cut. */
export function rowFits(label: string, accel?: string): boolean {
  return rowWidth(label, accel) <= MAX_W;
}

/** Width fits the content in 8 px steps, 264 to 360. */
function menuWidth(rows: MenuRow[]): number {
  let need = 0;
  for (const r of rows) if (r.type === 'item') need = Math.max(need, rowWidth(r.label, r.accel, r.bold));
  return clamp(Math.ceil(need / 8) * 8, MIN_W, MAX_W);
}

function menuHeight(rows: MenuRow[], rowH: number): number {
  return 12 + rows.reduce((h, r) => h + (r.type === 'sep' ? SEP_H : r.type === 'caption' ? CAPTION_H : rowH), 0);
}

function place(a: MenuAnchor, w: number, h: number): Placed {
  const W = window.innerWidth;
  const H = window.innerHeight;
  let left = 0;
  let top = 0;
  let up = false;
  let leftward = false;
  switch (a.kind) {
    case 'point':
      left = a.x;
      top = a.y;
      if (left + w > W - MARGIN) {
        left = a.x - w;
        leftward = true;
      }
      if (top + h > H - MARGIN) {
        top = a.y - h;
        up = true;
      }
      break;
    case 'below': {
      left = a.left;
      top = a.bottom + 4;
      const roomBelow = H - MARGIN - top;
      const roomAbove = a.top - 4 - MARGIN;
      if (h > roomBelow && (h <= roomAbove || roomAbove > roomBelow)) {
        top = a.top - 4 - h;
        up = true;
      }
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
    left: Math.round(clamp(left, MARGIN, W - MARGIN - w)),
    top: Math.round(clamp(top, MARGIN, H - MARGIN - h)),
    up,
    leftward,
  };
}

/** The access key's letter: the first at a word start, otherwise the first anywhere. */
function accessIndex(label: string, key: string | undefined): number {
  if (!key) return -1;
  const low = label.toLowerCase();
  const k = key.toLowerCase();
  for (let i = 0; i < low.length; i++) {
    if (low[i] === k && (i === 0 || /[\s“("']/.test(low[i - 1]))) return i;
  }
  return low.indexOf(k);
}

function ariaKeys(accel: string | undefined): string | null {
  if (!accel || !/^(Ctrl|Alt|Shift|Esc|F\d)/.test(accel) || /click$/i.test(accel)) return null;
  return accel
    .replace(/\bCtrl\b/g, 'Control')
    .replace(/\bEsc\b/, 'Escape')
    .replace(/\bLeft\b/, 'ArrowLeft')
    .replace(/\bRight\b/, 'ArrowRight');
}

function itemElement(r: MenuItem, id: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'vt-mi';
  el.id = id;
  el.setAttribute('role', r.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
  if (r.checked !== undefined) el.setAttribute('aria-checked', String(r.checked));
  el.setAttribute('aria-disabled', String(!!r.disabled));
  const keys = ariaKeys(r.accel);
  if (keys) el.setAttribute('aria-keyshortcuts', keys);
  if (r.bold) el.classList.add('bold');
  el.innerHTML = iconSvg(r.checked === undefined ? r.icon : r.checked ? 'check' : undefined);

  const label = document.createElement('span');
  label.className = 'vt-mi-label';
  const i = accessIndex(r.label, r.key);
  if (i >= 0) {
    const ak = document.createElement('span');
    ak.className = 'vt-ak';
    ak.textContent = r.label.slice(i, i + 1);
    label.append(r.label.slice(0, i), ak, r.label.slice(i + 1));
  } else {
    label.textContent = r.label;
  }
  el.append(label);
  if (r.accel) {
    const accel = document.createElement('span');
    accel.className = 'vt-mi-accel';
    accel.textContent = r.accel;
    el.append(accel);
  }
  return el;
}

export class MenuView {
  /** A right-click outside an open menu: the caller reopens a menu for whatever is under it. */
  onOutsideRightClick: ((x: number, y: number, shift: boolean) => void) | null = null;

  private readonly root: HTMLElement;
  private readonly catcher: HTMLElement;
  private spec: MenuSpec | null = null;
  private el: HTMLElement | null = null;
  private plate: HTMLElement | null = null;
  private entries: Entry[] = [];
  private active = -1;
  private plateShown = false;
  private pressed = -1;
  private lastInput: 'mouse' | 'key' = 'mouse';
  private prevFocus: Element | null = null;
  private tookFocus = false;
  private borrowed: ((on: boolean) => void) | null = null;
  private washes: HTMLElement[] = [];
  private timers: number[] = [];
  private unlisten: (() => void)[] = [];
  private catcherHeld = false;
  private seq = 0;
  /** Releasing the right button on an item runs it; the contextmenu that follows is swallowed until then. */
  private quietUntil = 0;

  constructor(layer: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'vt-menus';
    this.catcher = document.createElement('div');
    this.catcher.className = 'vt-catcher';
    this.catcher.hidden = true;
    this.root.append(this.catcher);
    layer.append(this.root);
    this.wireCatcher();
    // The fading menu ignores the pointer, so that contextmenu would land on whatever is under it
    // (Home, a tab circle) and open a second menu.
    window.addEventListener(
      'contextmenu',
      (e) => {
        if (performance.now() > this.quietUntil) return;
        this.quietUntil = 0;
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );
  }

  get isOpen(): boolean {
    return this.spec !== null;
  }

  open(spec: MenuSpec, theme: MenuTheme): void {
    if (this.spec) this.close('instant', false);
    if (!spec.rows.some((r) => r.type === 'item')) return;
    this.spec = spec;
    this.seq++;
    const touchRows = spec.source === 'touch' || spec.source === 'pen';
    const rowH = touchRows ? 40 : 34;
    const w = menuWidth(spec.rows);
    const h = Math.min(menuHeight(spec.rows, rowH), window.innerHeight - 2 * MARGIN);
    const at = place(spec.anchor, w, h);

    const el = this.build(spec, theme, touchRows);
    el.style.left = `${at.left}px`;
    el.style.top = `${at.top}px`;
    el.style.width = `${w}px`;
    el.style.maxHeight = `${window.innerHeight - 2 * MARGIN}px`;
    this.catcher.hidden = false;
    this.root.append(el);
    this.showWash(spec.wash ?? []);
    spec.owner?.classList.add('vt-menu-owner');
    spec.ownerButton?.setAttribute('aria-haspopup', 'menu');
    spec.ownerButton?.setAttribute('aria-expanded', 'true');
    this.takeFocus(el, spec);
    this.animateIn(el, at);
    this.watchContext(spec);
    if (spec.source === 'keyboard') {
      el.classList.add('keys');
      this.lastInput = 'key';
      const first = this.entries.findIndex((e) => !e.row.disabled);
      this.setActive(first >= 0 ? first : 0, 'key');
    } else {
      this.lastInput = 'mouse';
    }
    if (theme === 'dark') this.sampleBackdrop(el, spec, at, w, h);
  }

  /** Close the menu. `restore` returns focus where it was before the menu opened. */
  close(mode: CloseMode, restore = true): void {
    const spec = this.spec;
    const el = this.el;
    if (!spec || !el) return;
    this.spec = null;
    this.el = null;
    this.plate = null;
    this.entries = [];
    this.active = -1;
    this.pressed = -1;
    this.plateShown = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const off of this.unlisten) off();
    this.unlisten = [];
    if (!this.catcherHeld) this.catcher.hidden = true;
    this.hideWash(mode === 'instant');
    spec.owner?.classList.remove('vt-menu-owner');
    spec.ownerButton?.removeAttribute('aria-haspopup');
    spec.ownerButton?.removeAttribute('aria-expanded');
    this.animateOut(el, mode);
    this.borrowed?.(false);
    this.borrowed = null;
    if (this.tookFocus && restore) this.restoreFocus();
    this.tookFocus = false;
    this.prevFocus = null;
  }

  /** A keydown while a menu is open: menu keys act, everything else is swallowed. */
  handleKey(e: MenuKeyLike): void {
    if (!this.spec) return;
    const k = e.key;
    if (k === 'ArrowDown' || (k === 'Tab' && !e.shiftKey)) this.move(1);
    else if (k === 'ArrowUp' || (k === 'Tab' && e.shiftKey)) this.move(-1);
    else if (k === 'Home') this.moveTo(0);
    else if (k === 'End') this.moveTo(this.entries.length - 1);
    else if (k === 'Enter' || k === ' ') {
      if (!e.repeat && this.active >= 0) this.activate(this.active);
    } else if (k === 'Escape' || k === 'Alt' || k === 'F10' || k === 'ContextMenu') {
      if (!e.repeat) this.close('dismiss');
    } else if (k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && !e.repeat) {
      this.accessKey(k);
    }
  }

  // ---- building ----

  private build(spec: MenuSpec, theme: MenuTheme, touchRows: boolean): HTMLElement {
    const el = document.createElement('div');
    el.className = `vt-menu t-${theme}${touchRows ? ' touch' : ''}`;
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', spec.label);
    el.tabIndex = -1;
    const list = document.createElement('div');
    list.className = 'vt-menu-list';
    const plate = document.createElement('div');
    plate.className = 'vt-plate';
    list.append(plate);
    this.entries = [];
    for (const r of spec.rows) {
      if (r.type === 'sep') {
        const s = document.createElement('div');
        s.className = 'vt-sep';
        s.setAttribute('role', 'separator');
        list.append(s);
      } else if (r.type === 'caption') {
        const c = document.createElement('div');
        c.className = 'vt-caption';
        c.setAttribute('aria-hidden', 'true');
        c.textContent = r.label;
        list.append(c);
      } else {
        const node = itemElement(r, `vt-mi-${this.seq}-${this.entries.length}`);
        node.dataset.i = String(this.entries.length);
        this.entries.push({ row: r, el: node });
        list.append(node);
      }
    }
    el.append(list);
    this.el = el;
    this.plate = plate;
    this.wireMenu(el, list);
    return el;
  }

  private showWash(rects: DOMRect[]): void {
    this.washes = rects.map((r) => {
      const d = document.createElement('div');
      d.className = 'vt-wash';
      Object.assign(d.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
      this.root.insertBefore(d, this.catcher.nextSibling);
      return d;
    });
    if (this.washes.length) requestAnimationFrame(() => this.washes.forEach((d) => d.classList.add('on')));
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
    if (reducedMotion()) {
      el.getBoundingClientRect();
      el.style.transition = 'opacity 150ms ease, background-color 90ms ease';
      el.style.opacity = '1';
      return;
    }
    // Scale 0.96 -> 1 with 4 px of travel from the anchor corner, on the spring, fading in 90 ms.
    el.style.transform = `translateY(${at.up ? 4 : -4}px) scale(0.96)`;
    el.getBoundingClientRect();
    el.style.transition = `opacity 90ms ${EXPAND}, transform 200ms ${SPRING}, background-color 90ms ease`;
    el.style.opacity = '1';
    el.style.transform = 'none';
    // Drop the transform when it lands so the text re-renders crisp.
    this.timers.push(
      window.setTimeout(() => {
        el.style.transition = 'background-color 90ms ease';
        el.style.transform = '';
      }, 200),
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

  private setActive(i: number, how: 'mouse' | 'key'): void {
    const prev = this.active;
    this.active = i;
    this.entries.forEach((e, j) => e.el.classList.toggle('active', j === i));
    const el = this.el;
    const plate = this.plate;
    if (!el || !plate) return;
    if (i < 0) {
      el.removeAttribute('aria-activedescendant');
      this.hidePlate();
      return;
    }
    const entry = this.entries[i];
    el.setAttribute('aria-activedescendant', entry.el.id);
    const dis = !!entry.row.disabled;
    // Disabled rows take keyboard focus (a faint plate) but never light up under the pointer.
    if (how === 'mouse' && dis) {
      this.hidePlate();
      return;
    }
    const glide = !reducedMotion() && this.plateShown && prev >= 0 && Math.abs(i - prev) === 1;
    plate.style.transition = glide ? `top 90ms ${SPRING}, opacity 60ms ease` : 'opacity 60ms ease';
    plate.style.top = `${entry.el.offsetTop}px`;
    plate.classList.toggle('dis', dis);
    plate.classList.remove('press');
    plate.style.opacity = '1';
    this.plateShown = true;
    if (how === 'key') entry.el.scrollIntoView({ block: 'nearest' });
  }

  private hidePlate(): void {
    if (!this.plate) return;
    this.plate.style.transition = 'opacity 120ms ease';
    this.plate.style.opacity = '0';
    this.plateShown = false;
  }

  private move(dir: 1 | -1): void {
    const n = this.entries.length;
    if (!n) return;
    this.lastInput = 'key';
    const i = this.active < 0 ? (dir > 0 ? 0 : n - 1) : (this.active + dir + n) % n;
    this.setActive(i, 'key');
  }

  private moveTo(i: number): void {
    this.lastInput = 'key';
    this.setActive(i, 'key');
  }

  private accessKey(ch: string): void {
    const k = ch.toLowerCase();
    const i = this.entries.findIndex((e) => e.row.key?.toLowerCase() === k && !e.row.disabled);
    if (i < 0) return;
    this.setActive(i, 'key');
    this.activate(i);
  }

  private activate(i: number): void {
    const entry = this.entries[i];
    if (!entry || entry.row.disabled) return;
    // The chosen row stays lit while the menu fades; the action fires at once.
    this.setActive(i, 'key');
    entry.el.classList.remove('pressed');
    const run = entry.row.run;
    const icon = (entry.el.querySelector('.vt-mi-icon') ?? entry.el).getBoundingClientRect();
    this.close('chosen');
    try {
      run({ x: Math.round(icon.left + 8), y: Math.round(icon.top + icon.height / 2) });
    } catch (err) {
      console.error('menu action failed', err);
    }
  }

  private takeFocus(el: HTMLElement, spec: MenuSpec): void {
    this.prevFocus = document.activeElement;
    // The page keeps OS focus, so its selection stays lit; main hands its keys to the menu.
    if (spec.borrowKeys && spec.guest && this.prevFocus === spec.guest) {
      this.borrowed = spec.borrowKeys;
      this.borrowed(true);
      return;
    }
    // A Vitre field keeps focus too (the address field closes on blur, taking the menu's target
    // with it); keys reach the menu through the window-level listener either way.
    const field = this.prevFocus instanceof HTMLInputElement || this.prevFocus instanceof HTMLTextAreaElement;
    this.tookFocus = !field;
    if (!field) el.focus({ preventScroll: true });
  }

  private restoreFocus(): void {
    const prev = this.prevFocus;
    if (prev instanceof HTMLElement && prev.isConnected && prev !== document.body) prev.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
  }

  // ---- events ----

  private wireMenu(el: HTMLElement, list: HTMLElement): void {
    const indexOf = (t: EventTarget | null): number => {
      const row = (t as HTMLElement | null)?.closest?.('.vt-mi') as HTMLElement | null;
      return row ? Number(row.dataset.i) : -1;
    };
    // Keep focus where it is: clicking the menu must not blur the page or a Vitre field.
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointermove', (e) => {
      const i = indexOf(e.target);
      this.lastInput = 'mouse';
      if (i >= 0) {
        if (i !== this.active || !this.plateShown) this.setActive(i, 'mouse');
      } else if ((e.target as HTMLElement).closest?.('.vt-caption')) {
        this.setActive(-1, 'mouse');
      }
    });
    el.addEventListener('pointerleave', () => {
      this.clearPressed();
      if (this.lastInput === 'mouse') this.setActive(-1, 'mouse');
    });
    el.addEventListener('pointerdown', (e) => {
      const i = indexOf(e.target);
      if (i < 0 || (e.button !== 0 && e.button !== 2) || this.entries[i].row.disabled) return;
      this.pressed = i;
      this.setActive(i, 'mouse');
      this.entries[i].el.classList.add('pressed');
      this.plate?.classList.add('press');
    });
    el.addEventListener('pointerup', (e) => {
      const i = indexOf(e.target);
      this.clearPressed();
      // Left click, or releasing the right button on an item, runs it.
      if (i < 0 || (e.button !== 0 && e.button !== 2) || this.entries[i].row.disabled) return;
      if (e.button === 2) this.quietUntil = performance.now() + 400;
      this.activate(i);
    });
    let scrollTimer = 0;
    list.addEventListener('scroll', () => {
      list.classList.add('scrolling');
      clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => list.classList.remove('scrolling'), 700);
    });
  }

  private clearPressed(): void {
    if (this.pressed < 0) return;
    this.entries[this.pressed]?.el.classList.remove('pressed');
    this.plate?.classList.remove('press');
    this.pressed = -1;
  }

  private wireCatcher(): void {
    const c = this.catcher;
    const release = () => {
      this.catcherHeld = false;
      if (!this.spec) c.hidden = true;
    };
    c.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.catcherHeld = true;
      this.close('dismiss');
      // Never leave the catcher up if the release is lost.
      window.setTimeout(release, 1500);
    });
    c.addEventListener('mouseup', (e) => {
      if (e.button !== 2) release();
    });
    c.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      release();
      this.onOutsideRightClick?.(e.clientX, e.clientY, e.shiftKey);
    });
    c.addEventListener('wheel', () => this.close('dismiss'), { passive: true });
  }

  /** Context loss closes a menu at once: resize, DPI change, window blur, the page navigating. */
  private watchContext(spec: MenuSpec): void {
    const instant = () => this.close('instant', false);
    const onBlur = () => {
      window.setTimeout(() => {
        if (this.spec === spec && !document.hasFocus()) instant();
      }, 0);
    };
    window.addEventListener('resize', instant);
    window.addEventListener('blur', onBlur);
    this.unlisten.push(() => {
      window.removeEventListener('resize', instant);
      window.removeEventListener('blur', onBlur);
    });
    const guest = spec.guest;
    if (guest) {
      const onNav = (e: Event) => {
        const n = e as Event & { isMainFrame?: boolean; isInPlace?: boolean };
        if (n.isMainFrame && !n.isInPlace) instant();
      };
      guest.addEventListener('did-start-navigation', onNav);
      this.unlisten.push(() => guest.removeEventListener('did-start-navigation', onNav));
    }
  }

  /** Over code views, video and dark sites the menu takes the raised tint so it sits lighter. */
  private sampleBackdrop(el: HTMLElement, spec: MenuSpec, at: Placed, w: number, h: number): void {
    const wv = spec.backdrop;
    if (!wv) return;
    let id: number;
    try {
      id = wv.getWebContentsId();
    } catch {
      return;
    }
    const r = wv.getBoundingClientRect();
    const x = clamp(at.left - r.left, 0, r.width);
    const y = clamp(at.top - r.top, 0, r.height);
    const rect = { x: Math.round(x), y: Math.round(y), width: Math.round(clamp(w, 1, r.width - x)), height: Math.round(clamp(h, 1, r.height - y)) };
    if (rect.width < 8 || rect.height < 8) return;
    window.vitre
      .sampleLuma(id, rect)
      .then((luma) => {
        if (luma !== null && luma < RAISED_LUMA && this.el === el) el.classList.add('t-raised');
      })
      .catch(() => undefined);
  }
}
