// The full-screen deck (the default style): big cards over the blurred wallpaper with the
// neighbours peeking at the edges, and a glass dock of tab circles whose selected circle grows
// into a pill with the title. Latched, the dock becomes the search field.
// Geometry and motion follow the TabSwitcher and TabMotion boards (1440×900: cards 864×540 at
// (288,160), neighbours 912 px away at 0.86, dock 476×52 at y 778).
import { lens } from '../../glass';
import type { Tab } from '../../model';
import { tabText } from './search';
import { cardAt, cardName, el, EXPAND, favicon, glass, guardFavicons, labelHtml, nextCard, optionId, paintMedia, play, reducedMotion, settle, SPRING, wait, wallpaperSrc } from './parts';
import type { Model, View, ViewHandlers } from './types';

const PEEK_SCALE = 0.86;
const NEIGHBOUR = 912 / 864; // a neighbour's offset, in card widths
const DOCK_H = 52;
const DOCK_BOTTOM = 70;
const DOCK_PAD = 10;
const DOT = 40;
const DOT_GAP = 8;
const PILL = 216;
const FIELD_W = 476;
const DROP_MS = 220;

interface Card {
  el: HTMLElement;
  inner: HTMLElement;
  face: HTMLElement;
  media: HTMLElement;
  label: HTMLElement;
  /** Position relative to the selected card. */
  d: number;
}

interface Geometry {
  W: number;
  H: number;
  cw: number;
  ch: number;
  left: number;
  top: number;
  /** Distance between card centres. */
  off: number;
  /** Scale and vertical shift that make a centred card fill the window. */
  scale: number;
  dy: number;
  dockTop: number;
}

/** Cards keep the window's shape, so the chosen one fills it exactly; 60% of it, leaving room for the dock. */
function geometry(): Geometry {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dockTop = H - DOCK_BOTTOM - DOCK_H;
  const ch = Math.max(96, Math.min(H * 0.6, dockTop - 24 - 60));
  const cw = (ch * W) / H;
  const top = Math.max(60, (H - ch) / 2 - 20);
  return { W, H, cw, ch, left: (W - cw) / 2, top, off: cw * NEIGHBOUR, scale: W / cw, dy: H / 2 - (top + ch / 2), dockTop };
}

const dotsWidth = (n: number) => 2 * DOCK_PAD + n * DOT + Math.max(0, n - 1) * DOT_GAP + (PILL - DOT);

export class DeckView implements View {
  readonly root = el('div', 'sw-view sw-deck');
  private wall: HTMLElement;
  private stage = el('div', 'sw-stage');
  private dock = glass('sw-dock');
  private dots = el('div', 'sw-dots');
  private row = el('div', 'sw-dots-row');
  private field = el('div', 'sw-dockfield');
  private cards = new Map<number, Card>();
  private dotEls = new Map<number, HTMLElement>();
  private closingIds = new Set<number>();
  private g = geometry();
  private dockW = 0;
  /** The query the labels were last drawn for, so matches are marked as it changes. */
  private paintedQuery = '';
  private lensTimer = 0;

  constructor(private m: Model, private h: ViewHandlers) {
    const bg = el('div', 'sw-bg');
    const src = wallpaperSrc();
    this.wall = src ? el('img', 'sw-wall') : el('div', 'sw-wall');
    if (src) {
      (this.wall as HTMLImageElement).src = src;
      (this.wall as HTMLImageElement).alt = '';
    }
    bg.append(this.wall);
    this.stage.id = 'sw-list';
    this.stage.setAttribute('role', 'listbox');
    this.stage.setAttribute('aria-label', 'Tabs');
    this.dots.append(this.row);
    this.dock.append(this.dots, this.field);
    this.root.append(bg, this.stage, this.dock);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('auxclick', (e) => this.onMiddle(e));
  }

  mount(fieldRow: HTMLElement): void {
    this.field.append(fieldRow);
  }

  enter(): void {
    settle(this.root, () => {
      this.g = geometry();
      this.syncCards(false);
      for (const id of this.m.all) this.dotFor(id);
      this.update();
    });
    if (reducedMotion()) {
      this.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease' });
      return;
    }
    // Your wallpaper blurs in behind the page you were on, which shrinks into its card while
    // the others rise 60 ms apart and the dock follows.
    play(this.wall, [{ filter: 'blur(0px) brightness(1) saturate(1)' }, { filter: 'blur(44px) brightness(0.5) saturate(1.25)' }], { duration: 320, easing: 'ease-out' });
    for (const id of this.m.list) {
      const c = this.cards.get(id);
      if (!c) continue;
      if (id === this.m.startId) {
        this.shrinkFromWindow(c);
      } else {
        const delay = 120 + 60 * Math.min(Math.abs(c.d), 4);
        play(c.inner, [{ opacity: 0, transform: 'translateY(28px) scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 560, easing: SPRING, delay });
      }
    }
    play(this.dock, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: SPRING, delay: 160 });
  }

  update(): void {
    this.syncCards(true);
    this.repaintForQuery();
    this.place();
    this.syncDock();
  }

  refresh(id: number): void {
    const t = this.m.tab(id);
    if (!t) return;
    const c = this.cards.get(id);
    if (c) this.paint(t, c);
    const dot = this.dotEls.get(id);
    if (dot) this.paintDot(t, dot);
  }

  private repaintForQuery(): void {
    if (this.m.query === this.paintedQuery) return;
    this.paintedQuery = this.m.query;
    for (const [id, c] of this.cards) {
      const t = this.m.tab(id);
      if (t) this.paint(t, c);
    }
  }

  closing(id: number): void {
    this.closingIds.add(id);
  }

  async expand(id: number): Promise<void> {
    this.root.classList.add('sw-expanding');
    const c = this.cards.get(id);
    if (!c || reducedMotion()) return;
    const g = this.g;
    for (const [other, card] of this.cards) if (other !== id) card.el.style.opacity = '0';
    c.el.classList.add('sel');
    c.el.style.zIndex = '20';
    c.el.style.opacity = '1';
    c.el.style.transition = `transform 360ms ${EXPAND}, opacity 220ms ease`;
    c.el.style.transform = `translate(0px, ${g.dy}px) scale(${g.scale})`;
    await wait(360);
  }

  layout(): void {
    this.g = geometry();
    this.update();
  }

  columns(): number {
    return 1;
  }

  // ---- cards ----

  private syncCards(fadeIn: boolean): void {
    const want = new Set(this.m.list);
    for (const [id, c] of this.cards) if (!want.has(id)) this.drop(id, c);
    this.m.list.forEach((id, i) => {
      if (this.cards.has(id)) return;
      const t = this.m.tab(id);
      if (!t) return;
      const c = this.makeCard(t, nextCard(this.m.list, i, this.cards));
      this.cards.set(id, c);
      if (fadeIn) {
        // Start in place but transparent; place() then fades it in.
        this.placeCard(c, i - this.m.sel);
        c.el.style.opacity = '0';
        void c.el.offsetWidth;
      }
    });
  }

  private makeCard(t: Tab, before: HTMLElement | null): Card {
    const card = el('div', 'sw-dcard');
    card.id = optionId(t.id);
    card.dataset.id = String(t.id);
    card.setAttribute('role', 'option');
    const inner = el('div', 'sw-dcard-in');
    const label = el('div', 'sw-dlabel');
    label.setAttribute('aria-hidden', 'true');
    const face = el('div', 'sw-dface');
    const media = el('div', 'sw-media');
    face.append(media, el('span', 'sw-sheen'), el('span', 'sw-dim'), el('span', 'sw-rim'));
    inner.append(label, face);
    card.append(inner);
    this.stage.insertBefore(card, before);
    const c: Card = { el: card, inner, face, media, label, d: 0 };
    this.paint(t, c);
    return c;
  }

  private paint(t: Tab, c: Card): void {
    const l = labelHtml(t, this.m);
    c.label.innerHTML = `<span class="fav">${favicon(t, 18)}</span><span class="t">${l.title}</span><span class="h">${l.detail}</span>`;
    guardFavicons(c.label);
    paintMedia(c.media, t, this.m.thumb(t.id), 32);
    c.el.setAttribute('aria-label', cardName(t, this.m));
  }

  /** A card that left the list: closed ones lift 12 px and fade; filtered ones just fade. */
  private drop(id: number, c: Card): void {
    this.cards.delete(id);
    c.el.classList.add('sw-gone');
    c.el.removeAttribute('id');
    c.el.removeAttribute('role');
    if (this.closingIds.delete(id) && !reducedMotion()) {
      c.el.style.transition = `transform ${DROP_MS}ms ${SPRING}, opacity ${DROP_MS}ms ease`;
      c.el.style.transform = `translateY(-12px) ${c.el.style.transform}`;
    }
    c.el.style.opacity = '0';
    window.setTimeout(() => c.el.remove(), DROP_MS + 40);
  }

  private place(): void {
    this.m.list.forEach((id, i) => {
      const c = this.cards.get(id);
      if (c) this.placeCard(c, i - this.m.sel);
    });
  }

  private placeCard(c: Card, d: number): void {
    const g = this.g;
    const sel = d === 0;
    c.d = d;
    c.el.classList.toggle('sel', sel);
    c.el.setAttribute('aria-selected', String(sel));
    Object.assign(c.el.style, { left: `${g.left}px`, top: `${g.top}px`, width: `${g.cw}px`, height: `${g.ch}px` });
    c.el.style.transform = sel ? 'translateX(0px) scale(1)' : `translateX(${d * g.off}px) scale(${PEEK_SCALE})`;
    c.el.style.opacity = Math.abs(d) > 1 ? '0' : '1';
    c.el.style.pointerEvents = Math.abs(d) > 1 ? 'none' : '';
    c.el.style.zIndex = String(sel ? 10 : Math.max(0, 5 - Math.abs(d)));
  }

  /**
   * The page you were on starts as the whole window and shrinks into its card. The inner layer
   * starts with the inverse of the card's place in the deck, so together they cover the window.
   */
  private shrinkFromWindow(c: Card): void {
    const g = this.g;
    const k = c.d === 0 ? 1 : PEEK_SCALE;
    const from = `translate(${(-c.d * g.off) / k}px, ${g.dy / k}px) scale(${g.scale / k})`;
    play(c.inner, [{ transform: from }, { transform: 'none' }], { duration: 420, easing: SPRING });
    play(c.face, [{ borderRadius: '0px' }, { borderRadius: '22px' }], { duration: 420, easing: SPRING });
    const dim = c.face.querySelector('.sw-dim');
    if (dim && c.d !== 0) play(dim, [{ opacity: 0 }, { opacity: 0.5 }], { duration: 480, easing: 'ease' });
    if (Math.abs(c.d) > 1) play(c.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: 'ease-in' });
  }

  // ---- dock ----

  private dotFor(id: number): HTMLElement | null {
    const have = this.dotEls.get(id);
    if (have) return have;
    const t = this.m.tab(id);
    if (!t) return null;
    const dot = el('button', 'sw-dot');
    (dot as HTMLButtonElement).type = 'button';
    dot.tabIndex = -1;
    dot.setAttribute('aria-hidden', 'true');
    dot.dataset.id = String(id);
    this.paintDot(t, dot);
    this.row.append(dot);
    this.dotEls.set(id, dot);
    return dot;
  }

  private paintDot(t: Tab, dot: HTMLElement): void {
    const title = tabText(t).title;
    dot.innerHTML = `<span class="fav">${favicon(t, 16)}</span><span class="t"></span>`;
    (dot.querySelector('.t') as HTMLElement).textContent = title;
    dot.title = title;
    guardFavicons(dot);
  }

  private syncDock(): void {
    const g = this.g;
    const selId = this.m.list[this.m.sel];
    for (const [id, dot] of this.dotEls) {
      if (this.m.all.includes(id)) {
        dot.classList.toggle('sel', id === selId);
        continue;
      }
      this.dotEls.delete(id);
      dot.classList.add('sw-gone');
      window.setTimeout(() => dot.remove(), DROP_MS + 40);
    }
    const n = this.dotEls.size;
    const content = dotsWidth(n);
    const width = this.m.latched ? Math.min(FIELD_W, g.W - 32) : Math.min(content, g.W - 96);
    this.dock.classList.toggle('latched', this.m.latched);
    Object.assign(this.dock.style, { left: `${Math.round((g.W - width) / 2)}px`, top: `${g.dockTop}px`, width: `${width}px` });
    // Too many tabs for the window: keep the pill in view.
    const i = selId === undefined ? 0 : this.m.all.indexOf(selId);
    const pillLeft = DOCK_PAD + Math.max(0, i) * (DOT + DOT_GAP);
    const shift = content > width ? Math.max(width - content, Math.min(0, width / 2 - (pillLeft + PILL / 2))) : 0;
    this.row.style.transform = `translateX(${shift}px)`;
    this.setLens(width);
  }

  /** The lens map is sized to the dock; while the dock changes width it is plain frost. */
  private setLens(width: number): void {
    if (width === this.dockW) return;
    const lensEl = this.dock.querySelector('.lens') as HTMLElement;
    const apply = () => {
      this.dock.classList.remove('morphing');
      lensEl.style.backdropFilter = lens(width, DOCK_H, { radius: DOCK_H / 2, blur: 2, scale: 16 });
    };
    const first = this.dockW === 0;
    this.dockW = width;
    window.clearTimeout(this.lensTimer);
    if (first) {
      apply();
      return;
    }
    this.dock.classList.add('morphing');
    this.lensTimer = window.setTimeout(apply, 440);
  }

  // ---- mouse ----

  private onClick(e: MouseEvent): void {
    const selected = this.m.list[this.m.sel];
    const id = cardAt(e, '.sw-dot') ?? cardAt(e, '.sw-dcard:not(.sw-gone)');
    if (id !== null) {
      if (id === selected) this.h.open(id);
      else this.h.select(id);
      return;
    }
    if ((e.target as HTMLElement).closest('.sw-dock')) return;
    this.h.cancel();
  }

  private onMiddle(e: MouseEvent): void {
    if (e.button !== 1) return;
    const id = cardAt(e, '.sw-dot') ?? cardAt(e, '.sw-dcard:not(.sw-gone)');
    if (id !== null) this.h.close(id);
  }
}
