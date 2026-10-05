// Grid (Settings › Tabs): every tab as a 291×182 card over the blurred page, in reading order,
// with the search field in the tab bar's place and a New tab card at the end (TabOverview board).
import { lens } from '../../glass';
import { icons } from '../../icons';
import type { Tab } from '../../model';
import { cardAt, cardName, el, EXPAND, favicon, flight, glass, guardFavicons, labelHtml, nextCard, optionId, paintMedia, play, reducedMotion, settle, SPRING } from './parts';
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
  media: HTMLElement;
  label: HTMLElement;
}

interface Layout {
  cols: number;
  x0: number;
  y0: number;
  height: number;
}

export class GridView implements View {
  readonly root = el('div', 'sw-view sw-grid');
  private bg = el('div', 'sw-bg');
  private field = glass('sw-gfield');
  private scroller = el('div', 'sw-gscroll');
  private content = el('div', 'sw-gcontent');
  private newTile = el('div', 'sw-gnew-wrap', `<button type="button" class="sw-gnew" tabindex="-1" aria-label="New tab"><span>${icons.plus}</span></button><div class="sw-gnew-label" aria-hidden="true">New tab</div>`);
  private cards = new Map<number, Card>();
  private closingIds = new Set<number>();
  private L: Layout = { cols: 4, x0: 0, y0: 0, height: 0 };
  private paintedQuery = '';

  constructor(private m: Model, private h: ViewHandlers) {
    this.content.id = 'sw-list';
    this.content.setAttribute('role', 'listbox');
    this.content.setAttribute('aria-label', 'Tabs');
    // A pointer shortcut only (Ctrl+T is the keyboard way), and not an option of the list.
    this.newTile.setAttribute('aria-hidden', 'true');
    this.content.append(this.newTile);
    this.scroller.append(this.content);
    this.root.append(this.bg, this.field, this.scroller);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('auxclick', (e) => {
      const id = e.button === 1 ? cardAt(e, '.sw-gcard') : null;
      if (id !== null) this.h.close(id);
    });
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
    if (reducedMotion()) {
      this.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease' });
      return;
    }
    play(this.bg, [{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease' });
    play(this.field, [{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: SPRING });
    // The page you were on shrinks into its card; the others rise in reading order.
    this.m.list.forEach((id, i) => {
      const c = this.cards.get(id);
      if (!c) return;
      if (id === this.m.startId) void flight(c.face, this.root, false, 12, 420, SPRING);
      else play(c.inner, [{ opacity: 0, transform: 'translateY(16px) scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: SPRING, delay: 60 + Math.min(i, 12) * 20 });
    });
    play(this.newTile, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease', delay: 120 });
  }

  update(): void {
    this.syncCards(true);
    if (this.m.query !== this.paintedQuery) {
      this.paintedQuery = this.m.query;
      for (const [id, c] of this.cards) {
        const t = this.m.tab(id);
        if (t) this.paint(t, c);
      }
    }
    this.place();
    this.scrollToSelection('smooth');
  }

  refresh(id: number): void {
    const t = this.m.tab(id);
    const c = this.cards.get(id);
    if (t && c) this.paint(t, c);
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
    const W = window.innerWidth;
    const fw = Math.min(FIELD_W, W - 32);
    Object.assign(this.field.style, { left: `${Math.round((W - fw) / 2)}px`, width: `${fw}px` });
    (this.field.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(fw, FIELD_H, { blur: 1.5, scale: 20 });
    this.clipAroundWindowControls();
    this.place();
  }

  columns(): number {
    return this.L.cols;
  }

  // ---- cards ----

  private syncCards(fadeIn: boolean): void {
    const want = new Set(this.m.list);
    for (const [id, c] of this.cards) if (!want.has(id)) this.drop(id, c);
    // Measured before any card is added: a card must get its place before its first style
    // pass, or it slides there from the corner.
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
    const card = el('div', 'sw-gcard');
    card.id = optionId(t.id);
    card.dataset.id = String(t.id);
    card.setAttribute('role', 'option');
    const inner = el('div', 'sw-gin');
    const face = el('div', 'sw-gface');
    const media = el('div', 'sw-media');
    face.append(media, el('span', 'sw-rim'));
    const close = el('button', 'sw-x', icons.closeSmall);
    (close as HTMLButtonElement).type = 'button';
    close.tabIndex = -1;
    close.title = 'Close tab';
    close.setAttribute('aria-hidden', 'true');
    const label = el('div', 'sw-glabel');
    label.setAttribute('aria-hidden', 'true');
    inner.append(face, close, label);
    card.append(inner);
    this.content.insertBefore(card, before);
    const c: Card = { el: card, inner, face, media, label };
    this.paint(t, c);
    return c;
  }

  private paint(t: Tab, c: Card): void {
    const l = labelHtml(t, this.m);
    c.label.innerHTML = `<span class="fav">${favicon(t, 16)}</span><span class="txt"><span class="t">${l.title}</span><span class="h">${l.detail}</span></span>`;
    guardFavicons(c.label);
    paintMedia(c.media, t, this.m.thumb(t.id), 22);
    c.el.setAttribute('aria-label', cardName(t, this.m));
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
    const W = this.scroller.clientWidth || window.innerWidth;
    const H = window.innerHeight;
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

  private showNew(): boolean {
    return !this.m.query.trim();
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
    this.newTile.hidden = !this.showNew();
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

  /** The window controls stay sharp and clickable: the blur leaves a hole exactly where they are. */
  private clipAroundWindowControls(): void {
    const r = document.getElementById('winctl')?.getBoundingClientRect();
    if (!r || r.width === 0 || r.bottom <= 0) {
      this.bg.style.clipPath = '';
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const k = r.height / 2;
    const hole = `M${r.left + k} ${r.top}H${r.right - k}A${k} ${k} 0 0 1 ${r.right - k} ${r.bottom}H${r.left + k}A${k} ${k} 0 0 1 ${r.left + k} ${r.top}Z`;
    this.bg.style.clipPath = `path(evenodd, 'M0 0H${W}V${H}H0Z${hole}')`;
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
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
