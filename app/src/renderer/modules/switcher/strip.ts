// Strip (Settings › Tabs): a compact frosted panel of 192×120 cards centred over the dimmed
// page (TabSwitcherStrip board). Latched, the search field appears above it.
import { lens } from '../../glass';
import type { Tab } from '../../model';
import { cardAt, cardName, el, EXPAND, favicon, flight, glass, guardFavicons, labelHtml, nextCard, optionId, paintMedia, play, reducedMotion, settle, SPRING } from './parts';
import type { Model, View, ViewHandlers } from './types';

const CW = 192;
const GAP = 16;
const PAD = 28;
const PANEL_H = 212;
const CARD_TOP = 32;
const SIDE = 48;
const FIELD_W = 480;
const FIELD_MIN = 320;
const FIELD_H = 44;
const FIELD_GAP = 12;
const DROP_MS = 220;

interface Card {
  el: HTMLElement;
  inner: HTMLElement;
  face: HTMLElement;
  media: HTMLElement;
  label: HTMLElement;
}

export class StripView implements View {
  readonly root = el('div', 'sw-view sw-strip');
  private bg = el('div', 'sw-bg');
  private field = glass('sw-sfield');
  private panel = glass('sw-panel');
  private clip = el('div', 'sw-sclip');
  private row = el('div', 'sw-srow');
  private cards = new Map<number, Card>();
  private closingIds = new Set<number>();
  private panelW = 0;
  private lensTimer = 0;
  private paintedQuery = '';

  constructor(private m: Model, private h: ViewHandlers) {
    this.row.id = 'sw-list';
    this.row.setAttribute('role', 'listbox');
    this.row.setAttribute('aria-label', 'Tabs');
    this.clip.append(this.row);
    this.panel.append(this.clip);
    this.root.append(this.bg, this.panel, this.field);
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.root.addEventListener('auxclick', (e) => {
      const id = e.button === 1 ? cardAt(e, '.sw-scard') : null;
      if (id !== null) this.h.close(id);
    });
  }

  mount(fieldRow: HTMLElement): void {
    this.field.append(fieldRow);
  }

  enter(): void {
    settle(this.root, () => this.update());
    if (reducedMotion()) {
      this.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease' });
      return;
    }
    play(this.bg, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease' });
    play(this.panel, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: SPRING });
  }

  update(): void {
    this.syncCards();
    if (this.m.query !== this.paintedQuery) {
      this.paintedQuery = this.m.query;
      for (const [id, c] of this.cards) {
        const t = this.m.tab(id);
        if (t) this.paint(t, c);
      }
    }
    this.place();
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
    await flight(c.face, this.root, true, 10, 360, EXPAND);
  }

  layout(): void {
    this.place();
  }

  columns(): number {
    return 1;
  }

  private syncCards(): void {
    const want = new Set(this.m.list);
    for (const [id, c] of this.cards) if (!want.has(id)) this.drop(id, c);
    this.m.list.forEach((id, i) => {
      if (this.cards.has(id)) return;
      const t = this.m.tab(id);
      if (!t) return;
      const c = this.makeCard(t, nextCard(this.m.list, i, this.cards));
      this.cards.set(id, c);
      c.el.style.transform = `translate(${this.x(i)}px, ${CARD_TOP}px)`;
    });
  }

  private makeCard(t: Tab, before: HTMLElement | null): Card {
    const card = el('div', 'sw-scard');
    card.id = optionId(t.id);
    card.dataset.id = String(t.id);
    card.setAttribute('role', 'option');
    const inner = el('div', 'sw-sin');
    const face = el('div', 'sw-sface');
    const media = el('div', 'sw-media');
    face.append(media, el('span', 'sw-rim'));
    const label = el('div', 'sw-slabel');
    label.setAttribute('aria-hidden', 'true');
    inner.append(face, label);
    card.append(inner);
    this.row.insertBefore(card, before);
    const c: Card = { el: card, inner, face, media, label };
    this.paint(t, c);
    return c;
  }

  private paint(t: Tab, c: Card): void {
    c.label.innerHTML = `<span class="fav">${favicon(t, 14)}</span><span class="t">${labelHtml(t, this.m).title}</span>`;
    guardFavicons(c.label);
    paintMedia(c.media, t, this.m.thumb(t.id), 18);
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

  private x(i: number): number {
    return PAD + i * (CW + GAP);
  }

  private place(): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const n = this.m.list.length;
    const content = this.x(n) - GAP + PAD;
    const width = Math.max(PAD * 2 + CW, Math.min(content, W - 2 * SIDE));
    const left = Math.round((W - width) / 2);
    const top = Math.round((H - PANEL_H) / 2);
    Object.assign(this.panel.style, { left: `${left}px`, top: `${top}px`, width: `${width}px` });
    this.setLens(width);

    const selId = this.m.list[this.m.sel];
    this.m.list.forEach((id, i) => {
      const c = this.cards.get(id);
      if (!c) return;
      c.el.style.transform = `translate(${this.x(i)}px, ${CARD_TOP}px)`;
      c.el.classList.toggle('sel', id === selId);
      c.el.setAttribute('aria-selected', String(id === selId));
    });
    // More cards than fit: keep the selected one in view, centred where possible.
    const centre = this.x(Math.max(0, this.m.sel)) + CW / 2;
    const shift = content > width ? Math.max(width - content, Math.min(0, width / 2 - centre)) : 0;
    this.row.style.transform = `translateX(${shift}px)`;
    const fw = Math.min(FIELD_W, W - 32, Math.max(FIELD_MIN, width));
    Object.assign(this.field.style, { left: `${Math.round((W - fw) / 2)}px`, top: `${top - FIELD_GAP - FIELD_H}px`, width: `${fw}px` });
    (this.field.querySelector('.lens') as HTMLElement).style.backdropFilter = lens(fw, FIELD_H, { blur: 6, scale: 16 });
    this.root.classList.toggle('latched', this.m.latched);
  }

  private setLens(width: number): void {
    if (width === this.panelW) return;
    const lensEl = this.panel.querySelector('.lens') as HTMLElement;
    const apply = () => {
      this.panel.classList.remove('morphing');
      lensEl.style.backdropFilter = lens(width, PANEL_H, { radius: 24, blur: 18, scale: 22 });
    };
    const first = this.panelW === 0;
    this.panelW = width;
    window.clearTimeout(this.lensTimer);
    if (first) {
      apply();
      return;
    }
    this.panel.classList.add('morphing');
    this.lensTimer = window.setTimeout(apply, 440);
  }

  private onClick(e: MouseEvent): void {
    const id = cardAt(e, '.sw-scard');
    if (id !== null) {
      this.h.open(id);
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest('.sw-panel') || target.closest('.sw-sfield')) return;
    this.h.cancel();
  }
}
