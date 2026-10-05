// Grid (Settings > Tabs): every tab as a 291x182 card over the blurred page, in reading order, with
// the search field in the tab bar's place and a New tab card at the end (TabOverview board: cards at
// x 96/415/734/1053, rows at y 248/508, label 12 px under the card, 13 px title, 12 px host at 0.55,
// selection ring 3 px #4cc2ff plus 4 px at 0.22, close badge 24 px at the top right on hover).
// Ported from app/src/renderer/modules/switcher/grid.ts.
import { svg } from '../../dom';
import { lens } from '../../glass';
import { icons } from '../../icons';
import type { Tab } from '../../model';
import { setTip } from '../../tips';
import { cardAt, cardName, el, EXPAND, fadeLayers, favicon, flight, glassBox, labelChanged, labelParts, Media, nextCard, optionId, play, reducedMotion, settle, SPRING } from './parts';
import type { Model, View, ViewHandlers } from './types';

const CW = 291;
const CH = 182;
const COL_GAP = 28;
const LABEL = 48;
const ROW_GAP = 30;
const BAND = 68; // the tab bar's band, where the search field sits
const SIDE = 24;
const MAX_COLS = 6;
const FIELD_W = 480;
const FIELD_H = 44;
const DROP_MS = 220;

interface Card {
  el: HTMLElement;
  inner: HTMLElement;
  face: HTMLElement;
  media: Media;
  label: HTMLElement;
}

interface Layout {
  cols: number;
  x0: number;
  y0: number;
  height: number;
}

export class GridView implements View {
  readonly root = el('sw-view sw-grid');
  private bg = el('sw-bg');
  private field = glassBox('sw-gfield');
  private scroller = el('sw-gscroll');
  private content = el('sw-gcontent');
  private newTile = el('sw-gnew-wrap');
  private cards = new Map<number, Card>();
  private closingIds = new Set<number>();
  private L: Layout = { cols: 4, x0: 0, y0: 0, height: 0 };
  private paintedQuery = '';

  constructor(private m: Model, private h: ViewHandlers) {
    const plus = el('sw-gnew', 'button');
    plus.type = 'button';
    plus.tabIndex = -1;
    plus.setAttribute('aria-label', 'New tab');
    const ring = el('', 'span');
    ring.append(svg(icons.plus));
    plus.append(ring);
    const caption = el('sw-gnew-label');
    caption.setAttribute('aria-hidden', 'true');
    caption.textContent = 'New tab';
    this.newTile.append(plus, caption);
    // A pointer shortcut only (Ctrl+T is the keyboard way), and not an option of the list.
    this.newTile.setAttribute('aria-hidden', 'true');
    this.content.id = 'sw-list';
    this.content.setAttribute('role', 'listbox');
    this.content.setAttribute('aria-label', 'Tabs');
    this.content.append(this.newTile);
    this.scroller.append(this.content);
    this.root.append(this.bg, this.field, this.scroller);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('auxclick', (e) => {
      const id = e.button === 1 ? cardAt(e, '.sw-gcard') : null;
      if (id !== null) this.h.close(id);
    });
    this.scroller.addEventListener('scroll', () => this.paintVisible(), { passive: true });
  }

  mount(fieldRow: HTMLElement): void {
    this.field.append(fieldRow);
  }

  enter(): void {
    settle(this.root, () => {
      this.syncCards(false);
      this.layout();
    });
    this.scrollToSelection('auto');
    this.paintVisible();
    if (reducedMotion()) {
      this.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease' });
      return;
    }
    play(this.bg, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease' });
    play(this.field, [{ transform: 'translateY(-8px)' }, { transform: 'none' }], { duration: 320, easing: SPRING });
    fadeLayers(this.field, 0, 1, { duration: 320, easing: SPRING });
    // The page you were on shrinks into its card; the others rise in reading order.
    this.m.list.forEach((id, i) => {
      const c = this.cards.get(id);
      if (!c) return;
      if (id === this.m.startId) void flight(c.face, this.root, false, 12, 420, SPRING);
      else if (i < 24) play(c.inner, [{ opacity: 0, transform: 'translateY(16px) scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: SPRING, delay: 60 + Math.min(i, 12) * 20 });
    });
    play(this.newTile, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease', delay: 120 });
  }

  update(): void {
    this.syncCards(true);
    if (this.m.query !== this.paintedQuery) {
      this.paintedQuery = this.m.query;
      for (const [id, c] of this.cards) {
        const t = this.m.tab(id);
        if (t) this.paintLabel(t, c);
      }
    }
    this.place();
    this.scrollToSelection('smooth');
    this.paintVisible();
  }

  refresh(id: number): void {
    const t = this.m.tab(id);
    const c = this.cards.get(id);
    if (!t || !c) return;
    this.paintLabel(t, c);
    if (this.onScreen(this.m.list.indexOf(id))) this.paintMedia(id, c);
  }

  /** The card's picture, on a canvas sized for the current device scale. */
  private paintMedia(id: number, c: Card): void {
    c.media.size(CW, CH);
    this.m.paint(id, c.media);
  }

  visible(): number[] {
    const out: number[] = [];
    const sel = Math.max(0, this.m.sel);
    const order = [...this.m.list.keys()].sort((a, b) => Math.abs(a - sel) - Math.abs(b - sel));
    for (const i of order) if (this.onScreen(i)) out.push(this.m.list[i]);
    return out;
  }

  closing(id: number): void {
    this.closingIds.add(id);
  }

  async expand(id: number): Promise<void> {
    this.root.classList.add('sw-expanding');
    const c = this.cards.get(id);
    if (!c || reducedMotion()) return;
    await flight(c.face, this.root, true, 12, 360, EXPAND);
  }

  layout(): void {
    const W = this.root.clientWidth || window.innerWidth;
    const fw = Math.min(FIELD_W, W - 32);
    Object.assign(this.field.style, { left: `${Math.round((W - fw) / 2)}px`, width: `${fw}px` });
    (this.field.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(fw, FIELD_H, { blur: 1.5, scale: 20 });
    this.place();
    this.paintVisible();
  }

  columns(): number {
    return this.L.cols;
  }

  // ---- cards ----

  private syncCards(fadeIn: boolean): void {
    const want = new Set(this.m.list);
    for (const [id, c] of this.cards) if (!want.has(id)) this.drop(id, c);
    // Measured before any card is added: a card must get its place before its first style pass,
    // or it slides there from the corner.
    const L = this.computeLayout();
    this.m.list.forEach((id, i) => {
      if (this.cards.has(id)) return;
      const t = this.m.tab(id);
      if (!t) return;
      const c = this.makeCard(t, nextCard(this.m.list, i, this.cards) ?? this.newTile);
      this.cards.set(id, c);
      c.el.style.transform = this.at(i, L);
      if (fadeIn) play(c.inner, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease' });
    });
  }

  private makeCard(t: Tab, before: HTMLElement): Card {
    const card = el('sw-gcard');
    card.id = optionId(t.id);
    card.dataset.id = String(t.id);
    card.setAttribute('role', 'option');
    const inner = el('sw-gin');
    const face = el('sw-gface');
    const media = new Media(22);
    media.size(CW, CH);
    face.append(media.root, el('sw-rim', 'span'));
    const close = el('sw-x', 'button');
    close.type = 'button';
    close.tabIndex = -1;
    close.setAttribute('aria-hidden', 'true');
    close.append(svg(icons.closeSmall));
    setTip(close, 'Close tab', 'Ctrl+W');
    const label = el('sw-glabel');
    label.setAttribute('aria-hidden', 'true');
    inner.append(face, close, label);
    card.append(inner);
    this.content.insertBefore(card, before);
    const c: Card = { el: card, inner, face, media, label };
    this.paintLabel(t, c);
    return c;
  }

  private paintLabel(t: Tab, c: Card): void {
    if (!labelChanged(c.label, t, this.m)) return;
    const l = labelParts(t, this.m);
    const title = el('t', 'span');
    title.append(l.title);
    const host = el('h', 'span');
    host.append(l.detail);
    const txt = el('txt', 'span');
    txt.append(title, host);
    c.label.replaceChildren(favicon(t, 16), txt);
    c.el.setAttribute('aria-label', cardName(t, this.m));
  }

  /** Paint the pictures of the cards in (or just below) the scrolled view. */
  private paintVisible(): void {
    this.m.list.forEach((id, i) => {
      const c = this.cards.get(id);
      if (c && this.onScreen(i, CH)) this.paintMedia(id, c);
    });
  }

  private onScreen(i: number, margin = 0): boolean {
    if (i < 0) return false;
    const L = this.L;
    const y = L.y0 + Math.floor(i / L.cols) * (CH + LABEL + ROW_GAP);
    const top = this.scroller.scrollTop;
    const height = this.scroller.clientHeight || window.innerHeight;
    return y + CH + LABEL >= top - margin && y <= top + height + margin;
  }

  private drop(id: number, c: Card): void {
    this.cards.delete(id);
    c.el.removeAttribute('id');
    c.el.removeAttribute('role');
    c.el.style.pointerEvents = 'none';
    const lift = this.closingIds.delete(id);
    const anim = play(c.inner, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: lift ? 'translateY(-12px)' : 'none' }], { duration: DROP_MS, easing: SPRING, fill: 'forwards' });
    if (anim) void anim.finished.catch(() => undefined).then(() => c.el.remove());
    else c.el.remove();
  }

  private computeLayout(): Layout {
    const W = this.scroller.clientWidth || this.root.clientWidth || window.innerWidth;
    const H = this.root.clientHeight || window.innerHeight;
    const cols = Math.max(1, Math.min(MAX_COLS, Math.floor((W - 2 * SIDE + COL_GAP) / (CW + COL_GAP))));
    // Sized for every tab and the New tab card, so the matches keep their places while you type.
    const items = this.m.all.length + 1;
    const used = Math.max(1, Math.min(cols, items));
    const rows = Math.max(1, Math.ceil(items / cols));
    const blockW = used * CW + (used - 1) * COL_GAP;
    const blockH = rows * (CH + LABEL) + (rows - 1) * ROW_GAP;
    const x0 = Math.round((W - blockW) / 2);
    const y0 = Math.max(24, Math.round((H - BAND - blockH) / 2) + 9);
    return { cols, x0, y0, height: y0 + blockH + 40 };
  }

  private at(i: number, L: Layout): string {
    const x = L.x0 + (i % L.cols) * (CW + COL_GAP);
    const y = L.y0 + Math.floor(i / L.cols) * (CH + LABEL + ROW_GAP);
    return `translate(${x}px, ${y}px)`;
  }

  private place(): void {
    const L = this.computeLayout();
    this.L = L;
    this.content.style.height = `${L.height}px`;
    const selId = this.m.list[this.m.sel];
    this.m.list.forEach((id, i) => {
      const c = this.cards.get(id);
      if (!c) return;
      c.el.style.transform = this.at(i, L);
      c.el.classList.toggle('sel', id === selId);
      c.el.setAttribute('aria-selected', String(id === selId));
    });
    this.newTile.classList.toggle('gone', !!this.m.query.trim());
    this.newTile.style.transform = this.at(this.m.list.length, L);
  }

  private scrollToSelection(behavior: ScrollBehavior): void {
    if (this.m.sel < 0) return;
    const L = this.L;
    const y = L.y0 + Math.floor(this.m.sel / L.cols) * (CH + LABEL + ROW_GAP);
    const top = y - 16;
    const bottom = y + CH + LABEL + 16;
    const view = this.scroller;
    const smooth = reducedMotion() ? 'auto' : behavior;
    if (top < view.scrollTop) view.scrollTo({ top, behavior: smooth });
    else if (bottom > view.scrollTop + view.clientHeight) view.scrollTo({ top: bottom - view.clientHeight, behavior: smooth });
  }

  private onClick(e: MouseEvent): void {
    if (e.button !== 0) return;
    const target = e.target as Element;
    const id = cardAt(e, '.sw-gcard');
    if (id !== null) {
      if (target.closest('.sw-x')) this.h.close(id);
      else this.h.open(id);
      return;
    }
    if (target.closest('.sw-gnew')) {
      this.h.newTab();
      return;
    }
    if (target.closest('.sw-gfield')) return;
    this.h.cancel();
  }
}
