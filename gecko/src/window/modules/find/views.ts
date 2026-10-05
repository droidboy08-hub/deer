// The two faces of find: the active pill's find face (480x44, in place over the pill) and the
// capsule in a peek's header (440x32). Both are DOM only: they know nothing about the finder.
// Ported from app/src/renderer/modules/find.ts (FindFace); the capsule is new (FindPill board,
// variant "capsule"; FindContexts "In a peek").
import type { Browser, Tab } from '../../browser';
import { el, svg } from '../../dom';
import { lens } from '../../glass';
import { setTip } from '../../tips';
import { CLOSE_MS, DROP_MS, PILL_H } from './styles';

export type Dir = 1 | -1;

/** What the counter shows. */
export interface CountView {
  kind: 'blank' | 'none' | 'count';
  ord: number;
  /** "7", "1,000+", "36+". */
  total: string;
  /** Previous / next are disabled (empty field or no matches). */
  off: boolean;
}

export interface ViewHandlers {
  input(): void;
  /** keydown in the field. */
  key(e: KeyboardEvent): void;
  /** keydown on one of the face's buttons (Tab moved focus there). */
  buttonKey(e: KeyboardEvent): void;
  step(dir: Dir): void;
  toggleCase(): void;
  close(): void;
  focusChanged(): void;
  compose(on: boolean): void;
  menu(e: MouseEvent): void;
}

const NARROW = 400;
/** Under this the face also drops its favicon, so the field keeps its room (DESIGN-NOTES: at least 160 px). */
const TIGHT = 360;
/** The width the face claims for the active pill while it shows (b.bar.claimPill): many tabs never squeeze it. */
const FACE_W = 480;
const HOLD_HIDDEN_BAR_MS = 400;
const COOLDOWN_MS = 400;
const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const fmt = (n: number): string => n.toLocaleString('en-US');

const chevron = (size: number, d: string, stroke: string): SVGSVGElement =>
  svg(`<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`);
const ICON = {
  up: (s: number, w: string) => chevron(s, 'M5 12.5 10 7.5l5 5', w),
  down: (s: number, w: string) => chevron(s, 'M5 7.5l5 5 5-5', w),
  close: (s: number, w: string) => chevron(s, 'M5.5 5.5l9 9M14.5 5.5l-9 9', w),
};

type Mode = 'hidden' | 'open' | 'closing';

/** What both faces share: the field, the counter, the buttons, keyboard cycling, the roll and the echo. */
abstract class FieldView {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  mode: Mode = 'hidden';
  /** The page whose find the view shows (null when hidden). */
  browser: XULBrowser | null = null;
  protected count: HTMLElement;
  protected prev: HTMLButtonElement;
  protected next: HTMLButtonElement;
  protected caseBtn: HTMLButtonElement;
  protected closeBtn: HTMLButtonElement;
  protected sr: HTMLElement;
  protected seq = 0;
  private countKey = '';

  constructor(
    protected b: Browser,
    protected h: ViewHandlers,
    root: HTMLElement,
    small: boolean
  ) {
    this.el = root;
    const size = small ? 14 : 16;
    const stroke = small ? '1.7' : '1.6';
    this.input = el('input', {
      class: 'vf-input',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: 'Find on page',
      'aria-label': 'Find on page',
    });
    this.count = el('div', { class: 'vf-count', 'aria-live': 'polite', 'aria-atomic': 'true' });
    this.prev = el('button', { type: 'button', class: 'vf-btn vf-prev', 'aria-label': 'Previous match', 'aria-keyshortcuts': 'Shift+Enter' }, ICON.up(size, stroke));
    this.next = el('button', { type: 'button', class: 'vf-btn vf-next', 'aria-label': 'Next match', 'aria-keyshortcuts': 'Enter' }, ICON.down(size, stroke));
    this.caseBtn = el('button', { type: 'button', class: 'vf-btn vf-case', 'aria-label': 'Match case', 'aria-pressed': 'false', 'aria-keyshortcuts': 'Alt+C' }, 'Aa');
    this.closeBtn = el('button', { type: 'button', class: 'vf-btn vf-close', 'aria-label': 'Close find', 'aria-keyshortcuts': 'Escape' }, ICON.close(small ? 12 : 13, small ? '1.7' : '1.6'));
    this.sr = el('div', { class: 'vf-sr', role: 'status' });
    setTip(this.prev, 'Previous match', 'Shift+Enter');
    setTip(this.next, 'Next match', 'Enter');
    setTip(this.caseBtn, 'Match case', 'Alt+C');
    setTip(this.closeBtn, 'Close', 'Esc');
    this.input.id = small ? 'vitre-find-capsule-input' : 'vitre-find-input';
    this.count.id = small ? 'vitre-find-capsule-count' : 'vitre-find-count';
    this.input.setAttribute('aria-describedby', this.count.id);
  }

  protected wire(): void {
    const { input, h } = this;
    input.addEventListener('input', () => {
      this.updateOverflow();
      h.input();
    });
    input.addEventListener('keydown', (e) => h.key(e));
    input.addEventListener('compositionstart', () => h.compose(true));
    input.addEventListener('compositionend', () => h.compose(false));
    input.addEventListener('contextmenu', (e) => h.menu(e));
    this.prev.addEventListener('click', () => h.step(-1));
    this.next.addEventListener('click', () => h.step(1));
    this.caseBtn.addEventListener('click', () => h.toggleCase());
    this.closeBtn.addEventListener('click', () => h.close());
    this.el.addEventListener('keydown', (e) => {
      this.cycleFocus(e);
      if (e.target !== input && !e.defaultPrevented) h.buttonKey(e);
    });
    this.el.addEventListener('focusin', () => h.focusChanged());
    this.el.addEventListener('focusout', () => window.setTimeout(() => h.focusChanged(), 0));
    // A mousedown never takes focus from the field; a press on the glass itself puts focus in it.
    this.el.addEventListener('mousedown', (e) => {
      if (this.mode !== 'open') {
        e.preventDefault();
        return;
      }
      const target = e.target as HTMLElement;
      if (target === input) return;
      e.preventDefault();
      if (!target.closest('button') && e.button === 0) this.focusField(false);
    });
  }

  hasFocus(): boolean {
    return this.mode !== 'hidden' && this.el.contains(document.activeElement);
  }

  focusField(selectAll: boolean): void {
    this.input.focus();
    if (selectAll) this.input.select();
  }

  setQuery(text: string): void {
    if (this.input.value !== text) this.input.value = text;
    this.updateOverflow();
  }

  setCase(on: boolean): void {
    this.caseBtn.setAttribute('aria-pressed', String(on));
  }

  setFocused(on: boolean): void {
    this.el.classList.toggle('vf-focused', on);
  }

  setComposing(on: boolean): void {
    this.el.classList.toggle('vf-ime', on);
  }

  /** The counter: "3 of 7", "1 of 1,000+", "No matches", or blank. */
  setCount(v: CountView, roll: 'up' | 'down' | null): void {
    // The bar re-renders often (every tab update): an unchanged counter is left alone.
    const key = `${v.kind}|${v.ord}|${v.total}|${v.off}`;
    if (key === this.countKey && !roll) return;
    this.countKey = key;
    const c = this.count;
    c.classList.toggle('none', v.kind === 'none');
    if (v.kind === 'none') {
      c.replaceChildren('No matches');
    } else if (v.kind === 'blank') {
      c.replaceChildren();
    } else {
      const ord = fmt(v.ord);
      let box = c.querySelector<HTMLElement>('.vf-ordbox');
      if (!box) {
        box = el('span', { class: 'vf-ordbox' }, el('span', { class: 'vf-ord' }), el('span', { class: 'vf-ord-old', 'aria-hidden': 'true' }));
        c.replaceChildren(box, el('span', { class: 'vf-total' }));
      }
      const cur = box.querySelector('.vf-ord') as HTMLElement;
      const old = box.querySelector('.vf-ord-old') as HTMLElement;
      const previous = cur.textContent ?? '';
      cur.textContent = ord;
      (c.querySelector('.vf-total') as HTMLElement).textContent = ` of ${v.total}`;
      if (roll && previous && previous !== ord && !reducedMotion()) this.roll(cur, old, previous, roll);
      else if (previous !== ord) old.textContent = '';
    }
    this.prev.setAttribute('aria-disabled', String(v.off));
    this.next.setAttribute('aria-disabled', String(v.off));
    this.layoutField();
  }

  /** The text the counter shows now (tests). */
  get countText(): string {
    const t = this.count.querySelector('.vf-total');
    if (!t) return this.count.textContent ?? '';
    return `${this.count.querySelector('.vf-ord')?.textContent ?? ''}${t.textContent ?? ''}`.replace(/ /g, ' ');
  }

  /** The ordinal rolls: old number out 6 px (120 ms), new one in from the other side (160 ms, spring). */
  private roll(cur: HTMLElement, old: HTMLElement, previous: string, dir: 'up' | 'down'): void {
    const d = dir === 'up' ? 6 : -6;
    old.textContent = previous;
    cur.getAnimations().forEach((a) => a.cancel());
    old.getAnimations().forEach((a) => a.cancel());
    cur.animate([{ transform: `translateY(${d}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 160, easing: SPRING });
    const out = old.animate([{ transform: 'none', opacity: 1 }, { transform: `translateY(${-d}px)`, opacity: 0 }], { duration: 120, easing: 'ease' });
    out.onfinish = () => {
      old.textContent = '';
    };
  }

  /** No matches: Enter pulses the counter once. */
  pulse(): void {
    if (!reducedMotion()) this.count.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 160, easing: 'ease' });
  }

  /** Keyboard steps light the matching chevron for 100 ms. */
  echo(dir: Dir): void {
    const btn = dir > 0 ? this.next : this.prev;
    btn.classList.add('vf-echo');
    window.setTimeout(() => btn.classList.remove('vf-echo'), 100);
  }

  announce(text: string): void {
    this.sr.textContent = '';
    window.setTimeout(() => {
      this.sr.textContent = text;
    }, 30);
  }

  protected abstract fieldRight(): number;
  protected abstract fieldLeft(): number;
  protected abstract width(): number;
  protected abstract minField(): number;

  /** The field runs from its left edge to 10 px left of the counter. */
  protected layoutField(): void {
    const cw = this.count.offsetWidth;
    const w = this.width() - this.fieldRight() - cw - (cw ? 10 : 0) - this.fieldLeft();
    this.input.style.width = `${Math.max(this.minField(), w)}px`;
    this.updateOverflow();
  }

  protected updateOverflow(): void {
    this.el.classList.toggle('vf-overflow', this.input.scrollWidth > this.input.clientWidth + 1);
  }

  /** Tab cycles field -> previous -> next -> Aa -> × and wraps. */
  private cycleFocus(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey) return;
    const stops = [this.input, this.prev, this.next, this.caseBtn, this.closeBtn].filter((x) => x.getClientRects().length > 0 && getComputedStyle(x).display !== 'none');
    const i = stops.indexOf(document.activeElement as HTMLInputElement);
    if (i < 0) return;
    e.preventDefault();
    stops[(i + (e.shiftKey ? stops.length - 1 : 1)) % stops.length].focus();
  }
}

// ---------------------------------------------------------------------------------------------
// The pill's find face. Over a visible bar the real pill keeps its glass and only its face hides;
// the find face is drawn on it. With the bar hidden the face brings its own glass and stays pinned.
// ---------------------------------------------------------------------------------------------

export class PillFace extends FieldView {
  /** The tab whose find the face shows (null when hidden). */
  tabId: number | null = null;
  private lensEl: HTMLElement;
  private fav: HTMLElement;
  private rect = { x: 0, w: 0 };
  private lensW = 0;
  private morphTimer = 0;
  private favSrc = '';
  /** Releases the pill width claimed while the face shows (b.bar.claimPill). */
  private releasePill: (() => void) | null = null;

  constructor(b: Browser, layer: HTMLElement, h: ViewHandlers) {
    const root = el('div', { class: 'vf-face glass', role: 'search', 'aria-label': 'Find on page' });
    super(b, h, root, false);
    root.hidden = true;
    this.lensEl = el('div', { class: 'lens' });
    this.fav = el('span', { class: 'vf-fav', 'aria-hidden': 'true', 'data-tip-delay': '500' });
    root.append(
      this.lensEl,
      el('div', { class: 'vf-tint vf-base' }),
      el('div', { class: 'vf-tint vf-hi' }),
      el('div', { class: 'rim' }),
      el('div', { class: 'vf-navs', 'aria-hidden': 'true' }, el('span', { class: 'vf-nav vf-back' }), el('span', { class: 'vf-nav vf-fwd' })),
      el('span', { class: 'vf-domain', 'aria-hidden': 'true' }),
      el('span', { class: 'vf-reload', 'aria-hidden': 'true' }),
      this.fav,
      this.input,
      el('div', { class: 'vf-grp' }, this.count, this.prev, this.next, el('span', { class: 'vf-div', 'aria-hidden': 'true' }), this.caseBtn),
      this.closeBtn,
      el('div', { class: 'vf-load' }),
      this.sr
    );
    layer.append(root);
    this.wire();
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.el.querySelector(sel) as T;
  }

  protected fieldRight(): number {
    return this.el.classList.contains('vf-narrow') ? 110 : 156;
  }
  protected fieldLeft(): number {
    return this.el.classList.contains('vf-tight') ? 12 : 42;
  }
  protected width(): number {
    return this.rect.w || 480;
  }
  protected minField(): number {
    return 24;
  }

  /**
   * Show the find face for a tab. 'open' morphs from the address face (or drops in when the bar is
   * hidden); 'restore' appears for a tab switch, following the pill as the bar re-flows.
   */
  show(t: Tab, how: 'open' | 'restore', barHidden: boolean): void {
    const seq = ++this.seq;
    const wasClosing = this.mode === 'closing' && this.tabId === t.id;
    this.mode = 'open';
    this.tabId = t.id;
    this.browser = t.browser;
    this.el.hidden = false;
    this.el.classList.remove('vf-under');
    this.b.root.classList.add('find-face');
    this.b.root.classList.remove('find-cooldown');
    this.syncTab(t);

    if (wasClosing) {
      // Reopened mid-close: the transitions simply turn around.
      this.fadeParts(null);
      this.el.classList.remove('vf-raised');
      this.el.classList.add('vf-find');
      this.paintTint();
      return;
    }
    this.fadeParts(null);
    // With many tabs the pill may be down to 220 px: the face claims its 480 (the circles give way).
    const before = this.pillNow(t.id);
    this.releasePill ??= this.b.bar.claimPill(FACE_W);
    const target = this.b.bar.layout.pillRect;
    if (how === 'restore') {
      this.snap(() => {
        this.setOwnGlass(barHidden);
        this.el.classList.add('vf-find');
        this.el.classList.remove('vf-raised');
        const now = this.pillNow(t.id) ?? target;
        if (now) this.place(now.x, now.width, true);
      });
      this.fadeParts(1);
      requestAnimationFrame(() => {
        if (seq !== this.seq) return;
        // The bar may have re-rendered since (a tab switch emits before the bar's render).
        const slot = this.b.bar.layout.pillRect;
        if (slot) this.place(slot.x, slot.width, false);
      });
      this.paintTint();
      return;
    }
    const fadeIn = barHidden && reducedMotion();
    // The pill is growing to its claimed width (420 ms spring): the face starts on the pill as it is
    // and grows with it.
    const grows = !barHidden && !!before && !!target && Math.abs(before.width - target.width) > 1;
    this.snap(() => {
      this.setOwnGlass(barHidden);
      if (grows && before) this.place(before.x, before.width, true);
      else if (target) this.place(target.x, target.width, true);
      if (barHidden) {
        // Bar hidden: only the pill drops in, already in its find face (reduced motion: fades in).
        this.el.classList.add('vf-find');
        if (!fadeIn) this.el.classList.add('vf-raised');
      } else {
        this.measureAddress(t.id);
        this.el.classList.remove('vf-find', 'vf-raised');
      }
    });
    this.el.classList.add('vf-find');
    this.el.classList.remove('vf-raised');
    if (grows && target) this.place(target.x, target.width, false);
    if (fadeIn) this.fadeParts(1);
    this.paintTint();
  }

  /**
   * Fade the face's parts in (1) or out (0) over 160 ms, or stop a fade (null). The parts fade, not
   * the face: opacity on the glass element would cut its lens off from the page (glass.ts).
   */
  private fadeParts(to: 0 | 1 | null): void {
    for (const part of Array.from(this.el.children) as HTMLElement[]) {
      for (const a of part.getAnimations()) if (a.id === 'vf-fade') a.cancel();
      if (to === null) continue;
      const a = part.animate(to ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease', fill: to ? 'none' : 'forwards' });
      a.id = 'vf-fade';
    }
  }

  /** Over a visible bar the real pill's own glass carries the face; with the bar hidden the face brings its own. */
  setOwnGlass(on: boolean): void {
    if (this.mode === 'hidden') return;
    this.el.classList.toggle('vf-own', on);
    this.b.root.classList.toggle('find-own', on);
    if (on && this.rect.w) this.setLens(this.rect.w);
  }

  get ownGlass(): boolean {
    return this.el.classList.contains('vf-own');
  }

  /** The focused tint replaces the pill's own while the field has focus. */
  private paintTint(): void {
    const c = this.el.classList;
    const on = this.mode === 'open' && c.contains('vf-find') && c.contains('vf-focused') && !c.contains('vf-under');
    this.b.root.classList.toggle('find-focused', on);
  }

  override setFocused(on: boolean): void {
    super.setFocused(on);
    this.paintTint();
  }

  /** The active match sits under the pill on fixed content: the pill takes its parked tint. */
  setUnder(on: boolean): void {
    this.el.classList.toggle('vf-under', on);
    this.paintTint();
  }

  /** 'morph' plays the close (200 ms); 'fade' cross-fades out (Ctrl+L); 'instant' is a tab switch. */
  hide(how: 'morph' | 'fade' | 'instant', barHidden = false): void {
    if (this.mode === 'hidden') return;
    const seq = ++this.seq;
    if (how === 'instant' || (how === 'fade' && reducedMotion())) {
      this.finishHide(how === 'instant' ? 0 : COOLDOWN_MS);
      return;
    }
    this.mode = 'closing';
    if (how === 'fade') {
      this.fadeParts(0);
      window.setTimeout(() => seq === this.seq && this.finishHide(0), 160);
      return;
    }
    if (this.tabId !== null) this.measureAddress(this.tabId);
    this.el.classList.remove('vf-find');
    this.paintTint();
    if (!barHidden) {
      window.setTimeout(() => seq === this.seq && this.finishHide(COOLDOWN_MS), CLOSE_MS);
      return;
    }
    // Bar hidden: the address face shows for 400 ms, then rises (reduced motion: fades out).
    window.setTimeout(() => {
      if (seq !== this.seq) return;
      if (reducedMotion()) this.fadeParts(0);
      else this.el.classList.add('vf-raised');
      window.setTimeout(() => seq === this.seq && this.finishHide(0), DROP_MS);
    }, CLOSE_MS + HOLD_HIDDEN_BAR_MS);
  }

  private finishHide(cooldown: number): void {
    const seq = this.seq;
    this.releasePill?.();
    this.releasePill = null;
    this.mode = 'hidden';
    this.tabId = null;
    this.browser = null;
    this.el.hidden = true;
    this.fadeParts(null);
    this.el.classList.remove('vf-find', 'vf-focused', 'vf-raised', 'vf-under', 'vf-ime', 'vf-own');
    this.b.root.classList.remove('find-face', 'find-own', 'find-focused');
    if (!cooldown) return;
    // The reload slot ignores clicks for a moment, so a second click on × doesn't reload.
    this.b.root.classList.add('find-cooldown');
    window.setTimeout(() => seq === this.seq && this.b.root.classList.remove('find-cooldown'), cooldown);
  }

  /** Run fn with every transition off, then commit the styles. */
  private snap(fn: () => void): void {
    this.el.classList.add('vf-snap');
    fn();
    void this.el.offsetWidth;
    this.el.classList.remove('vf-snap');
  }

  private pillNow(tabId: number): DOMRect | null {
    const r = this.b.bar.item(tabId)?.getBoundingClientRect();
    return r && r.width > 0 ? r : null;
  }

  /** Copy the real pill's address face (positions, icons, domain) so the morph starts or ends on it. */
  private measureAddress(tabId: number): void {
    const item = this.b.bar.item(tabId);
    if (!item) return;
    const box = item.getBoundingClientRect();
    const part = (sel: string): HTMLElement | null => item.querySelector<HTMLElement>(sel);
    const copy = (sel: string, into: string): void => {
      const src = part(sel);
      const dst = this.q(into);
      if (!src) return;
      dst.replaceChildren(...Array.from(src.childNodes, (n) => n.cloneNode(true)));
      dst.style.left = `${src.getBoundingClientRect().x - box.x}px`;
      dst.classList.toggle('dis', src.getAttribute('aria-disabled') === 'true');
    };
    copy('.back', '.vf-back');
    copy('.forward', '.vf-fwd');
    copy('.reload', '.vf-reload');
    const fav = part('.address .fav')?.getBoundingClientRect();
    if (fav) this.el.style.setProperty('--vf-fav-dx', `${fav.x + fav.width / 2 - 8 - box.x - 16}px`);
    const host = part('.host');
    const domain = this.q('.vf-domain');
    if (host) {
      const r = host.getBoundingClientRect();
      domain.textContent = host.textContent;
      domain.style.width = `${Math.ceil(r.width) + 1}px`;
      this.el.style.setProperty('--vf-dom-dx', `${r.x - box.x - 42}px`);
    }
  }

  /** Lay the face over the pill. Width changes use frost until the lens for the new size is in. */
  place(x: number, w: number, snap: boolean): void {
    x = Math.round(x);
    w = Math.round(w);
    if (x === this.rect.x && w === this.rect.w) return;
    const resized = w !== this.rect.w;
    this.rect = { x, w };
    this.el.style.left = `${x}px`;
    this.el.style.width = `${w}px`;
    this.el.classList.toggle('vf-narrow', w < NARROW);
    this.el.classList.toggle('vf-tight', w < TIGHT);
    if (!resized) return;
    window.clearTimeout(this.morphTimer);
    if (snap) {
      this.setLens(w);
    } else {
      this.el.classList.add('morphing');
      this.morphTimer = window.setTimeout(() => {
        this.el.classList.remove('morphing');
        this.setLens(w);
      }, 440);
    }
    this.layoutField();
  }

  private setLens(w: number): void {
    if (w === this.lensW) return;
    this.lensW = w;
    this.lensEl.style.backdropFilter = lens(w, PILL_H, { blur: 2.4 });
  }

  /** Stay on the pill's slot as the bar re-flows (tabs opening and closing, window resizes). */
  follow(): void {
    const target = this.b.bar.layout.pillRect;
    if (target && this.mode !== 'hidden') this.place(target.x, target.width, this.lensW === 0);
  }

  /** Favicon, address (the favicon's tooltip) and loading line from the tab. */
  syncTab(t: Tab): void {
    this.el.classList.toggle('vf-loading', t.loading);
    setTip(this.fav, t.url || null);
    const src = this.b.bar.item(t.id)?.querySelector<HTMLElement>('.address .fav');
    const key = src?.dataset.src ?? '';
    if (src && key !== this.favSrc) {
      this.favSrc = key;
      this.fav.replaceChildren(...Array.from(src.childNodes, (n) => n.cloneNode(true)));
    }
  }

  /** The face's own rectangle in the window (for the scroll guard while the bar is hidden). */
  rectNow(): DOMRect | null {
    return this.mode === 'hidden' ? null : this.el.getBoundingClientRect();
  }
}

// ---------------------------------------------------------------------------------------------
// The capsule in a peek's header: 440x32, frosted white, replacing the header's domain and path.
// Capsule-local: field from x 12, counter right edge 300, previous 308, next 334 (24x24), divider
// 365, Aa 372, × 404, 12 px right padding, no favicon. It grows from the domain's box in 240 ms.
// ---------------------------------------------------------------------------------------------

export class PeekCapsule extends FieldView {
  constructor(b: Browser, layer: HTMLElement, h: ViewHandlers) {
    const root = el('div', { class: 'vf-cap', role: 'search', 'aria-label': 'Find in this peek' });
    super(b, h, root, true);
    root.hidden = true;
    root.append(this.input, this.count, this.prev, this.next, el('span', { class: 'vf-div', 'aria-hidden': 'true' }), this.caseBtn, this.closeBtn, this.sr);
    layer.append(root);
    this.wire();
  }

  protected fieldRight(): number {
    return 140;
  }
  protected fieldLeft(): number {
    return 12;
  }
  private w = 440;

  protected width(): number {
    return this.w;
  }
  protected minField(): number {
    return 80;
  }

  show(browser: XULBrowser, slot: { x: number; y: number; width: number }, grow: boolean): void {
    this.seq++;
    this.mode = 'open';
    this.browser = browser;
    this.el.hidden = false;
    this.place(slot);
    this.el.classList.remove('vf-growing');
    if (grow && !reducedMotion()) {
      void this.el.offsetWidth;
      this.el.classList.add('vf-growing');
    }
    this.layoutField();
    this.b.root.classList.add('find-in-peek');
    document.documentElement.setAttribute('vitre-find-in-peek', 'true');
  }

  /** 440 px, or what the header leaves on a narrow sheet (the right-hand group stays in place). */
  place(slot: { x: number; y: number; width: number }): void {
    this.el.style.left = `${Math.round(slot.x)}px`;
    this.el.style.top = `${Math.round(slot.y)}px`;
    const w = Math.round(Math.max(240, Math.min(440, slot.width || 440)));
    if (w !== this.w) {
      this.w = w;
      this.el.style.width = `${w}px`;
      this.layoutField();
    }
  }

  hide(): void {
    if (this.mode === 'hidden') return;
    this.seq++;
    this.mode = 'hidden';
    this.browser = null;
    this.el.hidden = true;
    this.el.classList.remove('vf-growing', 'vf-focused', 'vf-ime');
    this.b.root.classList.remove('find-in-peek');
    document.documentElement.removeAttribute('vitre-find-in-peek');
  }

  rectNow(): DOMRect | null {
    return this.mode === 'hidden' ? null : this.el.getBoundingClientRect();
  }
}
